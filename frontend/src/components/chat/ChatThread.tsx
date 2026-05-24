import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, ReplyToPayload } from "@/lib/breeze/types";
import { format } from "date-fns";
import {
  File as FileIcon,
  Image as ImageIcon,
  type LucideIcon,
  Mic as MicIcon,
  Reply as ReplyIcon,
  Video as VideoIcon,
} from "lucide-react";
import { AttachmentLightbox, type LightboxItem } from "./AttachmentLightbox";
import { useCall } from "@/lib/breeze/call-context";

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
  onReply?: (msg: ReplyToPayload) => void;
}

export function ChatThread({
  messages,
  loading,
  currentUserId,
  members,
  showTyping,
  typingName,
  onDelete,
  onReply,
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
          <p className="font-display text-2xl text-foreground">Send the first message.</p>
          <p className="mt-2">
            Start with a hello — Breeze handles delivery and read receipts in real time.
          </p>
        </div>
      </div>
    );
  }

  const memberMap = new Map<string, Member>();
  for (const m of members) memberMap.set(m.userId, m);

  return (
    <div ref={scrollRef} className="scroll-soft flex-1 overflow-y-auto p-6 md:p-8">
      <div className="space-y-6">
        {messages.map((m, idx) => {
          // System messages (e.g. call events) render as centered dividers
          if (m.messageType === "system") {
            return (
              <SystemMessageBubble
                key={m.id}
                message={m}
                currentUserId={currentUserId}
                memberMap={memberMap}
              />
            );
          }

          const mine = m.senderId === currentUserId;
          const showHeader = idx === 0 || messages[idx - 1].senderId !== m.senderId;
          const sender = memberMap.get(m.senderId);
          const name = sender?.user?.displayName ?? sender?.user?.email ?? "Someone";
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
              onReply={onReply}
            />
          );
        })}
        {showTyping && <TypingBubble name={typingName ?? "Someone"} />}
      </div>
    </div>
  );
}

function SystemMessageBubble({
  message,
  currentUserId,
  memberMap,
}: {
  message: ChatMessage;
  currentUserId: string;
  memberMap: Map<string, Member>;
}) {
  const { initiateCall } = useCall();
  const metadata = normalizeCallMetadata(message.metadata);

  const isCall =
    message.subtype === "call" ||
    Boolean(metadata?.outcome || metadata?.durationSeconds || metadata?.callType || metadata?.type);
  const outcome = metadata?.outcome ?? "";
  const isCompleted = outcome === "completed";
  const callType = normalizeCallType(metadata, message.message);
  const callLabel = callType === "video" ? "Video call" : "Voice call";
  const callLabelLower = callType === "video" ? "video call" : "voice call";
  const durationText = formatCallDuration(metadata?.durationSeconds ?? null);
  const otherPartyId = getOtherCallPartyId(metadata, currentUserId);
  const otherParty = otherPartyId ? memberMap.get(otherPartyId) : null;
  const otherPartyName = otherParty?.user?.displayName ?? otherParty?.user?.email ?? "Someone";
  const canCallBack =
    isCall &&
    Boolean(otherPartyId) &&
    (outcome === "completed" || outcome === "missed" || outcome === "rejected");
  const displayMessage = (() => {
    if (!isCall) return message.message;
    switch (outcome) {
      case "completed":
        return durationText ? `${callLabel} · ${durationText}` : callLabel;
      case "missed":
        return `Missed ${callLabelLower}`;
      case "rejected":
        return "Declined";
      case "cancelled":
        return `Cancelled ${callLabelLower}`;
      case "failed":
        return "Call failed";
      default:
        return message.message;
    }
  })();

  return (
    <div className="flex items-center justify-center gap-2 py-2">
      <div
        className={[
          "flex items-center gap-2 rounded-full px-4 py-1.5 text-xs",
          isCall && outcome === "missed"
            ? "bg-red-50 text-red-500"
            : isCall && outcome === "rejected"
              ? "bg-amber-50 text-amber-600"
              : "bg-linen-100 text-muted-foreground",
        ].join(" ")}
      >
        {isCall && (
          <svg
            viewBox="0 0 24 24"
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            {outcome === "missed" && <line x1="1" y1="1" x2="23" y2="23" />}
          </svg>
        )}
        <span className="font-medium">{displayMessage}</span>
        {isCall && isCompleted && (
          <span className="text-[10px] opacity-60">
            {(() => {
              try {
                return format(new Date(message.sentAt ?? message.createdAt), "h:mm a");
              } catch {
                return "";
              }
            })()}
          </span>
        )}
        {canCallBack && otherPartyId && (
          <button
            type="button"
            onClick={() => void initiateCall(otherPartyId, message.room, otherPartyName, "audio")}
            className="flex size-5 items-center justify-center rounded-full opacity-70 transition hover:bg-white/50 hover:opacity-100"
            aria-label={`Call ${otherPartyName}`}
            title="Call back"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

type CallMetadata = {
  outcome?: string;
  durationSeconds?: number | null;
  callType?: string;
  type?: string;
  callerId?: string;
  calleeId?: string;
};

function normalizeCallMetadata(raw: ChatMessage["metadata"]): CallMetadata | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as CallMetadata;
      return typeof parsed === "object" && parsed !== null ? parsed : null;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as CallMetadata;
  return null;
}

function normalizeCallType(metadata: CallMetadata | null, fallbackText: string): "audio" | "video" {
  const fromMetadata = findCallTypeInMetadata(metadata);
  if (fromMetadata) return fromMetadata;
  if (fallbackText.toLowerCase().includes("video call")) return "video";
  return "audio";
}

function findCallTypeInMetadata(value: unknown): "audio" | "video" | null {
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (normalized === "video") return "video";
    if (normalized === "audio" || normalized === "voice") return "audio";
    return null;
  }

  if (!value || typeof value !== "object") return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findCallTypeInMetadata(item);
      if (found) return found;
    }
    return null;
  }

  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const keyLower = key.toLowerCase();
    if (val === true) {
      if (keyLower.includes("video")) return "video";
      if (keyLower.includes("audio") || keyLower.includes("voice")) return "audio";
    }
    const found = findCallTypeInMetadata(val);
    if (found) return found;
  }

  return null;
}

function formatCallDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${secs}s`;
}

function getOtherCallPartyId(metadata: CallMetadata | null, currentUserId: string): string | null {
  if (!metadata?.callerId || !metadata?.calleeId) return null;
  if (metadata.callerId === currentUserId) return metadata.calleeId;
  if (metadata.calleeId === currentUserId) return metadata.callerId;
  return null;
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
  onReply,
}: {
  mine: boolean;
  showHeader: boolean;
  name: string;
  ts: string;
  message: ChatMessage;
  onDelete?: (messageId: string) => void;
  onReply?: (msg: ReplyToPayload) => void;
}) {
  const deleted = Boolean(message.deletedAt);
  const status = mine && !deleted ? deriveStatus(message) : null;
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxStart, setLightboxStart] = useState(0);

  const mediaItems = useMemo(() => {
    const atts = message.attachments ?? [];
    const items: LightboxItem[] = [];
    for (const a of atts) {
      const url = a.url;
      if (!url) continue;
      if (a.type === "image") items.push({ type: "image", url, filename: a.filename });
      if (a.type === "video") items.push({ type: "video", url, filename: a.filename });
    }
    return items;
  }, [message.attachments]);

  return (
    <div
      className={[
        "group flex max-w-[78%] flex-col gap-1",
        mine ? "ml-auto items-end" : "items-start",
      ].join(" ")}
    >
      <AttachmentLightbox
        open={lightboxOpen}
        items={mediaItems}
        startIndex={lightboxStart}
        onClose={() => setLightboxOpen(false)}
      />
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
        {onReply && !deleted && (
          <button
            type="button"
            onClick={() =>
              onReply({
                messageId: message.id,
                senderId: message.senderId,
                senderName: name,
                text: message.message?.slice(0, 100) ?? "",
                attachmentType:
                  message.attachments?.[0]?.type ?? message.attachmentType ?? undefined,
              })
            }
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-0 transition hover:bg-linen-100 hover:text-foreground group-hover:opacity-100"
            aria-label="Reply to message"
            title="Reply"
          >
            <ReplyIcon className="size-3.5" />
          </button>
        )}
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
            <ReplyQuoteBlock replyTo={message.replyTo} mine={mine} />
            {Array.isArray(message.attachments) && message.attachments.length > 0 ? (
              <div className="flex flex-col gap-2">
                <div className="grid max-w-[420px] grid-cols-2 gap-2">
                  {message.attachments.map((a) => {
                    if (a.type === "image" && a.url) {
                      const idx = mediaItems.findIndex((i) => i.url === a.url);
                      return (
                        <button
                          key={a.id}
                          className="overflow-hidden rounded-xl border border-linen-100"
                          type="button"
                          onClick={() => {
                            setLightboxStart(Math.max(0, idx));
                            setLightboxOpen(true);
                          }}
                        >
                          <img
                            src={a.url}
                            alt={a.filename ?? ""}
                            className="h-28 w-full object-cover"
                            loading="lazy"
                          />
                        </button>
                      );
                    }
                    if (a.type === "video" && a.url) {
                      const idx = mediaItems.findIndex((i) => i.url === a.url);
                      return (
                        <button
                          key={a.id}
                          type="button"
                          className="relative h-28 w-full overflow-hidden rounded-xl border border-linen-100 bg-black/10"
                          onClick={() => {
                            setLightboxStart(Math.max(0, idx));
                            setLightboxOpen(true);
                          }}
                        >
                          <video
                            preload="metadata"
                            src={a.url}
                            className="h-28 w-full object-cover opacity-95"
                          />
                          <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-white">
                            Play
                          </span>
                        </button>
                      );
                    }
                    if (a.type === "audio" && a.url) {
                      return (
                        <audio
                          key={a.id}
                          controls
                          preload="metadata"
                          src={a.url}
                          className="w-full"
                        />
                      );
                    }
                    return (
                      <a
                        key={a.id}
                        href={a.url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between gap-2 rounded-xl border border-linen-100 bg-white/40 px-3 py-2 text-xs"
                      >
                        <span className="truncate">{a.filename ?? "Attachment"}</span>
                        <span className="shrink-0 opacity-60">Open</span>
                      </a>
                    );
                  })}
                </div>
                {message.message ? <div>{message.message}</div> : null}
              </div>
            ) : message.attachmentType === "audio" && message.attachmentUrl ? (
              <div className="flex flex-col gap-2">
                <audio
                  controls
                  preload="metadata"
                  src={message.attachmentUrl}
                  className="w-64 max-w-full"
                />
                {message.message ? <div>{message.message}</div> : null}
              </div>
            ) : (
              message.message
            )}
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

function ReplyQuoteBlock({
  replyTo,
  mine,
}: {
  replyTo?: ReplyToPayload | null;
  mine: boolean;
}) {
  if (!replyTo) return null;
  const attachment = getAttachmentDisplay(replyTo.attachmentType);

  return (
    <div
      className={[
        "mb-2 rounded-xl border-l-2 border-[var(--accent-bubble-bg)] px-3 py-2",
        mine ? "bg-white/15" : "bg-linen-100/70",
      ].join(" ")}
    >
      <div className={["text-xs font-semibold", mine ? "text-white" : "text-foreground"].join(" ")}>
        {replyTo.senderName}
      </div>
      {attachment && (
        <div
          className={[
            "mt-1 flex items-center gap-1 text-xs",
            mine ? "text-white/75" : "text-muted-foreground",
          ].join(" ")}
        >
          <attachment.Icon className="size-3" />
          <span>{attachment.label}</span>
        </div>
      )}
      {replyTo.text && (
        <div className={["mt-0.5 text-xs", mine ? "text-white/75" : "text-muted-foreground"].join(" ")}>
          {truncateText(replyTo.text, 80)}
        </div>
      )}
    </div>
  );
}

function getAttachmentDisplay(type?: string): {
  label: string;
  Icon: LucideIcon;
} | null {
  if (!type) return null;
  if (type === "image") return { label: "Photo", Icon: ImageIcon };
  if (type === "video") return { label: "Video", Icon: VideoIcon };
  if (type === "audio") return { label: "Audio", Icon: MicIcon };
  return { label: "File", Icon: FileIcon };
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}...`;
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
