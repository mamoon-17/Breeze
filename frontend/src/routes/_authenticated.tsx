import {
  createFileRoute,
  Outlet,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/breeze/auth-context";
import { getRefreshToken, setTokens } from "@/lib/breeze/api";

export const Route = createFileRoute("/_authenticated")({
  component: AuthLayout,
});

function AuthLayout() {
  const { status } = useAuth();
  const navigate = useNavigate();
  const wasAuthenticated = useRef(false);

  // Track whether we've ever been authenticated in this mount; used below
  // to distinguish "session just expired" from "never signed in".
  useEffect(() => {
    if (status === "authenticated") {
      wasAuthenticated.current = true;
    }
  }, [status]);

  // Bounce to the landing page when we're sure the user has no session at
  // all — i.e. status is "guest" AND there's no refresh token. Without the
  // `!refreshToken` guard, a freshly-landed page would flash guest before
  // /auth/me returns, which would eject a just-signed-in user.
  //
  // Also handles the case where the refresh token is stale in localStorage
  // but /auth/me returned 401 and the refresh endpoint also failed. In that
  // scenario status flips to "guest" but the stale refresh token may still
  // sit in localStorage, so we clear it explicitly.
  useEffect(() => {
    if (status === "guest") {
      // Clear any stale refresh token still in localStorage
      if (getRefreshToken()) {
        setTokens(null);
      }
      if (wasAuthenticated.current) {
        toast.error("Your session expired — please sign in again");
      }
      navigate({ to: "/" });
    }
  }, [status, navigate]);

  // Safety net: if auth stays "loading" for more than 8 seconds, the refresh
  // is probably dead. Force-clear and redirect so the user isn't stuck on an
  // infinite spinner wondering why the app "isn't working".
  useEffect(() => {
    if (status !== "loading") return;
    const timer = setTimeout(() => {
      if (getRefreshToken()) {
        setTokens(null); // triggers onTokensChange → guest
      }
    }, 8000);
    return () => clearTimeout(timer);
  }, [status]);

  if (status === "loading" || status === "guest") {
    return (
      <div className="flex h-dvh items-center justify-center">
        <div className="size-3 animate-pulse rounded-full bg-breeze" />
      </div>
    );
  }

  return (
    <div className="h-dvh overflow-hidden bg-background">
      <Outlet />
    </div>
  );
}
