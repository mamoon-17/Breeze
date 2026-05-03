// Right-side AI assist panel with Mood Enhancer + AI Chat.

import { useState, useRef, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Ai } from "@/lib/breeze/api";
import type { AiIntentResult, AiMessageWriterJob, SummaryResult } from "@/lib/breeze/api";

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
  kind?: "chat" | "status";
}

interface Props {
  conversationTitle: string;
  messageCount: number;
  readReceipts: Record<string, string>;
  composerDraft: string;
  setComposerDraft: (text: string) => void;
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
    .filter((m) => m.kind !== "status")
    .map((m) => ({ role: m.role, content: m.content }));
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

// ─── Component ───────────────────────────────────────────────────────────────

export function AssistPanel({
  conversationTitle,
  messageCount,
  composerDraft,
  setComposerDraft,
  conversationId,
}: Props) {
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
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatLoading]);

  // Cleanup restore timer on unmount
  useEffect(() => {
    return () => {
      if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current);
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
      const text = composerDraft.trim();
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
        setComposerDraft(enhancedText);

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
      setComposerDraft(originalText);
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
      const intent = await Ai.intent(text);
      if (intent.action === "send_message") {
        await handleSendIntent(intent, text);
      } else {
        const { reply } = await Ai.chat(buildAiChatHistory(newMessages));
        setChatMessages((prev) => [...prev, { role: "assistant", content: reply, kind: "chat" }]);
      }
    } catch (err) {
      console.error(err);
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, I couldn't respond right now. Please try again.",
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
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Who should I send that to? You can use a name or email.",
          kind: "status",
        },
      ]);
      return;
    }

    setChatMessages((prev) => [
      ...prev,
      { role: "assistant", content: "Sending your message...", kind: "status" },
    ]);

    const { jobId } = await Ai.messageWriter(payload);
    const job = await pollMessageWriterJob(jobId);
    if (!job) {
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Queued in the background. I'll keep sending it.",
          kind: "status",
        },
      ]);
      return;
    }

    setChatMessages((prev) => [
      ...prev,
      { role: "assistant", content: summarizeWriterJob(job), kind: "status" },
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

  return (
    <aside className="hidden w-80 shrink-0 flex-col border-l border-linen-200 bg-linen-100/50 lg:flex">
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
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Breeze Assistant
            </h4>

            {/* Chat thread */}
            <div className="max-h-[300px] min-h-[120px] overflow-y-auto rounded-2xl border border-linen-200 bg-card/60 p-3 scroll-soft">
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
                    key={i}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                        msg.role === "user"
                          ? "bg-breeze/90 text-white"
                          : "bg-linen-200/80 text-foreground"
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}
                {/* Typing indicator */}
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

            {/* Chat input */}
            <div className="flex items-center gap-2 rounded-xl border border-linen-200 bg-card p-1.5">
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
                placeholder="Ask Breeze Assistant..."
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
          </div>
        </div>
      </div>
    </aside>
  );
}
