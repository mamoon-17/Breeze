import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";
import { useAuth } from "@/lib/breeze/auth-context";
import { Auth } from "@/lib/breeze/api";

function goTo(url: string) {
  if (typeof window !== "undefined") window.location.href = url;
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Breeze — calm, AI-powered messaging" },
      {
        name: "description",
        content:
          "An AI agent that summarizes chats, enhances messages, and manages conversations on your behalf.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { isAuthenticated, status } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated) navigate({ to: "/app" });
  }, [isAuthenticated, navigate]);

  const handleSignIn = useCallback(() => {
    goTo(Auth.googleSignInUrl());
  }, []);

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background">
      {/* Soft atmospheric background */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60rem 40rem at 80% -10%, color-mix(in oklab, var(--breeze) 22%, transparent), transparent 60%), radial-gradient(50rem 30rem at -10% 110%, color-mix(in oklab, var(--breeze-soft) 60%, transparent), transparent 60%)",
        }}
      />

      <header className="glass sticky top-0 z-10 flex h-16 items-center border-b border-linen-200 px-6 md:px-10">
        <Link to="/" className="flex items-center gap-2">
          <BreezeMark />
          <span className="text-lg font-semibold tracking-tight">breeze</span>
        </Link>
        <nav className="ml-auto hidden items-center gap-7 text-sm text-muted-foreground md:flex">
          <a href="#features" className="hover:text-foreground transition-colors">
            Features
          </a>
          <a href="#agent" className="hover:text-foreground transition-colors">
            The agent
          </a>
          <a
            href="https://github.com/mamoon-17/Breeze"
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground transition-colors"
          >
            GitHub
          </a>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-24 pt-16 md:px-10 md:pt-28">
        <section className="grid items-center gap-12 md:grid-cols-[1.2fr_1fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-linen-200 bg-card/70 px-3 py-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              <span className="size-1.5 rounded-full bg-breeze" /> AI-powered
              messaging
            </span>
            <h1 className="mt-6 font-display text-5xl leading-[1.05] text-foreground md:text-6xl lg:text-7xl">
              Conversations that feel like an exhale.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
              Breeze is messaging with a quiet intelligence. A smart agent
              summarizes long threads, enhances your replies, and gently keeps
              your inbox in flow — across DMs, groups, and calls.
            </p>
            <div className="mt-8">
              <button
                onClick={handleSignIn}
                className="inline-flex items-center gap-3 rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-soft transition hover:bg-linen-600"
              >
                <GoogleIcon className="size-4" />
                Sign in with Google
              </button>
            </div>
            {status === "loading" && (
              <p className="mt-4 text-xs text-muted-foreground">
                Checking your session…
              </p>
            )}
          </div>

          <PreviewCard />
        </section>

        <section id="features" className="mt-32">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            What's inside
          </p>
          <h2 className="mt-3 max-w-2xl font-display text-4xl text-foreground md:text-5xl">
            Real-time, end-to-end. Quietly intelligent.
          </h2>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            <Feature
              eyebrow="Live"
              title="Real-time chat"
              body="Direct messages and group conversations, delivered instantly over a WebSocket gateway with read receipts and presence."
            />
            <Feature
              eyebrow="Agent"
              title="Acts on your behalf"
              body="Summarize threads, enhance tone, and surface gentle replies. The agent quietly keeps you in flow."
            />
            <Feature
              eyebrow="Trust"
              title="Security-first auth"
              body="Google OAuth with refresh-token rotation, anomaly detection, step-up auth, and per-device session controls."
            />
          </div>
        </section>

        <section id="agent" className="mt-28 rounded-3xl border border-linen-200 bg-card/70 p-8 md:p-12">
          <div className="grid gap-10 md:grid-cols-[1fr_1.2fr] md:items-center">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                The agent
              </p>
              <h3 className="mt-3 font-display text-3xl text-foreground md:text-4xl">
                A quiet co-pilot for every conversation.
              </h3>
              <p className="mt-4 text-muted-foreground">
                Breeze's agent reads context, drafts replies in your voice, and
                summarizes long threads at a glance. You stay present — it
                handles the noise.
              </p>
            </div>
            <ul className="space-y-3 text-sm">
              {[
                "Summarize a thread back to its essential pillars",
                "Enhance tone — clearer, warmer, more precise",
                "Suggest replies grounded in the conversation",
                "Catch follow-ups you might otherwise miss",
              ].map((line) => (
                <li
                  key={line}
                  className="flex items-start gap-3 rounded-2xl border border-linen-200 bg-background/60 p-4"
                >
                  <span className="mt-2 inline-block size-1.5 shrink-0 rounded-full bg-breeze" />
                  <span className="text-foreground">{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <footer className="mt-24 flex flex-col items-center justify-between gap-3 border-t border-linen-200 pt-8 text-xs text-muted-foreground md:flex-row">
          <span>© Breeze. Built on a NestJS backend.</span>
          <span>Calm, by design.</span>
        </footer>
      </main>
    </div>
  );
}

function Feature({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-3xl border border-linen-200 bg-card/70 p-6 shadow-soft transition hover:bg-card">
      <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-breeze">
        {eyebrow}
      </span>
      <h3 className="mt-3 text-lg font-semibold text-foreground">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {body}
      </p>
    </div>
  );
}

function PreviewCard() {
  return (
    <div className="relative">
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-breeze-soft/40 blur-2xl" />
      <div className="overflow-hidden rounded-3xl border border-linen-200 bg-card shadow-soft">
        <div className="flex items-center gap-2 border-b border-linen-200 px-4 py-3">
          <span className="size-2 rounded-full bg-breeze" />
          <span className="text-xs font-medium text-muted-foreground">
            Soren Nielsen · in the flow
          </span>
        </div>
        <div className="space-y-4 p-5">
          <div className="max-w-[80%] rounded-3xl rounded-tl-none border border-linen-100 bg-linen-50 px-4 py-3 text-sm">
            The vision proposal looks clean — the tactile feedback is exactly
            what we discussed.
          </div>
          <div className="ml-auto max-w-[80%] rounded-3xl rounded-tr-none bg-breeze px-4 py-3 text-sm text-white shadow-bubble">
            Glad it landed. I focused on reducing the visual noise.
          </div>
          <div className="rounded-2xl border border-linen-200 bg-linen-100/60 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Gentle assist
            </p>
            <p className="mt-1 text-xs italic text-muted-foreground">
              Soren is asking to confirm a Thursday demo. Reply: "Thursday
              works — I'll prep the assets."
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function BreezeMark() {
  return (
    <span className="inline-flex size-7 items-center justify-center rounded-xl bg-primary text-primary-foreground">
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M3 9c4 0 4-3 8-3s4 3 8 3" />
        <path d="M3 15c4 0 4-3 8-3s4 3 8 3" />
      </svg>
    </span>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.6 8.4 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35 26.7 36 24 36c-5.2 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C40.9 35.5 44 30.2 44 24c0-1.3-.1-2.3-.4-3.5z"
      />
    </svg>
  );
}
