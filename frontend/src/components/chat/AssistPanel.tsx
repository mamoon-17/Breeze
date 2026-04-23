// Right-side AI assist panel. UI-only for now — Breeze backend doesn't yet
// expose AI endpoints. Marked clearly as "preview".

import { useState } from "react";
import { toast } from "sonner";

interface Props {
  conversationTitle: string;
  messageCount: number;
  readReceipts: Record<string, string>;
}

const SUGGESTIONS = [
  {
    title: "Confirm warmly",
    body: "Sounds great — let's lock that in.",
  },
  {
    title: "Buy time",
    body: "Give me an hour to think it over and I'll come back with a plan.",
  },
  {
    title: "Soft no",
    body: "I'd love to but the timing isn't quite right — can we revisit next week?",
  },
];

export function AssistPanel({ conversationTitle, messageCount }: Props) {
  const [summary, setSummary] = useState<string | null>(null);

  const fakeSummarize = () => {
    if (messageCount === 0) {
      toast("Nothing to summarize yet.");
      return;
    }
    setSummary(
      `${conversationTitle} · ${messageCount} message${messageCount === 1 ? "" : "s"} so far. The thread is about to evolve — connect the agent endpoint to enable real summarization.`,
    );
  };

  return (
    <aside className="hidden w-80 shrink-0 flex-col border-l border-linen-200 bg-linen-100/50 lg:flex">
      <div className="flex-1 space-y-6 overflow-y-auto p-6 scroll-soft">
        <div>
          <div className="flex items-center gap-2">
            <span className="size-1.5 animate-pulse rounded-full bg-breeze" />
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Gentle Assist
            </h4>
            <span className="ml-auto rounded-full bg-card px-2 py-0.5 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
              Preview
            </span>
          </div>
          <p className="mt-3 rounded-2xl border border-linen-200 bg-card/80 p-4 text-xs italic leading-relaxed text-muted-foreground">
            {summary ??
              "Breeze's agent will summarize this thread and surface gentle replies once you connect an AI endpoint."}
          </p>
        </div>

        <div className="space-y-3">
          <h4 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Suggestions
          </h4>
          {SUGGESTIONS.map((s) => (
            <button
              key={s.title}
              onClick={() => {
                navigator.clipboard?.writeText(s.body).catch(() => {});
                toast.success("Copied — paste into the composer");
              }}
              className="group block w-full rounded-xl border border-linen-200 bg-card p-3 text-left text-xs transition hover:border-breeze"
            >
              <span className="block font-semibold text-foreground">
                {s.title}
              </span>
              <span className="mt-1 block leading-snug text-muted-foreground">
                {s.body}
              </span>
            </button>
          ))}
        </div>

        <div className="space-y-2 pt-2">
          <button
            onClick={fakeSummarize}
            className="w-full rounded-xl border border-linen-200 bg-card px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-foreground transition hover:bg-linen-50"
          >
            Summarize thread
          </button>
          <button
            onClick={() => toast("Connect an AI endpoint to enable Enhance.")}
            className="w-full rounded-xl border border-linen-200 bg-card px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-foreground transition hover:bg-linen-50"
          >
            Enhance tone
          </button>
        </div>
      </div>

      <div className="border-t border-linen-200 p-6">
        <div className="flex items-center gap-3 rounded-2xl bg-linen-200/60 px-4 py-3">
          <div className="size-2 rounded-full bg-muted-foreground" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Zen mode
          </span>
        </div>
      </div>
    </aside>
  );
}
