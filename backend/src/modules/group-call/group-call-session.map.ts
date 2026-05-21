import { Injectable } from '@nestjs/common';
import { GroupCallSession } from './group-call-session';

@Injectable()
export class GroupCallSessionMap {
  private readonly sessions = new Map<string, GroupCallSession>();

  get(callId: string): GroupCallSession | undefined {
    return this.sessions.get(callId);
  }

  set(callId: string, session: GroupCallSession): void {
    this.sessions.set(callId, session);
  }

  delete(callId: string): void {
    this.sessions.delete(callId);
  }

  getByConversationId(conversationId: string): GroupCallSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.conversationId === conversationId && session.state !== 'ended') {
        return session;
      }
    }

    return undefined;
  }

  getByUserId(userId: string): GroupCallSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.state === 'ended') {
        continue;
      }

      const hasParticipant = session.participants.some(
        (participant) => participant.userId === userId,
      );

      if (hasParticipant) {
        return session;
      }
    }

    return undefined;
  }
}
