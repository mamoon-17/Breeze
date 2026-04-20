import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Auth,
  getRefreshToken,
  onTokensChange,
  setTokens,
  type ApiError,
} from "./api";
import { disconnectSocket } from "./socket";
import type { AuthTokens, BreezeUser } from "./types";

interface AuthState {
  user: BreezeUser | null;
  status: "loading" | "authenticated" | "guest";
  isAuthenticated: boolean;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setSession: (tokens: AuthTokens, user?: BreezeUser | null) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<BreezeUser | null>(null);
  const [status, setStatus] = useState<AuthState["status"]>("loading");

  const fetchMe = useCallback(async () => {
    try {
      const { user: me } = await Auth.me();
      setUser(me);
      setStatus("authenticated");
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr?.status === 401) {
        setUser(null);
        setStatus("guest");
      } else {
        setStatus("guest");
      }
    }
  }, []);

  useEffect(() => {
    if (getRefreshToken()) {
      void fetchMe();
    } else {
      setStatus("guest");
    }
  }, [fetchMe]);

  // If tokens get cleared mid-session (e.g. refresh failed on the socket
  // layer after an `authExpired` kick), transition the UI to guest and
  // tear down the socket.
  useEffect(() => {
    const off = onTokensChange((t) => {
      if (t === null) {
        setUser(null);
        setStatus("guest");
        disconnectSocket();
      }
    });
    return () => {
      off();
    };
  }, []);

  const signOut = useCallback(async () => {
    try {
      await Auth.logout();
    } catch {
      // ignore
    }
    setTokens(null);
    setUser(null);
    setStatus("guest");
    disconnectSocket();
  }, []);

  const setSession = useCallback(
    (tokens: AuthTokens, maybeUser?: BreezeUser | null) => {
      setTokens(tokens);
      if (maybeUser) {
        setUser(maybeUser);
        setStatus("authenticated");
      } else {
        // Flip UI to "loading" while /auth/me is in flight so protected
        // routes show a spinner instead of flashing the guest screen.
        setStatus("loading");
        void fetchMe();
      }
    },
    [fetchMe],
  );

  const value = useMemo<AuthState>(
    () => ({
      user,
      status,
      isAuthenticated: status === "authenticated",
      signOut,
      refreshUser: fetchMe,
      setSession,
    }),
    [user, status, signOut, fetchMe, setSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
