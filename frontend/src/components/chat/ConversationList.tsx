import { useEffect, useState } from "react";
import type { Conversation } from "@/lib/breeze/types";
import { resolveAvatarUrl } from "@/lib/breeze/api";

interface Props {
  conversations: Conversation[];
  loading: boolean;
  activeId?: string;
  currentUserId: string;
  typingConvoIds?: Set<string>;
  onSelect: (id: string) => void;
}

export function ConversationList({
  conversations,
  loading,
  activeId,
  typingConvoIds,
  onSelect,
}: Props) {
  if (loading) {
    return (
      <div className="space-y-1 px-3 py-2">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-xl px-3 py-3"
          >
            <div className="size-10 shrink-0 animate-pulse rounded-full bg-linen-200" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3 w-24 animate-pulse rounded bg-linen-200" />
              <div className="h-2.5 w-36 animate-pulse rounded bg-linen-100" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        <p>No conversations yet.</p>
        <p className="mt-2 text-xs">
          Tap the chat icon above to start a new conversation.
        </p>
      </div>
    );
  }

  return (
    <ul className="scroll-soft flex-1 space-y-0.5 overflow-y-auto px-2 py-1">
      {conversations.map((c) => {
        const active = c.id === activeId;
        const title =
          c.type === "group"
            ? (c.name ?? "Group")
            : (c.peer?.displayName ?? c.peer?.email ?? "Direct message");
        const initial = title.charAt(0).toUpperCase();
        const isTyping = typingConvoIds?.has(c.id) ?? false;
        const lastMsg = isTyping ? "" : (c.lastMessage?.message ?? "");
        const unreadCount = c.unreadCount ?? 0;
        const timestamp = formatTime(c.lastMessage?.sentAt ?? c.createdAt);

        return (
          <li key={c.id}>
            <button
              onClick={() => onSelect(c.id)}
              className={[
                "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition",
                active ? "bg-linen-100" : "hover:bg-linen-50",
              ].join(" ")}
            >
              <div className="relative shrink-0">
                <Avatar
                  src={resolveAvatarUrl(
                    c.type === "group" ? c.avatarUrl : c.peer?.avatarUrl,
                  )}
                  initial={initial}
                  bgClass={getAvatarColor(title)}
                />
                {isTyping && (
                  <span className="absolute -bottom-0.5 -left-0.5 size-2.5 rounded-full border-2 border-white bg-emerald-400" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="truncate text-sm font-semibold text-foreground">
                    {title}
                  </h3>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {timestamp}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  {isTyping ? (
                    <p className="flex items-center gap-1 text-xs font-medium text-emerald-500">
                      <span className="inline-flex gap-0.5">
                        <span className="size-1 animate-bounce rounded-full bg-emerald-500 [animation-delay:0ms]" />
                        <span className="size-1 animate-bounce rounded-full bg-emerald-500 [animation-delay:150ms]" />
                        <span className="size-1 animate-bounce rounded-full bg-emerald-500 [animation-delay:300ms]" />
                      </span>
                      typing...
                    </p>
                  ) : (
                    <p className="truncate text-xs text-muted-foreground">
                      {lastMsg || "No messages yet"}
                    </p>
                  )}
                  {unreadCount > 0 && (
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Avatar({
  src,
  initial,
  bgClass,
}: {
  src?: string | null;
  initial: string;
  bgClass: string;
}) {
  const [broken, setBroken] = useState(false);

  // If the src changes (e.g. refreshed profile photo), retry loading it.
  useEffect(() => {
    setBroken(false);
  }, [src]);

  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        className="size-10 shrink-0 rounded-full object-cover"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <div
      className={`flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${bgClass}`}
    >
      {initial}
    </div>
  );
}

const AVATAR_COLORS = [
  "bg-emerald-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-teal-500",
  "bg-indigo-500",
  "bg-orange-500",
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function formatTime(dateStr?: string | null): string {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    }
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: "long" });
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}
