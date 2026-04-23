import {
  Module,
  NestModule,
  MiddlewareConsumer,
  RequestMethod,
  Provider,
} from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PassportModule } from '@nestjs/passport';
import { GoogleStrategy } from './strategy/google.strategy';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategy/jwt.strategy';
import { JwtRefreshStrategy } from './strategy/jwt-refresh.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtRefreshAuthGuard } from './guards/jwt-refresh-auth.guard';
import { StepUpRequiredGuard } from './guards/step-up-required.guard';
import { UserModule } from '../user/user.module';
import { RefreshSession } from './refresh-session.entity';
import { RefreshEvent } from './refresh-event.entity';
import { RefreshSessionCleanupService } from './refresh-session-cleanup.service';
import { RefreshEventService } from './refresh-event.service';
import { TokenBlacklistService } from './token-blacklist.service';
import { AnomalyDetectionService } from './anomaly-detection.service';
import { NotificationService } from './notification.service';
import { OriginCheckMiddleware } from './middlewares/origin-check.middleware';
import { GoogleOAuthGuard } from './guards/google-oauth.guard';

const googleOAuthEnabled = Boolean(
  process.env.GOOGLE_CLIENT_ID?.trim() &&
    process.env.GOOGLE_CLIENT_SECRET?.trim(),
);

const googleStrategyProviders: Provider[] = googleOAuthEnabled
  ? [GoogleStrategy]
  : [];

@Module({
  imports: [
    JwtModule.register({}),
    PassportModule.register({}),
    UserModule,
    TypeOrmModule.forFeature([RefreshSession, RefreshEvent]),
  ],
  controllers: [AuthController],
  providers: [
    ...googleStrategyProviders,
    GoogleOAuthGuard,
    JwtStrategy,
    JwtRefreshStrategy,
    JwtAuthGuard,
    JwtRefreshAuthGuard,
    StepUpRequiredGuard,
    AuthService,
    RefreshSessionCleanupService,
    RefreshEventService,
    TokenBlacklistService,
    AnomalyDetectionService,
    NotificationService,
  ],
  exports: [
    AuthService,
    JwtAuthGuard,
    JwtRefreshAuthGuard,
    StepUpRequiredGuard,
    AnomalyDetectionService,
    TokenBlacklistService,
  ],
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
