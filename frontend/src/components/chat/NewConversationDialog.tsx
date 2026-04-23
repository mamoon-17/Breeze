// Modal: start a DM by email, or create a group with invitations.

import { useEffect, useMemo, useRef, useState } from "react";
import { Conversations, Users, resolveAvatarUrl } from "@/lib/breeze/api";
import type { BreezeUser } from "@/lib/breeze/types";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}

type LookupStatus = "idle" | "checking" | "found" | "not-found";

interface DmLookup {
  status: LookupStatus;
  user: BreezeUser | null;
}

interface Recipient {
  email: string;
  status: LookupStatus;
  user: BreezeUser | null;
}

export function NewConversationDialog({ open, onClose, onCreated }: Props) {
  const [tab, setTab] = useState<"dm" | "group">("dm");
  const [submitting, setSubmitting] = useState(false);

  // DM state
  const [dmEmail, setDmEmail] = useState("");
  const [dmLookup, setDmLookup] = useState<DmLookup>({
    status: "idle",
    user: null,
  });

  // Group state
  const [groupName, setGroupName] = useState("");
  const [emailDraft, setEmailDraft] = useState("");
  const [recipients, setRecipients] = useState<Recipient[]>([]);

  // Reset everything when the dialog re-opens.
  useEffect(() => {
    if (!open) return;
    setTab("dm");
    setDmEmail("");
    setDmLookup({ status: "idle", user: null });
    setGroupName("");
    setEmailDraft("");
    setRecipients([]);
  }, [open]);

  // Debounced DM lookup
  const dmDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (dmDebounce.current) clearTimeout(dmDebounce.current);
    const trimmed = dmEmail.trim();
    if (!isValidEmail(trimmed)) {
      setDmLookup({ status: "idle", user: null });
      return;
    }
    setDmLookup({ status: "checking", user: null });
    dmDebounce.current = setTimeout(async () => {
      const u = await Users.lookupByEmail(trimmed).catch(() => null);
      setDmLookup(
        u ? { status: "found", user: u } : { status: "not-found", user: null },
      );
    }, 300);
    return () => {
      if (dmDebounce.current) clearTimeout(dmDebounce.current);
    };
  }, [dmEmail]);

  const addRecipient = async () => {
    const email = emailDraft.trim().toLowerCase();
    if (!isValidEmail(email)) {
      toast.error("Enter a valid email");
      return;
    }
    if (recipients.some((r) => r.email === email)) {
      toast.error("Already added");
      setEmailDraft("");
      return;
    }
    setEmailDraft("");
    setRecipients((prev) => [
      ...prev,
      { email, status: "checking", user: null },
    ]);
    const u = await Users.lookupByEmail(email).catch(() => null);
    setRecipients((prev) =>
      prev.map((r) =>
        r.email === email
          ? u
            ? { ...r, status: "found", user: u }
            : { ...r, status: "not-found", user: null }
          : r,
      ),
    );
  };

  const removeRecipient = (email: string) => {
    setRecipients((prev) => prev.filter((r) => r.email !== email));
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      if (tab === "dm") {
        const trimmed = dmEmail.trim().toLowerCase();
        if (!isValidEmail(trimmed)) {
          toast.error("Enter a valid email");
          return;
        }
        if (dmLookup.status !== "found") {
          toast.error("That email isn't on Breeze yet");
          return;
        }
        const { conversationId } = await Conversations.getOrCreateDm(trimmed);
        onCreated(conversationId);
      } else {
        const name = groupName.trim();
        if (!name) {
          toast.error("Give your group a name");
          return;
        }
        const valid = recipients.filter((r) => r.status === "found");
        const invalid = recipients.filter((r) => r.status === "not-found");
        if (valid.length === 0) {
          toast.error("Add at least one member who's on Breeze");
          return;
        }
        const res = await Conversations.createGroup(
          name,
          valid.map((r) => r.email),
        );
        if (invalid.length > 0) {
          toast(
            `${invalid.length} email${invalid.length === 1 ? "" : "s"} not on Breeze and skipped`,
          );
        }
        onCreated(res.conversationId);
      }
    } catch (err) {
      const e = err as { message?: string };
      toast.error(e?.message ?? "Couldn't create the conversation");
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmitDm = useMemo(
    () => dmLookup.status === "found" && !submitting,
    [dmLookup, submitting],
  );
  const canSubmitGroup = useMemo(
    () =>
      groupName.trim().length > 0 &&
      recipients.some((r) => r.status === "found") &&
      !submitting,
    [groupName, recipients, submitting],
  );

  if (!open) return null;

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
              htmlFor="dm-email"
              className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
            >
              Recipient email
            </label>
            <input
              id="dm-email"
              type="email"
              autoFocus
              value={dmEmail}
              onChange={(e) => setDmEmail(e.target.value)}
              placeholder="friend@example.com"
              className="w-full rounded-xl border border-linen-200 bg-background px-3 py-2 text-sm outline-none focus:border-breeze"
            />
            <DmLookupHint email={dmEmail} lookup={dmLookup} />
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
                Invite by email
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="email"
                  value={emailDraft}
                  onChange={(e) => setEmailDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void addRecipient();
                    }
                  }}
                  placeholder="friend@example.com"
                  className="flex-1 rounded-xl border border-linen-200 bg-background px-3 py-2 text-sm outline-none focus:border-breeze"
                />
                <button
                  onClick={() => void addRecipient()}
                  className="shrink-0 rounded-xl border border-linen-200 px-3 py-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground transition hover:bg-linen-100 hover:text-foreground"
                >
                  Add
                </button>
              </div>
              {recipients.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {recipients.map((r) => (
                    <li
                      key={r.email}
                      className={[
                        "flex items-center justify-between rounded-lg border px-3 py-1.5 text-sm",
                        r.status === "not-found"
                          ? "border-amber-200 bg-amber-50"
                          : "border-linen-200 bg-linen-50",
                      ].join(" ")}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium text-foreground">
                          {r.user?.displayName ?? r.email}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {r.status === "checking"
                            ? "Checking…"
                            : r.status === "not-found"
                              ? "Not on Breeze — will be skipped"
                              : r.email}
                        </div>
                      </div>
                      <button
                        onClick={() => removeRecipient(r.email)}
                        className="ml-2 shrink-0 rounded-md p-1 text-muted-foreground hover:bg-linen-100 hover:text-foreground"
                        aria-label={`Remove ${r.email}`}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[11px] text-muted-foreground">
                Invitees will need to accept before joining.
              </p>
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
            disabled={tab === "dm" ? !canSubmitDm : !canSubmitGroup}
            className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground transition hover:bg-linen-600 disabled:opacity-50"
          >
            {submitting ? "…" : tab === "dm" ? "Message" : "Create group"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DmLookupHint({
  email,
  lookup,
}: {
  email: string;
  lookup: DmLookup;
}) {
  const [avatarBroken, setAvatarBroken] = useState(false);
  useEffect(() => {
    setAvatarBroken(false);
  }, [lookup.user?.avatarUrl]);

  const trimmed = email.trim();
  if (!trimmed) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Type an email to start a direct message.
      </p>
    );
  }
  if (!isValidEmail(trimmed)) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Keep typing — that doesn't look like an email yet.
      </p>
    );
  }
  if (lookup.status === "checking") {
    return (
      <p className="text-[11px] text-muted-foreground">Checking Breeze…</p>
    );
  }
  if (lookup.status === "found" && lookup.user) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-linen-200 bg-linen-50 px-3 py-2 text-sm">
        {resolveAvatarUrl(lookup.user.avatarUrl) && !avatarBroken ? (
          <img
            src={resolveAvatarUrl(lookup.user.avatarUrl) ?? undefined}
            alt=""
            className="size-7 rounded-full object-cover"
            onError={() => setAvatarBroken(true)}
          />
        ) : (
          <div className="flex size-7 items-center justify-center rounded-full bg-breeze text-[11px] font-semibold text-white">
            {(lookup.user.displayName ?? lookup.user.email)
              .charAt(0)
              .toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">
            {lookup.user.displayName ?? lookup.user.email}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {lookup.user.email}
          </div>
        </div>
      </div>
    );
  }
  if (lookup.status === "not-found") {
    const inviteHref = `mailto:${encodeURIComponent(trimmed)}?subject=${encodeURIComponent("Join me on Breeze")}&body=${encodeURIComponent(
      "Hey! I'm on Breeze — sign in at https://breeze.app and we can chat there.",
    )}`;
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
        <span className="text-amber-900">Not on Breeze yet.</span>
        <a
          href={inviteHref}
          className="shrink-0 rounded-md border border-amber-300 bg-white px-2 py-1 text-[11px] font-semibold uppercase tracking-widest text-amber-900 hover:bg-amber-100"
        >
          Invite to Breeze
        </a>
      </div>
    );
  }
  return null;
}

function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
