import {
  createFileRoute,
  Outlet,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { Conversations, Invitations } from "@/lib/breeze/api";
import type {
  Conversation,
  ChatMessage,
  ConversationInvitation,
  WsConversationCreated,
  WsInvitationUpdated,
  WsTyping,
} from "@/lib/breeze/types";
import { ConversationList } from "@/components/chat/ConversationList";
import { NewConversationDialog } from "@/components/chat/NewConversationDialog";
import { InvitationsInbox } from "@/components/chat/InvitationsInbox";
import { useAuth } from "@/lib/breeze/auth-context";
import { getSocket } from "@/lib/breeze/socket";
import {
  currentPermission,
  disablePushNotifications,
  enablePushNotifications,
  isPushSupported,
  syncPushSubscription,
} from "@/lib/breeze/push";
import { toast } from "sonner";

let notifAudioCtx: AudioContext | null = null;
function playNotificationSound() {
  try {
    const Ctx =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!notifAudioCtx) notifAudioCtx = new Ctx();
    const ctx = notifAudioCtx;
    if (ctx.state === "suspended") {
      // Best-effort; browsers may still block until a user gesture occurs.
      void ctx.resume().catch(() => {});
    }

    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880; // A5
    g.gain.value = 0.0001;
    o.connect(g);
    g.connect(ctx.destination);

    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.start(t);
    o.stop(t + 0.13);
    o.onended = () => {
      try {
        o.disconnect();
        g.disconnect();
      } catch {
        // ignore
      }
    };
  } catch {
    // ignore
  }
}

export const Route = createFileRoute("/_authenticated/app")({
  component: AppShell,
});

function AppShell() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { conversationId?: string };
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [openNew, setOpenNew] = useState(false);
  const [openInvites, setOpenInvites] = useState(false);
  const [pendingInviteCount, setPendingInviteCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pushPermission, setPushPermission] = useState<
    NotificationPermission | "unsupported"
  >(() => (typeof window === "undefined" ? "unsupported" : currentPermission()));
  const [typingConvoIds, setTypingConvoIds] = useState<Set<string>>(new Set());
  const typingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const settingsRef = useRef<HTMLDivElement>(null);
  // Keep a ref to the active conversationId so the WS closure always reads
  // the latest value without needing to re-subscribe on every navigation.
  const activeConvoRef = useRef<string | undefined>(params.conversationId);
  const conversationsRef = useRef<Conversation[]>(conversations);

  const refresh = async () => {
    try {
      const { conversations: list } = await Conversations.list();
      setConversations(list);
    } catch (err) {
      const e = err as { status?: number; message?: string };
      if (e?.status !== 401) {
        toast.error(e?.message ?? "Couldn't load your conversations");
      }
    } finally {
      setLoading(false);
    }
  };

  // Keep refs in sync on every render so WS closures always read fresh values.
  useEffect(() => {
    conversationsRef.current = conversations;
  });

  useEffect(() => {
    activeConvoRef.current = params.conversationId;
    if (params.conversationId) {
      // Clear unread badge when the user opens a conversation.
      setConversations((prev) =>
        prev.map((c) =>
          c.id === params.conversationId ? { ...c, unreadCount: 0 } : c,
        ),
      );
    }
  }, [params.conversationId]);

  useEffect(() => {
    void refresh();
  }, []);

  const refreshInvitationCount = async () => {
    try {
      const { invitations } = await Invitations.list();
      setPendingInviteCount(invitations.length);
    } catch {
      // Non-fatal — keep whatever count we already had.
    }
  };

  useEffect(() => {
    void refreshInvitationCount();
  }, []);

  // Web Push: register the service worker, re-sync an existing subscription
  // with the backend, and listen for click-through navigation messages from SW.
  useEffect(() => {
    if (!isPushSupported()) return;

    // Silent on mount — only re-subscribes if the user already granted before.
    void syncPushSubscription();

    const onSwMessage = (evt: MessageEvent) => {
      const data = evt.data as { type?: string; url?: string } | null;
      if (!data) return;
      if (data.type === "breeze:navigate" && typeof data.url === "string") {
        // Pull the conversationId out of /app/<id> to navigate via the router.
        const match = data.url.match(/^\/app\/([^/?#]+)/);
        if (match) {
          navigate({
            to: "/app/$conversationId",
            params: { conversationId: match[1] },
          });
        } else {
          navigate({ to: "/app" });
        }
      } else if (data.type === "breeze:pushsubscriptionchange") {
        void syncPushSubscription();
      }
    };

    navigator.serviceWorker.addEventListener("message", onSwMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", onSwMessage);
    };
  }, [navigate]);

  const toggleNotifications = async () => {
    setSettingsOpen(false);
    if (!isPushSupported()) {
      toast.error("Push notifications aren't supported in this browser");
      return;
    }
    try {
      if (pushPermission === "granted") {
        await disablePushNotifications();
        setPushPermission(currentPermission());
        toast.success("Notifications disabled");
        return;
      }
      const status = await enablePushNotifications();
      setPushPermission(currentPermission());
      if (status === "subscribed") {
        toast.success("Notifications enabled");
      } else if (status === "permission-denied") {
        toast.error(
          "Notifications are blocked — enable them in your browser settings",
        );
      } else if (status === "unsupported") {
        toast.error("Push notifications aren't configured");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't enable notifications";
      toast.error(msg);
    }
  };

  // Real-time sidebar updates: last-message preview + typing indicators.
  useEffect(() => {
    const socket = getSocket();

    const onNewMessage = (msg: ChatMessage) => {
      const isActive = activeConvoRef.current === msg.room;

      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== msg.room) return c;
          return {
            ...c,
            lastMessage: msg,
            // Only increment badge when the conversation isn't open.
            unreadCount: isActive ? 0 : (c.unreadCount ?? 0) + 1,
          };
        }),
      );

      if (!isActive) {
        playNotificationSound();
        // Resolve sender name from existing conversation data.
        const convo = conversationsRef.current.find((c) => c.id === msg.room);
        const senderName =
          convo?.type === "dm"
            ? (convo.peer?.displayName ?? convo.peer?.email ?? "Someone")
            : (convo?.name ?? "Group");

        toast(msg.message, {
          description: senderName,
          duration: 4000,
          action: {
            label: "Open",
            onClick: () =>
              navigate({
                to: "/app/$conversationId",
                params: { conversationId: msg.room },
              }),
          },
        });

        // Foreground notification: when the browser is open but this tab isn't active,
        // surface a system notification (SW click handler will deep-link).
        if (
          typeof document !== "undefined" &&
          document.hidden &&
          isPushSupported() &&
          Notification.permission === "granted"
        ) {
          void navigator.serviceWorker
            .getRegistration("/")
            .then((reg) => {
              if (!reg) return;
              const body =
                typeof msg.message === "string" && msg.message.trim()
                  ? msg.message
                  : "You have a new message";
              return reg.showNotification("New message", {
                body,
                tag: `breeze-room-${msg.room}`,
                icon: "/favicon.svg",
                badge: "/favicon.svg",
                data: { url: `/app/${msg.room}`, room: msg.room },
              });
            })
            .catch(() => {
              // ignore
            });
        }
      }
    };

    const onUserTyping = (evt: WsTyping) => {
      const { conversationId } = evt;
      // Clear any existing auto-stop timer for this convo.
      const existing = typingTimersRef.current.get(conversationId);
      if (existing) clearTimeout(existing);

      setTypingConvoIds((prev) => new Set([...prev, conversationId]));

      // Auto-clear after 4 s in case stopTyping is missed.
      const timer = setTimeout(() => {
        setTypingConvoIds((prev) => {
          const next = new Set(prev);
          next.delete(conversationId);
          return next;
        });
        typingTimersRef.current.delete(conversationId);
      }, 4000);
      typingTimersRef.current.set(conversationId, timer);
    };

    const onUserStopTyping = (evt: WsTyping) => {
      const { conversationId } = evt;
      const existing = typingTimersRef.current.get(conversationId);
      if (existing) {
        clearTimeout(existing);
        typingTimersRef.current.delete(conversationId);
      }
      setTypingConvoIds((prev) => {
        const next = new Set(prev);
        next.delete(conversationId);
        return next;
      });
    };

    const onInvitationReceived = (inv: ConversationInvitation) => {
      setPendingInviteCount((c) => c + 1);
      toast(`${inv.inviter.displayName ?? inv.inviter.email} invited you to ${inv.conversation.name ?? "a group"}`, {
        description: "Tap to review",
        duration: 6000,
        action: {
          label: "View",
          onClick: () => setOpenInvites(true),
        },
      });
    };

    const onInvitationUpdated = (evt: WsInvitationUpdated) => {
      if (evt.status !== "pending") {
        // Any resolution clears a pending slot on the invitee's side.
        // Harmless when the event is for someone else.
        setPendingInviteCount((c) => Math.max(0, c - 1));
      }
      // When someone else (or me) accepts an invite, membership may change —
      // refresh the conversation list so new groups show up.
      void refresh();
    };

    const onConversationCreated = (_evt: WsConversationCreated) => {
      // A new DM was started with us (or by us on another device).
      void refresh();
    };

    socket.on("newMessage", onNewMessage);
    socket.on("userTyping", onUserTyping);
    socket.on("userStopTyping", onUserStopTyping);
    socket.on("invitationReceived", onInvitationReceived);
    socket.on("invitationUpdated", onInvitationUpdated);
    socket.on("conversationCreated", onConversationCreated);

    return () => {
      socket.off("newMessage", onNewMessage);
      socket.off("userTyping", onUserTyping);
      socket.off("userStopTyping", onUserStopTyping);
      socket.off("invitationReceived", onInvitationReceived);
      socket.off("invitationUpdated", onInvitationUpdated);
      socket.off("conversationCreated", onConversationCreated);
      for (const t of typingTimersRef.current.values()) clearTimeout(t);
      typingTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        settingsRef.current &&
        !settingsRef.current.contains(e.target as Node)
      ) {
        setSettingsOpen(false);
      }
    };
    if (settingsOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [settingsOpen]);

  const filteredConversations = conversations.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const title =
      c.type === "group"
        ? (c.name ?? "Group")
        : (c.peer?.displayName ?? c.peer?.email ?? "");
    return title.toLowerCase().includes(q);
  });

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-linen-200 bg-white/60 xl:w-80">
        {/* Sidebar header: logo + actions */}
        <div className="flex h-14 shrink-0 items-center justify-between px-5">
          <span className="text-xl font-bold tracking-tight text-foreground">
            Breeze
          </span>
          <div className="flex items-center gap-1" ref={settingsRef}>
            <button
              onClick={() => setOpenInvites(true)}
              className="relative flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-linen-100 hover:text-foreground"
              title="Invitations"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-[18px]"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
              {pendingInviteCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
                  {pendingInviteCount > 9 ? "9+" : pendingInviteCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setOpenNew(true)}
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-linen-100 hover:text-foreground"
              title="New conversation"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-[18px]"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </button>
            <div className="relative">
              <button
                onClick={() => setSettingsOpen((p) => !p)}
                className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-linen-100 hover:text-foreground"
                title="Settings"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="size-[18px]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
              {settingsOpen && (
                <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-xl border border-linen-200 bg-card p-1 shadow-lg">
                  <button
                    onClick={() => {
                      setSettingsOpen(false);
                      navigate({ to: "/settings" });
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground transition hover:bg-linen-100"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="size-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="8" r="4" />
                      <path d="M4 21v-1a7 7 0 0 1 14 0v1" />
                    </svg>
                    Profile
                  </button>
                  <button
                    onClick={() => {
                      setSettingsOpen(false);
                      navigate({ to: "/sessions" });
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground transition hover:bg-linen-100"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="size-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect
                        x="3"
                        y="11"
                        width="18"
                        height="11"
                        rx="2"
                        ry="2"
                      />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    Security
                  </button>
                  {pushPermission !== "unsupported" && (
                    <button
                      onClick={() => void toggleNotifications()}
                      disabled={pushPermission === "denied"}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground transition hover:bg-linen-100 disabled:cursor-not-allowed disabled:opacity-60"
                      title={
                        pushPermission === "denied"
                          ? "Notifications are blocked in your browser settings"
                          : undefined
                      }
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="size-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                      </svg>
                      {pushPermission === "granted"
                        ? "Disable notifications"
                        : pushPermission === "denied"
                          ? "Notifications blocked"
                          : "Enable notifications"}
                    </button>
                  )}
                  <div className="my-1 border-t border-linen-200" />
                  <button
                    onClick={async () => {
                      setSettingsOpen(false);
                      await signOut();
                      navigate({ to: "/" });
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-600 transition hover:bg-red-50"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="size-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                    Log out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="shrink-0 px-4 pb-3">
          <div className="flex items-center gap-2 rounded-lg border border-linen-200 bg-linen-50 px-3 py-2">
            <svg
              viewBox="0 0 24 24"
              className="size-4 shrink-0 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>

        {/* Conversation list */}
        <ConversationList
          conversations={filteredConversations}
          loading={loading}
          activeId={params.conversationId}
          currentUserId={user?.id ?? ""}
          typingConvoIds={typingConvoIds}
          onSelect={(id) =>
            navigate({
              to: "/app/$conversationId",
              params: { conversationId: id },
            })
          }
        />
      </aside>

      {/* Main content area */}
      <section className="min-w-0 flex-1 overflow-hidden bg-linen-50">
        <Outlet />
      </section>

      <NewConversationDialog
        open={openNew}
        onClose={() => setOpenNew(false)}
        onCreated={async (conversationId) => {
          setOpenNew(false);
          await refresh();
          navigate({
            to: "/app/$conversationId",
            params: { conversationId },
          });
        }}
      />

      <InvitationsInbox
        open={openInvites}
        onClose={() => {
          setOpenInvites(false);
          void refreshInvitationCount();
        }}
        onAccepted={async (conversationId) => {
          setOpenInvites(false);
          await refreshInvitationCount();
          await refresh();
          navigate({
            to: "/app/$conversationId",
            params: { conversationId },
          });
        }}
      />
    </div>
  );
}
