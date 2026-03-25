import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { createHash } from 'crypto';
import { RefreshEvent, RiskLevel, AnomalySignals } from './refresh-event.entity';
import { RefreshSession } from './refresh-session.entity';
import { AppConfigService } from '../../config/app-config.service';
import {
  AnomalyContext,
  RiskAssessment,
  RISK_WEIGHTS,
  RISK_THRESHOLDS,
  IMPOSSIBLE_TRAVEL_MINUTES,
  RAPID_REFRESH_WINDOW_MS,
  RAPID_REFRESH_THRESHOLD,
} from './types/anomaly-detection.types';

@Injectable()
export class AnomalyDetectionService {
  private readonly logger = new Logger(AnomalyDetectionService.name);

  constructor(
    @InjectRepository(RefreshEvent)
    private readonly refreshEventRepository: Repository<RefreshEvent>,
    @InjectRepository(RefreshSession)
    private readonly refreshSessionRepository: Repository<RefreshSession>,
    private readonly appConfigService: AppConfigService,
  ) {}

  async assessRisk(context: AnomalyContext): Promise<RiskAssessment> {
    const signals: AnomalySignals = {};
    let riskScore = 0;

    try {
      const previousEvent = await this.getMostRecentFamilyEvent(context.familyId);
      const currentUserAgentHash = context.userAgent
        ? this.hashUserAgent(context.userAgent)
        : null;

      if (previousEvent) {
        const impossibleTravel = this.detectImpossibleTravel(
          previousEvent,
          context.country,
          context.isVpnOrProxy,
        );
        if (impossibleTravel) {
          signals.impossibleTravel = true;
          riskScore += RISK_WEIGHTS.IMPOSSIBLE_TRAVEL;
        }

        if (this.detectCountryChange(previousEvent, context.country)) {
          signals.countryChanged = true;
          if (!signals.impossibleTravel) {
            riskScore += RISK_WEIGHTS.COUNTRY_CHANGED;
          }
        }

        if (this.detectUserAgentChange(previousEvent, currentUserAgentHash)) {
          signals.userAgentChanged = true;
          riskScore += RISK_WEIGHTS.USER_AGENT_CHANGED;
        }
      }

      const rapidRefreshes = await this.detectRapidRefreshes(context.familyId);
      if (rapidRefreshes) {
        signals.rapidRefreshes = true;
        riskScore += RISK_WEIGHTS.RAPID_REFRESHES;
      }

      if (this.isUnusualHour()) {
        signals.unusualHour = true;
        riskScore += RISK_WEIGHTS.UNUSUAL_HOUR;
      }

      if (context.isVpnOrProxy) {
        signals.vpnOrProxyDetected = true;
      }
    } catch (error) {
      this.logger.warn(
        `Failed to assess risk for family ${context.familyId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const riskLevel = this.calculateRiskLevel(riskScore);

    return {
      riskScore,
      riskLevel,
      signals,
      shouldRevoke: riskLevel === RiskLevel.HIGH,
      shouldRequireStepUp: riskLevel === RiskLevel.MEDIUM,
      accessTokenTtlOverride:
        riskLevel === RiskLevel.MEDIUM
          ? this.appConfigService.anomalyStepUpAccessTokenTtl
          : undefined,
    };
  }

  private async getMostRecentFamilyEvent(
    familyId: string,
  ): Promise<RefreshEvent | null> {
    try {
      const event = await this.refreshEventRepository.findOne({
        where: {
          familyId,
          wasSuccessful: true,
        },
        order: { createdAt: 'DESC' },
      });
      return event;
    } catch (error) {
      this.logger.warn(
        `Failed to get recent event for family ${familyId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private detectImpossibleTravel(
    previousEvent: RefreshEvent,
    currentCountry?: string,
    isVpnOrProxy?: boolean,
  ): boolean {
    if (!previousEvent.country || !currentCountry) {
      return false;
    }

    if (previousEvent.country === currentCountry) {
      return false;
    }

    const timeDiffMs =
      Date.now() - new Date(previousEvent.createdAt).getTime();
    const timeDiffMinutes = timeDiffMs / (1000 * 60);

    if (timeDiffMinutes < IMPOSSIBLE_TRAVEL_MINUTES) {
      if (isVpnOrProxy) {
        this.logger.log(
          `Impossible travel detected but VPN/proxy suspected for family ${previousEvent.familyId}`,
        );
      }
      return true;
    }

    return false;
  }

  private detectCountryChange(
    previousEvent: RefreshEvent,
    currentCountry?: string,
  ): boolean {
    if (!previousEvent.country || !currentCountry) {
      return false;
    }
    return previousEvent.country !== currentCountry;
  }

  private detectUserAgentChange(
    previousEvent: RefreshEvent,
    currentUserAgentHash: string | null,
  ): boolean {
    if (!previousEvent.userAgentHash || !currentUserAgentHash) {
      return false;
    }
    return previousEvent.userAgentHash !== currentUserAgentHash;
  }

  private async detectRapidRefreshes(familyId: string): Promise<boolean> {
    try {
      const windowStart = new Date(Date.now() - RAPID_REFRESH_WINDOW_MS);
      const recentCount = await this.refreshEventRepository.count({
        where: {
          familyId,
          wasSuccessful: true,
          createdAt: MoreThan(windowStart),
        },
      });
      return recentCount > RAPID_REFRESH_THRESHOLD;
    } catch (error) {
      this.logger.warn(
        `Failed to check rapid refreshes for family ${familyId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  private isUnusualHour(): boolean {
    const utcHour = new Date().getUTCHours();
    return utcHour >= 2 && utcHour < 5;
  }

  private calculateRiskLevel(score: number): RiskLevel {
    if (score <= RISK_THRESHOLDS.LOW_MAX) {
      return RiskLevel.LOW;
    }
    if (score <= RISK_THRESHOLDS.MEDIUM_MAX) {
      return RiskLevel.MEDIUM;
    }
    return RiskLevel.HIGH;
  }

  private hashUserAgent(userAgent: string): string {
    return createHash('sha256').update(userAgent).digest('hex');
  }

  async markSessionForStepUp(sessionId: string): Promise<void> {
    try {
      await this.refreshSessionRepository.update(
        { id: sessionId },
        { requiresStepUp: true },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to mark session ${sessionId} for step-up: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async clearStepUpRequirement(sessionId: string): Promise<void> {
    try {
      await this.refreshSessionRepository.update(
        { id: sessionId },
        { requiresStepUp: false },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to clear step-up for session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async revokeFamilyWithBlacklist(
    userId: string,
    familyId: string,
  ): Promise<string[]> {
    try {
      const activeSessions = await this.refreshSessionRepository.find({
        where: {
          userId,
          familyId,
          revokedAt: undefined,
        },
      });

      const jtisToBlacklist: string[] = [];
      for (const session of activeSessions) {
        if (session.currentAccessTokenJti) {
          jtisToBlacklist.push(session.currentAccessTokenJti);
        }
      }

      await this.refreshSessionRepository
        .createQueryBuilder()
        .update(RefreshSession)
        .set({ revokedAt: new Date() })
        .where('userId = :userId', { userId })
        .andWhere('familyId = :familyId', { familyId })
        .andWhere('revokedAt IS NULL')
        .execute();

      this.logger.log(
        `Revoked family ${familyId} for user ${userId}, blacklisting ${jtisToBlacklist.length} access tokens`,
      );

      return jtisToBlacklist;
    } catch (error) {
      this.logger.error(
        `Failed to revoke family ${familyId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  async getActiveSessionFamilies(userId: string): Promise<
    {
      familyId: string;
      createdAt: Date;
      lastActivity: Date;
      ipPrefix: string | null;
      country: string | null;
      userAgentRaw: string | null;
      requiresStepUp: boolean;
    }[]
  > {
    try {
      const sessions = await this.refreshSessionRepository
        .createQueryBuilder('session')
        .select('session.familyId', 'familyId')
        .addSelect('MIN(session.createdAt)', 'createdAt')
        .addSelect('MAX(session.updatedAt)', 'lastActivity')
        .addSelect('MAX(session.ipPrefix)', 'ipPrefix')
        .addSelect('MAX(session.lastKnownCountry)', 'country')
        .addSelect('MAX(session.userAgentRaw)', 'userAgentRaw')
        .addSelect('MAX(session.requiresStepUp::int)::boolean', 'requiresStepUp')
        .where('session.userId = :userId', { userId })
        .andWhere('session.revokedAt IS NULL')
        .andWhere('session.absoluteExpiresAt > :now', { now: new Date() })
        .groupBy('session.familyId')
        .getRawMany();

      return sessions;
    } catch (error) {
      this.logger.error(
        `Failed to get active families for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }
}
