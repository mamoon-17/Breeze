import { RiskLevel, AnomalySignals } from '../refresh-event.entity';

export interface AnomalyContext {
  userId: string;
  familyId: string;
  sessionId: string;
  ipAddress?: string;
  userAgent?: string;
  country?: string;
  isVpnOrProxy?: boolean;
}

export interface RiskAssessment {
  riskScore: number;
  riskLevel: RiskLevel;
  signals: AnomalySignals;
  shouldRevoke: boolean;
  shouldRequireStepUp: boolean;
  accessTokenTtlOverride?: number;
}

export const RISK_WEIGHTS = {
  IMPOSSIBLE_TRAVEL: 80,
  COUNTRY_CHANGED: 40,
  USER_AGENT_CHANGED: 20,
  RAPID_REFRESHES: 30,
  UNUSUAL_HOUR: 10,
} as const;

export const RISK_THRESHOLDS = {
  LOW_MAX: 29,
  MEDIUM_MAX: 59,
} as const;

export const IMPOSSIBLE_TRAVEL_MINUTES = 60;
export const RAPID_REFRESH_WINDOW_MS = 2 * 60 * 1000;
export const RAPID_REFRESH_THRESHOLD = 3;
