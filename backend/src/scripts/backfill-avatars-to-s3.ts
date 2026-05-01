import 'dotenv/config';

import { DataSource } from 'typeorm';
import { User } from '../modules/user/user.entity';
import { AppConfigService } from '../config/app-config.service';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

function isLocalPath(p: string): boolean {
  return path.isAbsolute(p);
}

function extForMime(mime: string | null | undefined): string {
  switch ((mime ?? '').toLowerCase()) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/jpeg':
    default:
      return 'jpg';
  }
}

async function main() {
  // AppConfigService expects Nest ConfigService; we can construct it directly for scripts.
  const cfg = new AppConfigService(new ConfigService());

  const dbUrl = cfg.dbUrl;
  const ds = new DataSource({
    type: 'postgres',
    url: dbUrl,
    entities: [User],
  });
  await ds.initialize();

  const s3 = new S3Client({
    region: cfg.s3Region,
    endpoint: cfg.s3Endpoint,
    credentials: {
      accessKeyId: cfg.s3AccessKeyId,
      secretAccessKey: cfg.s3SecretAccessKey,
    },
    forcePathStyle: Boolean(cfg.s3Endpoint),
  });

  const repo = ds.getRepository(User);

  // TypeORM doesn't support OR easily in `find` with null checks across columns,
  // so we do it in a query and then load entities.
  const rows = await repo
    .createQueryBuilder('u')
    .select([
      'u.id',
      'u.cachedGoogleAvatarPath',
      'u.customAvatarPath',
      'u.cachedGoogleAvatarMime',
      'u.customAvatarMime',
    ])
    .where(
      '(u."cachedGoogleAvatarPath" IS NOT NULL OR u."customAvatarPath" IS NOT NULL)',
    )
    .getMany();

  let migrated = 0;
  for (const u of rows) {
    const updates: Partial<User> = {};

    if (u.cachedGoogleAvatarPath && isLocalPath(u.cachedGoogleAvatarPath)) {
      const p = u.cachedGoogleAvatarPath;
      try {
        const buffer = await fs.readFile(p);
        const ext = extForMime(u.cachedGoogleAvatarMime);
        const key = `avatars/google/${u.id}/${randomUUID()}.${ext}`;
        await s3.send(
          new PutObjectCommand({
            Bucket: cfg.s3Bucket,
            Key: key,
            Body: buffer,
            ContentType: u.cachedGoogleAvatarMime ?? 'image/jpeg',
          }),
        );
        updates.cachedGoogleAvatarPath = key;
        await fs.unlink(p).catch(() => {});
        migrated++;
      } catch (err) {
        console.warn(`[backfill] failed google avatar for ${u.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (u.customAvatarPath && isLocalPath(u.customAvatarPath)) {
      const p = u.customAvatarPath;
      try {
        const buffer = await fs.readFile(p);
        const ext = extForMime(u.customAvatarMime);
        const key = `avatars/custom/${u.id}/${randomUUID()}.${ext}`;
        await s3.send(
          new PutObjectCommand({
            Bucket: cfg.s3Bucket,
            Key: key,
            Body: buffer,
            ContentType: u.customAvatarMime ?? 'image/jpeg',
          }),
        );
        updates.customAvatarPath = key;
        await fs.unlink(p).catch(() => {});
        migrated++;
      } catch (err) {
        console.warn(`[backfill] failed custom avatar for ${u.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (Object.keys(updates).length > 0) {
      await repo.update(u.id, updates);
    }
  }

  console.log(`[backfill] done. migrated_files=${migrated}`);
  await ds.destroy();
}

void main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

