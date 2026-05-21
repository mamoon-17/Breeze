export interface GroupCallParticipant {
  userId: string;
  socketId: string;
  userName: string;
  joinedAt: Date;
}

export interface GroupCallSession {
  callId: string;
  conversationId: string;
  initiatorId: string;
  participants: GroupCallParticipant[];
  state: 'waiting' | 'active' | 'ended';
  createdAt: Date;
}
