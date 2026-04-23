import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { promises as fs, createReadStream, ReadStream } from 'fs';
import * as path from 'path';
import { User } from './user.entity';

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
  stream: ReadStream;
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

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async onModuleInit() {
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
      user.cachedGoogleAvatarPath &&
      (await this.fileExists(user.cachedGoogleAvatarPath))
    ) {
      return;
    }

    try {
      const { buffer, mime } = await this.downloadImage(googleUrl);
      const filename = `${user.id}-google-${randomUUID()}${this.extForMime(mime)}`;
      const dest = path.join(this.storageDir, filename);
      await fs.writeFile(dest, buffer);

      const oldPath = user.cachedGoogleAvatarPath;

      await this.userRepository.update(user.id, {
        cachedGoogleAvatarPath: dest,
        cachedGoogleAvatarMime: mime,
        avatarVersion: this.nextVersion(user.avatarVersion),
      });

      if (oldPath && oldPath !== dest) {
        await this.safeUnlink(oldPath);
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

    const filename = `${user.id}-custom-${randomUUID()}${this.extForMime(file.mimetype)}`;
    const dest = path.join(this.storageDir, filename);
    await fs.writeFile(dest, file.buffer);

    const oldPath = user.customAvatarPath;

    await this.userRepository.update(user.id, {
      customAvatarPath: dest,
      customAvatarMime: file.mimetype,
      useGoogleAvatar: false,
      avatarVersion: this.nextVersion(user.avatarVersion),
    });

    if (oldPath && oldPath !== dest) {
      await this.safeUnlink(oldPath);
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
      await this.safeUnlink(oldPath);
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
    if (
      !useGoogle &&
      user.customAvatarPath &&
      (await this.fileExists(user.customAvatarPath))
    ) {
      return {
        path: user.customAvatarPath,
        mime: user.customAvatarMime ?? 'image/jpeg',
        stream: createReadStream(user.customAvatarPath),
      };
    }

    if (
      user.cachedGoogleAvatarPath &&
      (await this.fileExists(user.cachedGoogleAvatarPath))
    ) {
      return {
        path: user.cachedGoogleAvatarPath,
        mime: user.cachedGoogleAvatarMime ?? 'image/jpeg',
        stream: createReadStream(user.cachedGoogleAvatarPath),
      };
    }

    return null;
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

  private async fileExists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }

  private async safeUnlink(p: string): Promise<void> {
    try {
      await fs.unlink(p);
    } catch (error) {
      this.logger.debug(
        `Failed to unlink old avatar ${p}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private nextVersion(current: string | number | undefined): string {
    const n = Number(current ?? 0);
    return String((Number.isFinite(n) ? n : 0) + 1);
  }
}
