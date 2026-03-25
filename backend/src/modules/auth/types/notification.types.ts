import { RiskLevel } from '../refresh-event.entity';

export interface NotificationContext {
  userId: string;
  email: string;
  ipPrefix?: string;
  country?: string;
  userAgent?: string;
  timestamp: Date;
}

export interface NewSessionNotification extends NotificationContext {
  type: 'new_session';
  familyId: string;
}

export interface SuspiciousActivityNotification extends NotificationContext {
  type: 'suspicious_activity';
  riskLevel: RiskLevel.MEDIUM;
  riskScore: number;
  signals: string[];
}

export interface ForcedLogoutNotification extends NotificationContext {
  type: 'forced_logout';
  riskLevel: RiskLevel.HIGH;
  riskScore: number;
  reason: string;
  signals: string[];
}

export type SecurityNotification =
  | NewSessionNotification
  | SuspiciousActivityNotification
  | ForcedLogoutNotification;

export interface EmailContent {
  subject: string;
  body: string;
}
