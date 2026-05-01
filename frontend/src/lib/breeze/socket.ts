// Socket.io client wired with the current bearer token.
//
// Mid-session re-auth flow:
//   · We proactively refresh the access token ~60s before it expires.
//   · If the backend kicks us with `authExpired`, we refresh and reconnect.
//   · If a handshake fails with an auth-shaped `connect_error`, we also
//     refresh + retry once before giving up.

import { io, type Socket } from "socket.io-client";
import { API_BASE, getAccessToken, onTokensChange, refreshTokens } from "./api";
import type {
  AuthTokens,
  ChatMessage,
  ConversationInvitation,
  WsConversationCreated,
  WsInvitationUpdated,
  WsMemberAdded,
  WsMessageDelivered,
  WsMessagesSeen,
  WsMessageDeleted,
  WsUserOnline,
  WsUserOffline,
  WsTyping,
  WsAuthExpired,
} from "./types";

let socket: Socket | null = null;
let tokensUnsubscribe: (() => void) | null = null;
let proactiveRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectingForAuth = false;
let closeHandlersAttached = false;

export interface BreezeServerEvents {
  newMessage: (msg: ChatMessage) => void;
  messageDelivered: (evt: WsMessageDelivered) => void;
  messagesSeen: (evt: WsMessagesSeen) => void;
  messageDeleted: (evt: WsMessageDeleted) => void;
  joinedRoom: (room: string) => void;
  userOnline: (evt: WsUserOnline) => void;
  userOffline: (evt: WsUserOffline) => void;
  userTyping: (evt: WsTyping) => void;
  userStopTyping: (evt: WsTyping) => void;
  authExpired: (evt: WsAuthExpired) => void;
  invitationReceived: (evt: ConversationInvitation) => void;
  invitationUpdated: (evt: WsInvitationUpdated) => void;
  memberAdded: (evt: WsMemberAdded) => void;
  conversationCreated: (evt: WsConversationCreated) => void;
}

function clearProactiveRefresh() {
  if (proactiveRefreshTimer) {
    clearTimeout(proactiveRefreshTimer);
    proactiveRefreshTimer = null;
  }
}

function scheduleProactiveRefresh(tokens: AuthTokens | null) {
  clearProactiveRefresh();
  if (!tokens?.accessToken) return;

  // Historical bug: the backend used to return `accessTokenExpiresIn` as a
  // string like "600s". `Number("600s") = NaN`, which combined with
  // `setTimeout(fn, NaN)` (browsers treat NaN as 0) produced an immediate
  // refresh storm that tripped rapid-refresh anomaly detection and killed
  // sessions after a few minutes. Defensive coercion below — plus the
  // `Number.isFinite` guard and minimum schedule — keeps us safe even if
  // a stale server or bad callback URL tries to feed us garbage.
  const ttlSeconds = Number(tokens.accessTokenExpiresIn);
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return;

  // Refresh 60s before expiry, minimum 15s out so reconnects never race
  // against expiry but we never schedule an immediate refresh either.
  const ms = Math.max((ttlSeconds - 60) * 1000, 15_000);

  proactiveRefreshTimer = setTimeout(() => {
    void refreshTokens().catch(() => {
      // Errors handled by api.ts → clears tokens → auth context signs out.
    });
  }, ms);
}

/** Try to recover the socket after an auth failure. Returns true on success. */
async function reauthAndReconnect(): Promise<boolean> {
  if (!socket) return false;
  if (reconnectingForAuth) return true;
  reconnectingForAuth = true;
  try {
    const tokens = await refreshTokens();
    if (!tokens?.accessToken || !socket) return false;
    socket.auth = { token: tokens.accessToken };
    if (socket.connected) socket.disconnect();
    socket.connect();
    return true;
  } finally {
    reconnectingForAuth = false;
  }
}

function isAuthError(err: unknown): boolean {
  if (!err) return false;
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err);
  return /unauthor|invalid.*token|expired.*token|revok/i.test(msg);
}

export function getSocket(): Socket {
  if (socket) return socket;
  const token = getAccessToken();
  socket = io(API_BASE, {
    transports: ["websocket"],
    auth: token ? { token } : {},
    autoConnect: true,
    withCredentials: true,
  });

  // Ensure the server sees a disconnect when the tab is closed/navigated away.
  // Without this, presence can remain "online" until Socket.IO ping timeouts fire.
  if (typeof window !== "undefined" && !closeHandlersAttached) {
    closeHandlersAttached = true;
    const closeNow = () => {
      try {
        socket?.disconnect();
      } catch {
        // ignore
      }
    };
    window.addEventListener("pagehide", closeNow);
    window.addEventListener("beforeunload", closeNow);
  }

  // Re-auth when tokens rotate (proactive refresh or api.ts auto-retry).
  tokensUnsubscribe?.();
  tokensUnsubscribe = onTokensChange((t) => {
    scheduleProactiveRefresh(t);
    if (!socket) return;
    socket.auth = t?.accessToken ? { token: t.accessToken } : {};
    // Only bounce the connection if we already had one going — a fresh
    // connect would otherwise not pick up the new token.
    if (socket.connected) {
      socket.disconnect();
      socket.connect();
    }
  });

  // Reactive: backend tells us the session is no longer valid.
  socket.on("authExpired", async () => {
    const recovered = await reauthAndReconnect();
    if (!recovered) {
      // Let the app layer decide what to do (redirect to sign-in, etc.).
      // We signal by clearing tokens via api.ts, which fires tokensChange(null).
      // That happens inside refreshTokens() on failure already.
    }
  });

  // Reactive: access token rejected at handshake — try a one-shot refresh + reconnect.
  socket.on("connect_error", async (err: Error) => {
    if (!isAuthError(err)) return;
    await reauthAndReconnect();
  });

  // First-time scheduling — we don't have the expiry in memory for the
  // current access token (it wasn't surfaced to `onTokensChange`), so we
  // rely on subsequent refreshes to start the cadence. Nothing else to do here.

  return socket;
}

export function disconnectSocket() {
  clearProactiveRefresh();
  if (tokensUnsubscribe) {
    tokensUnsubscribe();
    tokensUnsubscribe = null;
  }
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function joinRoom(conversationId: string) {
  getSocket().emit("joinRoom", conversationId);
}

export function sendMessage(
  room: string,
  payload: { message?: string; attachmentUrl?: string; attachmentType?: "audio" },
) {
  getSocket().emit("sendMessage", { room, ...payload });
}

export function deleteMessage(room: string, messageId: string) {
  getSocket().emit("deleteMessage", { room, messageId });
}

export function markRead(conversationId: string, readUpToMessageId: string) {
  getSocket().emit("markRead", { conversationId, readUpToMessageId });
}

export function emitTyping(conversationId: string) {
  getSocket().emit("typing", conversationId);
}

export function emitStopTyping(conversationId: string) {
  getSocket().emit("stopTyping", conversationId);
}

/**
 * Emits a `getPresence` event and resolves with the list of online user IDs
 * for the given conversation. Returns [] on timeout or error.
 */
export function getPresence(conversationId: string): Promise<string[]> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve([]), 5000);
    getSocket().emit(
      "getPresence",
      conversationId,
      (response: { conversationId: string; onlineUserIds: string[] }) => {
        clearTimeout(timer);
        resolve(response?.onlineUserIds ?? []);
      },
    );
  });
}
