import { Injectable } from '@nestjs/common';

/**
 * In-memory state for active call sessions.
 * Phase 12 will replace this with Redis-backed keys.
 */
export interface CallSession {
  callId: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  state: 'ringing' | 'active' | 'ended';
  ringTimeout: ReturnType<typeof setTimeout> | null;
  createdAt: Date;
  answeredAt?: Date;
}

@Injectable()
export class CallSessionMap {
  /** callId → CallSession */
  private readonly sessions = new Map<string, CallSession>();

  /** userId → callId (for O(1) busy lookup) */
  private readonly userToCall = new Map<string, string>();

  // ─── Session CRUD ────────────────────────────────────────────────────────────

  create(session: CallSession): void {
    this.sessions.set(session.callId, session);
    this.userToCall.set(session.callerId, session.callId);
    this.userToCall.set(session.calleeId, session.callId);
  }

  get(callId: string): CallSession | undefined {
    return this.sessions.get(callId);
  }

  delete(callId: string): void {
    const session = this.sessions.get(callId);
    if (session) {
      if (session.ringTimeout) clearTimeout(session.ringTimeout);

      // Only remove user→call mapping if it still points to this session
      // (prevents clearing a newer session's entry).
      if (this.userToCall.get(session.callerId) === callId) {
        this.userToCall.delete(session.callerId);
      }
      if (this.userToCall.get(session.calleeId) === callId) {
        this.userToCall.delete(session.calleeId);
      }

      this.sessions.delete(callId);
    }
  }

  // ─── Busy lookup ─────────────────────────────────────────────────────────────

  /** Returns the active session for the user, or undefined. */
  getSessionForUser(userId: string): CallSession | undefined {
    const callId = this.userToCall.get(userId);
    if (!callId) return undefined;
    const session = this.sessions.get(callId);
    if (!session || session.state === 'ended') return undefined;
    return session;
  }

  isUserBusy(userId: string): boolean {
    return !!this.getSessionForUser(userId);
  }
}
