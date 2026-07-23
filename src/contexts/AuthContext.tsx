import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getDemoCred, buildDemoSession } from "@/lib/demoCreds";
import { useGeoCapture } from "@/hooks/useGeoCapture";
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

/**
 * Fetch JSON with timeout support.
 * For auth endpoints, use fetchAuthJson which includes credentials for cookies.
 */
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

/**
 * Fetch JSON for auth endpoints with credentials: "include".
 * SECURITY: This is required for httpOnly refresh token cookies to be sent/received.
 * Refresh tokens are stored in httpOnly cookies, NOT localStorage.
 */
async function fetchAuthJson(
  path: string,
  init: RequestInit,
  timeoutMs = AUTH_REQUEST_TIMEOUT_MS,
): Promise<{ ok: boolean; status: number; payload: any }> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(apiUrl(path), {
      ...init,
      credentials: 'include', // SECURITY: Required for httpOnly cookies
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

/**
 * Attempt to refresh the access token using httpOnly cookie.
 * SECURITY: Refresh token is stored in httpOnly cookie, NOT localStorage.
 * The browser automatically sends the cookie; we don't need to read/send it explicitly.
 */
async function tryRefresh(): Promise<HrmsUser | null> {
  try {
    // SECURITY: Use fetchAuthJson with credentials: "include" to send/receive cookies
    const { ok, payload } = await fetchAuthJson('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // No body needed - refresh token comes from httpOnly cookie
    });
    if (!ok) {
      // Check for security-related errors that require logout
      if (payload?.logoutRequired || payload?.code === 'TOKEN_REUSED' || payload?.code === 'PASSWORD_CHANGED') {
        localStorage.removeItem('hrms_access_token');
        localStorage.removeItem('hrms_must_change_password');
        localStorage.removeItem('hrms_2fa_required');
        localStorage.removeItem('hrms_2fa_verified');
      }
      return null;
    }
    const { data } = payload ?? {};
    localStorage.setItem('hrms_access_token', data.accessToken);
    // SECURITY: Refresh token is rotated server-side and set via httpOnly cookie
    // We don't store it in localStorage anymore
    return decodeJwtUser(data.accessToken);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<HrmsUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(() => {
    // Only honour the flag when an access token exists.
    // SECURITY: Refresh token is now in httpOnly cookie, not localStorage
    const hasToken = !!localStorage.getItem('hrms_access_token');
    if (!hasToken) {
      localStorage.removeItem('hrms_must_change_password');
      return false;
    }
    return localStorage.getItem('hrms_must_change_password') === 'true';
  });
  const [twoFactorRequired, setTwoFactorRequired] = useState(() => {
    // SECURITY: Refresh token is now in httpOnly cookie, not localStorage
    const hasToken = !!localStorage.getItem('hrms_access_token');
    if (!hasToken) {
      localStorage.removeItem('hrms_2fa_required');
      localStorage.removeItem('hrms_2fa_verified');
      return false;
    }
    return localStorage.getItem('hrms_2fa_required') === 'true';
  });
  const [twoFactorVerified, setTwoFactorVerified] = useState(() => {
    // SECURITY: Refresh token is now in httpOnly cookie, not localStorage
    const hasToken = !!localStorage.getItem('hrms_access_token');
    if (!hasToken) return false;
    return localStorage.getItem('hrms_2fa_verified') === 'true';
  });
  const queryClient = useQueryClient();
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [autoLogoutMinutes, setAutoLogoutMinutes] = useState<number>(0);

  const scheduleRefresh = () => {
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    // Refresh every 13 minutes (token expires at 15)
    refreshTimerRef.current = setInterval(async () => {
      const refreshed = await tryRefresh();
      if (!refreshed) {
        localStorage.removeItem('hrms_access_token');
        // SECURITY: Refresh token is now in httpOnly cookie, cleared by server
        setUser(null);
        queryClient.clear();
        if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
      }
    }, 13 * 60 * 1000);
  };

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
        localStorage.removeItem('hrms_access_token');
        const refreshed = await tryRefresh();
        if (refreshed) {
          setUser(refreshed);
          setIsLoading(false);
          scheduleRefresh();
          return;
        }
        // SECURITY: Refresh token is now in httpOnly cookie, cleared by server
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

    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, []);

  // Fetch auto-logout setting from server
  useEffect(() => {
    const fetchAutoLogoutSetting = async () => {
      try {
        const res = await fetch(apiUrl('/api/org/settings/public/auto-logout-minutes'));
        if (res.ok) {
          const data = await res.json();
          setAutoLogoutMinutes(data.minutes || 0);
        }
      } catch (error) {
        console.error('[AuthContext] Failed to fetch auto-logout setting:', error);
        // Default to 0 (disabled) on error
        setAutoLogoutMinutes(0);
      }
    };

    fetchAutoLogoutSetting();
  }, []);

  // Setup inactivity timeout - only when user is logged in
  useInactivityTimeout(
    user ? autoLogoutMinutes : 0,
    async () => {
      if (!user) return;
      console.log('[AuthContext] Inactivity timeout triggered - logging out');
      await signOut();
    }
  );

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
      // PRIVACY: Removed geolocation collection - backend doesn't use it for security
      // and collecting it without clear purpose violates data minimization principle
      // SECURITY: Use fetchAuthJson with credentials: "include" to receive httpOnly cookies
      const { ok, payload } = await fetchAuthJson('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });
      if (!ok) {
        return { error: new Error(payload?.error || payload?.message || 'Authentication failed') };
      }
      const { accessToken, user: authUser } = payload?.data ?? {};
      // SECURITY: Refresh token is now set as httpOnly cookie by server
      // It is NOT returned in the response body and NOT stored in localStorage
      if (!accessToken || !authUser?.id) {
        return { error: new Error('Login response was incomplete. Please try again.') };
      }
      localStorage.removeItem('hrms_demo_session');
      localStorage.setItem('hrms_access_token', accessToken);
      // SECURITY: Refresh token is handled via httpOnly cookie, not localStorage
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
      // SECURITY: Use fetchAuthJson with credentials: "include" to send/clear cookies
      const token = localStorage.getItem('hrms_access_token');
      await fetch(apiUrl('/api/auth/logout'), {
        method: 'POST',
        credentials: 'include', // SECURITY: Required to send/clear httpOnly cookie
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        // No body needed - refresh token comes from httpOnly cookie
      }).catch(() => { /* best-effort */ });
    } finally {
      localStorage.removeItem('hrms_demo_session');
      localStorage.removeItem('hrms_access_token');
      // SECURITY: Refresh token is now in httpOnly cookie, cleared by server on logout
      localStorage.removeItem('hrms_must_change_password');
      localStorage.removeItem('hrms_2fa_required');
      localStorage.removeItem('hrms_2fa_verified');
      setMustChangePassword(false);
      setTwoFactorRequired(false);
      setTwoFactorVerified(false);
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
      setUser(null);
      queryClient.clear();
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
      // SECURITY: Use fetchAuthJson with credentials: "include" to receive httpOnly cookies
      const { ok, payload } = await fetchAuthJson('/api/auth/2fa/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ otp }),
      });
      if (!ok) return { error: new Error(payload?.error || payload?.message || 'Verification failed') };

      // Backend returns full access token after successful 2FA.
      // SECURITY: Refresh token is set as httpOnly cookie by server, NOT in response body
      if (payload?.accessToken) {
        localStorage.setItem('hrms_access_token', payload.accessToken);
      }
      // SECURITY: Refresh token is handled via httpOnly cookie, not localStorage

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
