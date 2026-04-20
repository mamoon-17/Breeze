import {
  createFileRoute,
  Outlet,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/breeze/auth-context";
import { getRefreshToken } from "@/lib/breeze/api";

export const Route = createFileRoute("/_authenticated")({
  component: AuthLayout,
});

function AuthLayout() {
  const { status } = useAuth();
  const navigate = useNavigate();

  // Only bounce to the landing page when we're sure the user has no session
  // at all — i.e. status is "guest" AND there's no refresh token sitting in
  // localStorage that we could still use to bootstrap auth. Without this
  // guard, a freshly-landed page can momentarily report "guest" before the
  // AuthProvider's mount effect finishes calling /auth/me, which would kick
  // a just-signed-in user straight back to `/`.
  useEffect(() => {
    if (status === "guest" && !getRefreshToken()) {
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
