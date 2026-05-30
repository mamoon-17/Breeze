import {
  Injectable,
  Inject,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { IOREDIS_CLIENT } from './redis.constants';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly client: Redis;
  private readonly logger = new Logger(RedisService.name);
  private redisAvailable = false;
  private readonly memoryStore = new Map<
    string,
    { value: string; expiresAt?: number }
  >();
  private fallbackLogged = false;

  constructor(@Inject(IOREDIS_CLIENT) client: Redis) {
    this.client = client;

    // Always attach an error handler so ioredis never emits an "unhandled error event".
    this.client.on('error', (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Redis error: ${msg}`);
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
      this.redisAvailable = true;
      this.logger.log('Redis connected');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis connect failed: ${msg}`);
      this.redisAvailable = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      if (this.redisAvailable) {
        await this.client.quit();
      }
    } catch {
      // ignore
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    if (!this.redisAvailable) {
      this.logFallbackOnce();
      return this.getFromMemory(key);
    }

    try {
      const val = await this.client.get(key);
      if (val === null) return undefined;
      try {
        return JSON.parse(val) as T;
      } catch {
        return val as unknown as T;
      }
    } catch (err) {
      this.handleRedisFailure(err);
      return this.getFromMemory(key);
    }
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const serialized =
      typeof value === 'string' ? value : JSON.stringify(value);
    if (!this.redisAvailable) {
      this.logFallbackOnce();
      this.setInMemory(key, serialized, ttlSeconds);
      return;
    }

    try {
      if (ttlSeconds && ttlSeconds > 0) {
        await this.client.set(key, serialized, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, serialized);
      }
    } catch (err) {
      this.handleRedisFailure(err);
      this.setInMemory(key, serialized, ttlSeconds);
    }
  }

  async del(key: string): Promise<void> {
    if (!this.redisAvailable) {
      this.logFallbackOnce();
      this.memoryStore.delete(key);
      return;
    }

    try {
      await this.client.del(key);
    } catch (err) {
      this.handleRedisFailure(err);
      this.memoryStore.delete(key);
    }
  }

  async reset(): Promise<void> {
    if (!this.redisAvailable) {
      this.logFallbackOnce();
      this.memoryStore.clear();
      return;
    }

    try {
      await this.client.flushdb();
    } catch (err) {
      this.handleRedisFailure(err);
      this.memoryStore.clear();
    }
  }

  private logFallbackOnce(): void {
    if (this.fallbackLogged) return;
    this.fallbackLogged = true;
    this.logger.warn(
      'Redis unavailable; using in-memory fallback. Token blacklist and call state will not be shared across instances.',
    );
  }

  private handleRedisFailure(error: unknown): void {
    const msg = error instanceof Error ? error.message : String(error);
    this.logger.warn(`Redis operation failed: ${msg}`);
    this.redisAvailable = false;
  }

  private getFromMemory<T>(key: string): T | undefined {
    const entry = this.memoryStore.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.memoryStore.delete(key);
      return undefined;
    }
    try {
      return JSON.parse(entry.value) as T;
    } catch {
      return entry.value as unknown as T;
    }
  }

  private setInMemory(key: string, value: string, ttlSeconds?: number): void {
    const expiresAt =
      ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : undefined;
    this.memoryStore.set(key, { value, expiresAt });
  }
}
