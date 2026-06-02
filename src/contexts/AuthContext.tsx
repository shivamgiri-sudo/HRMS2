import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { getDemoCred, buildDemoSession } from "@/lib/demoCreds";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isSigningOut: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    // Check if we are in local demo mode first
    const localDemo = localStorage.getItem("hrms_demo_session");
    if (localDemo) {
      try {
        const demoData = JSON.parse(localDemo);
        setSession(demoData);
        setUser(demoData.user);
        setIsLoading(false);
        return;
      } catch (e) {
        console.error("Failed to parse demo session", e);
      }
    }

    // Check for MySQL JWT session (new auth path)
    const mysqlToken = localStorage.getItem('hrms_access_token');
    if (mysqlToken) {
      try {
        // Decode JWT payload (no verification needed client-side — server verifies on each request)
        const [, payloadB64] = mysqlToken.split('.');
        const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
        if (payload?.sub && payload?.exp && payload.exp * 1000 > Date.now()) {
          setUser({ id: payload.sub, email: payload.email } as any);
          setIsLoading(false);
          return;
        }
      } catch {
        // Malformed token — clear and fall through
        localStorage.removeItem('hrms_access_token');
        localStorage.removeItem('hrms_refresh_token');
      }
    }

    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        // If a demo session is in progress, do not overwrite it with null
        if (localStorage.getItem("hrms_demo_session")) return;

        setSession(session);
        setUser(session?.user ?? null);
        setIsLoading(false);
        
        // Invalidate user-role cache on login/signup to force refetch
        if (event === 'SIGNED_IN' && session?.user?.id) {
          queryClient.invalidateQueries({ queryKey: ['user-role', session.user.id] });
        }
        
        // Clear cache on logout
        if (event === 'SIGNED_OUT') {
          queryClient.removeQueries({ queryKey: ['user-role'] });
        }
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (localStorage.getItem("hrms_demo_session")) return;
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    // Role-based demo sign-in bypass (no Supabase call)
    const demoCred = getDemoCred(email);
    if (demoCred && password === demoCred.password) {
      const mockSession = buildDemoSession(demoCred);
      localStorage.setItem("hrms_demo_session", JSON.stringify(mockSession));
      setSession(mockSession as any);
      setUser(mockSession.user as any);
      queryClient.invalidateQueries();
      return { error: null };
    }
    if (demoCred && password !== demoCred.password) {
      return { error: new Error("Incorrect password for demo account") };
    }

    // Try MySQL JWT auth first
    try {
      const response = await fetch(`${import.meta.env.VITE_HRMS_API_URL || ''}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (response.ok) {
        const { data: authData } = await response.json();
        localStorage.setItem('hrms_access_token', authData.accessToken);
        localStorage.setItem('hrms_refresh_token', authData.refreshToken);
        // Set user state from MySQL auth response
        setUser({ id: authData.user.id, email: authData.user.email } as any);
        queryClient.invalidateQueries();
        return { error: null };
      }
    } catch (networkErr) {
      // Network failure — fall through to Supabase
      console.warn('MySQL auth endpoint unreachable, falling back to Supabase', networkErr);
    }

    // Fall back to Supabase auth (for users not yet in auth_user table)
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return { error: error as Error };
    }

    // Check if user is blocked
    if (data.user) {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('blocked')
        .eq('id', data.user.id)
        .single();

      if (profileError) {
        console.error('Error checking blocked status:', profileError);
      }

      if (profile?.blocked) {
        // Sign out the user immediately
        await supabase.auth.signOut({ scope: 'local' });
        return { error: new Error('Your account has been blocked. Please contact an administrator.') };
      }
    }

    return { error: null };
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          full_name: fullName,
        },
      },
    });

    if (error) {
      return { error: error as Error };
    }

    // Supabase returns a fake user with empty identities for duplicate signups
    if (data?.user?.identities && data.user.identities.length === 0) {
      return { error: new Error("User already registered") };
    }

    return { error: null };
  };

  const signOut = async () => {
    setIsSigningOut(true);
    try {
      localStorage.removeItem("hrms_demo_session");
      localStorage.removeItem('hrms_access_token');
      localStorage.removeItem('hrms_refresh_token');
      await supabase.auth.signOut({ scope: 'local' });
    } catch (error) {
      console.error('Sign out error:', error);
    } finally {
      // Clear local state regardless of server response
      setSession(null);
      setUser(null);
      queryClient.clear();
      setIsSigningOut(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, isLoading, isSigningOut, signIn, signUp, signOut }}>
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
