import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Result, ok, err } from 'neverthrow';
import { AppError, Errors } from '../common/errors/app-error';

@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService) {}

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

  get isProduction(): boolean {
    return this.configService.get<string>('NODE_ENV') === 'production';
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
