import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getDemoCred, buildDemoSession } from "@/lib/demoCreds";

interface User {
  id: string;
  email: string | null;
}

interface AuthContextType {
  user: User | null;
  session: null;
  isLoading: boolean;
  isSigningOut: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const HRMS_API_URL = import.meta.env.VITE_HRMS_API_URL || '';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    // Check if we are in local demo mode first
    const localDemo = localStorage.getItem("hrms_demo_session");
    if (localDemo) {
      try {
        const demoData = JSON.parse(localDemo);
        setUser(demoData.user);
        setIsLoading(false);
        return;
      } catch (e) {
        console.error("Failed to parse demo session", e);
        localStorage.removeItem("hrms_demo_session");
      }
    }

    // Restore MySQL JWT session on page load
    const mysqlToken = localStorage.getItem('hrms_access_token');
    if (mysqlToken) {
      // Verify token expiry client-side before making a server request
      try {
        const [, payloadB64] = mysqlToken.split('.');
        const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
        if (payload?.sub && payload?.exp && payload.exp * 1000 > Date.now()) {
          // Token looks valid — fetch the employee record to confirm with the server
          fetch(`${HRMS_API_URL}/api/employees/me`, {
            headers: { Authorization: `Bearer ${mysqlToken}` },
          })
            .then(async (res) => {
              if (res.ok) {
                const json = await res.json();
                const emp = json?.data ?? json;
                setUser({ id: payload.sub as string, email: emp?.email ?? payload.email ?? null });
              } else {
                // Token rejected by server — clear it
                localStorage.removeItem('hrms_access_token');
                localStorage.removeItem('hrms_refresh_token');
                setUser(null);
              }
            })
            .catch(() => {
              // Network error — keep user from JWT payload so the UI remains functional
              setUser({ id: payload.sub as string, email: payload.email ?? null });
            })
            .finally(() => setIsLoading(false));
          return;
        }
      } catch {
        // Malformed token — clear and fall through
        localStorage.removeItem('hrms_access_token');
        localStorage.removeItem('hrms_refresh_token');
      }
    }

    // No session found
    setIsLoading(false);
  }, []);

  const signIn = async (email: string, password: string) => {
    // Role-based demo sign-in bypass (no server call)
    const demoCred = getDemoCred(email);
    if (demoCred && password === demoCred.password) {
      const mockSession = buildDemoSession(demoCred);
      localStorage.setItem("hrms_demo_session", JSON.stringify(mockSession));
      setUser(mockSession.user as User);
      queryClient.invalidateQueries();
      return { error: null };
    }
    if (demoCred && password !== demoCred.password) {
      return { error: new Error("Incorrect password for demo account") };
    }

    // MySQL JWT auth — only auth method
    try {
      const response = await fetch(`${HRMS_API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: email, password }),
      });

      if (response.ok) {
        const { data: authData } = await response.json();
        localStorage.setItem('hrms_access_token', authData.accessToken);
        localStorage.setItem('hrms_refresh_token', authData.refreshToken);

        // Fetch employee record to get display name
        let displayEmail: string | null = authData.user?.email ?? email;
        try {
          const meRes = await fetch(`${HRMS_API_URL}/api/employees/me`, {
            headers: { Authorization: `Bearer ${authData.accessToken}` },
          });
          if (meRes.ok) {
            const meJson = await meRes.json();
            const emp = meJson?.data ?? meJson;
            displayEmail = emp?.email ?? displayEmail;
          }
        } catch {
          // Non-fatal — continue with email from auth response
        }

        setUser({ id: authData.user.id, email: displayEmail });
        queryClient.invalidateQueries();
        return { error: null };
      }

      // Parse error from server
      let message = 'Invalid credentials';
      try {
        const body = await response.json();
        message = body?.message ?? body?.error ?? message;
      } catch { /* ignore */ }
      return { error: new Error(message) };
    } catch (networkErr) {
      return { error: new Error('Unable to reach the server. Please try again.') };
    }
  };

  // signUp is disabled — accounts are created by HR Admin
  const signUp = async (_email: string, _password: string, _fullName: string) => {
    return { error: new Error("New accounts are created by HR Admin. Please contact your HR team.") };
  };

  const signOut = async () => {
    setIsSigningOut(true);
    try {
      // Call logout endpoint if refresh token is available
      const refreshToken = localStorage.getItem('hrms_refresh_token');
      if (refreshToken) {
        try {
          await fetch(`${HRMS_API_URL}/api/auth/logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
          });
        } catch {
          // Non-fatal — clear local state regardless
        }
      }
      localStorage.removeItem("hrms_demo_session");
      localStorage.removeItem('hrms_access_token');
      localStorage.removeItem('hrms_refresh_token');
    } catch (error) {
      console.error('Sign out error:', error);
    } finally {
      // Clear local state regardless of server response
      setUser(null);
      queryClient.clear();
      setIsSigningOut(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, session: null, isLoading, isSigningOut, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
