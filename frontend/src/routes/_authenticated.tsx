import {
  createFileRoute,
  Outlet,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAuth } from "@/lib/breeze/auth-context";
import { getRefreshToken } from "@/lib/breeze/api";

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
  // The socket layer handles its own mid-session re-auth (see
  // `frontend/src/lib/breeze/socket.ts`): on an `authExpired` event or an
  // auth-shaped `connect_error`, it tries to refresh once; if that fails,
  // `setTokens(null)` fires and auth-context flips to guest — which lands
  // us here. That's when `wasAuthenticated.current` tells us to show the
  // "session expired" toast instead of a silent redirect.
  useEffect(() => {
    if (status === "guest" && !getRefreshToken()) {
      if (wasAuthenticated.current) {
        toast.error("Your session expired — please sign in again");
      }
      navigate({ to: "/" });
    }
  }, [status, navigate]);

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
