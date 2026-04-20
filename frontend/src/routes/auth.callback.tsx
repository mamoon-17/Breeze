// OAuth callback handler.
// The backend's /auth/google/callback returns JSON with { tokens }.
// In a typical browser flow, it might either:
//   1) redirect back to the frontend with #accessToken=...&refreshToken=... in the hash, OR
//   2) set httpOnly cookies and redirect back without a payload.
// We handle both: read the hash if present, otherwise call /auth/me to confirm.

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/breeze/auth-context";
import { setTokens } from "@/lib/breeze/api";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallback,
});

function AuthCallback() {
  const navigate = useNavigate();
  const { setSession, refreshUser } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const finish = async () => {
      // Try hash first
      const hash =
        typeof window !== "undefined" && window.location.hash
          ? window.location.hash.slice(1)
          : "";
      const hashParams = new URLSearchParams(hash);
      const search =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search)
          : new URLSearchParams();

      const accessToken =
        hashParams.get("accessToken") ?? search.get("accessToken");
      const refreshToken =
        hashParams.get("refreshToken") ?? search.get("refreshToken");
      const accessTokenExpiresIn = Number(
        hashParams.get("accessTokenExpiresIn") ??
          search.get("accessTokenExpiresIn") ??
          "0",
      );
      const refreshTokenExpiresIn = Number(
        hashParams.get("refreshTokenExpiresIn") ??
          search.get("refreshTokenExpiresIn") ??
          "0",
      );

      if (accessToken && refreshToken) {
        setSession({
          accessToken,
          refreshToken,
          accessTokenExpiresIn,
          refreshTokenExpiresIn,
        });
        // Hard-navigate to /app so the entire React tree remounts with the
        // fresh refresh token already in localStorage. This sidesteps every
        // timing race between the SPA navigation, the AuthProvider mount
        // effect, and the protected layout's guest-redirect effect.
        if (typeof window !== "undefined") {
          window.location.replace("/app");
        }
        return;
      }

      // Cookie flow: confirm the session, then hard-navigate.
      try {
        await refreshUser();
        if (typeof window !== "undefined") {
          window.location.replace("/app");
        } else {
          navigate({ to: "/app" });
        }
      } catch {
        setError("We couldn't verify your sign-in. Please try again.");
      }
    };

    void finish();
    // We intentionally only run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        {error ? (
          <>
            <h1 className="font-display text-3xl text-foreground">
              Sign-in interrupted
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">{error}</p>
            <button
              onClick={() => navigate({ to: "/" })}
              className="mt-6 inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Back home
            </button>
          </>
        ) : (
          <>
            <div className="mx-auto size-3 animate-pulse rounded-full bg-breeze" />
            <p className="mt-4 text-sm text-muted-foreground">
              Catching the breeze…
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// Defensive: if backend sets tokens via cookies and never redirects with hash,
// we still want to make sure no stale state leaks in.
export function clearAnyStaleTokens() {
  setTokens(null);
}
