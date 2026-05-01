// Backend entity & DTO types — mirror Breeze NestJS API.

export type AuthProvider = "google" | "apple" | "email";

export interface BreezeUser {
  id: string;
  email: string;
  /**
   * Effective display name — respects `customDisplayName` when the user has
   * set one, otherwise falls back to the Google-supplied name. Always
   * non-null in practice (backend guarantees a string) but typed as
   * nullable to match legacy callers.
   */
  displayName: string | null;
  /**
   * Relative path (starts with `/`) to our avatar proxy endpoint, or `null`
   * when the user has no avatar bytes on disk. Clients compose it as
   * `${API_BASE}${avatarUrl}`.
   */
  avatarUrl?: string | null;
  /** Raw Google-supplied name, useful for showing defaults in the settings UI. */
  googleDisplayName?: string | null;
  /** When true the avatar served is the cached Google picture, else a custom upload. */
  useGoogleAvatar?: boolean;
  /** Whether the user has an uploaded custom avatar file, regardless of current toggle. */
  hasCustomAvatar?: boolean;
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
  attachmentUrl?: string | null;
  attachmentType?: "audio" | string | null;
  attachmentsCount?: number;
  firstAttachmentType?: string | null;
  sentAt: string;
  createdAt: string;
  deletedAt?: string | null;
  receipts?: MessageReceipt[];
  attachments?: {
    id: string;
    messageId: string;
    type: "image" | "video" | "audio" | "file" | string;
    key: string;
    url?: string;
    mime: string;
    size: string;
    filename?: string | null;
    width?: number | null;
    height?: number | null;
    durationMs?: number | null;
    createdAt: string;
  }[];
  /**
   * Client-only field for instant rendering while we wait for the server
   * echo. Never persisted and never sent over the wire.
   */
  optimistic?: boolean;
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
