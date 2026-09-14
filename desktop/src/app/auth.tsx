import * as React from 'react';
import {
  clearAuthSession,
  getCachedAccessToken,
  getCachedStoredUser,
  loadSession,
  setAuthSession,
  type AuthUser,
} from '@/lib/auth';
import { fetchMe, loginUser, registerUser } from '@/lib/api';

interface AuthContextValue {
  /** Currently signed-in user, or `null` when signed out. */
  user: AuthUser | null;
  /** Current access token (used by admin-only features such as the audit log). */
  token: string | null;
  /** `true` while an existing session is being validated on startup. */
  isLoading: boolean;
  /** True when the session was restored from storage at startup (not a fresh login). */
  restoredSession: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  register: (email: string, password: string, displayName?: string) => Promise<AuthUser>;
  logout: () => void;
}

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [token, setToken] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [restoredSession, setRestoredSession] = React.useState(false);

  // Hydrate the session (keyring/localStorage into the memory cache) and validate it
  // on startup. If the access token is stale the request layer refreshes it
  // automatically. A hard failure signs the user out.
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      await loadSession();
      const accessToken = getCachedAccessToken();
      const cachedUser = getCachedStoredUser();
      if (!accessToken) {
        if (mounted) {
          setToken(null);
          setUser(null);
          setIsLoading(false);
        }
        return;
      }
      if (cachedUser) setUser(cachedUser);
      if (mounted) setRestoredSession(true);
      try {
        const me = await fetchMe(accessToken);
        if (mounted) setUser(me);
      } catch {
        // Failing to validate must not sign the user out. The request layer
        // clears the session only when the refresh token is genuinely
        // rejected, and an offline start should keep the cached user — so the
        // session is only dropped when it is really gone.
        if (mounted && !getCachedAccessToken()) setUser(null);
      } finally {
        if (mounted) setIsLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Keep React state in sync with session changes from the API layer
  // (automatic refresh, or a cleared session after refresh failure).
  React.useEffect(() => {
    const sync = () => {
      setToken(getCachedAccessToken());
      setUser(getCachedStoredUser());
      if (!getCachedAccessToken()) setIsLoading(false);
    };
    window.addEventListener('pudim:auth-changed', sync);
    return () => window.removeEventListener('pudim:auth-changed', sync);
  }, []);

  const login = React.useCallback(async (email: string, password: string) => {
    const res = await loginUser({ email, password });
    await setAuthSession(res.access_token, res.refresh_token, res.user);
    setUser(res.user);
    setToken(res.access_token);
    setRestoredSession(false);
    return res.user;
  }, []);

  const register = React.useCallback(
    async (email: string, password: string, displayName?: string) => {
      const res = await registerUser({
        email,
        password,
        display_name: displayName?.trim() || null,
      });
      await setAuthSession(res.access_token, res.refresh_token, res.user);
      setUser(res.user);
      setToken(res.access_token);
      setRestoredSession(false);
      return res.user;
    },
    [],
  );

  const logout = React.useCallback(() => {
    void clearAuthSession().then(() => {
      setUser(null);
      setToken(null);
    });
  }, []);

  const value = React.useMemo<AuthContextValue>(
    () => ({ user, token, isLoading, restoredSession, login, register, logout }),
    [user, token, isLoading, restoredSession, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
