import { Module } from '@nestjs/common';
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
import { RefreshSession } from './refresh-session.entity';
import { RefreshSessionCleanupService } from './refresh-session-cleanup.service';

@Module({
  imports: [
    JwtModule.register({}),
    UserModule,
    TypeOrmModule.forFeature([RefreshSession]),
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
  ],
  exports: [AuthService, JwtAuthGuard, JwtRefreshAuthGuard],
})
export class AuthModule {}
