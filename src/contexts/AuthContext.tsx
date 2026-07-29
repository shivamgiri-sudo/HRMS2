import { createContext, useContext, useCallback, useEffect, useRef, useState, ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getDemoCred, buildDemoSession } from "@/lib/demoCreds";
import { apiUrl } from "@/lib/apiBase";
import { useInactivityTimeout } from "@/hooks/useInactivityTimeout";

export interface HrmsUser {
  id: string;
  email: string;
  isReadOnly?: boolean;
}

interface AuthContextType {
  user: HrmsUser | null;
  isLoading: boolean;
  isSigningOut: boolean;
  mustChangePassword: boolean;
  twoFactorRequired: boolean;
  twoFactorVerified: boolean;
  signIn: (identifier: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName: string, onboardingToken?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  forgotPassword: (email: string) => Promise<{ error: Error | null; smtpNotConfigured?: boolean }>;
  completePasswordChange: () => void;
  sendTwoFactorCode: (channel: "email" | "sms") => Promise<{ error: Error | null }>;
  verifyTwoFactorCode: (otp: string) => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const DEMO_LOGIN_ENABLED = import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEMO_LOGIN === 'true';
const AUTH_REQUEST_TIMEOUT_MS = 20000;

async function parseJsonResponse(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(res.ok ? 'Server returned an invalid response.' : 'Server returned an invalid error response.');
  }
}

async function fetchJson(
  path: string,
  init: RequestInit,
  timeoutMs = AUTH_REQUEST_TIMEOUT_MS,
): Promise<{ ok: boolean; status: number; payload: any }> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(apiUrl(path), {
      ...init,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...init.headers,
      },
      signal: controller.signal,
    });
    const payload = await parseJsonResponse(res);
    return { ok: res.ok, status: res.status, payload };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function decodeJwtUser(token: string): HrmsUser | null {
  try {
    const [, b64] = token.split('.');
    const payload = JSON.parse(atob(b64.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload?.sub && payload?.exp && payload.exp * 1000 > Date.now()) {
      return {
        id: payload.sub,
        email: payload.email ?? '',
        isReadOnly: payload.is_read_only === true || payload.isReadOnly === true,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// Codes that mean the server has deliberately revoked the session.
// On these we must clear local auth state. Anything else (network error,
// server restart, 5xx) is transient — we leave the session alive and retry.
const DEFINITIVE_LOGOUT_CODES = new Set([
  'TOKEN_REUSED', 'PASSWORD_CHANGED', 'USER_BLOCKED', 'EMPLOYEE_INACTIVE',
  'TOKEN_INVALID',
]);

// Returns the decoded user on success, null on transient failure,
// and throws a special sentinel on definitive server rejection.
const DEFINITIVE_LOGOUT = Symbol('DEFINITIVE_LOGOUT');

async function tryRefresh(): Promise<HrmsUser | null | typeof DEFINITIVE_LOGOUT> {
  try {
    const { ok, status, payload } = await fetchJson('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!ok) {
      const code: string | undefined = payload?.code;
      const isDefinitive =
        payload?.logoutRequired === true ||
        (code != null && DEFINITIVE_LOGOUT_CODES.has(code)) ||
        status === 401;
      if (isDefinitive) {
        localStorage.removeItem('hrms_access_token');
        localStorage.removeItem('hrms_refresh_token');
        localStorage.removeItem('hrms_must_change_password');
        localStorage.removeItem('hrms_2fa_required');
        localStorage.removeItem('hrms_2fa_verified');
        return DEFINITIVE_LOGOUT;
      }
      // Transient (5xx, network, timeout) — keep the session alive
      return null;
    }
    const { data } = payload ?? {};
    localStorage.setItem('hrms_access_token', data.accessToken);
    return decodeJwtUser(data.accessToken);
  } catch {
    // Network or parse error — treat as transient, do not logout
    return null;
  }
}

// Returns how many ms until the stored access token expires.
// Returns 0 if the token is missing or already expired.
function msUntilTokenExpiry(): number {
  try {
    const token = localStorage.getItem('hrms_access_token');
    if (!token) return 0;
    const [, b64] = token.split('.');
    const { exp } = JSON.parse(atob(b64.replace(/-/g, '+').replace(/_/g, '/')));
    return Math.max(0, exp * 1000 - Date.now());
  } catch {
    return 0;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<HrmsUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(() => {
    // Only honour the flag when a session token actually exists.
    // Without a token there is no authenticated session, so the flag is stale.
    const hasToken = !!localStorage.getItem('hrms_access_token') || !!localStorage.getItem('hrms_refresh_token');
    if (!hasToken) {
      localStorage.removeItem('hrms_must_change_password');
      return false;
    }
    return localStorage.getItem('hrms_must_change_password') === 'true';
  });
  const [twoFactorRequired, setTwoFactorRequired] = useState(() => {
    const hasToken = !!localStorage.getItem('hrms_access_token') || !!localStorage.getItem('hrms_refresh_token');
    if (!hasToken) {
      localStorage.removeItem('hrms_2fa_required');
      localStorage.removeItem('hrms_2fa_verified');
      return false;
    }
    return localStorage.getItem('hrms_2fa_required') === 'true';
  });
  const [twoFactorVerified, setTwoFactorVerified] = useState(() => {
    const hasToken = !!localStorage.getItem('hrms_access_token') || !!localStorage.getItem('hrms_refresh_token');
    if (!hasToken) return false;
    return localStorage.getItem('hrms_2fa_verified') === 'true';
  });
  const queryClient = useQueryClient();
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clears auth state and stops the refresh timer.
  const clearAuthState = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  // Schedules a single proactive refresh to fire 5 minutes before the token expires.
  // If the token already has <6 minutes left, fires in 30 seconds.
  // On definitive server rejection, clears auth state (user logged out server-side).
  // On transient failure, schedules a retry in 60 seconds without touching the session.
  const scheduleRefresh = useCallback((delayOverrideMs?: number) => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    const EARLY_MS = 5 * 60 * 1000; // fire 5 min before expiry
    const delay = delayOverrideMs ?? Math.max(30_000, msUntilTokenExpiry() - EARLY_MS);

    refreshTimerRef.current = setTimeout(async () => {
      refreshTimerRef.current = null;
      const result = await tryRefresh();
      if (result === DEFINITIVE_LOGOUT) {
        clearAuthState();
        return;
      }
      if (result === null) {
        // Transient failure — retry in 60 seconds without logging the user out
        scheduleRefresh(60_000);
        return;
      }
      // Success — decoded user from new token; reschedule for next expiry
      setUser(result);
      scheduleRefresh();
    }, delay);
  }, [clearAuthState]);

  useEffect(() => {
    const init = async () => {
      // Real JWT tokens always take priority over demo sessions
      const token = localStorage.getItem('hrms_access_token');
      if (token) {
        const decoded = decodeJwtUser(token);
        if (decoded) {
          // Clear any lingering demo session when real JWT is present
          localStorage.removeItem('hrms_demo_session');
          setUser(decoded);
          setIsLoading(false);
          scheduleRefresh();
          return;
        }
        // Token exists but is expired — attempt silent refresh
        localStorage.removeItem('hrms_access_token');
        const result = await tryRefresh();
        if (result !== null && result !== DEFINITIVE_LOGOUT) {
          setUser(result);
          setIsLoading(false);
          scheduleRefresh();
          return;
        }
        if (result !== DEFINITIVE_LOGOUT) {
          // Transient failure on boot — still clear the stale token but do not
          // destroy the refresh cookie; the user will be prompted to log in
          localStorage.removeItem('hrms_refresh_token');
        }
      }

      // Demo sessions are only checked if no real JWT token exists and local demo mode is explicit.
      if (DEMO_LOGIN_ENABLED) {
        const demoRaw = localStorage.getItem('hrms_demo_session');
        if (demoRaw) {
          try {
            const demo = JSON.parse(demoRaw);
            if (demo?.user?.id) {
              setUser({ id: demo.user.id, email: demo.user.email ?? '' });
              setIsLoading(false);
              return;
            }
          } catch {
            localStorage.removeItem('hrms_demo_session');
          }
        }
      } else {
        localStorage.removeItem('hrms_demo_session');
      }

      setUser(null);
      setIsLoading(false);
    };

    init();

    // Re-check token when the tab regains focus after being idle (e.g. overnight).
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      const token = localStorage.getItem('hrms_access_token');
      if (!token) return;
      const ttl = msUntilTokenExpiry();
      // If token expires within the next 6 minutes, trigger a proactive refresh now
      if (ttl < 6 * 60 * 1000) {
        scheduleRefresh(0);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // hrmsApi rotated the token inline (on a 401 retry) — reschedule our timer
    // so both code paths stay in sync on the same expiry clock.
    const handleTokenRefreshed = () => scheduleRefresh();
    window.addEventListener('hrms:token-refreshed', handleTokenRefreshed);

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('hrms:token-refreshed', handleTokenRefreshed);
    };
  }, [scheduleRefresh]);

  // Auto-logout disabled — inactivity timeout hardcoded to 0 (no-op)
  useInactivityTimeout(0, async () => { /* disabled */ });

  const signIn = async (identifier: string, password: string): Promise<{ error: Error | null }> => {
    if (DEMO_LOGIN_ENABLED) {
      const demoCred = getDemoCred(identifier);
      if (demoCred) {
        if (password !== demoCred.password) {
          return { error: new Error('Incorrect password for demo account') };
        }
        const mockSession = buildDemoSession(demoCred);
        localStorage.setItem('hrms_demo_session', JSON.stringify(mockSession));
        setUser({ id: mockSession.user.id, email: mockSession.user.email });
        queryClient.invalidateQueries();
        return { error: null };
      }
    }

    try {
      const { ok, payload } = await fetchJson('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });
      if (!ok) {
        return { error: new Error(payload?.error || payload?.message || 'Authentication failed') };
      }
      const { accessToken, refreshToken, user: authUser } = payload?.data ?? {};
      // SECURITY: refreshToken may be null when 2FA is required (token only issued after 2FA)
      if (!accessToken || !authUser?.id) {
        return { error: new Error('Login response was incomplete. Please try again.') };
      }
      localStorage.removeItem('hrms_demo_session');
      localStorage.setItem('hrms_access_token', accessToken);
      localStorage.removeItem('hrms_refresh_token');
      const forceChange = authUser.mustChangePassword === true;
      const requiresTwoFactor = authUser.twoFactorRequired === true;
      const verifiedTwoFactor = authUser.twoFactorVerified === true;
      localStorage.setItem('hrms_must_change_password', String(forceChange));
      localStorage.setItem('hrms_2fa_required', String(requiresTwoFactor));
      localStorage.setItem('hrms_2fa_verified', String(verifiedTwoFactor));
      setMustChangePassword(forceChange);
      setTwoFactorRequired(requiresTwoFactor);
      setTwoFactorVerified(verifiedTwoFactor);
      await queryClient.cancelQueries();
      queryClient.clear();
      setUser({ id: authUser.id, email: authUser.email });
      scheduleRefresh();
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err : new Error('Network error') };
    }
  };

  const signUp = async (email: string, password: string, _fullName: string, onboardingToken?: string): Promise<{ error: Error | null }> => {
    try {
      const body: Record<string, unknown> = { email, password };
      if (onboardingToken) body.onboardingToken = onboardingToken;
      const { ok, payload } = await fetchJson('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!ok) return { error: new Error(payload?.error || payload?.message || 'Registration failed') };
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err : new Error('Network error') };
    }
  };

  const signOut = async () => {
    setIsSigningOut(true);
    try {
      const token = localStorage.getItem('hrms_access_token');
      await fetch(apiUrl('/api/auth/logout'), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }).catch(() => { /* best-effort */ });
    } finally {
      localStorage.removeItem('hrms_demo_session');
      localStorage.removeItem('hrms_access_token');
      localStorage.removeItem('hrms_refresh_token');
      localStorage.removeItem('hrms_must_change_password');
      localStorage.removeItem('hrms_2fa_required');
      localStorage.removeItem('hrms_2fa_verified');
      setMustChangePassword(false);
      setTwoFactorRequired(false);
      setTwoFactorVerified(false);
      clearAuthState();
      setIsSigningOut(false);
    }
  };

  const forgotPassword = async (email: string): Promise<{ error: Error | null; smtpNotConfigured?: boolean }> => {
    try {
      const { ok, payload } = await fetchJson('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!ok) {
        return {
          error: new Error(payload?.error || payload?.message || 'Request failed'),
          smtpNotConfigured: !!payload?.smtpNotConfigured,
        };
      }
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err : new Error('Network error') };
    }
  };

  const completePasswordChange = () => {
    localStorage.setItem('hrms_must_change_password', 'false');
    localStorage.setItem('hrms_2fa_required', 'true');
    localStorage.setItem('hrms_2fa_verified', 'false');
    setMustChangePassword(false);
    setTwoFactorRequired(true);
    setTwoFactorVerified(false);
  };

  const sendTwoFactorCode = async (channel: "email" | "sms"): Promise<{ error: Error | null }> => {
    try {
      const token = localStorage.getItem('hrms_access_token');
      const { ok, payload } = await fetchJson('/api/auth/2fa/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ channel }),
      });
      if (!ok) return { error: new Error(payload?.error || payload?.message || 'Unable to send verification code') };
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err : new Error('Network error') };
    }
  };

  const verifyTwoFactorCode = async (otp: string): Promise<{ error: Error | null }> => {
    try {
      const token = localStorage.getItem('hrms_access_token');
      const { ok, payload } = await fetchJson('/api/auth/2fa/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ otp }),
      });
      if (!ok) return { error: new Error(payload?.error || payload?.message || 'Verification failed') };

      // Backend returns full session tokens (access + refresh) after successful 2FA.
      // SECURITY: The refresh token is ONLY issued after 2FA verification.
      if (payload?.accessToken) {
        localStorage.setItem('hrms_access_token', payload.accessToken);
      }
      localStorage.removeItem('hrms_refresh_token');

      localStorage.setItem('hrms_2fa_required', 'true');
      localStorage.setItem('hrms_2fa_verified', 'true');
      setTwoFactorRequired(true);
      setTwoFactorVerified(true);
      scheduleRefresh();
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err : new Error('Network error') };
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, isSigningOut, mustChangePassword, twoFactorRequired, twoFactorVerified, signIn, signUp, signOut, forgotPassword, completePasswordChange, sendTwoFactorCode, verifyTwoFactorCode }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function useIsReadOnly(): boolean {
  const { user } = useAuth();
  return (user as any)?.isReadOnly === true;
}
