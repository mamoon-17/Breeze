import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Result, ok, err } from 'neverthrow';
import { AppError, Errors } from '../common/errors/app-error';

@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService) {}

  /** True when both Google OAuth env vars are non-empty (strategy + routes enabled). */
  get googleOAuthConfigured(): boolean {
    const id = this.configService.get<string>('GOOGLE_CLIENT_ID')?.trim();
    const secret = this.configService.get<string>('GOOGLE_CLIENT_SECRET')?.trim();
    return Boolean(id && secret);
  }

  get googleClientId(): string {
    const value = this.getRequired('GOOGLE_CLIENT_ID');
    if (value.isErr()) throw new Error(value.error.message);
    return value.value;
  }

  get googleClientSecret(): string {
    const value = this.getRequired('GOOGLE_CLIENT_SECRET');
    if (value.isErr()) throw new Error(value.error.message);
    return value.value;
  }

  get dbUrl(): string {
    const dbUrl =
      this.configService.get<string>('DATABASE_URL') ??
      this.configService.get<string>('DB_URL');

    if (!dbUrl) {
      throw new Error(
        'Missing required environment variable: DATABASE_URL (or DB_URL)',
      );
    }

    return dbUrl;
  }

  get googleCallbackUrl(): string {
    return (
      this.configService.get<string>('GOOGLE_CALLBACK_URL') ??
      'http://localhost:3000/auth/google/callback'
    );
  }

  get jwtAccessSecret(): string {
    const value = this.getRequired('JWT_ACCESS_SECRET');
    if (value.isErr()) throw new Error(value.error.message);
    return value.value;
  }

  get jwtRefreshSecret(): string {
    const value = this.getRequired('JWT_REFRESH_SECRET');
    if (value.isErr()) throw new Error(value.error.message);
    return value.value;
  }

  get jwtAccessExpiresIn(): string {
    return this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '10m';
  }

  get jwtRefreshExpiresIn(): string {
    return this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d';
  }

  get jwtAccessExpiresInSeconds(): number {
    return (
      Number(this.configService.get<string>('JWT_ACCESS_EXPIRES_IN_SECONDS')) ||
      600
    );
  }

  get jwtRefreshExpiresInSeconds(): number {
    return (
      Number(
        this.configService.get<string>('JWT_REFRESH_EXPIRES_IN_SECONDS'),
      ) || 604800
    );
  }

  get accessCookieMaxAgeMs(): number {
    return (
      Number(this.configService.get<string>('JWT_ACCESS_COOKIE_MAX_AGE_MS')) ||
      600000
    );
  }

  get refreshCookieMaxAgeMs(): number {
    return (
      Number(this.configService.get<string>('JWT_REFRESH_COOKIE_MAX_AGE_MS')) ||
      604800000
    );
  }

  get refreshSessionAbsoluteLifetimeSeconds(): number {
    return (
      Number(
        this.configService.get<string>(
          'JWT_REFRESH_SESSION_ABSOLUTE_LIFETIME_SECONDS',
        ),
      ) || 2592000
    );
  }

  get refreshReuseDetectionRetentionSeconds(): number {
    return (
      Number(
        this.configService.get<string>(
          'JWT_REFRESH_REUSE_DETECTION_RETENTION_SECONDS',
        ),
      ) || 604800
    );
  }

  get strictRefreshReuseRevocation(): boolean {
    return (
      this.configService.get<string>('JWT_STRICT_REFRESH_REUSE_REVOKE_ALL') ===
      'true'
    );
  }

  get anomalyDetectionEnabled(): boolean {
    return (
      this.configService.get<string>('ANOMALY_DETECTION_ENABLED') !== 'false'
    );
  }

  get anomalyStepUpAccessTokenTtl(): number {
    return (
      Number(this.configService.get<string>('ANOMALY_STEPUP_ACCESS_TOKEN_TTL')) ||
      120
    );
  }

  get impossibleTravelMinutes(): number {
    return (
      Number(this.configService.get<string>('IMPOSSIBLE_TRAVEL_MINUTES')) || 60
    );
  }

  get rapidRefreshWindowMs(): number {
    return (
      Number(this.configService.get<string>('RAPID_REFRESH_WINDOW_MS')) ||
      2 * 60 * 1000
    );
  }

  get rapidRefreshThreshold(): number {
    return (
      Number(this.configService.get<string>('RAPID_REFRESH_THRESHOLD')) || 3
    );
  }

  get emailEnabled(): boolean {
    return this.configService.get<string>('EMAIL_ENABLED') === 'true';
  }

  get smtpConfig():
    | { host: string; port: number; user: string; pass: string; from: string }
    | undefined {
    const host = this.configService.get<string>('SMTP_HOST');
    const port = Number(this.configService.get<string>('SMTP_PORT'));
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');
    const from = this.configService.get<string>('SMTP_FROM');

    if (host && port && user && pass && from) {
      return { host, port, user, pass, from };
    }
    return undefined;
  }

  get isProduction(): boolean {
    return this.configService.get<string>('NODE_ENV') === 'production';
  }

  get allowedOrigins(): string[] {
    const origins = this.configService.get<string>('ALLOWED_ORIGINS');
    if (origins) {
      return origins.split(',').map((o) => o.trim());
    }
    return [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:5173',
    ];
  }

  get frontendUrl(): string {
    return (
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:5173'
    );
  }

  get vapidSubject(): string {
    return this.configService.get<string>('VAPID_SUBJECT') ?? 'mailto:admin@example.com';
  }

  get vapidPublicKey(): string {
    const value = this.getRequired('VAPID_PUBLIC_KEY');
    if (value.isErr()) throw new Error(value.error.message);
    return value.value;
  }

  get vapidPrivateKey(): string {
    const value = this.getRequired('VAPID_PRIVATE_KEY');
    if (value.isErr()) throw new Error(value.error.message);
    return value.value;
  }

  get wsPort(): number {
    return (
      Number(this.configService.get<string>('WS_PORT')) ||
      Number(this.configService.get<string>('PORT')) ||
      3000
    );
  }

  get redisHost(): string {
    return this.configService.get<string>('REDIS_HOST') ?? 'localhost';
  }

  get redisPort(): number {
    return Number(this.configService.get<string>('REDIS_PORT')) || 6379;
  }

  get redisPassword(): string | undefined {
    return this.configService.get<string>('REDIS_PASSWORD');
  }

  get redisDb(): number {
    return Number(this.configService.get<string>('REDIS_DB')) || 0;
  }

  /**
   * Get required env var with Result type
   * Returns Result<string, AppError> instead of throwing
   */
  private getRequired(key: string): Result<string, AppError> {
    const value = this.configService.get<string>(key);

    if (!value) {
      return err(Errors.missingEnvVar(key));
    }

    return ok(value);
  }
}
