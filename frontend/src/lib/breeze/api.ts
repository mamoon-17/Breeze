// Tiny typed fetch client for the Breeze NestJS backend.
// - Bearer access token in memory (refreshed on 401)
// - Refresh token persisted to localStorage so reloads work
// - Talks to VITE_API_URL (configure in .env)

import type {
  AuthTokens,
  BreezeUser,
  Conversation,
  ChatMessage,
  SessionFamily,
} from "./types";

const REFRESH_KEY = "breeze.refreshToken";

let accessToken: string | null = null;
let refreshToken: string | null =
  typeof window !== "undefined" ? localStorage.getItem(REFRESH_KEY) : null;
let refreshPromise: Promise<AuthTokens | null> | null = null;
const tokenListeners = new Set<(t: AuthTokens | null) => void>();

export const API_BASE: string =
  ((import.meta as unknown as { env?: Record<string, string> }).env
    ?.VITE_API_URL as string) ?? "http://localhost:3000";

export function getAccessToken(): string | null {
  return accessToken;
}

export function getRefreshToken(): string | null {
  return refreshToken;
}

export function setTokens(tokens: AuthTokens | null) {
  accessToken = tokens?.accessToken ?? null;
  refreshToken = tokens?.refreshToken ?? null;
  if (typeof window !== "undefined") {
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
    else localStorage.removeItem(REFRESH_KEY);
  }
  tokenListeners.forEach((l) => l(tokens));
}

export function onTokensChange(cb: (t: AuthTokens | null) => void) {
  tokenListeners.add(cb);
  return () => tokenListeners.delete(cb);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    message: string,
  ) {
    super(message);
  }
}

export async function refreshTokens(): Promise<AuthTokens | null> {
  if (!refreshToken) return null;
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${refreshToken}`,
          "Content-Type": "application/json",
        },
        credentials: "include",
      });
      if (!res.ok) {
        setTokens(null);
        return null;
      }
      const json = (await res.json()) as { tokens: AuthTokens };
      setTokens(json.tokens);
      return json.tokens;
    } catch {
      setTokens(null);
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export interface RequestOpts extends Omit<RequestInit, "body" | "headers"> {
  body?: unknown;
  headers?: Record<string, string>;
  retry?: boolean;
}

export async function api<T = unknown>(
  path: string,
  opts: RequestOpts = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(opts.headers ?? {}),
  };
  if (opts.body !== undefined && !(opts.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers,
    credentials: "include",
    body:
      opts.body === undefined
        ? undefined
        : opts.body instanceof FormData
          ? opts.body
          : JSON.stringify(opts.body),
  });

  if (res.status === 401 && opts.retry !== false && refreshToken) {
    const refreshed = await refreshTokens();
    if (refreshed) {
      return api<T>(path, { ...opts, retry: false });
    }
  }

  const text = await res.text();
  const body = text ? safeParse(text) : null;

  if (!res.ok) {
    const msg =
      (body && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message)
        : null) ?? res.statusText;
    throw new ApiError(res.status, body, msg);
  }

  return body as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ─── Endpoints ───────────────────────────────────────────────────────────────

export const Auth = {
  googleSignInUrl(returnTo?: string): string {
    // Backend handles the OAuth dance and redirects to its callback.
    // Most flows: open this URL, backend redirects browser back with tokens
    // either as cookies or in a query string we capture in /auth/callback.
    // `prompt=select_account` asks Google to show the account chooser, which
    // covers both "sign in as a different account" and "register a new one"
    // from the same single button on the landing page.
    const params = new URLSearchParams({ prompt: "select_account" });
    if (returnTo) params.set("returnTo", returnTo);
    return `${API_BASE}/auth/google?${params.toString()}`;
  },
  me: () => api<{ user: BreezeUser }>("/auth/me"),
  logout: () => api<{ message: string }>("/auth/logout", { method: "POST" }),
  logoutAll: () =>
    api<{ message: string }>("/auth/logout-all", { method: "POST" }),
  sessions: () => api<{ sessions: SessionFamily[] }>("/auth/sessions"),
  revokeSession: (familyId: string) =>
    api<{ message: string }>(`/auth/sessions/${familyId}`, {
      method: "DELETE",
    }),
  revokeOthers: () =>
    api<{ message: string }>("/auth/sessions/revoke-others", {
      method: "POST",
    }),
};

export const Users = {
  byId: (id: string) => api<BreezeUser>(`/user/${id}`),
  byEmail: (email: string) =>
    api<BreezeUser>(`/user/email/${encodeURIComponent(email)}`),
};

export const Conversations = {
  list: () => api<{ conversations: Conversation[] }>("/conversations"),
  getOrCreateDm: (targetUserId: string) =>
    api<{ conversationId: string }>("/conversations/dm", {
      method: "POST",
      body: { targetUserId },
    }),
  createGroup: (name: string, memberIds: string[], avatarUrl?: string) =>
    api<{ conversationId: string; name: string }>("/conversations/group", {
      method: "POST",
      body: { name, memberIds, avatarUrl },
    }),
  members: (id: string) =>
    api<{ members: { userId: string; user?: BreezeUser }[] }>(
      `/conversations/${id}/members`,
    ),
  history: (id: string, limit = 50, before?: string) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (before) qs.set("before", before);
    return api<{ messages: ChatMessage[] }>(
      `/conversations/${id}/history?${qs.toString()}`,
    );
  },
  addMember: (id: string, userId: string) =>
    api<{ message: string }>(`/conversations/${id}/members`, {
      method: "POST",
      body: { userId },
    }),
  removeMember: (id: string, userId: string) =>
    api<{ message: string }>(`/conversations/${id}/members/${userId}`, {
      method: "DELETE",
    }),
};

export interface PushSubscriptionPayload {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
}

export const Notifications = {
  subscribe: (subscription: PushSubscriptionPayload) =>
    api<{ ok: true }>("/notifications/subscribe", {
      method: "POST",
      body: { subscription },
    }),
  unsubscribe: (endpoint: string) =>
    api<{ ok: true }>("/notifications/subscribe", {
      method: "DELETE",
      body: { endpoint },
    }),
};
