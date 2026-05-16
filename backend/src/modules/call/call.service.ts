import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { CallRecord } from './call-record.entity';
import { CallSessionMap, type CallSession } from './call-session.map';
import { SocketStateService } from '../socket/socket-state.service';
import { ConversationService } from '../conversation/conversation.service';
import { ChatService } from '../chat/chat.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CallServerEvents,
  CallErrorCodes,
  type CallOutcome,
} from './call.events';

const RING_TIMEOUT_MS = 30_000; // 30 seconds

@Injectable()
export class CallService {
  private readonly logger = new Logger(CallService.name);

  constructor(
    @InjectRepository(CallRecord)
    private readonly callRecordRepo: Repository<CallRecord>,
    private readonly sessionMap: CallSessionMap,
    private readonly socketState: SocketStateService,
    private readonly conversationService: ConversationService,
    private readonly chatService: ChatService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ─── Initiate ──────────────────────────────────────────────────────────────

  async initiate(
    callerId: string,
    calleeId: string,
    conversationId: string,
    offer: string,
  ): Promise<{ callId: string } | { error: string }> {
    // Self-call guard
    if (callerId === calleeId) {
      this.socketState.emitToUser(callerId, CallServerEvents.ERROR, {
        code: CallErrorCodes.CANNOT_CALL_SELF,
        message: 'You cannot call yourself.',
      });
      return { error: CallErrorCodes.CANNOT_CALL_SELF };
    }

    // DM membership guard
    const memberIds =
      await this.conversationService.getMemberUserIds(conversationId);
    if (
      memberIds.length !== 2 ||
      !memberIds.includes(callerId) ||
      !memberIds.includes(calleeId)
    ) {
      this.socketState.emitToUser(callerId, CallServerEvents.ERROR, {
        code: CallErrorCodes.NOT_DM,
        message: 'Voice calls are only supported in DM conversations.',
      });
      return { error: CallErrorCodes.NOT_DM };
    }

    // Busy guard — caller
    if (this.sessionMap.isUserBusy(callerId)) {
      this.socketState.emitToUser(callerId, CallServerEvents.ERROR, {
        code: 'ALREADY_IN_CALL',
        message: 'You are already in a call.',
      });
      return { error: 'ALREADY_IN_CALL' };
    }

    // Busy guard — callee
    if (this.sessionMap.isUserBusy(calleeId)) {
      this.socketState.emitToUser(callerId, CallServerEvents.BUSY, {
        calleeId,
      });
      return { error: 'BUSY' };
    }

    const callId = randomUUID();
    const now = new Date();

    const session: CallSession = {
      callId,
      conversationId,
      callerId,
      calleeId,
      state: 'ringing',
      createdAt: now,
      ringTimeout: null,
    };

    // Ring timeout — auto-end as missed after 30s
    session.ringTimeout = setTimeout(() => {
      this.endSession(callId, 'missed');
    }, RING_TIMEOUT_MS);

    this.sessionMap.create(session);

    // Notify callee
    this.socketState.emitToUser(calleeId, CallServerEvents.INCOMING, {
      callId,
      conversationId,
      callerId,
      offer,
    });

    this.logger.log(
      `Call initiated: ${callId} (${callerId} → ${calleeId}) in ${conversationId}`,
    );

    return { callId };
  }

  // ─── Accept ────────────────────────────────────────────────────────────────

  accept(callId: string, calleeId: string): boolean {
    const session = this.sessionMap.get(callId);
    if (!session || session.calleeId !== calleeId || session.state !== 'ringing') {
      this.socketState.emitToUser(calleeId, CallServerEvents.ERROR, {
        code: CallErrorCodes.INVALID_SESSION,
        message: 'No ringing call to accept.',
      });
      return false;
    }

    // Clear ring timeout
    if (session.ringTimeout) {
      clearTimeout(session.ringTimeout);
      session.ringTimeout = null;
    }

    session.state = 'active';
    session.answeredAt = new Date();

    this.logger.log(`Call accepted: ${callId} by ${calleeId}`);
    return true;
  }

  // ─── Answer (SDP) ──────────────────────────────────────────────────────────

  answer(callId: string, calleeId: string, answerSdp: string): boolean {
    const session = this.sessionMap.get(callId);
    if (!session || session.calleeId !== calleeId) {
      return false;
    }

    // Relay answer to caller
    this.socketState.emitToUser(session.callerId, CallServerEvents.ANSWERED, {
      callId,
      answer: answerSdp,
    });

    this.logger.log(`Answer relayed: ${callId}`);
    return true;
  }

  // ─── ICE Candidate relay ───────────────────────────────────────────────────

  relayIceCandidate(
    callId: string,
    senderId: string,
    candidate: string,
  ): void {
    const session = this.sessionMap.get(callId);
    if (!session) return;

    const recipientId =
      senderId === session.callerId ? session.calleeId : session.callerId;

    this.socketState.emitToUser(recipientId, CallServerEvents.ICE_CANDIDATE, {
      callId,
      candidate,
    });
  }

  // ─── Reject ────────────────────────────────────────────────────────────────

  reject(callId: string, calleeId: string): void {
    const session = this.sessionMap.get(callId);
    if (!session || session.calleeId !== calleeId || session.state !== 'ringing') {
      return;
    }
    this.endSession(callId, 'rejected');
  }

  // ─── Cancel ────────────────────────────────────────────────────────────────

  cancel(callId: string, callerId: string): void {
    const session = this.sessionMap.get(callId);
    if (!session || session.callerId !== callerId || session.state !== 'ringing') {
      return;
    }
    this.endSession(callId, 'cancelled');
  }

  // ─── End (hangup) ──────────────────────────────────────────────────────────

  end(callId: string, _userId: string): void {
    const session = this.sessionMap.get(callId);
    if (!session || session.state === 'ended') return;

    const outcome: CallOutcome =
      session.state === 'ringing' ? 'missed' : 'completed';
    this.endSession(callId, outcome);
  }

  // ─── ICE failed ────────────────────────────────────────────────────────────

  iceFailed(callId: string, _userId: string): void {
    const session = this.sessionMap.get(callId);
    if (!session || session.state === 'ended') return;
    this.endSession(callId, 'failed');
  }

  // ─── Disconnect handler ────────────────────────────────────────────────────

  onUserDisconnect(userId: string): void {
    const session = this.sessionMap.getSessionForUser(userId);
    if (!session) return;

    if (session.state === 'ringing') {
      if (userId === session.callerId) {
        // Caller left while ringing → cancelled
        this.endSession(session.callId, 'cancelled');
      } else {
        // Callee left while ringing → missed
        this.endSession(session.callId, 'missed');
      }
    } else if (session.state === 'active') {
      // Active call — treat as hangup
      this.endSession(session.callId, 'completed');
    }
  }

  // ─── Central cleanup ──────────────────────────────────────────────────────

  async endSession(callId: string, outcome: CallOutcome): Promise<void> {
    const session = this.sessionMap.get(callId);
    if (!session || session.state === 'ended') return;

    // Mark ended immediately to prevent re-entry
    session.state = 'ended';

    // Clear ring timer
    if (session.ringTimeout) {
      clearTimeout(session.ringTimeout);
      session.ringTimeout = null;
    }

    const now = new Date();

    // Calculate duration
    let durationSeconds: number | null = null;
    if (session.answeredAt) {
      durationSeconds = Math.round(
        (now.getTime() - session.answeredAt.getTime()) / 1000,
      );
    }

    // Persist CallRecord
    try {
      const record = this.callRecordRepo.create({
        conversationId: session.conversationId,
        callerId: session.callerId,
        calleeId: session.calleeId,
        callType: 'voice',
        outcome,
        durationSeconds,
        startedAt: session.createdAt,
        answeredAt: session.answeredAt ?? null,
        endedAt: now,
      });
      await this.callRecordRepo.save(record);
    } catch (err) {
      this.logger.error(`Failed to persist CallRecord for ${callId}`, err);
    }

    // Emit ended to both parties (idempotent)
    const endedPayload = {
      callId,
      conversationId: session.conversationId,
      outcome,
      durationSeconds,
    };

    this.socketState.emitToUser(
      session.callerId,
      CallServerEvents.ENDED,
      endedPayload,
    );
    this.socketState.emitToUser(
      session.calleeId,
      CallServerEvents.ENDED,
      endedPayload,
    );

    // Also send specific events for caller/callee UX:
    if (outcome === 'missed') {
      this.socketState.emitToUser(session.callerId, CallServerEvents.MISSED, {
        callId,
        calleeId: session.calleeId,
      });
    }

    // Remove from maps
    this.sessionMap.delete(callId);

    // Insert system message in the conversation thread
    try {
      const content = this.buildSystemMessageContent(outcome, durationSeconds);
      await this.chatService.insertSystemMessage({
        room: session.conversationId,
        senderId: session.callerId,
        subtype: 'call',
        content,
        metadata: {
          callId,
          outcome,
          durationSeconds,
          callerId: session.callerId,
          calleeId: session.calleeId,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to insert system message for call ${callId}`,
        err,
      );
    }

    // Send missed-call push notification to callee
    if (outcome === 'missed') {
      try {
        await this.notificationsService.sendMissedCallPush(
          session.calleeId,
          {
            type: 'missed_call',
            room: session.conversationId,
            callId,
          },
        );
      } catch (err) {
        this.logger.error(
          `Failed to send missed-call push for call ${callId}`,
          err,
        );
      }
    }

    this.logger.log(
      `Call ended: ${callId} outcome=${outcome} duration=${durationSeconds ?? 'n/a'}s`,
    );
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private buildSystemMessageContent(
    outcome: CallOutcome,
    durationSeconds: number | null,
  ): string {
    const durationStr = durationSeconds
      ? this.formatDuration(durationSeconds)
      : null;

    switch (outcome) {
      case 'completed':
        return `Voice call · ${durationStr ?? '0s'}`;
      case 'missed':
        return 'Missed voice call';
      case 'rejected':
        return 'Declined voice call';
      case 'cancelled':
        return 'Cancelled voice call';
      case 'failed':
        return 'Voice call failed';
      case 'busy':
        return 'Voice call — busy';
      default:
        return 'Voice call';
    }
  }

  private formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m === 0) return `${s}s`;
    return `${m}m ${s.toString().padStart(2, '0')}s`;
  }

  // ─── Call history ──────────────────────────────────────────────────────────

  async getHistory(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<{ records: CallRecord[]; total: number }> {
    const [records, total] = await this.callRecordRepo.findAndCount({
      where: [{ callerId: userId }, { calleeId: userId }],
      order: { startedAt: 'DESC' },
      take: limit,
      skip: (page - 1) * limit,
    });

    return { records, total };
  }
}
