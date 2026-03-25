import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { Result, ok, err } from 'neverthrow';
import { AppError, Errors } from '../../common/errors/app-error';

@Injectable()
export class TokenBlacklistService {
  private readonly logger = new Logger(TokenBlacklistService.name);
  private readonly BLACKLIST_PREFIX = 'token:blacklist:';

  constructor(private readonly redisService: RedisService) {}

  async addToBlacklist(
    jti: string,
    expiresInSeconds: number,
  ): Promise<Result<void, AppError>> {
    try {
      const key = this.getKey(jti);
      await this.redisService.set(key, '1', expiresInSeconds * 1000);
      
      this.logger.log(`Token ${jti} added to blacklist for ${expiresInSeconds}s`);
      return ok(undefined);
    } catch (error) {
      const originalError =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Failed to blacklist token: ${originalError.message}`);
      return err(Errors.internalError(originalError));
    }
  }

  async isBlacklisted(jti: string): Promise<Result<boolean, AppError>> {
    try {
      const key = this.getKey(jti);
      const result = await this.redisService.get<string>(key);
      return ok(result === '1');
    } catch (error) {
      const originalError =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Failed to check token blacklist: ${originalError.message}`);
      return err(Errors.internalError(originalError));
    }
  }

  async removeFromBlacklist(jti: string): Promise<Result<void, AppError>> {
    try {
      const key = this.getKey(jti);
      await this.redisService.del(key);
      return ok(undefined);
    } catch (error) {
      const originalError =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Failed to remove token from blacklist: ${originalError.message}`);
      return err(Errors.internalError(originalError));
    }
  }

  private getKey(jti: string): string {
    return `${this.BLACKLIST_PREFIX}${jti}`;
  }
}
