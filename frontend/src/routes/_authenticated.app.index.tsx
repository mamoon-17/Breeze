import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/app/")({
  component: EmptyState,
});

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-breeze-soft">
        <svg
          viewBox="0 0 24 24"
          className="size-8 text-breeze"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
      <div>
        <h2 className="text-xl font-semibold text-foreground">
          Welcome to Breeze
        </h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Select a conversation to start messaging. Your chats are fast, simple,
          and effortless.
        </p>
      </div>
    </div>
  );
}
