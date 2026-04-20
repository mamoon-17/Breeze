import { Injectable, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';
import { IOREDIS_CLIENT } from './redis.constants';

@Injectable()
export class RedisService {
  private readonly client: Redis;

  constructor(@Inject(IOREDIS_CLIENT) client: Redis) {
    this.client = client;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const val = await this.client.get(key);
    if (val === null) return undefined;
    try {
      return JSON.parse(val) as T;
    } catch {
      return val as unknown as T;
    }
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const serialized =
      typeof value === 'string' ? value : JSON.stringify(value);
    if (ttlSeconds && ttlSeconds > 0) {
      await this.client.set(key, serialized, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, serialized);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async reset(): Promise<void> {
    await this.client.flushdb();
  }
}
