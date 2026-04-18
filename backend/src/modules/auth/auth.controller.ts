import { Controller, Get, Post, Delete, Param, Req, Res, UseGuards } from '@nestjs/common';
import { FamilyIdParamDto } from './dto/family-id-param.dto';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { toHttpException } from '../../common/errors/error-handler';
import { Errors } from '../../common/errors/app-error';
import { Profile } from 'passport-google-oauth20';
import { AuthService, RefreshTokensResult } from './auth.service';
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
import { SocketStateService } from '../socket/socket-state.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly appConfigService: AppConfigService,
    private readonly jwtService: JwtService,
    private readonly socketState: SocketStateService,
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
    @ClientInfo() clientInfo: ClientInfoType,
  ) {
    const googleProfile = req.user as unknown as Profile;
    const loginResult = await this.authService.handleGoogleLogin(googleProfile);
    if (loginResult.isErr()) {
      throw toHttpException(loginResult.error);
    }
    const { user: dbUser, authUser } = loginResult.value;
    const tokensResult = await this.authService.issueTokens(
      {
        userId: dbUser.id,
        providerId: authUser.providerId,
        email: authUser.email,
        provider: authUser.provider,
        displayName: authUser.displayName,
      },
      clientInfo,
    );
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
    
    const response: {
      message: string;
      tokens: AuthTokens;
      requiresStepUp?: boolean;
      riskLevel?: string;
    } = {
      message: 'Token refreshed successfully',
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiresIn: tokens.accessTokenExpiresIn,
        refreshTokenExpiresIn: tokens.refreshTokenExpiresIn,
      },
    };

    if (tokens.requiresStepUp) {
      response.requiresStepUp = true;
      response.riskLevel = tokens.riskLevel;
    }

    return response;
  }

  @Post('logout')
  @UseGuards(JwtRefreshAuthGuard)
  async logout(
    @RefreshPayload() payload: JwtRefreshPayload,
    @RefreshToken() rawRefreshToken: string | undefined,
    @AccessToken() rawAccessToken: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!rawRefreshToken) {
      throw toHttpException(Errors.invalidRefreshToken());
    }

    let accessTokenJti: string | undefined;
    if (rawAccessToken) {
      const decoded = this.jwtService.decode(rawAccessToken) as JwtAccessPayload | null;
      if (decoded?.jti) {
        accessTokenJti = decoded.jti;
      }
    }

    const result = await this.authService.logoutSession(
      payload,
      rawRefreshToken,
      accessTokenJti,
    );
    if (result.isErr()) {
      throw toHttpException(result.error);
    }

    // Force-disconnect active websocket sessions for this user.
    this.socketState.disconnectUser(payload.uid, 'logout');

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

    // Force-disconnect active websocket sessions for this user.
    this.socketState.disconnectUser(user.id, 'logout_all');

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

  /**
   * Check if step-up authentication is required for the current session
   */
  @Get('step-up/status')
  @UseGuards(JwtRefreshAuthGuard)
  async getStepUpStatus(@RefreshPayload() payload: JwtRefreshPayload) {
    const result = await this.authService.checkStepUpRequired(
      payload.uid,
      payload.sid,
    );
    if (result.isErr()) {
      throw toHttpException(result.error);
    }
    return {
      requiresStepUp: result.value,
    };
  }

  /**
   * Initiate step-up authentication via Google OAuth
   * This redirects to Google for re-authentication
   */
  @Get('step-up')
  @UseGuards(AuthGuard('google'))
  stepUp() {
    // Guard redirects to Google OAuth for re-authentication
  }

  /**
   * Handle step-up authentication callback
   * Clears the step-up requirement after successful re-authentication
   */
  @Get('step-up/callback')
  @UseGuards(AuthGuard('google'))
  async stepUpCallback(
    @Req() req: Request,
    @RefreshPayload() payload: JwtRefreshPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const googleProfile = req.user as unknown as Profile;
    
    const loginResult = await this.authService.handleGoogleLogin(googleProfile);
    if (loginResult.isErr()) {
      throw toHttpException(loginResult.error);
    }

    const { user: dbUser } = loginResult.value;

    if (dbUser.id !== payload.uid) {
      throw toHttpException(
        Errors.forbidden('Step-up authentication must use the same account'),
      );
    }

    const sessionResult = await this.authService.getSessionByRefreshPayload(payload);
    if (sessionResult.isErr()) {
      throw toHttpException(sessionResult.error);
    }

    const session = sessionResult.value;
    if (!session) {
      throw toHttpException(Errors.invalidRefreshToken());
    }

    const clearResult = await this.authService.clearStepUpRequirement(
      payload.uid,
      session.id,
    );
    if (clearResult.isErr()) {
      throw toHttpException(clearResult.error);
    }

    return {
      message: 'Step-up authentication successful',
      requiresStepUp: false,
    };
  }

  /**
   * Get all active session families for the current user
   */
  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  async getSessions(@User() user: UserEntity) {
    const result = await this.authService.getActiveSessionFamilies(user.id);
    if (result.isErr()) {
      throw toHttpException(result.error);
    }
    return {
      sessions: result.value.map((family) => ({
        familyId: family.familyId,
        createdAt: family.createdAt,
        lastActivity: family.lastActivity,
        location: family.country || 'Unknown',
        ipPrefix: family.ipPrefix,
        device: this.summarizeUserAgent(family.userAgentRaw),
        requiresStepUp: family.requiresStepUp,
      })),
    };
  }

  /**
   * Revoke a specific session family
   */
  @Delete('sessions/:familyId')
  @UseGuards(JwtAuthGuard)
  async revokeSessionFamily(
    @User() user: UserEntity,
    @Param() params: FamilyIdParamDto,
  ) {
    const result = await this.authService.revokeSessionFamilyByUser(
      user.id,
      params.familyId,
    );
    if (result.isErr()) {
      throw toHttpException(result.error);
    }
    return {
      message: 'Session family revoked successfully',
    };
  }

  /**
   * Revoke all session families except the current one
   */
  @Post('sessions/revoke-others')
  @UseGuards(JwtRefreshAuthGuard)
  async revokeOtherSessions(
    @User() user: UserEntity,
    @RefreshPayload() payload: JwtRefreshPayload,
  ) {
    const sessionResult = await this.authService.getSessionByRefreshPayload(payload);
    if (sessionResult.isErr()) {
      throw toHttpException(sessionResult.error);
    }

    const session = sessionResult.value;
    if (!session) {
      throw toHttpException(Errors.invalidRefreshToken());
    }

    const result = await this.authService.revokeOtherSessionFamilies(
      user.id,
      session.familyId,
    );
    if (result.isErr()) {
      throw toHttpException(result.error);
    }
    return {
      message: 'Other sessions revoked successfully',
    };
  }

  private summarizeUserAgent(userAgent: string | null): string {
    if (!userAgent) return 'Unknown device';
    
    const lowerUA = userAgent.toLowerCase();

    let browser = 'Unknown Browser';
    if (lowerUA.includes('chrome') && !lowerUA.includes('edg')) {
      browser = 'Chrome';
    } else if (lowerUA.includes('firefox')) {
      browser = 'Firefox';
    } else if (lowerUA.includes('safari') && !lowerUA.includes('chrome')) {
      browser = 'Safari';
    } else if (lowerUA.includes('edg')) {
      browser = 'Edge';
    }

    let os = 'Unknown OS';
    if (lowerUA.includes('windows')) {
      os = 'Windows';
    } else if (lowerUA.includes('mac')) {
      os = 'macOS';
    } else if (lowerUA.includes('linux')) {
      os = 'Linux';
    } else if (lowerUA.includes('android')) {
      os = 'Android';
    } else if (lowerUA.includes('iphone') || lowerUA.includes('ipad')) {
      os = 'iOS';
    }

    return `${browser} on ${os}`;
  }
}
