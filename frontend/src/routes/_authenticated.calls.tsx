import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { API_BASE, Calls, Users, resolveAvatarUrl } from "@/lib/breeze/api";
import { useAuth } from "@/lib/breeze/auth-context";
import { useCall } from "@/lib/breeze/call-context";
import type { BreezeUser, CallOutcome, CallRecord } from "@/lib/breeze/types";

const PAGE_SIZE = 20;

export const Route = createFileRoute("/_authenticated/calls")({
  component: CallsPage,
});

function CallsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { initiateCall } = useCall();
  const [records, setRecords] = useState<CallRecord[]>([]);
  const [usersById, setUsersById] = useState<Record<string, BreezeUser>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const load = async (nextPage: number, append: boolean) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const result = await Calls.history(nextPage, PAGE_SIZE);
      const sorted = [...result.records].sort(
        (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      );
      setRecords((prev) => (append ? [...prev, ...sorted] : sorted));
      setTotal(result.total);
      setPage(result.page);
    } catch (err) {
      const e = err as { message?: string };
      toast.error(e?.message ?? "Couldn't load call history");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    void load(1, false);
  }, []);

  useEffect(() => {
    if (!user?.id || records.length === 0) return;
    const ids = new Set<string>();
    for (const record of records) {
      const otherId = getOtherPartyId(record, user.id);
      if (otherId && !usersById[otherId]) ids.add(otherId);
    }
    if (ids.size === 0) return;

    let cancelled = false;
    void Promise.all(
      [...ids].map(async (id) => {
        try {
          const { user: found } = await Users.byId(id);
          return [id, found] as const;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setUsersById((prev) => {
        const next = { ...prev };
        for (const entry of entries) {
          if (entry) next[entry[0]] = entry[1];
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [records, user?.id, usersById]);

  const hasMore = records.length < total;
  const content = (() => {
    if (loading) return <CallHistorySkeleton />;
    if (records.length === 0) {
      return (
        <div className="flex min-h-[360px] items-center justify-center text-sm text-muted-foreground">
          No calls yet
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {records.map((record) => {
          const otherId = user?.id ? getOtherPartyId(record, user.id) : null;
          const otherUser = otherId ? usersById[otherId] : null;
          const otherName = otherUser?.displayName ?? otherUser?.email ?? "Unknown";
          const callType = normalizeRecordCallType(record);
          const canCallBack =
            Boolean(otherId) &&
            (record.outcome === "completed" ||
              record.outcome === "missed" ||
              record.outcome === "rejected");

          return (
            <div
              key={record.id}
              className="flex items-center gap-4 rounded-2xl border border-linen-200 bg-card p-4 shadow-soft"
            >
              <CallAvatar
                src={effectiveAvatarUrl(otherId, otherUser)}
                initial={(otherName || "?").charAt(0).toUpperCase()}
                name={otherName}
              />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <h2 className="truncate text-sm font-semibold text-foreground">{otherName}</h2>
                  {callType === "video" ? (
                    <VideoIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <PhoneIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <OutcomeBadge outcome={record.outcome} callType={callType} />
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">
                    {formatRelativeCallTime(record.startedAt)}
                  </p>
                  {record.outcome === "completed" && record.durationSeconds != null && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {formatCallDuration(record.durationSeconds)}
                    </p>
                  )}
                </div>
                {canCallBack && otherId && (
                  <button
                    type="button"
                    onClick={() =>
                      void initiateCall(otherId, record.conversationId, otherName, "audio")
                    }
                    className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-linen-100 hover:text-foreground"
                    aria-label={`Call ${otherName}`}
                    title="Call back"
                  >
                    <PhoneIcon className="size-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {hasMore && (
          <div className="flex justify-center pt-2">
            <button
              type="button"
              onClick={() => void load(page + 1, true)}
              disabled={loadingMore}
              className="rounded-xl border border-linen-200 bg-card px-4 py-2 text-xs font-semibold uppercase tracking-widest text-foreground transition hover:bg-linen-100 disabled:opacity-60"
            >
              {loadingMore ? "Loading..." : "Load more"}
            </button>
          </div>
        )}
      </div>
    );
  })();

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-linen-200 bg-white/60 px-6">
        <button
          onClick={() => navigate({ to: "/app" })}
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition hover:bg-linen-100 hover:text-foreground"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to messages
        </button>
      </header>

      <div className="scroll-soft flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-10 md:py-16">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Calls
          </p>
          <h1 className="mt-1 font-display text-4xl">Call History</h1>
          <div className="mt-8">{content}</div>
        </div>
      </div>
    </div>
  );
}

function CallHistorySkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-2xl border border-linen-200 bg-card p-4 shadow-soft"
        >
          <div className="size-11 shrink-0 animate-pulse rounded-full bg-linen-200" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-36 animate-pulse rounded bg-linen-200" />
            <div className="h-2.5 w-24 animate-pulse rounded bg-linen-100" />
          </div>
          <div className="h-3 w-20 animate-pulse rounded bg-linen-100" />
        </div>
      ))}
    </div>
  );
}

function CallAvatar({ src, initial, name }: { src: string | null; initial: string; name: string }) {
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setBroken(false);
  }, [src]);

  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        className="size-11 shrink-0 rounded-full object-cover"
        onError={() => setBroken(true)}
      />
    );
  }

  return (
    <div
      className={`flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${getAvatarColor(
        name,
      )}`}
    >
      {initial}
    </div>
  );
}

function OutcomeBadge({
  outcome,
  callType,
}: {
  outcome: CallOutcome;
  callType: "audio" | "video";
}) {
  const label = (() => {
    switch (outcome) {
      case "completed":
        return callType === "video" ? "Video call" : "Voice call";
      case "missed":
        return "Missed";
      case "rejected":
        return "Declined";
      case "cancelled":
        return "Cancelled";
      case "failed":
        return "Failed";
      default:
        return outcome;
    }
  })();

  const tone =
    outcome === "completed"
      ? "bg-emerald-50 text-emerald-600"
      : outcome === "missed" || outcome === "failed"
        ? "bg-red-50 text-red-500"
        : outcome === "rejected"
          ? "bg-amber-50 text-amber-600"
          : "bg-linen-100 text-muted-foreground";

  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tone}`}>{label}</span>
  );
}

function effectiveAvatarUrl(userId: string | null, user: BreezeUser | null): string | null {
  const resolved = resolveAvatarUrl(user?.avatarUrl);
  if (resolved) return resolved;
  return userId ? `${API_BASE}/user/${userId}/avatar` : null;
}

function getOtherPartyId(record: CallRecord, currentUserId: string): string | null {
  if (record.callerId === currentUserId) return record.calleeId;
  if (record.calleeId === currentUserId) return record.callerId;
  return record.callerId || record.calleeId || null;
}

function normalizeRecordCallType(record: CallRecord): "audio" | "video" {
  const raw = (record as CallRecord & { callType?: string; type?: string }).callType ?? "";
  const type = raw || (record as CallRecord & { type?: string }).type || "";
  return type.toLowerCase() === "video" ? "video" : "audio";
}

function formatRelativeCallTime(value: string): string {
  try {
    const date = new Date(value);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 1) return "Yesterday";
    return formatDistanceToNow(date, { addSuffix: true });
  } catch {
    return "";
  }
}

function formatCallDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${secs}s`;
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function VideoIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M23 7l-7 5 7 5V7z" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
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
