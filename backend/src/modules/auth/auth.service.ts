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
import { AnomalyDetectionService } from './anomaly-detection.service';
import { NotificationService } from './notification.service';
import { RiskAssessment } from './types/anomaly-detection.types';
import { User } from '../user/user.entity';
import { AppError, Errors } from '../../common/errors/app-error';
import {
  AuthTokens,
  AuthUser,
  JwtAccessPayload,
  JwtRefreshPayload,
} from './types/auth.types';
import { RefreshSession } from './refresh-session.entity';
import { RiskLevel } from './refresh-event.entity';

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

export interface RefreshTokensResult extends AuthTokens {
  requiresStepUp?: boolean;
  riskLevel?: RiskLevel;
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
    private readonly anomalyDetectionService: AnomalyDetectionService,
    private readonly notificationService: NotificationService,
    @InjectRepository(RefreshSession)
    private readonly refreshSessionRepository: Repository<RefreshSession>,
  ) {}

  /**
   * Validate Google profile and convert to AuthUser
   * Returns Result<AuthUser, AppError> instead of throwing
   */
  validateGoogleUser(profile: Profile): Result<AuthUser, AppError> {
    const emailFromArray = (() => {
      const emails = profile.emails ?? [];
      // Prefer a verified email if passport-google-oauth20 provides it.
      const verified = emails.find((e) => (e as unknown as { verified?: boolean }).verified);
      return verified?.value ?? emails[0]?.value ?? null;
    })();

    // passport-google-oauth20 occasionally omits `profile.emails` depending on
    // account / consent / scope behavior. Fall back to the raw JSON payload.
    const json = profile._json as
      | undefined
      | {
          email?: unknown;
          emails?: unknown;
        };
    const emailFromJson =
      (typeof json?.email === 'string' && json.email) ||
      (Array.isArray(json?.emails) &&
      typeof (json.emails[0] as { value?: unknown } | undefined)?.value === 'string'
        ? ((json.emails[0] as { value: string }).value as string)
        : null);

    const primaryEmail = emailFromArray ?? emailFromJson;
    if (!primaryEmail) {
      // Defensive logging: some Google accounts / consent flows omit email.
      // Log only the presence of fields, not the values.
      this.logger.warn(
        `Google profile missing email; hasProfileEmails=${Boolean(profile.emails?.length)} hasJson=${Boolean(profile._json)} jsonKeys=${profile._json ? Object.keys(profile._json as Record<string, unknown>).join(',') : ''}`,
      );
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
    authUser: AuthUser,
  ): Promise<Result<{ user: User; authUser: AuthUser }, AppError>> {
    // `authUser` is produced by GoogleStrategy.validate() → validateGoogleUser()
    // before this controller runs, so we only need to upsert/persist here.
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
    clientInfo?: { ipAddress?: string; userAgent?: string; country?: string },
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
        accessTokenJti: signingResult.value.accessTokenJti,
        clientInfo,
      });
      if (sessionCreateResult.isErr()) {
        return err(sessionCreateResult.error);
      }

      this.sendNewSessionNotification(subject, sessionSeed.familyId, clientInfo);

      return ok(this.toAuthTokens(signingResult.value));
    } catch (error) {
      const originalError =
        error instanceof Error ? error : new Error(String(error));
      return err(Errors.internalError(originalError));
    }
  }

  private sendNewSessionNotification(
    subject: TokenSubject,
    familyId: string,
    clientInfo?: { ipAddress?: string; userAgent?: string; country?: string },
  ): void {
    try {
      this.notificationService.sendSecurityNotification({
        type: 'new_session',
        userId: subject.userId,
        email: subject.email,
        familyId,
        ipPrefix: this.refreshEventService.getIpPrefixPublic(clientInfo?.ipAddress) || undefined,
        country: clientInfo?.country,
        userAgent: clientInfo?.userAgent,
        timestamp: new Date(),
      });
    } catch (error) {
      this.logger.warn(
        `Failed to send new session notification: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Refresh JWT tokens using a refresh token payload
   * Returns Result<RefreshTokensResult, AppError> instead of throwing
   * Includes anomaly detection and risk-based actions
   */
  async refreshTokens(
    payload: JwtRefreshPayload,
    rawRefreshToken: string,
    clientInfo?: { ipAddress?: string; userAgent?: string; country?: string; isVpnOrProxy?: boolean },
  ): Promise<Result<RefreshTokensResult, AppError>> {
    if (payload.tokenType !== 'refresh' || !payload.sid || !payload.uid) {
      await this.refreshEventService.logRefreshEvent({
        userId: payload.uid || 'unknown',
        familyId: 'unknown',
        sessionId: payload.sid || 'unknown',
        ipAddress: clientInfo?.ipAddress,
        userAgent: clientInfo?.userAgent,
        country: clientInfo?.country,
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
        country: clientInfo?.country,
        wasSuccessful: false,
        failureReason: 'Session validation failed',
      });
      return err(sessionValidationResult.error);
    }
    const currentSession = sessionValidationResult.value;
    const familyId = String(currentSession.familyId);

    let riskAssessment: RiskAssessment | null = null;
    if (this.appConfigService.anomalyDetectionEnabled) {
      riskAssessment = await this.anomalyDetectionService.assessRisk({
        userId: payload.uid,
        familyId,
        sessionId: payload.sid,
        ipAddress: clientInfo?.ipAddress,
        userAgent: clientInfo?.userAgent,
        country: clientInfo?.country,
        isVpnOrProxy: clientInfo?.isVpnOrProxy,
      });

      if (riskAssessment.shouldRevoke) {
        await this.refreshEventService.logRefreshEvent({
          userId: payload.uid,
          familyId,
          sessionId: payload.sid,
          ipAddress: clientInfo?.ipAddress,
          userAgent: clientInfo?.userAgent,
          country: clientInfo?.country,
          wasSuccessful: false,
          failureReason: 'High risk activity detected',
          riskScore: riskAssessment.riskScore,
          riskLevel: riskAssessment.riskLevel,
          anomalySignals: riskAssessment.signals,
          isVpnOrProxy: clientInfo?.isVpnOrProxy,
        });

        const jtisToBlacklist =
          await this.anomalyDetectionService.revokeFamilyWithBlacklist(
            payload.uid,
            familyId,
          );
        for (const jti of jtisToBlacklist) {
          await this.tokenBlacklistService.addToBlacklist(
            jti,
            this.appConfigService.jwtAccessExpiresInSeconds,
          );
        }

        this.sendHighRiskNotification(
          payload.uid,
          payload.email,
          riskAssessment,
          clientInfo,
        );

        return err(
          Errors.highRiskSession(
            riskAssessment.riskScore,
            this.notificationService.formatSignalsForNotification(
              riskAssessment.signals as Record<string, boolean>,
            ),
          ),
        );
      }
    }

    if (currentSession.currentAccessTokenJti) {
      await this.tokenBlacklistService.addToBlacklist(
        currentSession.currentAccessTokenJti,
        this.appConfigService.jwtAccessExpiresInSeconds,
      );
    }

    const newSessionId = randomUUID();
    const accessTokenTtl =
      riskAssessment?.accessTokenTtlOverride ||
      this.appConfigService.jwtAccessExpiresInSeconds;

    const signingResult = await this.signTokens(
      {
        userId: payload.uid,
        providerId: payload.sub,
        email: payload.email,
        provider: payload.provider,
        displayName: payload.email,
      },
      newSessionId,
      accessTokenTtl,
    );
    if (signingResult.isErr()) {
      await this.refreshEventService.logRefreshEvent({
        userId: payload.uid,
        familyId,
        sessionId: payload.sid,
        ipAddress: clientInfo?.ipAddress,
        userAgent: clientInfo?.userAgent,
        country: clientInfo?.country,
        wasSuccessful: false,
        failureReason: 'Token signing failed',
        riskScore: riskAssessment?.riskScore,
        riskLevel: riskAssessment?.riskLevel,
        anomalySignals: riskAssessment?.signals,
        isVpnOrProxy: clientInfo?.isVpnOrProxy,
      });
      return err(signingResult.error);
    }

    const rotationResult = await this.rotateRefreshSession({
      currentSession,
      newSessionId,
      newRefreshToken: signingResult.value.refreshToken,
      newAccessTokenJti: signingResult.value.accessTokenJti,
      clientInfo,
      requiresStepUp: riskAssessment?.shouldRequireStepUp,
    });
    if (rotationResult.isErr()) {
      await this.refreshEventService.logRefreshEvent({
        userId: payload.uid,
        familyId,
        sessionId: payload.sid,
        ipAddress: clientInfo?.ipAddress,
        userAgent: clientInfo?.userAgent,
        country: clientInfo?.country,
        wasSuccessful: false,
        failureReason: 'Session rotation failed',
        riskScore: riskAssessment?.riskScore,
        riskLevel: riskAssessment?.riskLevel,
        anomalySignals: riskAssessment?.signals,
        isVpnOrProxy: clientInfo?.isVpnOrProxy,
      });
      return err(rotationResult.error);
    }

    await this.refreshEventService.logRefreshEvent({
      userId: payload.uid,
      familyId,
      sessionId: newSessionId,
      ipAddress: clientInfo?.ipAddress,
      userAgent: clientInfo?.userAgent,
      country: clientInfo?.country,
      wasSuccessful: true,
      riskScore: riskAssessment?.riskScore || 0,
      riskLevel: riskAssessment?.riskLevel || RiskLevel.LOW,
      anomalySignals: riskAssessment?.signals,
      isVpnOrProxy: clientInfo?.isVpnOrProxy,
    });

    if (riskAssessment?.shouldRequireStepUp) {
      this.sendMediumRiskNotification(
        payload.uid,
        payload.email,
        riskAssessment,
        clientInfo,
      );
    }

    const result: RefreshTokensResult = {
      ...this.toAuthTokens(signingResult.value, accessTokenTtl),
      requiresStepUp: riskAssessment?.shouldRequireStepUp,
      riskLevel: riskAssessment?.riskLevel,
    };

    return ok(result);
  }

  private sendHighRiskNotification(
    userId: string,
    email: string,
    riskAssessment: RiskAssessment,
    clientInfo?: { ipAddress?: string; userAgent?: string; country?: string },
  ): void {
    try {
      this.notificationService.sendSecurityNotification({
        type: 'forced_logout',
        userId,
        email,
        ipPrefix: this.refreshEventService.getIpPrefixPublic(clientInfo?.ipAddress) || undefined,
        country: clientInfo?.country,
        userAgent: clientInfo?.userAgent,
        timestamp: new Date(),
        riskLevel: RiskLevel.HIGH,
        riskScore: riskAssessment.riskScore,
        reason: 'High-risk activity detected during token refresh',
        signals: this.notificationService.formatSignalsForNotification(
          riskAssessment.signals as Record<string, boolean>,
        ),
      });
    } catch (error) {
      this.logger.warn(
        `Failed to send high-risk notification: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private sendMediumRiskNotification(
    userId: string,
    email: string,
    riskAssessment: RiskAssessment,
    clientInfo?: { ipAddress?: string; userAgent?: string; country?: string },
  ): void {
    try {
      this.notificationService.sendSecurityNotification({
        type: 'suspicious_activity',
        userId,
        email,
        ipPrefix: this.refreshEventService.getIpPrefixPublic(clientInfo?.ipAddress) || undefined,
        country: clientInfo?.country,
        userAgent: clientInfo?.userAgent,
        timestamp: new Date(),
        riskLevel: RiskLevel.MEDIUM,
        riskScore: riskAssessment.riskScore,
        signals: this.notificationService.formatSignalsForNotification(
          riskAssessment.signals as Record<string, boolean>,
        ),
      });
    } catch (error) {
      this.logger.warn(
        `Failed to send medium-risk notification: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async logoutSession(
    payload: JwtRefreshPayload,
    rawRefreshToken: string,
    accessTokenJti?: string,
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

    const currentSession = sessionValidationResult.value;

    try {
      // Blacklist the current access token if provided
      if (accessTokenJti) {
        await this.tokenBlacklistService.addToBlacklist(
          accessTokenJti,
          this.appConfigService.jwtAccessExpiresInSeconds,
        );
      }

      // Also blacklist the tracked access token from the session
      if (currentSession.currentAccessTokenJti) {
        await this.tokenBlacklistService.addToBlacklist(
          currentSession.currentAccessTokenJti,
          this.appConfigService.jwtAccessExpiresInSeconds,
        );
      }

      // Revoke this specific session
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
      // Get all active sessions for this user
      const sessions = await this.refreshSessionRepository.find({
        where: {
          userId,
          revokedAt: IsNull(),
        },
      });

      // Blacklist the current access token
      const blacklistResult = await this.tokenBlacklistService.addToBlacklist(
        jti,
        this.appConfigService.jwtAccessExpiresInSeconds,
      );
      if (blacklistResult.isErr()) {
        return err(blacklistResult.error);
      }

      // Blacklist all other access tokens from active sessions
      for (const session of sessions) {
        if (session.currentAccessTokenJti) {
          await this.tokenBlacklistService.addToBlacklist(
            session.currentAccessTokenJti,
            this.appConfigService.jwtAccessExpiresInSeconds,
          );
        }
      }

      // Revoke all refresh sessions
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
    accessTokenJti: string;
    clientInfo?: { ipAddress?: string; userAgent?: string; country?: string };
  }): Promise<Result<void, AppError>> {
    try {
      const userAgentHash = input.clientInfo?.userAgent
        ? this.refreshEventService.hashUserAgentPublic(input.clientInfo.userAgent)
        : null;

      await this.refreshSessionRepository.insert({
        id: input.id,
        userId: input.userId,
        familyId: input.familyId,
        tokenHash: await this.hashRefreshToken(input.refreshToken),
        currentAccessTokenJti: input.accessTokenJti,
        expiresAt: this.computeRefreshSessionExpiry(),
        absoluteExpiresAt: input.absoluteExpiresAt,
        requiresStepUp: false,
        lastKnownCountry: input.clientInfo?.country || null,
        lastKnownUserAgentHash: userAgentHash,
        userAgentRaw: input.clientInfo?.userAgent || null,
        ipPrefix: this.refreshEventService.getIpPrefixPublic(input.clientInfo?.ipAddress),
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
    newAccessTokenJti: string;
    clientInfo?: { ipAddress?: string; userAgent?: string; country?: string };
    requiresStepUp?: boolean;
  }): Promise<Result<void, AppError>> {
    const now = new Date();
    const currentSessionUserId = String(input.currentSession.userId);
    const currentSessionFamilyId = String(input.currentSession.familyId);
    const currentSessionAbsoluteExpiresAt = new Date(
      String(input.currentSession.absoluteExpiresAt),
    );

    try {
      const newTokenHash = await this.hashRefreshToken(input.newRefreshToken);
      const userAgentHash = input.clientInfo?.userAgent
        ? this.refreshEventService.hashUserAgentPublic(input.clientInfo.userAgent)
        : null;

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
            currentAccessTokenJti: input.newAccessTokenJti,
            expiresAt: this.computeRefreshSessionExpiry(),
            absoluteExpiresAt: currentSessionAbsoluteExpiresAt,
            requiresStepUp: input.requiresStepUp || false,
            lastKnownCountry: input.clientInfo?.country || null,
            lastKnownUserAgentHash: userAgentHash,
            userAgentRaw: input.clientInfo?.userAgent || null,
            ipPrefix: this.refreshEventService.getIpPrefixPublic(input.clientInfo?.ipAddress),
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
    accessTokenTtlOverride?: number,
  ): Promise<Result<{ accessToken: string; refreshToken: string; accessTokenJti: string }, AppError>> {
    try {
      const accessTokenJti = randomUUID();
      const accessPayload: JwtAccessPayload = {
        jti: accessTokenJti,
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

      const accessTokenTtl =
        accessTokenTtlOverride || this.appConfigService.jwtAccessExpiresInSeconds;

      const [accessToken, refreshToken] = await Promise.all([
        this.jwtService.signAsync(accessPayload, {
          secret: this.appConfigService.jwtAccessSecret,
          expiresIn: accessTokenTtl,
        }),
        this.jwtService.signAsync(refreshPayload, {
          secret: this.appConfigService.jwtRefreshSecret,
          expiresIn: this.appConfigService.jwtRefreshExpiresInSeconds,
        }),
      ]);

      return ok({ accessToken, refreshToken, accessTokenJti });
    } catch (error) {
      const originalError =
        error instanceof Error ? error : new Error(String(error));
      return err(Errors.internalError(originalError));
    }
  }

  private toAuthTokens(
    tokens: {
      accessToken: string;
      refreshToken: string;
    },
    accessTokenTtl?: number,
  ): AuthTokens {
    const ttl = accessTokenTtl || this.appConfigService.jwtAccessExpiresInSeconds;
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiresIn: ttl,
      refreshTokenExpiresIn: this.appConfigService.jwtRefreshExpiresInSeconds,
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

  /**
   * Clear step-up requirement after successful re-authentication
   */
  async clearStepUpRequirement(
    userId: string,
    sessionId: string,
  ): Promise<Result<void, AppError>> {
    try {
      await this.refreshSessionRepository.update(
        { id: sessionId, userId },
        { requiresStepUp: false },
      );
      return ok(undefined);
    } catch (error) {
      const originalError =
        error instanceof Error ? error : new Error(String(error));
      return err(
        Errors.databaseError('Failed to clear step-up requirement', originalError),
      );
    }
  }

  /**
   * Check if a session requires step-up authentication
   */
  async checkStepUpRequired(
    userId: string,
    sessionId: string,
  ): Promise<Result<boolean, AppError>> {
    try {
      const session = await this.refreshSessionRepository.findOne({
        where: { id: sessionId, userId },
        select: ['requiresStepUp'],
      });
      return ok(session?.requiresStepUp || false);
    } catch (error) {
      const originalError =
        error instanceof Error ? error : new Error(String(error));
      return err(Errors.internalError(originalError));
    }
  }

  /**
   * Get all active session families for a user
   */
  async getActiveSessionFamilies(userId: string): Promise<
    Result<
      {
        familyId: string;
        createdAt: Date;
        lastActivity: Date;
        ipPrefix: string | null;
        country: string | null;
        userAgentRaw: string | null;
        requiresStepUp: boolean;
      }[],
      AppError
    >
  > {
    try {
      const families =
        await this.anomalyDetectionService.getActiveSessionFamilies(userId);
      return ok(families);
    } catch (error) {
      const originalError =
        error instanceof Error ? error : new Error(String(error));
      return err(Errors.internalError(originalError));
    }
  }

  /**
   * Revoke a specific session family for a user
   */
  async revokeSessionFamilyByUser(
    userId: string,
    familyId: string,
  ): Promise<Result<void, AppError>> {
    try {
      const jtisToBlacklist =
        await this.anomalyDetectionService.revokeFamilyWithBlacklist(
          userId,
          familyId,
        );
      for (const jti of jtisToBlacklist) {
        await this.tokenBlacklistService.addToBlacklist(
          jti,
          this.appConfigService.jwtAccessExpiresInSeconds,
        );
      }
      return ok(undefined);
    } catch (error) {
      const originalError =
        error instanceof Error ? error : new Error(String(error));
      return err(
        Errors.databaseError('Failed to revoke session family', originalError),
      );
    }
  }

  /**
   * Revoke all session families for a user except the current one
   */
  async revokeOtherSessionFamilies(
    userId: string,
    currentFamilyId: string,
  ): Promise<Result<void, AppError>> {
    try {
      const activeSessions = await this.refreshSessionRepository.find({
        where: {
          userId,
          revokedAt: IsNull(),
        },
      });

      const otherFamilyIds = new Set<string>();
      for (const session of activeSessions) {
        if (session.familyId !== currentFamilyId) {
          otherFamilyIds.add(session.familyId);
        }
      }

      for (const familyId of otherFamilyIds) {
        await this.revokeSessionFamilyByUser(userId, familyId);
      }

      return ok(undefined);
    } catch (error) {
      const originalError =
        error instanceof Error ? error : new Error(String(error));
      return err(
        Errors.databaseError('Failed to revoke other families', originalError),
      );
    }
  }

  /**
   * Get session by sessionId for the refresh payload
   */
  async getSessionByRefreshPayload(
    payload: JwtRefreshPayload,
  ): Promise<Result<RefreshSession | null, AppError>> {
    try {
      const session = await this.refreshSessionRepository.findOne({
        where: {
          id: payload.sid,
          userId: payload.uid,
        },
      });
      return ok(session);
    } catch (error) {
      const originalError =
        error instanceof Error ? error : new Error(String(error));
      return err(Errors.internalError(originalError));
    }
  }
}
