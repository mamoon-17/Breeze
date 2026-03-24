import { Module, NestModule, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GoogleStrategy } from './strategy/google.strategy';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategy/jwt.strategy';
import { JwtRefreshStrategy } from './strategy/jwt-refresh.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtRefreshAuthGuard } from './guards/jwt-refresh-auth.guard';
import { UserModule } from '../user/user.module';
import { RedisModule } from '../redis/redis.module';
import { RefreshSession } from './refresh-session.entity';
import { RefreshEvent } from './refresh-event.entity';
import { RefreshSessionCleanupService } from './refresh-session-cleanup.service';
import { RefreshEventService } from './refresh-event.service';
import { TokenBlacklistService } from './token-blacklist.service';
import { OriginCheckMiddleware } from './middlewares/origin-check.middleware';

@Module({
  imports: [
    JwtModule.register({}),
    UserModule,
    RedisModule,
    TypeOrmModule.forFeature([RefreshSession, RefreshEvent]),
  ],
  controllers: [AuthController],
  providers: [
    GoogleStrategy,
    JwtStrategy,
    JwtRefreshStrategy,
    JwtAuthGuard,
    JwtRefreshAuthGuard,
    AuthService,
    RefreshSessionCleanupService,
    RefreshEventService,
    TokenBlacklistService,
  ],
  exports: [AuthService, JwtAuthGuard, JwtRefreshAuthGuard],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(OriginCheckMiddleware)
      .forRoutes(
        { path: 'auth/refresh', method: RequestMethod.POST },
        { path: 'auth/logout', method: RequestMethod.POST },
      );
  }
}
