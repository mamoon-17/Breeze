// Invitations drawer — shows pending group invitations for the current user,
// with accept / reject actions. Updates live via socket events from the app shell.

import { useEffect, useState } from "react";
import { Invitations, resolveAvatarUrl } from "@/lib/breeze/api";
import type { ConversationInvitation } from "@/lib/breeze/types";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
  onAccepted: (conversationId: string) => void;
}

export function InvitationsInbox({ open, onClose, onAccepted }: Props) {
  const [items, setItems] = useState<ConversationInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [broken, setBroken] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { invitations } = await Invitations.list();
        if (!cancelled) setItems(invitations);
      } catch (err) {
        const e = err as { message?: string };
        toast.error(e?.message ?? "Couldn't load invitations");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const accept = async (inv: ConversationInvitation) => {
    setBusyId(inv.id);
    try {
      const { conversationId } = await Invitations.accept(inv.id);
      setItems((prev) => prev.filter((i) => i.id !== inv.id));
      toast.success(`Joined ${inv.conversation.name ?? "group"}`);
      onAccepted(conversationId);
    } catch (err) {
      const e = err as { message?: string };
      toast.error(e?.message ?? "Couldn't accept invitation");
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (inv: ConversationInvitation) => {
    setBusyId(inv.id);
    try {
      await Invitations.reject(inv.id);
      setItems((prev) => prev.filter((i) => i.id !== inv.id));
    } catch (err) {
      const e = err as { message?: string };
      toast.error(e?.message ?? "Couldn't reject invitation");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
    >
      <button
        type="button"
        aria-label="Close invitations backdrop"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-foreground/30 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-md rounded-3xl border border-linen-200 bg-card p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-2xl">Invitations</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground transition hover:bg-linen-100 hover:text-foreground"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 max-h-[50vh] overflow-y-auto">
          {loading ? (
            <div className="space-y-2 py-2">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-xl bg-linen-100"
                />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No pending invitations.
            </p>
          ) : (
            <ul className="space-y-2">
              {items.map((inv) => (
                <li
                  key={inv.id}
                  className="flex items-start gap-3 rounded-xl border border-linen-200 bg-linen-50 p-3"
                >
                  {resolveAvatarUrl(inv.inviter.avatarUrl) && !broken[inv.id] ? (
                    <img
                      src={resolveAvatarUrl(inv.inviter.avatarUrl) ?? undefined}
                      alt=""
                      className="size-10 shrink-0 rounded-full object-cover"
                      onError={() =>
                        setBroken((prev) => ({ ...prev, [inv.id]: true }))
                      }
                    />
                  ) : (
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-breeze text-sm font-semibold text-white">
                      {(inv.inviter.displayName ?? inv.inviter.email)
                        .charAt(0)
                        .toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">
                      <span className="font-semibold">
                        {inv.inviter.displayName ?? inv.inviter.email}
                      </span>{" "}
                      invited you to{" "}
                      <span className="font-semibold">
                        {inv.conversation.name ?? "a group"}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {new Date(inv.createdAt).toLocaleString()}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        disabled={busyId === inv.id}
                        onClick={() => void accept(inv)}
                        className="rounded-lg bg-primary px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary-foreground transition hover:bg-linen-600 disabled:opacity-50"
                      >
                        Accept
                      </button>
                      <button
                        disabled={busyId === inv.id}
                        onClick={() => void reject(inv)}
                        className="rounded-lg border border-linen-200 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground transition hover:bg-linen-100 hover:text-foreground disabled:opacity-50"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
