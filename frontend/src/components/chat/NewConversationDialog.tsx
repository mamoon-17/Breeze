// Modal: start a DM by user ID, or create a group.

import { useState } from "react";
import { Conversations } from "@/lib/breeze/api";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}

export function NewConversationDialog({ open, onClose, onCreated }: Props) {
  const [tab, setTab] = useState<"dm" | "group">("dm");
  const [targetUserId, setTargetUserId] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupMembers, setGroupMembers] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const submit = async () => {
    setSubmitting(true);
    try {
      if (tab === "dm") {
        const id = targetUserId.trim();
        if (!id) {
          toast.error("Enter the recipient's user ID");
          return;
        }
        const { conversationId } = await Conversations.getOrCreateDm(id);
        onCreated(conversationId);
        setTargetUserId("");
      } else {
        const name = groupName.trim();
        const ids = groupMembers
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (!name || ids.length === 0) {
          toast.error("Group needs a name and at least one member");
          return;
        }
        const { conversationId } = await Conversations.createGroup(name, ids);
        onCreated(conversationId);
        setGroupName("");
        setGroupMembers("");
      }
    } catch (err) {
      const e = err as { message?: string };
      toast.error(e?.message ?? "Couldn't create the conversation");
    } finally {
      setSubmitting(false);
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
        aria-label="Close dialog backdrop"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-foreground/30 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-md rounded-3xl border border-linen-200 bg-card p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-2xl">New conversation</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground transition hover:bg-linen-100 hover:text-foreground"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="mt-5 inline-flex rounded-xl border border-linen-200 bg-linen-100 p-1">
          {(["dm", "group"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                "px-4 py-1.5 text-xs font-semibold uppercase tracking-widest transition",
                t === tab
                  ? "rounded-lg bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {t === "dm" ? "Direct message" : "Group"}
            </button>
          ))}
        </div>

        {tab === "dm" ? (
          <div className="mt-5 space-y-2">
            <label
              htmlFor="dm-uid"
              className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
            >
              Recipient user ID
            </label>
            <input
              id="dm-uid"
              autoFocus
              value={targetUserId}
              onChange={(e) => setTargetUserId(e.target.value)}
              placeholder="e.g. 7c9e6679-7425-40de-944b-e07fc1f90ae7"
              className="w-full rounded-xl border border-linen-200 bg-background px-3 py-2 text-sm outline-none focus:border-breeze"
            />
            <p className="text-[11px] text-muted-foreground">
              Breeze identifies users by UUID. Once a directory endpoint exists,
              this becomes a search.
            </p>
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Group name
              </label>
              <input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                className="w-full rounded-xl border border-linen-200 bg-background px-3 py-2 text-sm outline-none focus:border-breeze"
                placeholder="Design crew"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Member user IDs (comma-separated)
              </label>
              <textarea
                value={groupMembers}
                onChange={(e) => setGroupMembers(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-linen-200 bg-background px-3 py-2 text-sm outline-none focus:border-breeze"
                placeholder="uuid-1, uuid-2, uuid-3"
              />
            </div>
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground transition hover:bg-linen-100 hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground transition hover:bg-linen-600 disabled:opacity-50"
          >
            {submitting ? "…" : "Start"}
          </button>
        </div>
      </div>
    </div>
  );
}
