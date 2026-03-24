import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Profile } from 'passport-google-oauth20';
import { Result, ok, err } from 'neverthrow';
import { randomUUID } from 'crypto';
import { compare, hash } from 'bcryptjs';
import { IsNull, Repository } from 'typeorm';
import { AppConfigService } from '../../config/app-config.service';
import { UserService } from '../user/user.service';
import { TokenBlacklistService } from './token-blacklist.service';
import { RefreshEventService } from './refresh-event.service';
import { User } from '../user/user.entity';
import { AppError, Errors } from '../../common/errors/app-error';
import {
  AuthTokens,
  AuthUser,
  JwtAccessPayload,
  JwtRefreshPayload,
} from './types/auth.types';
import { RefreshSession } from './refresh-session.entity';

const REFRESH_TOKEN_BCRYPT_ROUNDS = 10;

interface TokenSubject {
  userId: string;
  providerId: string;
  email: string;
  provider: 'google';
  displayName: string;
}

interface SessionSeed {
  sessionId: string;
  familyId: string;
  absoluteExpiresAt: Date;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly appConfigService: AppConfigService,
    private readonly userService: UserService,
    private readonly tokenBlacklistService: TokenBlacklistService,
    private readonly refreshEventService: RefreshEventService,
    @InjectRepository(RefreshSession)
    private readonly refreshSessionRepository: Repository<RefreshSession>,
  ) {}

  /**
   * Validate Google profile and convert to AuthUser
   * Returns Result<AuthUser, AppError> instead of throwing
   */
  validateGoogleUser(profile: Profile): Result<AuthUser, AppError> {
    const primaryEmail = profile.emails?.[0]?.value;
    if (!primaryEmail) {
      return err(Errors.missingEmail());
    }
    const authUser: AuthUser = {
      provider: 'google',
      providerId: profile.id,
      email: primaryEmail,
      firstName: profile.name?.givenName,
      lastName: profile.name?.familyName,
      displayName: profile.displayName,
      picture: profile.photos?.[0]?.value,
    };
    return ok(authUser);
  }

  /**
   * Handle Google OAuth login: validate and persist user
   * Returns Result<{user: User, authUser: AuthUser}, AppError>
   */
  async handleGoogleLogin(
    profile: Profile,
  ): Promise<Result<{ user: User; authUser: AuthUser }, AppError>> {
    const validationResult = this.validateGoogleUser(profile);
    if (validationResult.isErr()) {
      return err(validationResult.error);
    }
    const authUser = validationResult.value;
    const upsertResult = await this.userService.upsertGoogleUser(authUser);
    if (upsertResult.isErr()) {
      return err(upsertResult.error);
    }
    const user = upsertResult.value;
    return ok({ user, authUser });
  }

  /**
   * Issue JWT tokens for authenticated user
   * Returns Result<AuthTokens, AppError> instead of throwing
   */
  async issueTokens(
    subject: TokenSubject,
  ): Promise<Result<AuthTokens, AppError>> {
    try {
      const sessionSeed: SessionSeed = {
        sessionId: randomUUID(),
        familyId: randomUUID(),
        absoluteExpiresAt: this.computeAbsoluteSessionExpiry(),
      };

      const signingResult = await this.signTokens(
        subject,
        sessionSeed.sessionId,
      );
      if (signingResult.isErr()) {
        return err(signingResult.error);
      }

      const sessionCreateResult = await this.createRefreshSession({
        id: sessionSeed.sessionId,
        userId: subject.userId,
        familyId: sessionSeed.familyId,
        absoluteExpiresAt: sessionSeed.absoluteExpiresAt,
        refreshToken: signingResult.value.refreshToken,
      });
      if (sessionCreateResult.isErr()) {
        return err(sessionCreateResult.error);
      }

      return ok(this.toAuthTokens(signingResult.value));
    } catch (error) {
      const originalError =
        error instanceof Error ? error : new Error(String(error));
      return err(Errors.internalError(originalError));
    }
  }

  /**
   * Refresh JWT tokens using a refresh token payload
   * Returns Result<AuthTokens, AppError> instead of throwing
   */
  async refreshTokens(
    payload: JwtRefreshPayload,
    rawRefreshToken: string,
    clientInfo?: { ipAddress?: string; userAgent?: string },
  ): Promise<Result<AuthTokens, AppError>> {
    if (payload.tokenType !== 'refresh' || !payload.sid || !payload.uid) {
      await this.refreshEventService.logRefreshEvent({
        userId: payload.uid || 'unknown',
        familyId: 'unknown',
        sessionId: payload.sid || 'unknown',
        ipAddress: clientInfo?.ipAddress,
        userAgent: clientInfo?.userAgent,
        wasSuccessful: false,
        failureReason: 'Invalid token payload',
      });
      return err(Errors.invalidRefreshToken());
    }

    const sessionValidationResult = await this.verifyActiveRefreshSession(
      payload,
      rawRefreshToken,
    );
    if (sessionValidationResult.isErr()) {
      await this.refreshEventService.logRefreshEvent({
        userId: payload.uid,
        familyId: 'unknown',
        sessionId: payload.sid,
        ipAddress: clientInfo?.ipAddress,
        userAgent: clientInfo?.userAgent,
        wasSuccessful: false,
        failureReason: 'Session validation failed',
      });
      return err(sessionValidationResult.error);
    }
    const currentSession = sessionValidationResult.value;

    const newSessionId = randomUUID();
    const signingResult = await this.signTokens(
      {
        userId: payload.uid,
        providerId: payload.sub,
        email: payload.email,
        provider: payload.provider,
        displayName: payload.email,
      },
      newSessionId,
    );
    if (signingResult.isErr()) {
      await this.refreshEventService.logRefreshEvent({
        userId: payload.uid,
        familyId: String(currentSession.familyId),
        sessionId: payload.sid,
        ipAddress: clientInfo?.ipAddress,
        userAgent: clientInfo?.userAgent,
        wasSuccessful: false,
        failureReason: 'Token signing failed',
      });
      return err(signingResult.error);
    }

    const rotationResult = await this.rotateRefreshSession({
      currentSession,
      newSessionId,
      newRefreshToken: signingResult.value.refreshToken,
    });
    if (rotationResult.isErr()) {
      await this.refreshEventService.logRefreshEvent({
        userId: payload.uid,
        familyId: String(currentSession.familyId),
        sessionId: payload.sid,
        ipAddress: clientInfo?.ipAddress,
        userAgent: clientInfo?.userAgent,
        wasSuccessful: false,
        failureReason: 'Session rotation failed',
      });
      return err(rotationResult.error);
    }

    await this.refreshEventService.logRefreshEvent({
      userId: payload.uid,
      familyId: String(currentSession.familyId),
      sessionId: newSessionId,
      ipAddress: clientInfo?.ipAddress,
      userAgent: clientInfo?.userAgent,
      wasSuccessful: true,
    });

    return ok(this.toAuthTokens(signingResult.value));
  }

  async logoutSession(
    payload: JwtRefreshPayload,
    rawRefreshToken: string,
  ): Promise<Result<void, AppError>> {
    if (payload.tokenType !== 'refresh' || !payload.sid || !payload.uid) {
      return err(Errors.invalidRefreshToken());
    }

    const sessionValidationResult = await this.verifyActiveRefreshSession(
      payload,
      rawRefreshToken,
    );
    if (sessionValidationResult.isErr()) {
      return err(sessionValidationResult.error);
    }

    try {
      await this.refreshSessionRepository.update(
        { id: payload.sid, userId: payload.uid },
        { revokedAt: new Date() },
      );
      return ok(undefined);
    } catch (error) {
      const originalError =
        error instanceof Error ? error : new Error(String(error));
      return err(
        Errors.databaseError('Failed to revoke session', originalError),
      );
    }
  }

  async logoutAllSessions(userId: string): Promise<Result<void, AppError>> {
    try {
      await this.revokeAllSessionsByUser(userId);

      return ok(undefined);
    } catch (error) {
      const originalError =
        error instanceof Error ? error : new Error(String(error));
      return err(
        Errors.databaseError('Failed to revoke all sessions', originalError),
      );
    }
  }

  async logoutWithAccessToken(
    jti: string,
    userId: string,
  ): Promise<Result<void, AppError>> {
    try {
      const blacklistResult = await this.tokenBlacklistService.addToBlacklist(
        jti,
        this.appConfigService.jwtAccessExpiresInSeconds,
      );
      if (blacklistResult.isErr()) {
        return err(blacklistResult.error);
      }

      await this.revokeAllSessionsByUser(userId);

      return ok(undefined);
    } catch (error) {
      const originalError =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Failed to logout with access token: ${originalError.message}`);
      return err(Errors.internalError(originalError));
    }
  }

  private async verifyActiveRefreshSession(
    payload: JwtRefreshPayload,
    rawRefreshToken: string,
  ): Promise<Result<RefreshSession, AppError>> {
    try {
      const session = await this.refreshSessionRepository.findOne({
        where: {
          id: payload.sid,
          userId: payload.uid,
        },
      });

      if (!session) {
        return err(Errors.invalidRefreshToken());
      }

      if (session.replacedBySessionId || session.rotatedAt) {
        const reusedSessionUserId = String(session.userId);
        const reusedSessionFamilyId = String(session.familyId);
        await this.handleRefreshReuseDetected(
          reusedSessionUserId,
          reusedSessionFamilyId,
        );
        return err(Errors.invalidRefreshToken());
      }

      const now = new Date();
      if (
        session.revokedAt ||
        session.expiresAt < now ||
        session.absoluteExpiresAt < now
      ) {
        return err(Errors.invalidRefreshToken());
      }

      const isTokenMatch = await compare(rawRefreshToken, session.tokenHash);
      if (!isTokenMatch) {
        return err(Errors.invalidRefreshToken());
      }

      return ok(session);
    } catch (error) {
      const originalError =
        error instanceof Error ? error : new Error(String(error));
      return err(
        Errors.databaseError(
          'Failed to validate refresh session',
          originalError,
        ),
      );
    }
  }

  private async createRefreshSession(input: {
    id: string;
    userId: string;
    familyId: string;
    absoluteExpiresAt: Date;
    refreshToken: string;
  }): Promise<Result<void, AppError>> {
    try {
      await this.refreshSessionRepository.insert({
        id: input.id,
        userId: input.userId,
        familyId: input.familyId,
        tokenHash: await this.hashRefreshToken(input.refreshToken),
        expiresAt: this.computeRefreshSessionExpiry(),
        absoluteExpiresAt: input.absoluteExpiresAt,
      });
      return ok(undefined);
    } catch (error) {
      const originalError =
        error instanceof Error ? error : new Error(String(error));
      return err(
        Errors.databaseError('Failed to save refresh session', originalError),
      );
    }
  }

  private async rotateRefreshSession(input: {
    currentSession: RefreshSession;
    newSessionId: string;
    newRefreshToken: string;
  }): Promise<Result<void, AppError>> {
    const now = new Date();
    const currentSessionUserId = String(input.currentSession.userId);
    const currentSessionFamilyId = String(input.currentSession.familyId);
    const currentSessionAbsoluteExpiresAt = new Date(
      String(input.currentSession.absoluteExpiresAt),
    );

    try {
      const newTokenHash = await this.hashRefreshToken(input.newRefreshToken);

      await this.refreshSessionRepository.manager.transaction(
        async (manager) => {
          const updateResult = await manager.update(
            RefreshSession,
            {
              id: input.currentSession.id,
              userId: currentSessionUserId,
              replacedBySessionId: IsNull(),
              revokedAt: IsNull(),
            },
            {
              replacedBySessionId: input.newSessionId,
              rotatedAt: now,
              revokedAt: now,
            },
          );

          if ((updateResult.affected ?? 0) !== 1) {
            throw new Error('REFRESH_TOKEN_ALREADY_SPENT');
          }

          await manager.insert(RefreshSession, {
            id: input.newSessionId,
            userId: currentSessionUserId,
            familyId: currentSessionFamilyId,
            tokenHash: newTokenHash,
            expiresAt: this.computeRefreshSessionExpiry(),
            absoluteExpiresAt: currentSessionAbsoluteExpiresAt,
          });
        },
      );

      return ok(undefined);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'REFRESH_TOKEN_ALREADY_SPENT'
      ) {
        await this.handleRefreshReuseDetected(
          currentSessionUserId,
          currentSessionFamilyId,
        );
        return err(Errors.invalidRefreshToken());
      }

      const originalError =
        error instanceof Error ? error : new Error(String(error));
      return err(
        Errors.databaseError('Failed to rotate refresh session', originalError),
      );
    }
  }

  private async signTokens(
    subject: TokenSubject,
    sessionId: string,
  ): Promise<Result<{ accessToken: string; refreshToken: string }, AppError>> {
    try {
      const accessPayload: JwtAccessPayload = {
        jti: randomUUID(),
        sub: subject.providerId,
        uid: subject.userId,
        email: subject.email,
        provider: subject.provider,
        tokenType: 'access',
      };
      const refreshPayload: JwtRefreshPayload = {
        sub: subject.providerId,
        uid: subject.userId,
        sid: sessionId,
        email: subject.email,
        provider: subject.provider,
        tokenType: 'refresh',
      };

      const [accessToken, refreshToken] = await Promise.all([
        this.jwtService.signAsync(accessPayload, {
          secret: this.appConfigService.jwtAccessSecret,
          expiresIn: this.appConfigService.jwtAccessExpiresInSeconds,
        }),
        this.jwtService.signAsync(refreshPayload, {
          secret: this.appConfigService.jwtRefreshSecret,
          expiresIn: this.appConfigService.jwtRefreshExpiresInSeconds,
        }),
      ]);

      return ok({ accessToken, refreshToken });
    } catch (error) {
      const originalError =
        error instanceof Error ? error : new Error(String(error));
      return err(Errors.internalError(originalError));
    }
  }

  private toAuthTokens(tokens: {
    accessToken: string;
    refreshToken: string;
  }): AuthTokens {
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiresIn: `${this.appConfigService.jwtAccessExpiresInSeconds}s`,
      refreshTokenExpiresIn: `${this.appConfigService.jwtRefreshExpiresInSeconds}s`,
    };
  }

  private async handleRefreshReuseDetected(
    userId: string,
    familyId: string,
  ): Promise<void> {
    try {
      if (this.appConfigService.strictRefreshReuseRevocation) {
        await this.revokeAllSessionsByUser(userId);
        return;
      }

      await this.revokeSessionFamily(userId, familyId);
    } catch (error) {
      const originalError =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Failed to apply refresh reuse policy: ${originalError.message}`,
      );
    }
  }

  private async revokeSessionFamily(
    userId: string,
    familyId: string,
  ): Promise<void> {
    await this.refreshSessionRepository
      .createQueryBuilder()
      .update(RefreshSession)
      .set({ revokedAt: new Date() })
      .where('userId = :userId', { userId })
      .andWhere('familyId = :familyId', { familyId })
      .andWhere('revokedAt IS NULL')
      .execute();
  }

  private async revokeAllSessionsByUser(userId: string): Promise<void> {
    await this.refreshSessionRepository
      .createQueryBuilder()
      .update(RefreshSession)
      .set({ revokedAt: new Date() })
      .where('userId = :userId', { userId })
      .andWhere('revokedAt IS NULL')
      .execute();
  }

  private computeAbsoluteSessionExpiry(): Date {
    const absoluteLifetimeSeconds = Number(
      this.appConfigService.refreshSessionAbsoluteLifetimeSeconds,
    );
    return new Date(Date.now() + absoluteLifetimeSeconds * 1000);
  }

  private computeRefreshSessionExpiry(): Date {
    const expiresInSeconds = this.appConfigService.jwtRefreshExpiresInSeconds;
    return new Date(Date.now() + expiresInSeconds * 1000);
  }

  private async hashRefreshToken(token: string): Promise<string> {
    return hash(token, REFRESH_TOKEN_BCRYPT_ROUNDS);
  }
}
