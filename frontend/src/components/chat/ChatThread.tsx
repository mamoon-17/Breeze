import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/lib/breeze/types";
import { format } from "date-fns";

interface Member {
  userId: string;
  user?: {
    displayName: string | null;
    email: string;
    avatarUrl?: string | null;
  } | null;
}

interface Props {
  messages: ChatMessage[];
  loading: boolean;
  currentUserId: string;
  members: Member[];
  showTyping?: boolean;
  typingName?: string;
  onDelete?: (messageId: string) => void;
}

export function ChatThread({
  messages,
  loading,
  currentUserId,
  members,
  showTyping,
  typingName,
  onDelete,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, showTyping]);

  if (loading) {
    return (
      <div className="scroll-soft flex-1 overflow-y-auto p-8">
        <div className="space-y-6">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`h-16 max-w-[60%] animate-pulse rounded-3xl bg-linen-100 ${
                i % 2 ? "ml-auto" : ""
              }`}
            />
          ))}
        </div>
      </div>
    );
  }

  if (messages.length === 0 && !showTyping) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center">
        <div className="max-w-sm text-sm text-muted-foreground">
          <p className="font-display text-2xl text-foreground">
            Send the first message.
          </p>
          <p className="mt-2">
            Start with a hello — Breeze handles delivery and read receipts in
            real time.
          </p>
        </div>
      </div>
    );
  }

  const memberMap = new Map<string, Member>();
  for (const m of members) memberMap.set(m.userId, m);

  return (
    <div
      ref={scrollRef}
      className="scroll-soft flex-1 overflow-y-auto p-6 md:p-8"
    >
      <div className="space-y-6">
        {messages.map((m, idx) => {
          const mine = m.senderId === currentUserId;
          const showHeader =
            idx === 0 || messages[idx - 1].senderId !== m.senderId;
          const sender = memberMap.get(m.senderId);
          const name =
            sender?.user?.displayName ?? sender?.user?.email ?? "Someone";
          const ts = (() => {
            try {
              return format(new Date(m.sentAt ?? m.createdAt), "h:mm a");
            } catch {
              return "";
            }
          })();
          return (
            <Bubble
              key={m.id}
              mine={mine}
              showHeader={showHeader}
              name={mine ? "You" : name}
              ts={ts}
              message={m}
              onDelete={mine && !m.deletedAt ? onDelete : undefined}
            />
          );
        })}
        {showTyping && <TypingBubble name={typingName ?? "Someone"} />}
      </div>
    </div>
  );
}

function TypingBubble({ name }: { name: string }) {
  return (
    <div className="flex max-w-[78%] flex-col gap-1 items-start">
      <span className="ml-2 text-[10px] uppercase tracking-widest text-muted-foreground">
        {name}
      </span>
      <div className="flex items-center gap-1.5 rounded-3xl rounded-tl-md border border-linen-100 bg-card px-5 py-4 shadow-bubble">
        <span className="size-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:0ms]" />
        <span className="size-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:200ms]" />
        <span className="size-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:400ms]" />
      </div>
    </div>
  );
}

function Bubble({
  mine,
  showHeader,
  name,
  ts,
  message,
  onDelete,
}: {
  mine: boolean;
  showHeader: boolean;
  name: string;
  ts: string;
  message: ChatMessage;
  onDelete?: (messageId: string) => void;
}) {
  const deleted = Boolean(message.deletedAt);
  const status = mine && !deleted ? deriveStatus(message) : null;

  return (
    <div
      className={[
        "group flex max-w-[78%] flex-col gap-1",
        mine ? "ml-auto items-end" : "items-start",
      ].join(" ")}
    >
      {showHeader && (
        <span
          className={[
            "text-[10px] uppercase tracking-widest text-muted-foreground",
            mine ? "mr-2" : "ml-2",
          ].join(" ")}
        >
          {name} · {ts}
        </span>
      )}
      <div className="flex items-center gap-1.5">
        {mine && onDelete && !deleted && (
          <button
            type="button"
            onClick={() => {
              if (
                typeof window !== "undefined" &&
                !window.confirm("Delete this message for everyone?")
              ) {
                return;
              }
              onDelete(message.id);
            }}
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-0 transition hover:bg-linen-100 hover:text-foreground group-hover:opacity-100"
            aria-label="Delete message"
            title="Delete message"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
          </button>
        )}
        {deleted ? (
          <div
            className={[
              "flex items-center gap-2 rounded-3xl border border-dashed border-linen-200 bg-transparent px-4 py-3 text-xs italic text-muted-foreground",
              mine ? "rounded-tr-md" : "rounded-tl-md",
            ].join(" ")}
          >
            <svg
              viewBox="0 0 24 24"
              className="size-3.5 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
            <span>This message was deleted</span>
          </div>
        ) : (
          <div
            className={[
              "px-4 py-3 text-sm leading-relaxed shadow-bubble",
              mine
                ? "rounded-3xl rounded-tr-md bg-breeze text-white"
                : "rounded-3xl rounded-tl-md border border-linen-100 bg-card text-foreground",
            ].join(" ")}
          >
            {message.message}
          </div>
        )}
      </div>
      {status && (
        <span
          className={[
            "mr-2 text-[10px] uppercase tracking-widest",
            status === "Read" ? "text-breeze" : "text-muted-foreground",
          ].join(" ")}
        >
          {status}
        </span>
      )}
    </div>
  );
}

function deriveStatus(m: ChatMessage): "Sent" | "Delivered" | "Read" {
  const receipts = m.receipts ?? [];
  if (receipts.length === 0) return "Sent";
  if (receipts.every((r) => r.readAt)) return "Read";
  if (receipts.every((r) => r.deliveredAt)) return "Delivered";
  if (receipts.some((r) => r.readAt)) return "Read";
  if (receipts.some((r) => r.deliveredAt)) return "Delivered";
  return "Sent";
}
