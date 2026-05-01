import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { promises as fs, createReadStream } from 'fs';
import * as path from 'path';
import { User } from './user.entity';
import { AppConfigService } from '../../config/app-config.service';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Readable } from 'stream';

const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5 MB hard cap
const DOWNLOAD_TIMEOUT_MS = 10_000;

export interface AvatarBinary {
  path: string;
  mime: string;
  stream: Readable;
}

/**
 * Owns everything to do with persisted avatar bytes: caching Google pictures
 * so Google's signed-URL expiry never breaks our UI, accepting user uploads,
 * and serving the effective image via a stable local URL. The source of truth
 * for "which avatar does this user want" lives on `User`; this service is
 * purely I/O.
 */
@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);
  private readonly storageDir = path.resolve(
    process.env.AVATAR_STORAGE_DIR ?? path.join(process.cwd(), 'storage', 'avatars'),
  );
  private readonly s3: S3Client;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly appConfig: AppConfigService,
  ) {
    this.s3 = new S3Client({
      region: appConfig.s3Region,
      endpoint: appConfig.s3Endpoint,
      credentials: {
        accessKeyId: appConfig.s3AccessKeyId,
        secretAccessKey: appConfig.s3SecretAccessKey,
      },
      forcePathStyle: Boolean(appConfig.s3Endpoint),
    });
  }

  async onModuleInit() {
    // Legacy local storage directory. We keep it so older rows with absolute
    // paths (pre-migration) can still be served if they exist.
    await fs.mkdir(this.storageDir, { recursive: true });
  }

  /**
   * Download and cache the Google profile picture for a user. Skips the
   * download when the URL is unchanged and we already have a file on disk,
   * so repeat sign-ins stay cheap. Errors are logged and swallowed — a
   * missing avatar cache should never block sign-in.
   */
  async cacheGoogleAvatar(user: User, googleUrl: string | undefined | null): Promise<void> {
    if (!googleUrl) return;

    if (
      user.picture === googleUrl &&
      user.cachedGoogleAvatarPath
    ) {
      // If this is already an S3 key, assume it's present (avoid a HEAD call on every sign-in).
      // If it looks like a legacy local path, keep the old fileExists behavior.
      if (!this.isLocalPath(user.cachedGoogleAvatarPath)) return;
      if (await this.fileExists(user.cachedGoogleAvatarPath)) return;
      return;
    }

    try {
      const { buffer, mime } = await this.downloadImage(googleUrl);
      const ext = this.extForMime(mime).replace(/^\./, '');
      const key = `avatars/google/${user.id}/${randomUUID()}.${ext}`;
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.appConfig.s3Bucket,
          Key: key,
          Body: buffer,
          ContentType: mime,
        }),
      );

      const oldPath = user.cachedGoogleAvatarPath;

      await this.userRepository.update(user.id, {
        cachedGoogleAvatarPath: key,
        cachedGoogleAvatarMime: mime,
        avatarVersion: this.nextVersion(user.avatarVersion),
      });

      if (oldPath && oldPath !== key) {
        await this.safeDelete(oldPath);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to cache Google avatar for user ${user.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async saveCustomAvatar(
    userId: string,
    file: { buffer: Buffer; mimetype: string; size: number },
  ): Promise<User> {
    if (!file.buffer || file.size === 0) {
      throw new BadRequestException('Empty upload');
    }
    if (file.size > MAX_AVATAR_BYTES) {
      throw new BadRequestException('Avatar is too large (max 5 MB)');
    }
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported image type (${file.mimetype}). Allowed: JPEG, PNG, WEBP, GIF.`,
      );
    }

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const ext = this.extForMime(file.mimetype).replace(/^\./, '');
    const key = `avatars/custom/${user.id}/${randomUUID()}.${ext}`;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.appConfig.s3Bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );

    const oldPath = user.customAvatarPath;

    await this.userRepository.update(user.id, {
      customAvatarPath: key,
      customAvatarMime: file.mimetype,
      useGoogleAvatar: false,
      avatarVersion: this.nextVersion(user.avatarVersion),
    });

    if (oldPath && oldPath !== key) {
      await this.safeDelete(oldPath);
    }

    const updated = await this.userRepository.findOne({ where: { id: userId } });
    if (!updated) throw new NotFoundException('User vanished mid-update');
    return updated;
  }

  async clearCustomAvatar(userId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const oldPath = user.customAvatarPath;

    await this.userRepository.update(user.id, {
      customAvatarPath: null,
      customAvatarMime: null,
      useGoogleAvatar: true,
      avatarVersion: this.nextVersion(user.avatarVersion),
    });

    if (oldPath) {
      await this.safeDelete(oldPath);
    }

    const updated = await this.userRepository.findOne({ where: { id: userId } });
    if (!updated) throw new NotFoundException('User vanished mid-update');
    return updated;
  }

  /**
   * Resolve the file to serve for `GET /user/:id/avatar`. Returns `null` when
   * the user has no avatar of any kind so the HTTP layer can 404 and the
   * client falls back to initials.
   */
  async getAvatarBinary(userId: string): Promise<AvatarBinary | null> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) return null;

    const useGoogle = user.useGoogleAvatar;
    if (!useGoogle && user.customAvatarPath) {
      const mime = user.customAvatarMime ?? 'image/jpeg';
      const bin = await this.resolveBinary(user.customAvatarPath, mime);
      if (bin) return bin;
    }

    if (user.cachedGoogleAvatarPath) {
      const mime = user.cachedGoogleAvatarMime ?? 'image/jpeg';
      const bin = await this.resolveBinary(user.cachedGoogleAvatarPath, mime);
      if (bin) return bin;
    }

    return null;
  }

  private async resolveBinary(
    keyOrPath: string,
    mime: string,
  ): Promise<AvatarBinary | null> {
    if (this.isLocalPath(keyOrPath)) {
      if (!(await this.fileExists(keyOrPath))) return null;
      return { path: keyOrPath, mime, stream: createReadStream(keyOrPath) };
    }
    try {
      const res = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.appConfig.s3Bucket,
          Key: keyOrPath,
        }),
      );
      if (!res.Body) return null;
      return {
        path: keyOrPath,
        mime,
        stream: res.Body as unknown as Readable,
      };
    } catch {
      return null;
    }
  }

  private async downloadImage(url: string): Promise<{ buffer: Buffer; mime: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Upstream ${res.status}`);
      }
      const rawMime = res.headers.get('content-type') ?? 'image/jpeg';
      const mime = rawMime.split(';')[0].trim();
      if (!ALLOWED_MIMES.has(mime)) {
        throw new Error(`Upstream returned non-image content-type: ${mime}`);
      }
      const arrayBuffer = await res.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_AVATAR_BYTES) {
        throw new Error('Upstream image exceeds size limit');
      }
      return { buffer: Buffer.from(arrayBuffer), mime };
    } finally {
      clearTimeout(timer);
    }
  }

  private extForMime(mime: string): string {
    switch (mime) {
      case 'image/png':
        return '.png';
      case 'image/webp':
        return '.webp';
      case 'image/gif':
        return '.gif';
      case 'image/jpeg':
      default:
        return '.jpg';
    }
  }

  private isLocalPath(p: string): boolean {
    return path.isAbsolute(p);
  }

  private async fileExists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }

  private async safeDelete(keyOrPath: string): Promise<void> {
    if (this.isLocalPath(keyOrPath)) {
      try {
        await fs.unlink(keyOrPath);
      } catch (error) {
        this.logger.debug(
          `Failed to unlink old avatar ${keyOrPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return;
    }
    try {
      await this.s3.send(
        new DeleteObjectCommand({
          Bucket: this.appConfig.s3Bucket,
          Key: keyOrPath,
        }),
      );
    } catch (error) {
      this.logger.debug(
        `Failed to delete old avatar key ${keyOrPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private nextVersion(current: string | number | undefined): string {
    const n = Number(current ?? 0);
    return String((Number.isFinite(n) ? n : 0) + 1);
  }
}
