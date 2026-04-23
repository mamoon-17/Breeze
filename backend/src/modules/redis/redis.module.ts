import { Module, Global } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppConfigService } from '../../config/app-config.service';
import { RedisService } from './redis.service';
import { IOREDIS_CLIENT } from './redis.constants';

@Global()
@Module({
  providers: [
    {
      provide: IOREDIS_CLIENT,
      inject: [AppConfigService],
      useFactory: (cfg: AppConfigService): Redis =>
        new Redis({
          host: cfg.redisHost,
          port: cfg.redisPort,
          password: cfg.redisPassword,
          db: cfg.redisDb,
          keyPrefix: 'breeze:',
          // Fail fast on startup: connect once, no retries.
          lazyConnect: true,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 0,
          connectTimeout: 2_000,
          retryStrategy: () => null,
        }),
    },
    RedisService,
  ],
  exports: [RedisService],
})
export class RedisModule {}
