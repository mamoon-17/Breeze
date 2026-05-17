import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

/**
 * Redis-backed state for active call sessions.
 * Replaced the in-memory Maps from Phase 9 with Redis keys
 * so session data is shared across horizontally-scaled instances.
 *
 * Key schema (all keys auto-prefixed with `breeze:` by RedisModule):
 *   call:session:<callId>   — JSON-serialized CallSession, TTL 7200s
 *   call:user:<userId>      — callId string,                TTL 7200s
 *   call:socket:<socketId>  — callId string,                TTL 7200s
 */

export interface CallSession {
  callId: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  callerSocketId?: string;
  calleeSocketId?: string;
  callType?: 'audio' | 'video';
  state: 'ringing' | 'active' | 'ended';
  /** ringTimeout is handled in-process; not serialized to Redis. */
  ringTimeout: ReturnType<typeof setTimeout> | null;
  createdAt: Date;
  answeredAt?: Date;
}

const TTL = 7200; // 2 hours

@Injectable()
export class CallSessionMap {
  constructor(private readonly redis: RedisService) {}

  // ─── Session CRUD ────────────────────────────────────────────────────────────

  async set(callId: string, session: CallSession): Promise<void> {
    // Serialize — strip non-serializable fields (ringTimeout)
    const { ringTimeout: _rt, ...serializable } = session;
    await this.redis.set(`call:session:${callId}`, serializable, TTL);
    await this.redis.set(`call:user:${session.callerId}`, callId, TTL);
    await this.redis.set(`call:user:${session.calleeId}`, callId, TTL);
    if (session.callerSocketId) {
      await this.redis.set(
        `call:socket:${session.callerSocketId}`,
        callId,
        TTL,
      );
    }
    if (session.calleeSocketId) {
      await this.redis.set(
        `call:socket:${session.calleeSocketId}`,
        callId,
        TTL,
      );
    }
  }

  /** Alias kept for backward compat with CallService.initiate(). */
  async create(session: CallSession): Promise<void> {
    return this.set(session.callId, session);
  }

  async get(callId: string): Promise<CallSession | null> {
    const raw = await this.redis.get<CallSession>(`call:session:${callId}`);
    if (!raw) return null;
    // Restore non-serializable defaults
    return {
      ...raw,
      ringTimeout: null,
      createdAt: new Date(raw.createdAt),
      answeredAt: raw.answeredAt ? new Date(raw.answeredAt) : undefined,
    };
  }

  async delete(callId: string): Promise<void> {
    const session = await this.get(callId);
    if (!session) return;

    await this.redis.del(`call:session:${callId}`);
    await this.redis.del(`call:user:${session.callerId}`);
    await this.redis.del(`call:user:${session.calleeId}`);
    if (session.callerSocketId) {
      await this.redis.del(`call:socket:${session.callerSocketId}`);
    }
    if (session.calleeSocketId) {
      await this.redis.del(`call:socket:${session.calleeSocketId}`);
    }
  }

  // ─── Busy lookup ─────────────────────────────────────────────────────────────

  /** Returns the active session for the user, or null. */
  async getSessionForUser(userId: string): Promise<CallSession | null> {
    const callId = await this.redis.get<string>(`call:user:${userId}`);
    if (!callId) return null;
    const session = await this.get(callId);
    if (!session || session.state === 'ended') return null;
    return session;
  }

  async isUserBusy(userId: string): Promise<boolean> {
    return (await this.getSessionForUser(userId)) !== null;
  }

  // ─── Socket lookup ───────────────────────────────────────────────────────────

  async getBySocketId(socketId: string): Promise<CallSession | null> {
    const callId = await this.redis.get<string>(`call:socket:${socketId}`);
    if (!callId) return null;
    return this.get(callId);
  }
}
