import { Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { toHttpException } from '../../common/errors/error-handler';
import { Errors } from '../../common/errors/app-error';
import { Profile } from 'passport-google-oauth20';
import { AuthService } from './auth.service';
import type { AuthTokens, JwtRefreshPayload, JwtAccessPayload } from './types/auth.types';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtRefreshAuthGuard } from './guards/jwt-refresh-auth.guard';
import { AppConfigService } from '../../config/app-config.service';
import { User } from './decorators/current-user.decorator';
import { AccessToken } from './decorators/access-token.decorator';
import { RefreshPayload } from './decorators/current-refresh-payload.decorator';
import { RefreshToken } from './decorators/refresh-token.decorator';
import { ClientInfo } from './decorators/client-info.decorator';
import type { ClientInfo as ClientInfoType } from './decorators/client-info.decorator';
import { User as UserEntity } from '../user/user.entity';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly appConfigService: AppConfigService,
    private readonly jwtService: JwtService,
  ) {}

  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleAuth() {
    // Guard redirects to Google OAuth consent screen.
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthCallback(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const googleProfile = req.user as unknown as Profile;
    const loginResult = await this.authService.handleGoogleLogin(googleProfile);
    if (loginResult.isErr()) {
      throw toHttpException(loginResult.error);
    }
    const { user: dbUser, authUser } = loginResult.value;
    const tokensResult = await this.authService.issueTokens({
      userId: dbUser.id,
      providerId: authUser.providerId,
      email: authUser.email,
      provider: authUser.provider,
      displayName: authUser.displayName,
    });
    if (tokensResult.isErr()) {
      throw toHttpException(tokensResult.error);
    }
    const tokens = tokensResult.value;
    this.setAuthCookies(res, tokens);
    return {
      message: 'Google authentication successful',
      user: dbUser,
      tokens,
    };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@User() user: UserEntity) {
    return {
      user,
    };
  }

  @Post('refresh')
  @UseGuards(JwtRefreshAuthGuard)
  async refresh(
    @RefreshPayload() payload: JwtRefreshPayload,
    @RefreshToken() rawRefreshToken: string | undefined,
    @ClientInfo() clientInfo: ClientInfoType,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!rawRefreshToken) {
      throw toHttpException(Errors.invalidRefreshToken());
    }

    const tokensResult = await this.authService.refreshTokens(
      payload,
      rawRefreshToken,
      clientInfo,
    );
    if (tokensResult.isErr()) {
      throw toHttpException(tokensResult.error);
    }
    const tokens = tokensResult.value;
    this.setAuthCookies(res, tokens);
    return {
      message: 'Token refreshed successfully',
      tokens,
    };
  }

  @Post('logout')
  @UseGuards(JwtRefreshAuthGuard)
  async logout(
    @RefreshPayload() payload: JwtRefreshPayload,
    @RefreshToken() rawRefreshToken: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!rawRefreshToken) {
      throw toHttpException(Errors.invalidRefreshToken());
    }

    const result = await this.authService.logoutSession(
      payload,
      rawRefreshToken,
    );
    if (result.isErr()) {
      throw toHttpException(result.error);
    }

    this.clearAuthCookies(res);
    return {
      message: 'Logged out successfully',
    };
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  async logoutAll(
    @User() user: UserEntity,
    @AccessToken() rawAccessToken: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!rawAccessToken) {
      throw toHttpException(Errors.unauthorized());
    }

    const decoded = this.jwtService.decode(rawAccessToken) as JwtAccessPayload;
    if (!decoded || !decoded.jti) {
      throw toHttpException(Errors.unauthorized());
    }

    const result = await this.authService.logoutWithAccessToken(
      decoded.jti,
      user.id,
    );
    if (result.isErr()) {
      throw toHttpException(result.error);
    }

    this.clearAuthCookies(res);
    return {
      message: 'Logged out from all sessions successfully',
    };
  }

  private setAuthCookies(res: Response, tokens: AuthTokens): void {
    res.cookie('accessToken', tokens.accessToken, {
      httpOnly: true,
      secure: this.appConfigService.isProduction,
      sameSite: 'lax',
      maxAge: this.appConfigService.accessCookieMaxAgeMs,
    });

    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: this.appConfigService.isProduction,
      sameSite: 'lax',
      maxAge: this.appConfigService.refreshCookieMaxAgeMs,
    });
  }

  private clearAuthCookies(res: Response): void {
    res.cookie('accessToken', '', {
      httpOnly: true,
      secure: this.appConfigService.isProduction,
      sameSite: 'lax',
      maxAge: 0,
    });

    res.cookie('refreshToken', '', {
      httpOnly: true,
      secure: this.appConfigService.isProduction,
      sameSite: 'lax',
      maxAge: 0,
    });
  }

}
