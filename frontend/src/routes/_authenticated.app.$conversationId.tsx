import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Conversations, Upload } from "@/lib/breeze/api";
import type {
  ChatMessage,
  Conversation,
  WsMessageDeleted,
  WsMessageDelivered,
  WsMessagesSeen,
  WsUserOnline,
  WsUserOffline,
  WsTyping,
} from "@/lib/breeze/types";
import {
  deleteMessage as wsDeleteMessage,
  getSocket,
  getPresence,
  joinRoom,
  markRead,
  sendMessage as wsSendMessage,
} from "@/lib/breeze/socket";
import { useAuth } from "@/lib/breeze/auth-context";
import { ChatThread } from "@/components/chat/ChatThread";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { AssistPanel } from "@/components/chat/AssistPanel";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/app/$conversationId")({
  component: ConversationView,
});

function ConversationView() {
  const { conversationId } = useParams({
    from: "/_authenticated/app/$conversationId",
  });
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [composerDraft, setComposerDraft] = useState("");
  const [members, setMembers] = useState<
    {
      userId: string;
      user?: {
        displayName: string | null;
        email: string;
        avatarUrl?: string | null;
      } | null;
    }[]
  >([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [readReceipts, setReadReceipts] = useState<Record<string, string>>({});
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  // userId → display name of people currently typing in this convo
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map());
  const lastReadSentRef = useRef<string | null>(null);
  // Always-fresh members ref so WS closures don't capture a stale array.
  const membersRef = useRef(members);

  // Keep membersRef current after every render so WS closures read fresh data.
  useEffect(() => {
    membersRef.current = members;
  });

  // Reset ephemeral state whenever the open conversation changes.
  useEffect(() => {
    setOnlineUserIds(new Set());
    setTypingUsers(new Map());
    lastReadSentRef.current = null;
  }, [conversationId]);

  const showTyping = typingUsers.size > 0;
  const typingName =
    typingUsers.size > 0 ? [...typingUsers.values()].join(", ") : undefined;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessages([]);
    (async () => {
      try {
        const [{ messages: history }, { members: ms }, { conversations }] =
          await Promise.all([
            Conversations.history(conversationId, 50),
            Conversations.members(conversationId).catch(() => ({
              members: [],
            })),
            Conversations.list(),
          ]);
        if (cancelled) return;
        const sorted = [...history].sort(
          (a, b) =>
            new Date(a.sentAt ?? a.createdAt).getTime() -
            new Date(b.sentAt ?? b.createdAt).getTime(),
        );
        setMessages(sorted);
        setMembers(ms);
        const found =
          conversations.find((c) => c.id === conversationId) ?? null;
        setConversation(found);
      } catch (err) {
        toast.error("Couldn't load this conversation");
        console.error(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    const socket = getSocket();
    joinRoom(conversationId);

    const onNewMessage = (msg: ChatMessage) => {
      if (msg.room !== conversationId) return;
      setMessages((prev) => {
        // Server echo arrived. Three cases:
        //   1. We've already folded this message in → no-op.
        //   2. We previously rendered an optimistic placeholder with the same
        //      sender + text → replace it in place (prevents duplicates even
        //      when `user` was stale in this closure's scope).
        //   3. Otherwise it's someone else's message or a message we never
        //      sent optimistically → append.
        if (prev.some((m) => m.id === msg.id)) return prev;

        const idx = prev.findIndex(
          (m) =>
            m.optimistic === true &&
            m.senderId === msg.senderId &&
            m.room === msg.room &&
            m.message === msg.message,
        );
        if (idx !== -1) {
          const next = [...prev];
          next[idx] = msg;
          return next;
        }

        return [...prev, msg];
      });
    };
    const onDelivered = (evt: WsMessageDelivered) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === evt.messageId
            ? {
                ...m,
                receipts: [
                  ...(m.receipts ?? []).filter((r) => r.userId !== evt.userId),
                  {
                    id: `${evt.messageId}:${evt.userId}`,
                    messageId: evt.messageId,
                    userId: evt.userId,
                    deliveredAt: evt.deliveredAt,
                    readAt:
                      m.receipts?.find((r) => r.userId === evt.userId)
                        ?.readAt ?? null,
                  },
                ],
              }
            : m,
        ),
      );
    };
    const onSeen = (evt: WsMessagesSeen) => {
      if (evt.conversationId !== conversationId) return;
      setReadReceipts((prev) => ({ ...prev, [evt.userId]: evt.readAt }));
      setMessages((prev) =>
        prev.map((m) => {
          if (!evt.messageIds.includes(m.id)) return m;
          const next = (m.receipts ?? []).filter(
            (r) => r.userId !== evt.userId,
          );
          return {
            ...m,
            receipts: [
              ...next,
              {
                id: `${m.id}:${evt.userId}`,
                messageId: m.id,
                userId: evt.userId,
                deliveredAt:
                  m.receipts?.find((r) => r.userId === evt.userId)
                    ?.deliveredAt ?? evt.readAt,
                readAt: evt.readAt,
              },
            ],
          };
        }),
      );
    };

    const onMessageDeleted = (evt: WsMessageDeleted) => {
      if (evt.room !== conversationId) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === evt.messageId ? { ...m, deletedAt: evt.deletedAt } : m,
        ),
      );
    };

    socket.on("newMessage", onNewMessage);
    socket.on("messageDelivered", onDelivered);
    socket.on("messagesSeen", onSeen);
    socket.on("messageDeleted", onMessageDeleted);

    const onUserOnline = (evt: WsUserOnline) => {
      setOnlineUserIds((prev) => new Set([...prev, evt.userId]));
    };
    const onUserOffline = (evt: WsUserOffline) => {
      setOnlineUserIds((prev) => {
        const next = new Set(prev);
        next.delete(evt.userId);
        return next;
      });
    };

    socket.on("userOnline", onUserOnline);
    socket.on("userOffline", onUserOffline);

    // Fetch initial presence snapshot after joining the room.
    getPresence(conversationId).then((ids) => {
      setOnlineUserIds(new Set(ids));
    });

    const resolveName = (userId: string) => {
      const found = membersRef.current.find((m) => m.userId === userId);
      return found?.user?.displayName ?? found?.user?.email ?? "Someone";
    };

    const onUserTyping = (evt: WsTyping) => {
      if (evt.conversationId !== conversationId) return;
      setTypingUsers((prev) => {
        const next = new Map(prev);
        next.set(evt.userId, resolveName(evt.userId));
        return next;
      });
    };
    const onUserStopTyping = (evt: WsTyping) => {
      if (evt.conversationId !== conversationId) return;
      setTypingUsers((prev) => {
        const next = new Map(prev);
        next.delete(evt.userId);
        return next;
      });
    };

    socket.on("userTyping", onUserTyping);
    socket.on("userStopTyping", onUserStopTyping);

    return () => {
      socket.off("newMessage", onNewMessage);
      socket.off("messageDelivered", onDelivered);
      socket.off("messagesSeen", onSeen);
      socket.off("messageDeleted", onMessageDeleted);
      socket.off("userOnline", onUserOnline);
      socket.off("userOffline", onUserOffline);
      socket.off("userTyping", onUserTyping);
      socket.off("userStopTyping", onUserStopTyping);
    };
  }, [conversationId]);

  useEffect(() => {
    if (!user || messages.length === 0) return;
    // Don't mark messages as read while the tab is in the background.
    // This keeps "Seen" meaningful and allows web push / notifications to matter.
    if (typeof document !== "undefined" && document.hidden) return;
    const lastIncoming = [...messages]
      .reverse()
      .find((m) => m.senderId !== user.id);
    if (!lastIncoming) return;
    if (lastReadSentRef.current === lastIncoming.id) return;
    lastReadSentRef.current = lastIncoming.id;
    try {
      markRead(conversationId, lastIncoming.id);
    } catch {
      // ignore
    }
  }, [messages, conversationId, user]);

  const title = useMemo(() => {
    if (!conversation) return "Loading...";
    if (conversation.type === "group") return conversation.name ?? "Group";
    const peer = members.find((m) => m.userId !== user?.id);
    return peer?.user?.displayName ?? peer?.user?.email ?? "Direct message";
  }, [conversation, members, user]);

  const subtitle = useMemo(() => {
    if (!conversation) return "";
    if (conversation.type === "group") {
      const onlineCount = members.filter((m) =>
        onlineUserIds.has(m.userId),
      ).length;
      return onlineCount > 0
        ? `${onlineCount} of ${members.length} online`
        : `${members.length} member${members.length === 1 ? "" : "s"}`;
    }
    const peer = members.find((m) => m.userId !== user?.id);
    return peer && onlineUserIds.has(peer.userId) ? "Online" : "Offline";
  }, [conversation, members, onlineUserIds, user]);

  const handleDelete = (messageId: string) => {
    try {
      wsDeleteMessage(conversationId, messageId);
    } catch (err) {
      console.error(err);
      toast.error("Couldn't delete message");
    }
  };

  const handleSend = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!user?.id) return;

    // Optimistic render so the UI feels instant; we reconcile this entry once
    // the server broadcasts the canonical message.
    const nowIso = new Date().toISOString();
    const optimistic: ChatMessage = {
      id: `local:${globalThis.crypto?.randomUUID?.() ?? String(Date.now())}`,
      room: conversationId,
      senderId: user.id,
      message: trimmed,
      sentAt: nowIso,
      createdAt: nowIso,
      receipts: [],
      optimistic: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    wsSendMessage(conversationId, { message: trimmed });
  };

  const handleSendAudio = async (blob: Blob) => {
    if (!user?.id) return;
    if (!conversationId) return;
    try {
      setUploadingAudio(true);
      const uploaded = await Upload.audio(blob);
      const nowIso = new Date().toISOString();
      const optimistic: ChatMessage = {
        id: `local:${globalThis.crypto?.randomUUID?.() ?? String(Date.now())}`,
        room: conversationId,
        senderId: user.id,
        message: "",
        attachmentUrl: uploaded.attachmentUrl,
        attachmentType: uploaded.attachmentType,
        sentAt: nowIso,
        createdAt: nowIso,
        receipts: [],
        optimistic: true,
      };
      setMessages((prev) => [...prev, optimistic]);
      wsSendMessage(conversationId, {
        attachmentUrl: uploaded.attachmentUrl,
        attachmentType: uploaded.attachmentType,
      });
    } catch (err) {
      console.error(err);
      toast.error("Couldn't upload voice message");
    } finally {
      setUploadingAudio(false);
    }
  };

  const handleSendAttachments = async (files: File[]) => {
    if (!user?.id) return;
    if (!conversationId) return;
    if (!files || files.length === 0) return;
    try {
      setUploadingAttachments(true);
      const { attachments } = await Upload.attachments(files);
      const nowIso = new Date().toISOString();
      const optimistic: ChatMessage = {
        id: `local:${globalThis.crypto?.randomUUID?.() ?? String(Date.now())}`,
        room: conversationId,
        senderId: user.id,
        message: "",
        sentAt: nowIso,
        createdAt: nowIso,
        receipts: [],
        optimistic: true,
        attachments: attachments.map((a, idx) => ({
          id: `localatt:${idx}`,
          messageId: "local",
          type: a.type,
          key: a.key,
          url: a.url,
          mime: a.mime,
          size: String(a.size),
          filename: a.filename ?? null,
          createdAt: nowIso,
        })),
      };
      setMessages((prev) => [...prev, optimistic]);
      wsSendMessage(conversationId, {
        attachments: attachments.map((a) => ({
          key: a.key,
          type: a.type,
          mime: a.mime,
          size: a.size,
          filename: a.filename,
        })),
      });
    } catch (err) {
      console.error(err);
      toast.error("Couldn't upload attachments");
    } finally {
      setUploadingAttachments(false);
    }
  };

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-linen-200 bg-white/60 px-6">
          <div className="flex items-center gap-3">
            {(() => {
              const isOnline = members.some(
                (m) => m.userId !== user?.id && onlineUserIds.has(m.userId),
              );
              return (
                <div
                  className={[
                    "size-2 rounded-full transition-colors duration-500",
                    isOnline ? "bg-emerald-400" : "bg-muted-foreground/40",
                  ].join(" ")}
                />
              );
            })()}
            <div>
              <h2 className="text-sm font-semibold text-foreground">{title}</h2>
              <p className="text-[11px] text-muted-foreground">{subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button aria-label="Voice call" className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-linen-100 hover:text-foreground">
              <svg viewBox="0 0 24 24" className="size-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            </button>
            <button aria-label="Video call" className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-linen-100 hover:text-foreground">
              <svg viewBox="0 0 24 24" className="size-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 7l-7 5 7 5V7z" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            </button>
            <button aria-label="More options" className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-linen-100 hover:text-foreground">
              <svg viewBox="0 0 24 24" className="size-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="1" />
                <circle cx="19" cy="12" r="1" />
                <circle cx="5" cy="12" r="1" />
              </svg>
            </button>
          </div>
        </header>

        <ChatThread
          messages={messages}
          loading={loading}
          currentUserId={user?.id ?? ""}
          members={members}
          showTyping={showTyping}
          typingName={typingName}
          onDelete={handleDelete}
        />

        <ChatComposer
          onSend={handleSend}
          onSendAudio={handleSendAudio}
          onSendAttachments={handleSendAttachments}
          uploadingAttachments={uploadingAttachments}
          conversationId={conversationId}
          disabled={uploadingAudio || uploadingAttachments}
          externalValue={composerDraft}
          onExternalChange={setComposerDraft}
        />
      </div>

      <AssistPanel
        conversationTitle={title}
        messageCount={messages.length}
        readReceipts={readReceipts}
        composerDraft={composerDraft}
        setComposerDraft={setComposerDraft}
        conversationId={conversationId}
      />
    </div>
  );
}
