import { Module, Global } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { redisStore } from 'cache-manager-ioredis-yet';
import { AppConfigService } from '../../config/app-config.service';
import { RedisService } from './redis.service';

@Global()
@Module({
  imports: [
    CacheModule.registerAsync({
      inject: [AppConfigService],
      useFactory: async (appConfigService: AppConfigService) => ({
        store: await redisStore({
          host: appConfigService.redisHost,
          port: appConfigService.redisPort,
          password: appConfigService.redisPassword,
          db: appConfigService.redisDb,
          ttl: 0,
          keyPrefix: 'breeze:',
        }),
      }),
    }),
  ],
  providers: [RedisService],
  exports: [RedisService, CacheModule],
})
export class RedisModule {}
