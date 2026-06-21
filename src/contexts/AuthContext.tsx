import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getDemoCred, buildDemoSession } from "@/lib/demoCreds";

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
  signIn: (identifier: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName: string, onboardingToken?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  forgotPassword: (email: string) => Promise<{ error: Error | null }>;
  completePasswordChange: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const DEMO_LOGIN_ENABLED = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO_LOGIN === 'true';

// Known demo user IDs from DEMO_TOKEN_MAP in authMiddleware
const KNOWN_DEMO_IDS = new Set([
  'demo-admin-id', 'demo-hr-id', 'demo-recruiter-id', 'demo-manager-id',
  'demo-tl-id', 'demo-qa-id', 'demo-wfm-id', 'demo-finance-id',
  'demo-employee-id', 'demo-ceo-id', 'demo-trainer-id', 'demo-user-id',
]);

function apiBaseUrl(): string {
  const configured = import.meta.env.VITE_HRMS_API_URL;
  if (configured !== undefined) return String(configured).replace(/\/$/, '');
  return import.meta.env.DEV ? 'http://localhost:5055' : '';
}

const API_URL = apiBaseUrl();

function decodeJwtUser(token: string): HrmsUser | null {
  try {
    const [, b64] = token.split('.');
    const payload = JSON.parse(atob(b64.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload?.sub && payload?.exp && payload.exp * 1000 > Date.now()) {
      return {
        id: payload.sub,
        email: payload.email ?? '',
        isReadOnly: payload.isReadOnly || false
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function tryRefresh(): Promise<HrmsUser | null> {
  const raw = localStorage.getItem('hrms_refresh_token');
  if (!raw) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: raw }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const { data } = await res.json();
    localStorage.setItem('hrms_access_token', data.accessToken);
    return decodeJwtUser(data.accessToken);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<HrmsUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(
    localStorage.getItem('hrms_must_change_password') === 'true'
  );
  const queryClient = useQueryClient();
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const scheduleRefresh = () => {
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    // Refresh every 13 minutes (token expires at 15)
    refreshTimerRef.current = setInterval(async () => {
      const refreshed = await tryRefresh();
      if (!refreshed) {
        localStorage.removeItem('hrms_access_token');
        localStorage.removeItem('hrms_refresh_token');
        setUser(null);
        queryClient.clear();
        if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
      }
    }, 13 * 60 * 1000);
  };

  useEffect(() => {
    const init = async () => {
      // Demo sessions are allowed only in local development or when explicitly enabled.
      if (DEMO_LOGIN_ENABLED) {
        const demoRaw = localStorage.getItem('hrms_demo_session');
        if (demoRaw) {
          try {
            const demo = JSON.parse(demoRaw);
            if (demo?.user?.id && KNOWN_DEMO_IDS.has(demo.user.id)) {
              setUser({ id: demo.user.id, email: demo.user.email ?? '' });
              setIsLoading(false);
              return;
            }
          } catch { /* fall through */ }
          localStorage.removeItem('hrms_demo_session');
        }
      } else {
        localStorage.removeItem('hrms_demo_session');
      }

      const token = localStorage.getItem('hrms_access_token');
      if (token) {
        const decoded = decodeJwtUser(token);
        if (decoded) {
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
        localStorage.removeItem('hrms_refresh_token');
      }

      setUser(null);
      setIsLoading(false);
    };

    init();

    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, []);

  const signIn = async (identifier: string, password: string): Promise<{ error: Error | null }> => {
    if (DEMO_LOGIN_ENABLED) {
      const demoCred = getDemoCred(identifier);
      if (demoCred) {
        if (password !== demoCred.password) {
          return { error: new Error('Incorrect password for demo account') };
        }
        const mockSession = buildDemoSession(demoCred);
        localStorage.setItem('hrms_demo_session', JSON.stringify(mockSession));
        await queryClient.cancelQueries();
        queryClient.clear();
        setUser({ id: mockSession.user.id, email: mockSession.user.email });
        return { error: null };
      }
    }

    try {
      console.log('[AuthContext] Login attempt:', { identifier, apiUrl: API_URL });
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });
      const json = await res.json();
      console.log('[AuthContext] Login response:', { status: res.status, data: json });
      if (!res.ok) return { error: new Error(json.error || `Login failed: HTTP ${res.status}`) };
      const { accessToken, refreshToken, user: authUser } = json.data;
      localStorage.removeItem('hrms_demo_session');
      localStorage.setItem('hrms_access_token', accessToken);
      localStorage.setItem('hrms_refresh_token', refreshToken);
      const forceChange = authUser.mustChangePassword === true;
      localStorage.setItem('hrms_must_change_password', String(forceChange));
      setMustChangePassword(forceChange);
      await queryClient.cancelQueries();
      queryClient.clear();
      setUser({ id: authUser.id, email: authUser.email, isReadOnly: authUser.isReadOnly || false });
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
      const res = await fetch(`${API_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) return { error: new Error(json.error || 'Registration failed') };
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err : new Error('Network error') };
    }
  };

  const signOut = async () => {
    setIsSigningOut(true);
    try {
      const refreshToken = localStorage.getItem('hrms_refresh_token');
      if (refreshToken) {
        const token = localStorage.getItem('hrms_access_token');
        await fetch(`${API_URL}/api/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ refreshToken }),
        }).catch(() => { /* best-effort */ });
      }
    } finally {
      localStorage.removeItem('hrms_demo_session');
      localStorage.removeItem('hrms_access_token');
      localStorage.removeItem('hrms_refresh_token');
      localStorage.removeItem('hrms_must_change_password');
      setMustChangePassword(false);
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
      setUser(null);
      queryClient.clear();
      setIsSigningOut(false);
    }
  };

  const forgotPassword = async (email: string): Promise<{ error: Error | null }> => {
    try {
      const res = await fetch(`${API_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const json = await res.json();
        return { error: new Error(json.error || 'Request failed') };
      }
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err : new Error('Network error') };
    }
  };

  const completePasswordChange = () => {
    localStorage.setItem('hrms_must_change_password', 'false');
    setMustChangePassword(false);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, isSigningOut, mustChangePassword, signIn, signUp, signOut, forgotPassword, completePasswordChange }}>
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

export function useIsReadOnly() {
  const { user } = useAuth();
  return user?.isReadOnly || false;
}
