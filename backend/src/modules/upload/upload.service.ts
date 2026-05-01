import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppConfigService } from '../../config/app-config.service';

export interface UploadedAudio {
  url: string;
  contentType: string;
  size: number;
}

@Injectable()
export class UploadService {
  private readonly s3: S3Client;

  constructor(private readonly appConfig: AppConfigService) {
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

  async uploadAudio(
    userId: string,
    file: { buffer: Buffer; mimetype: string; size: number; originalname?: string },
  ): Promise<UploadedAudio> {
    if (!file?.buffer || file.size === 0) {
      throw new BadRequestException('Empty upload');
    }
    const contentType = (file.mimetype || '').toLowerCase();
    if (!contentType.startsWith('audio/')) {
      throw new BadRequestException(
        `Unsupported audio type (${file.mimetype ?? 'unknown'})`,
      );
    }

    const ext = this.extForMime(contentType) ?? this.safeExtFromName(file.originalname);
    const key = `audio/${userId}/${randomUUID()}${ext ? `.${ext}` : ''}`;

    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.appConfig.s3Bucket,
          Key: key,
          Body: file.buffer,
          ContentType: contentType,
          // NOTE: do not set ACL. Many buckets have Object Ownership = "Bucket owner enforced",
          // which rejects ACLs with AccessControlListNotSupported.
          // Make objects public via bucket policy / CloudFront if desired.
        }),
      );
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err && 'name' in err
            ? String((err as { name: unknown }).name)
            : String(err);
      throw new BadRequestException(`S3 upload failed: ${msg}`);
    }

    // Return a signed URL so private buckets still work locally/dev.
    // Note: AWS presigned URLs max out at 7 days.
    const url = await getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.appConfig.s3Bucket,
        Key: key,
      }),
      { expiresIn: 60 * 60 * 24 * 7 },
    );
    return { url, contentType, size: file.size };
  }

  private extForMime(mime: string): string | undefined {
    switch (mime) {
      case 'audio/webm':
        return 'webm';
      case 'audio/ogg':
      case 'audio/opus':
        return 'ogg';
      case 'audio/mpeg':
        return 'mp3';
      case 'audio/mp4':
        return 'm4a';
      case 'audio/wav':
      case 'audio/x-wav':
        return 'wav';
      default:
        return undefined;
    }
  }

  private safeExtFromName(name: string | undefined): string | undefined {
    if (!name) return undefined;
    const parts = name.split('.');
    if (parts.length < 2) return undefined;
    const ext = parts[parts.length - 1].toLowerCase().trim();
    if (!ext) return undefined;
    if (!/^[a-z0-9]{1,10}$/.test(ext)) return undefined;
    return ext;
  }
}

