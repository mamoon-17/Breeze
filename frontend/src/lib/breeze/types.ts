// Backend entity & DTO types — mirror Breeze NestJS API.

export type AuthProvider = "google" | "apple" | "email";

export interface BreezeUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl?: string | null;
  provider?: AuthProvider;
  providerId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresIn: number;
  requiresStepUp?: boolean;
  riskLevel?: string;
}

export type ConversationType = "dm" | "group";

export interface ConversationMember {
  userId: string;
  joinedAt?: string;
  user?: BreezeUser;
}

export interface Conversation {
  id: string;
  type: ConversationType;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
  // Hydrated client-side from /members for DMs:
  peer?: BreezeUser | null;
  lastMessage?: ChatMessage | null;
  unreadCount?: number;
}

export interface MessageReceipt {
  id: string;
  messageId: string;
  userId: string;
  deliveredAt: string | null;
  readAt: string | null;
}

export interface ChatMessage {
  id: string;
  room: string;
  senderId: string;
  message: string;
  sentAt: string;
  createdAt: string;
  deletedAt?: string | null;
  receipts?: MessageReceipt[];
}

export interface SessionFamily {
  familyId: string;
  createdAt: string;
  lastActivity: string;
  location: string;
  ipPrefix: string;
  device: string;
  requiresStepUp: boolean;
}

// WS event payloads
export interface WsMessageDelivered {
  messageId: string;
  userId: string;
  deliveredAt: string;
}

export interface WsMessagesSeen {
  conversationId: string;
  userId: string;
  messageIds: string[];
  readAt: string;
  readUpToMessageId: string;
}

export interface WsUserOnline {
  userId: string;
}

export interface WsUserOffline {
  userId: string;
}

export interface WsTyping {
  conversationId: string;
  userId: string;
}

export interface WsMessageDeleted {
  messageId: string;
  room: string;
  deletedAt: string;
}

export interface WsAuthExpired {
  reason:
    | "access_token_revoked"
    | "refresh_session_invalid"
    | "session_validation_failed"
    | string;
}

export type InvitationStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "cancelled";

export interface ConversationInvitation {
  id: string;
  status: InvitationStatus;
  createdAt: string;
  respondedAt: string | null;
  conversation: {
    id: string;
    type: ConversationType;
    name: string | null;
    avatarUrl: string | null;
  };
  inviter: {
    id: string;
    email: string;
    displayName: string;
    avatarUrl?: string | null;
  };
  invitee: {
    id: string;
    email: string;
    displayName: string;
    avatarUrl?: string | null;
  };
}

export interface WsInvitationUpdated {
  id: string;
  status: InvitationStatus;
  conversationId: string;
}

export interface WsMemberAdded {
  conversationId: string;
  userId: string;
}

export interface WsConversationCreated {
  id: string;
  type: ConversationType;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
}
