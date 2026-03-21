import { Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { toHttpException } from '../../common/errors/error-handler';
import { Errors } from '../../common/errors/app-error';
import { Profile } from 'passport-google-oauth20';
import { AuthService } from './auth.service';
import type { AuthTokens } from './types/auth.types';
import type {
  RequestWithJwtAccessPayload,
  RequestWithJwtRefreshPayload,
} from './types/auth-request.types';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtRefreshAuthGuard } from './guards/jwt-refresh-auth.guard';
import { AppConfigService } from '../../config/app-config.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly appConfigService: AppConfigService,
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
  getMe(@Req() req: RequestWithJwtAccessPayload) {
    return {
      user: req.user,
    };
  }

  @Post('refresh')
  @UseGuards(JwtRefreshAuthGuard)
  async refresh(
    @Req() req: RequestWithJwtRefreshPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawRefreshToken = this.extractRefreshToken(req);
    if (!rawRefreshToken) {
      throw toHttpException(Errors.invalidRefreshToken());
    }

    const tokensResult = await this.authService.refreshTokens(
      req.user,
      rawRefreshToken,
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
    @Req() req: RequestWithJwtRefreshPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawRefreshToken = this.extractRefreshToken(req);
    if (!rawRefreshToken) {
      throw toHttpException(Errors.invalidRefreshToken());
    }

    const result = await this.authService.logoutSession(
      req.user,
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
    @Req() req: RequestWithJwtAccessPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.logoutAllSessions(req.user.uid);
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

  private extractRefreshToken(
    req: RequestWithJwtRefreshPayload,
  ): string | undefined {
    const requestRecord = req as unknown as {
      cookies?: Record<string, unknown>;
      body?: Record<string, unknown>;
    };

    const cookieToken = requestRecord.cookies?.refreshToken;
    if (typeof cookieToken === 'string') {
      return cookieToken;
    }

    const bodyToken = requestRecord.body?.refreshToken;
    return typeof bodyToken === 'string' ? bodyToken : undefined;
  }
}
