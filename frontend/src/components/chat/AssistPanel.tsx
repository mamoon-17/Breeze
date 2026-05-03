// Right-side AI assist panel with Mood Enhancer + AI Chat + Reminder scheduling.

import { useState, useRef, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Ai } from "@/lib/breeze/api";
import { useAuth } from "@/lib/breeze/auth-context";
import type {
  AiIntentResult,
  AiMessageWriterJob,
  ReminderJobSummary,
  SummaryResult,
  ReminderParseResult,
  ZenHistoryMessage,
} from "@/lib/breeze/api";
import { getSocket } from "@/lib/breeze/socket";
import type { WsReminderQueued, WsReminderSent } from "@/lib/breeze/types";

// ─── Types ───────────────────────────────────────────────────────────────────

type MoodKey =
  | "neutral"
  | "formal"
  | "casual"
  | "friendly"
  | "creative"
  | "funny"
  | "empathetic"
  | "assertive";

interface MoodOption {
  key: MoodKey;
  label: string;
  emoji: string;
  gradient: string;
}

const MOODS: MoodOption[] = [
  {
    key: "neutral",
    label: "Neutral",
    emoji: "😐",
    gradient: "from-slate-400 to-slate-500",
  },
  {
    key: "formal",
    label: "Formal",
    emoji: "🎩",
    gradient: "from-indigo-400 to-indigo-600",
  },
  {
    key: "casual",
    label: "Casual",
    emoji: "😎",
    gradient: "from-amber-400 to-orange-500",
  },
  {
    key: "friendly",
    label: "Friendly",
    emoji: "🤗",
    gradient: "from-pink-400 to-rose-500",
  },
  {
    key: "creative",
    label: "Creative",
    emoji: "🎨",
    gradient: "from-violet-400 to-purple-600",
  },
  {
    key: "funny",
    label: "Funny",
    emoji: "😂",
    gradient: "from-yellow-400 to-amber-500",
  },
  {
    key: "empathetic",
    label: "Empathetic",
    emoji: "💕",
    gradient: "from-rose-400 to-pink-500",
  },
  {
    key: "assertive",
    label: "Assertive",
    emoji: "💪",
    gradient: "from-emerald-400 to-teal-600",
  },
];

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  kind?: "chat" | "status" | "reminder_confirm";
  reminderData?: ReminderParseResult;
  reminderResolved?: boolean;
  /** Server row id when loaded from or saved to Zen history */
  zenId?: string;
}

interface Props {
  conversationTitle?: string;
  messageCount?: number;
  readReceipts?: Record<string, string>;
  composerDraft?: string;
  setComposerDraft?: (text: string) => void;
  conversationId?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDateReadable(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function buildAiChatHistory(
  messages: ChatMsg[],
): { role: "user" | "assistant"; content: string }[] {
  return messages
    .filter((m) => m.kind !== "status" && m.kind !== "reminder_confirm")
    .map((m) => ({ role: m.role, content: m.content }));
}

function mapZenServerToChatMsg(m: ZenHistoryMessage): ChatMsg {
  const kind = m.kind ?? "chat";
  const base: ChatMsg = {
    role: m.role,
    content: m.content,
    kind,
    zenId: m.id,
  };
  if (kind === "reminder_confirm" && m.meta?.reminderData && typeof m.meta.reminderData === "object") {
    base.reminderData = m.meta.reminderData as ReminderParseResult;
    base.reminderResolved = Boolean(m.meta.reminderResolved);
  }
  return base;
}

function summarizeWriterJob(job: AiMessageWriterJob): string {
  const results = job.results ?? [];
  const successes = results.filter((r) => Boolean(r.messageId));
  const failures = results.filter((r) => Boolean(r.error));

  if (successes.length === 0) {
    const error = job.errorMessage ?? failures[0]?.error ?? "Unknown error";
    return `I couldn't send that. ${error}`;
  }

  const successLabel =
    successes.length === 1 ? "1 conversation" : `${successes.length} conversations`;

  if (failures.length === 0) {
    return `Sent to ${successLabel}.`;
  }

  const failureLabel =
    failures.length === 1 ? "1 conversation" : `${failures.length} conversations`;
  return `Sent to ${successLabel}. Failed for ${failureLabel}.`;
}

const LIMIT_OPTIONS: { label: string; value: number }[] = [
  { label: "Last 10 messages", value: 10 },
  { label: "Last 20 messages", value: 20 },
  { label: "Last 30 messages", value: 30 },
];

const CHAT_STORAGE_KEY_BASE = "breeze.ai.chat.history";
const CHAT_COLLAPSED_KEY = "breeze.ai.panel.collapsed";
const CHAT_EXPANDED_KEY = "breeze.ai.chat.expanded";
const MAX_CHAT_HISTORY = 200;
const CHAT_SESSION_KEY_BASE = "breeze.ai.chat.history.session";

// ─── Component ───────────────────────────────────────────────────────────────

export function AssistPanel({
  conversationTitle,
  messageCount,
  composerDraft,
  setComposerDraft,
  conversationId,
}: Props) {
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(CHAT_COLLAPSED_KEY) === "true";
  });
  const [chatExpanded, setChatExpanded] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(CHAT_EXPANDED_KEY) === "true";
  });
  // ── Mood enhancer state ──
  const [loadingMood, setLoadingMood] = useState<MoodKey | null>(null);
  const [originalText, setOriginalText] = useState<string | null>(null);
  const [moodError, setMoodError] = useState<string | null>(null);
  const restoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Summarize state ──
  const [summarizeOpen, setSummarizeOpen] = useState(false);
  const [summarizeLimit, setSummarizeLimit] = useState(20);
  const [summarizeLoading, setSummarizeLoading] = useState(false);
  const [summaryResult, setSummaryResult] = useState<SummaryResult | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const summarizeContainerRef = useRef<HTMLDivElement>(null);

  // ── AI Chat state ──
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [reminders, setReminders] = useState<ReminderJobSummary[]>([]);
  const [remindersLoading, setRemindersLoading] = useState(false);
  const zenLoadedRef = useRef(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const userTimeZone =
    typeof window === "undefined" ? "UTC" : Intl.DateTimeFormat().resolvedOptions().timeZone;
  const chatStorageKey = user?.id
    ? `${CHAT_STORAGE_KEY_BASE}:${user.id}`
    : `${CHAT_STORAGE_KEY_BASE}:anon`;
  const chatSessionKey = user?.id
    ? `${CHAT_SESSION_KEY_BASE}:${user.id}`
    : `${CHAT_SESSION_KEY_BASE}:anon`;

  const readStoredChat = (key: string, sessionKey: string): ChatMsg[] | null => {
    const parse = (raw: string | null) => {
      if (!raw) return null;
      const parsed = JSON.parse(raw) as ChatMsg[];
      return Array.isArray(parsed) ? parsed : null;
    };
    try {
      const local = parse(localStorage.getItem(key));
      if (local) return local;
    } catch {
      // ignore
    }
    try {
      const session = parse(sessionStorage.getItem(sessionKey));
      if (session) return session;
    } catch {
      // ignore
    }
    return null;
  };

  const persistChat = (key: string, sessionKey: string, payload: ChatMsg[]) => {
    try {
      localStorage.setItem(key, JSON.stringify(payload));
    } catch {
      // ignore
    }
    try {
      sessionStorage.setItem(sessionKey, JSON.stringify(payload));
    } catch {
      // ignore
    }
  };

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatLoading]);

  // Restore Zen AI chat history. Prefer server-backed history; fall back to local cache.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (zenLoadedRef.current) return;
    try {
      (async () => {
        if (user?.id) {
          try {
            const { messages } = await Ai.zenHistory(200);
            zenLoadedRef.current = true;
            const serverMsgs: ChatMsg[] = (messages ?? []).map(mapZenServerToChatMsg);
            if (serverMsgs.length > 0) {
              setChatMessages(serverMsgs);
              return;
            }
          } catch {
            // ignore server failures; fall back to local below
          }
        }

        const stored = readStoredChat(chatStorageKey, chatSessionKey);
        if (stored) {
          zenLoadedRef.current = true;
          setChatMessages(stored);
          return;
        }

        if (user?.id) {
          const anonStored = readStoredChat(
            `${CHAT_STORAGE_KEY_BASE}:anon`,
            `${CHAT_SESSION_KEY_BASE}:anon`,
          );
          if (anonStored) {
            zenLoadedRef.current = true;
            setChatMessages(anonStored);
            persistChat(chatStorageKey, chatSessionKey, anonStored);
            return;
          }
        }

        zenLoadedRef.current = true;
        setChatMessages([]);
      })();
    } catch {
      setChatMessages([]);
    }
  }, [chatSessionKey, chatStorageKey, user?.id]);

  // Persist AI chat history and UI state.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (chatMessages.length > MAX_CHAT_HISTORY) {
        setChatMessages(chatMessages.slice(-MAX_CHAT_HISTORY));
        return;
      }
      persistChat(chatStorageKey, chatSessionKey, chatMessages);
    } catch {
      // ignore
    }
  }, [chatMessages, chatSessionKey, chatStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(CHAT_COLLAPSED_KEY, String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(CHAT_EXPANDED_KEY, String(chatExpanded));
  }, [chatExpanded]);

  // Cleanup restore timer on unmount
  useEffect(() => {
    return () => {
      if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current);
    };
  }, []);

  // Socket listeners for reminder events
  useEffect(() => {
    const socket = getSocket();

    const handleReminderQueued = (evt: WsReminderQueued) => {
      toast.success(
        `⏰ Reminder scheduled for ${new Date(evt.scheduledAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })}`,
      );
      void refreshReminders();
    };

    const handleReminderSent = (evt: WsReminderSent) => {
      if (evt.status === "sent") {
        toast.success("✅ Reminder sent successfully!");
      } else {
        toast.error(`Reminder failed: ${evt.errorMessage ?? "Unknown error"}`);
      }
      void refreshReminders();
    };

    socket.on("reminder:queued" as string, handleReminderQueued);
    socket.on("reminder:sent" as string, handleReminderSent);

    return () => {
      socket.off("reminder:queued" as string, handleReminderQueued);
      socket.off("reminder:sent" as string, handleReminderSent);
    };
  }, []);

  // Click-outside handler: close summarize dropdown
  useEffect(() => {
    if (!summarizeOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        summarizeContainerRef.current &&
        !summarizeContainerRef.current.contains(e.target as Node)
      ) {
        setSummarizeOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [summarizeOpen]);

  // ── Mood enhance handler ──
  const handleMoodClick = useCallback(
    async (mood: MoodKey) => {
      setMoodError(null);
      const text = (composerDraft ?? "").trim();
      if (!text) {
        setMoodError("Type a message first");
        setTimeout(() => setMoodError(null), 3000);
        return;
      }

      setLoadingMood(mood);
      try {
        const { enhancedText } = await Ai.enhance(text, mood, conversationId);
        // Save original so user can restore
        setOriginalText(text);
        setComposerDraft?.(enhancedText);

        // Clear any old restore timer
        if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current);
        restoreTimerRef.current = setTimeout(() => {
          setOriginalText(null);
          restoreTimerRef.current = null;
        }, 8000);
      } catch (err) {
        console.error(err);
        toast.error("Couldn't enhance message — try again");
      } finally {
        setLoadingMood(null);
      }
    },
    [composerDraft, conversationId, setComposerDraft],
  );

  const handleRestore = () => {
    if (originalText !== null) {
      setComposerDraft?.(originalText);
      setOriginalText(null);
      if (restoreTimerRef.current) {
        clearTimeout(restoreTimerRef.current);
        restoreTimerRef.current = null;
      }
    }
  };

  // ── Summarize handler ──
  const handleSummarizeOptionClick = async (limit: number) => {
    setSummarizeLimit(limit);
    setSummarizeOpen(false);
    setSummaryError(null);
    setSummarizeLoading(true);
    try {
      const result = await Ai.summarise(conversationId!, limit);
      setSummaryResult(result);
    } catch (err) {
      console.error(err);
      setSummaryError("Could not summarise. Try again.");
    } finally {
      setSummarizeLoading(false);
    }
  };

  // ── AI Chat handler ──
  const handleChatSend = async () => {
    const text = chatInput.trim();
    if (!text || chatLoading) return;

    const userMsg: ChatMsg = { role: "user", content: text, kind: "chat" };
    const newMessages = [...chatMessages, userMsg];
    setChatMessages(newMessages);
    setChatInput("");
    setChatLoading(true);

    try {
      await Ai.zenAppend({ role: "user", content: text, kind: "chat" }).catch(() => {});

      const timezone = userTimeZone;
      const intent = await Ai.intent(text, timezone);
      if (intent.action === "send_message") {
        await handleSendIntent(intent, text);
      } else if (intent.action === "schedule_reminder") {
        await handleReminderIntent(text, timezone);
      } else {
        const { reply } = await Ai.chat(buildAiChatHistory(newMessages));
        await Ai.zenAppend({ role: "assistant", content: reply, kind: "chat" }).catch(() => {});
        setChatMessages((prev) => [...prev, { role: "assistant", content: reply, kind: "chat" }]);
      }
    } catch (err) {
      console.error(err);
      const errText = "Sorry, I couldn't respond right now. Please try again.";
      await Ai.zenAppend({ role: "assistant", content: errText, kind: "status" }).catch(() => {});
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: errText,
          kind: "status",
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleSendIntent = async (intent: AiIntentResult, rawText: string) => {
    const recipients = intent.recipients ?? {};
    const payload = {
      instruction: intent.instruction?.trim() || rawText,
      allConversations: Boolean(recipients.allConversations),
      conversationNames: recipients.conversationNames,
      recipientEmails: recipients.emails,
      contextMessageLimit: 6,
    };

    const hasTargets =
      payload.allConversations ||
      (payload.conversationNames?.length ?? 0) > 0 ||
      (payload.recipientEmails?.length ?? 0) > 0;

    if (!hasTargets) {
      const line = "Who should I send that to? You can use a name or email.";
      await Ai.zenAppend({ role: "assistant", content: line, kind: "status" }).catch(() => {});
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: line,
          kind: "status",
        },
      ]);
      return;
    }

    const sendingLine = "Sending your message...";
    await Ai.zenAppend({ role: "assistant", content: sendingLine, kind: "status" }).catch(() => {});
    setChatMessages((prev) => [
      ...prev,
      { role: "assistant", content: sendingLine, kind: "status" },
    ]);

    const { jobId } = await Ai.messageWriter(payload);
    const job = await pollMessageWriterJob(jobId);
    if (!job) {
      const line = "Queued in the background. I'll keep sending it.";
      await Ai.zenAppend({ role: "assistant", content: line, kind: "status" }).catch(() => {});
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: line,
          kind: "status",
        },
      ]);
      return;
    }

    const resultLine = summarizeWriterJob(job);
    await Ai.zenAppend({ role: "assistant", content: resultLine, kind: "status" }).catch(() => {});
    setChatMessages((prev) => [
      ...prev,
      { role: "assistant", content: resultLine, kind: "status" },
    ]);
  };

  const pollMessageWriterJob = async (jobId: string): Promise<AiMessageWriterJob | null> => {
    const maxAttempts = 8;
    const delayMs = 700;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const job = await Ai.messageWriterStatus(jobId);
      if (job.status !== "queued" && job.status !== "processing") {
        return job;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    return null;
  };

  // ── Reminder intent handler ──
  const handleReminderIntent = async (text: string, timezone: string) => {
    const parsingLine = "Parsing your reminder...";
    await Ai.zenAppend({ role: "assistant", content: parsingLine, kind: "status" }).catch(() => {});
    setChatMessages((prev) => [
      ...prev,
      { role: "assistant", content: parsingLine, kind: "status" },
    ]);

    try {
      const result = await Ai.createReminder(text, timezone);

      let zenId: string | undefined;
      try {
        const row = await Ai.zenAppend({
          role: "assistant",
          content: result.confirmationText,
          kind: "reminder_confirm",
          meta: { reminderData: result, reminderResolved: false },
        });
        zenId = row.id;
      } catch {
        // still show card locally
      }

      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.confirmationText,
          kind: "reminder_confirm",
          reminderData: result,
          reminderResolved: false,
          zenId,
        },
      ]);
      void refreshReminders();
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "";
      const hint = msg.toLowerCase().includes("specific time")
        ? "Please include a time for the reminder."
        : "Sorry, I couldn't parse that reminder. Please try rephrasing.";
      await Ai.zenAppend({ role: "assistant", content: hint, kind: "status" }).catch(() => {});
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: hint,
          kind: "status",
        },
      ]);
    }
  };

  const handleReminderConfirm = async (jobId: string, msgIndex: number, zenId?: string) => {
    try {
      await Ai.confirmReminder(jobId);
      if (zenId) void Ai.zenPatchMeta(zenId, { reminderResolved: true }).catch(() => {});
      setChatMessages((prev) =>
        prev.map((m, i) => (i === msgIndex ? { ...m, reminderResolved: true } : m)),
      );
      const line = "✅ Reminder scheduled! I'll send it at the scheduled time.";
      await Ai.zenAppend({ role: "assistant", content: line, kind: "status" }).catch(() => {});
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: line,
          kind: "status",
        },
      ]);
      void refreshReminders();
    } catch (err) {
      console.error(err);
      toast.error("Failed to confirm reminder");
    }
  };

  const handleReminderCancel = async (jobId: string, msgIndex: number, zenId?: string) => {
    try {
      await Ai.cancelReminder(jobId);
      if (zenId) void Ai.zenPatchMeta(zenId, { reminderResolved: true }).catch(() => {});
      setChatMessages((prev) =>
        prev.map((m, i) => (i === msgIndex ? { ...m, reminderResolved: true } : m)),
      );
      const line = "❌ Reminder cancelled.";
      await Ai.zenAppend({ role: "assistant", content: line, kind: "status" }).catch(() => {});
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: line, kind: "status" },
      ]);
      void refreshReminders();
    } catch (err) {
      console.error(err);
      toast.error("Failed to cancel reminder");
    }
  };

  const refreshReminders = useCallback(async () => {
    setRemindersLoading(true);
    try {
      const { reminders } = await Ai.listReminders();
      setReminders(reminders);
    } catch (err) {
      console.error(err);
    } finally {
      setRemindersLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshReminders();
  }, [refreshReminders]);

  const renderChatThread = (containerClassName: string) => (
    <div
      className={`overflow-y-auto rounded-2xl border border-linen-200 bg-card/60 p-3 scroll-soft ${containerClassName}`}
    >
      {chatMessages.length === 0 && !chatLoading && (
        <div className="flex h-20 items-center justify-center">
          <p className="text-center text-[11px] italic text-muted-foreground">
            Ask me anything — I can help you
            <br />
            rephrase, suggest replies, or brainstorm.
          </p>
        </div>
      )}
      <div className="space-y-2">
        {chatMessages.map((msg, i) => (
          <div
            key={msg.zenId ?? `local-${i}`}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.kind === "reminder_confirm" && msg.reminderData ? (
              <div className="max-w-[90%] rounded-2xl border border-violet-200/60 bg-gradient-to-br from-violet-50 to-indigo-50 p-3 space-y-2 animate-in fade-in slide-in-from-bottom-1 duration-200">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-violet-600">
                  <span>⏰</span>
                  <span>Scheduled Reminder</span>
                </div>
                <p className="text-xs leading-relaxed text-foreground">{msg.content}</p>
                <div className="space-y-1 rounded-lg bg-white/60 p-2">
                  <p className="text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground/70">Message: </span>
                    {msg.reminderData.messageBody}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground/70">Time: </span>
                    {new Date(msg.reminderData.scheduledAt).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: true,
                      timeZone: userTimeZone,
                    })}
                    <span className="ml-1 text-[10px] text-muted-foreground/70">
                      ({userTimeZone})
                    </span>
                  </p>
                  {(msg.reminderData.recipients.conversationNames?.length ?? 0) > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground/70">To: </span>
                      {msg.reminderData.recipients.conversationNames!.join(", ")}
                    </p>
                  )}
                </div>
                {!msg.reminderResolved && (
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() =>
                        void handleReminderConfirm(msg.reminderData!.jobId, i, msg.zenId)
                      }
                      className="flex-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-emerald-600 active:scale-[0.98]"
                    >
                      ✓ Confirm
                    </button>
                    <button
                      onClick={() =>
                        void handleReminderCancel(msg.reminderData!.jobId, i, msg.zenId)
                      }
                      className="flex-1 rounded-lg bg-linen-200 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground transition hover:bg-linen-300 active:scale-[0.98]"
                    >
                      ✕ Cancel
                    </button>
                  </div>
                )}
                {msg.reminderResolved && (
                  <p className="text-[10px] italic text-muted-foreground">Resolved</p>
                )}
              </div>
            ) : (
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                  msg.role === "user"
                    ? "bg-breeze/90 text-white"
                    : "bg-linen-200/80 text-foreground"
                }`}
              >
                {msg.content}
              </div>
            )}
          </div>
        ))}
        {chatLoading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1 rounded-2xl bg-linen-200/80 px-4 py-2.5">
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:0ms]" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
              <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>
    </div>
  );

  const renderChatInput = (containerClassName = "") => (
    <div
      className={`flex items-center gap-2 rounded-xl border border-linen-200 bg-card p-1.5 ${containerClassName}`}
    >
      <input
        type="text"
        value={chatInput}
        onChange={(e) => setChatInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void handleChatSend();
          }
        }}
        placeholder="Ask Zen AI..."
        className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground"
      />
      <button
        onClick={() => void handleChatSend()}
        disabled={!chatInput.trim() || chatLoading}
        className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-breeze text-white transition hover:bg-breeze/80 disabled:opacity-40"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </button>
    </div>
  );

  const renderReminders = () => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Reminders
        </h4>
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
          {remindersLoading ? "Updating" : "Live"}
        </span>
      </div>
      <div className="rounded-2xl border border-linen-200 bg-card/60 p-3">
        {remindersLoading && (
          <p className="text-[11px] text-muted-foreground">Loading reminders…</p>
        )}
        {!remindersLoading && reminders.length === 0 && (
          <p className="text-[11px] text-muted-foreground">No upcoming reminders yet.</p>
        )}
        {!remindersLoading && reminders.length > 0 && (
          <div className="space-y-2">
            {reminders.map((reminder) => (
              <div
                key={reminder.id}
                className="rounded-xl border border-linen-200 bg-white/80 p-2.5"
              >
                <p className="text-[11px] font-medium text-foreground">{reminder.messageBody}</p>
                <p className="text-[10px] text-muted-foreground">
                  {new Date(reminder.scheduledAt).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true,
                    timeZone: userTimeZone,
                  })}
                  <span className="ml-1 text-[9px] text-muted-foreground/70">({userTimeZone})</span>
                </p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
                    {reminder.status.replace(/_/g, " ")}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleReminderCancel(reminder.id, -1)}
                    className="rounded-lg bg-linen-200 px-2 py-1 text-[10px] font-semibold text-muted-foreground transition hover:bg-linen-300"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // ── Collapsed state: show a slim toggle button ──
  if (collapsed) {
    return (
      <aside className="hidden shrink-0 flex-col items-center border-l border-linen-200 bg-linen-100/50 py-4 lg:flex">
        <button
          onClick={() => setCollapsed(false)}
          className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-breeze/20 to-violet-500/20 text-breeze transition hover:scale-105 hover:from-breeze/30 hover:to-violet-500/30"
          title="Expand AI Assistant"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1.27A7 7 0 0 1 14 23h-4a7 7 0 0 1-6.73-4H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z" />
            <circle cx="9" cy="15" r="1" />
            <circle cx="15" cy="15" r="1" />
          </svg>
        </button>
        {chatMessages.length > 0 && (
          <span className="mt-2 flex size-5 items-center justify-center rounded-full bg-breeze/20 text-[9px] font-bold text-breeze">
            {chatMessages.length}
          </span>
        )}
      </aside>
    );
  }

  return (
    <aside
      className={`hidden shrink-0 flex-col border-l border-linen-200 bg-linen-100/50 lg:flex ${
        chatExpanded ? "w-[420px]" : "w-80"
      }`}
    >
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* ── Scrollable content ── */}
        <div className="flex-1 space-y-5 overflow-y-auto p-5 scroll-soft">
          {/* Header */}
          <div>
            <div className="flex items-center gap-2">
              <span className="size-1.5 animate-pulse rounded-full bg-breeze" />
              <h4 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                ZEN MODE
              </h4>
              <span className="ml-auto rounded-full bg-gradient-to-r from-breeze/20 to-violet-500/20 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
                AI
              </span>
            </div>
          </div>

          {/* ── MOOD PALETTE ── */}
          <div className="space-y-3">
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Enhance Tone
            </h4>

            {moodError && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600 animate-in fade-in slide-in-from-top-1 duration-200">
                {moodError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              {MOODS.map((mood) => {
                const isLoading = loadingMood === mood.key;
                return (
                  <button
                    key={mood.key}
                    onClick={() => void handleMoodClick(mood.key)}
                    disabled={loadingMood !== null}
                    className={`group relative flex items-center gap-2 rounded-xl border border-linen-200 bg-card px-3 py-2.5 text-left text-xs font-medium transition-all duration-200 hover:border-transparent hover:shadow-md disabled:opacity-50 ${
                      isLoading ? "ring-2 ring-breeze/40" : ""
                    }`}
                  >
                    {/* Gradient hover overlay */}
                    <div
                      className={`absolute inset-0 rounded-xl bg-gradient-to-r ${mood.gradient} opacity-0 transition-opacity duration-200 group-hover:opacity-10`}
                    />
                    <span className="relative text-sm">{mood.emoji}</span>
                    <span className="relative text-foreground">{mood.label}</span>
                    {isLoading && (
                      <span className="relative ml-auto size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent text-breeze" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Restore original button */}
            {originalText !== null && (
              <button
                onClick={handleRestore}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-700 transition hover:bg-amber-100 animate-in fade-in slide-in-from-top-1 duration-200"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="size-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                </svg>
                Restore original
              </button>
            )}
          </div>

          {/* ── SUMMARIZE + ACTIONS ── */}
          <div className="space-y-2" ref={summarizeContainerRef}>
            {/* Summarize button — toggles dropdown */}
            <button
              id="summarize-thread-btn"
              onClick={() => {
                if (!summarizeLoading) setSummarizeOpen((o) => !o);
              }}
              disabled={summarizeLoading || !conversationId}
              className="w-full rounded-xl border border-linen-200 bg-card px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-foreground transition hover:bg-linen-50 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {summarizeLoading ? (
                <>
                  <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Summarising…
                </>
              ) : (
                "SUMMARIZE WITH ZEN AI"
              )}
            </button>

            {/* Inline dropdown — appears below the button in normal flow */}
            {summarizeOpen && !summarizeLoading && (
              <div className="rounded-xl border border-linen-200 bg-card overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                {LIMIT_OPTIONS.map((opt) => {
                  const isDefault = opt.value === 20;
                  const isSelected = opt.value === summarizeLimit;
                  return (
                    <button
                      key={opt.value}
                      id={`summarize-limit-${opt.value}`}
                      onClick={() => void handleSummarizeOptionClick(opt.value)}
                      disabled={summarizeLoading}
                      className={`w-full px-4 py-2.5 text-left text-xs transition hover:bg-linen-50 disabled:opacity-50 ${
                        isSelected || isDefault
                          ? "font-semibold text-foreground"
                          : "font-medium text-muted-foreground"
                      } ${isSelected ? "bg-linen-100/70" : ""}`}
                    >
                      {opt.label}
                      {isDefault && !isSelected && (
                        <span className="ml-2 text-[9px] uppercase tracking-wider text-muted-foreground">
                          default
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Inline error */}
            {summaryError && (
              <p className="text-[11px] text-red-500 animate-in fade-in duration-200">
                {summaryError}
              </p>
            )}

            {/* Summary result card */}
            {summaryResult && (
              <div className="rounded-2xl border border-linen-200 bg-card/80 p-3 space-y-2 animate-in fade-in duration-300">
                {/* Dismiss */}
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs leading-relaxed text-foreground flex-1">
                    {summaryResult.summary}
                  </p>
                  <button
                    onClick={() => setSummaryResult(null)}
                    className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground transition"
                    aria-label="Dismiss summary"
                  >
                    ✕
                  </button>
                </div>

                {/* Bullet points */}
                {summaryResult.bulletPoints.length > 0 ? (
                  <ul className="space-y-1">
                    {summaryResult.bulletPoints.map((pt, i) => (
                      <li
                        key={i}
                        className="flex gap-1.5 text-[11px] leading-relaxed text-muted-foreground"
                      >
                        <span className="shrink-0 text-foreground/60">•</span>
                        <span>{pt}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[11px] italic text-muted-foreground">
                    No messages to summarise yet.
                  </p>
                )}

                {/* Participants */}
                {summaryResult.participants.length > 0 && (
                  <p className="text-[10px] text-muted-foreground">
                    <span className="font-medium text-foreground/70">Participants: </span>
                    {summaryResult.participants.join(", ")}
                  </p>
                )}

                {/* Date range */}
                {summaryResult.dateRange?.from && summaryResult.dateRange?.to && (
                  <p className="text-[10px] text-muted-foreground">
                    <span className="font-medium text-foreground/70">Date range: </span>
                    {formatDateReadable(summaryResult.dateRange.from)}
                    {" → "}
                    {formatDateReadable(summaryResult.dateRange.to)}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── AI CHAT ── */}
          <div className="space-y-3">
            {renderReminders()}
            <div className="flex items-center justify-between">
              <h4 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Zen AI
              </h4>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setChatExpanded((prev) => !prev)}
                  className="flex size-7 items-center justify-center rounded-full border border-linen-200 bg-card text-muted-foreground transition hover:text-foreground"
                  title={chatExpanded ? "Collapse AI panel" : "Expand AI panel"}
                  aria-label={chatExpanded ? "Collapse AI panel" : "Expand AI panel"}
                >
                  {chatExpanded ? (
                    <svg
                      viewBox="0 0 24 24"
                      className="size-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="6 7 11 12 6 17" />
                      <polyline points="13 7 18 12 13 17" />
                    </svg>
                  ) : (
                    <svg
                      viewBox="0 0 24 24"
                      className="size-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="18 7 13 12 18 17" />
                      <polyline points="11 7 6 12 11 17" />
                    </svg>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setCollapsed(true)}
                  className="rounded-full border border-linen-200 bg-card px-2 py-1 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground transition hover:text-foreground"
                  title="Collapse AI panel"
                >
                  Hide
                </button>
              </div>
            </div>

            {/* Chat thread */}
            {renderChatThread("min-h-[120px] max-h-[320px]")}

            {/* Chat input */}
            {renderChatInput()}
          </div>
        </div>
      </div>
      {chatExpanded && (
        <div className="fixed inset-y-0 left-72 right-0 z-40 flex flex-col bg-linen-50 xl:left-80">
          <div className="flex items-center gap-3 border-b border-linen-200 bg-white/80 px-6 py-4">
            <div className="flex size-10 items-center justify-center rounded-xl bg-breeze/10 text-breeze">
              <svg
                viewBox="0 0 24 24"
                className="size-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1.27A7 7 0 0 1 14 23h-4a7 7 0 0 1-6.73-4H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z" />
                <circle cx="9" cy="15" r="1" />
                <circle cx="15" cy="15" r="1" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Zen AI</h2>
              <p className="text-[11px] text-muted-foreground">AI chat, reminders, and drafting</p>
            </div>
            <button
              type="button"
              onClick={() => setChatExpanded(false)}
              className="ml-auto flex size-8 items-center justify-center rounded-lg border border-linen-200 bg-white text-muted-foreground transition hover:text-foreground"
              title="Close AI chat"
              aria-label="Close AI chat"
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
                <polyline points="6 7 11 12 6 17" />
                <polyline points="13 7 18 12 13 17" />
              </svg>
            </button>
          </div>
          <div className="flex flex-1 flex-col gap-4 overflow-hidden p-6">
            {renderReminders()}
            {renderChatThread("flex-1")}
            {renderChatInput("bg-white")}
          </div>
        </div>
      )}
    </aside>
  );
}
