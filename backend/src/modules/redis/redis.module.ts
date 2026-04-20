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
          lazyConnect: false,
        }),
    },
    RedisService,
  ],
  exports: [RedisService],
})
export class RedisModule {}
