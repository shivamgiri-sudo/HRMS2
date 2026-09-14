import { createContext, useContext, useCallback, useEffect, useRef, useState, ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getDemoCred, buildDemoSession } from "@/lib/demoCreds";
import { apiUrl } from "@/lib/apiBase";
import { useInactivityTimeout } from "@/hooks/useInactivityTimeout";
import { toast } from "@/hooks/use-toast";

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

// User-facing explanation per definitive-logout code, shown when the *background*
// silent-refresh path discovers the session was revoked server-side. Before this
// (2026-08-13 auth audit), only the ACCOUNT_DEACTIVATED case — triggered by an
// ordinary API call's 401, handled in lib/hrmsApi.ts — got an explanatory toast;
// a user bounced by the proactive refresh timer instead (the far more common path,
// since it fires every ~19 minutes regardless of whether the user is actively
// clicking around) was silently returned to /auth with zero explanation.
const DEFINITIVE_LOGOUT_MESSAGES: Record<string, { title: string; description: string }> = {
  EMPLOYEE_INACTIVE: {
    title: 'Account inactive',
    description: 'Your account has been deactivated. Please contact HR for assistance.',
  },
  USER_BLOCKED: {
    title: 'Account inactive',
    description: 'Your account has been deactivated. Please contact HR for assistance.',
  },
  PASSWORD_CHANGED: {
    title: 'Signed out',
    description: 'Your password was changed. Please sign in again with your new password.',
  },
  TOKEN_REUSED: {
    title: 'Security sign-out',
    description: 'Unusual activity was detected on your session, so all devices were signed out for your security. Please sign in again.',
  },
};
const DEFAULT_DEFINITIVE_LOGOUT_MESSAGE = { title: 'Session ended', description: 'Please sign in again.' };

function showDefinitiveLogoutToast(code: string | undefined) {
  const { title, description } = (code && DEFINITIVE_LOGOUT_MESSAGES[code]) ?? DEFAULT_DEFINITIVE_LOGOUT_MESSAGE;
  toast({ title, description, variant: 'destructive' });
}

// Returns the decoded user on success, null on transient failure,
// or a tagged result on definitive server rejection (session revoked).
interface DefinitiveLogoutResult {
  definitiveLogout: true;
  code?: string;
}
function isDefinitiveLogout(value: unknown): value is DefinitiveLogoutResult {
  return typeof value === 'object' && value !== null && (value as { definitiveLogout?: unknown }).definitiveLogout === true;
}

async function tryRefresh(): Promise<HrmsUser | null | DefinitiveLogoutResult> {
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
        return { definitiveLogout: true, code };
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
      if (isDefinitiveLogout(result)) {
        showDefinitiveLogoutToast(result.code);
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
        if (result !== null && !isDefinitiveLogout(result)) {
          setUser(result);
          setIsLoading(false);
          scheduleRefresh();
          return;
        }
        if (isDefinitiveLogout(result)) {
          // Revoked server-side (deactivated, blocked, password changed, token
          // reuse) while the tab was closed/idle — explain why, same as the
          // background-timer path.
          showDefinitiveLogoutToast(result.code);
        } else {
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
      // 2FA-gated accounts aren't fully signed in yet — greet only once
      // verifyTwoFactorCode() actually completes the login below.
      if (!requiresTwoFactor) void primeMiraGreeting();
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

  /**
   * Fire-and-forget: fetch Mira's time-aware greeting + critical-updates preview and
   * stash it for whichever Mira chat surface (AmbientStrip/CommandPalette/
   * PeopleOSCopilot) mounts next to show as her opening message.
   *
   * Called only from the two "just became fully authenticated" points below — signIn()
   * success when 2FA isn't required, and verifyTwoFactorCode() success — never from the
   * mount-time session-restore effect, so a page refresh doesn't re-trigger it. A
   * sessionStorage guard additionally caps this to once per browser tab session: a
   * user signing out and back in within the same tab won't be re-greeted mid-session,
   * but a fresh tab/window always gets one.
   */
  const primeMiraGreeting = async () => {
    try {
      if (sessionStorage.getItem('mira_greeted_session')) return;
      sessionStorage.setItem('mira_greeted_session', 'true');
      const token = localStorage.getItem('hrms_access_token');
      if (!token) return;
      const { ok, payload } = await fetchJson('/api/ai/session?greet=1', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (ok && payload?.data) {
        sessionStorage.setItem('mira_greeting', JSON.stringify(payload.data));
      }
    } catch {
      // The greeting is a nicety — never let it block or disrupt sign-in.
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
      void primeMiraGreeting();
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
