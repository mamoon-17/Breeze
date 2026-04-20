import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Auth } from "@/lib/breeze/api";
import type { SessionFamily } from "@/lib/breeze/types";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { useAuth } from "@/lib/breeze/auth-context";

export const Route = createFileRoute("/_authenticated/sessions")({
  component: SessionsPage,
});

function SessionsPage() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionFamily[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { sessions: list } = await Auth.sessions();
      setSessions(list);
    } catch (err) {
      const e = err as { message?: string };
      toast.error(e?.message ?? "Couldn't load sessions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const revoke = async (familyId: string) => {
    setRevoking(familyId);
    try {
      await Auth.revokeSession(familyId);
      toast.success("Session revoked");
      await load();
    } catch (err) {
      const e = err as { message?: string };
      toast.error(e?.message ?? "Couldn't revoke session");
    } finally {
      setRevoking(null);
    }
  };

  const revokeOthers = async () => {
    try {
      await Auth.revokeOthers();
      toast.success("All other sessions revoked");
      await load();
    } catch (err) {
      const e = err as { message?: string };
      toast.error(e?.message ?? "Couldn't revoke");
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Minimal top bar for navigation */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-linen-200 bg-white/60 px-6">
        <div className="flex items-center gap-3">
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
        </div>
        <button
          onClick={async () => {
            await signOut();
            navigate({ to: "/" });
          }}
          className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-50"
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
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-10 md:py-16">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Security
              </p>
              <h1 className="mt-1 font-display text-4xl">Active sessions</h1>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                Each device that's signed into Breeze. Revoke anything that
                doesn't look like you.
              </p>
            </div>
            <button
              onClick={revokeOthers}
              className="rounded-xl border border-linen-200 bg-card px-4 py-2 text-xs font-semibold uppercase tracking-widest text-foreground transition hover:bg-linen-100"
            >
              Revoke others
            </button>
          </div>

          <div className="mt-8 space-y-3">
            {loading ? (
              <SkeletonSession />
            ) : sessions.length === 0 ? (
              <p className="rounded-2xl border border-linen-200 bg-card p-6 text-sm text-muted-foreground">
                No active sessions found.
              </p>
            ) : (
              sessions.map((s) => (
                <div
                  key={s.familyId}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-linen-200 bg-card p-5 shadow-soft"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {s.device || "Unknown device"}
                      </span>
                      {s.requiresStepUp && (
                        <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-destructive">
                          Step-up
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {s.location || "Unknown location"} ·{" "}
                      {s.ipPrefix || "unknown"}
                    </p>
                    <p className="mt-1 text-[11px] uppercase tracking-widest text-muted-foreground">
                      Last active{" "}
                      {(() => {
                        try {
                          return formatDistanceToNow(
                            new Date(s.lastActivity),
                            { addSuffix: true },
                          );
                        } catch {
                          return "";
                        }
                      })()}
                    </p>
                  </div>
                  <button
                    onClick={() => revoke(s.familyId)}
                    disabled={revoking === s.familyId}
                    className="rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-primary-foreground transition hover:bg-linen-600 disabled:opacity-50"
                  >
                    {revoking === s.familyId ? "..." : "Revoke"}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SkeletonSession() {
  return (
    <>
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-24 animate-pulse rounded-2xl border border-linen-200 bg-card"
        />
      ))}
    </>
  );
}
