import { useState, useEffect, useCallback } from "react";

const SESSION_KEY = "lms_token";
const LMS_API_URL = import.meta.env.VITE_LMS_API_URL as string;

export type LMSSessionState = {
  lmsToken: string | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
};

export const useLMSSession = (): LMSSessionState => {
  const [lmsToken, setLmsToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);

  const refresh = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY);
    setLmsToken(null);
    setError(null);
    setTrigger((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const fetchToken = async () => {
      // Check sessionStorage cache first
      const cached = sessionStorage.getItem(SESSION_KEY);
      if (cached) {
        if (!cancelled) {
          setLmsToken(cached);
          setIsLoading(false);
          setError(null);
        }
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        // Get current MySQL JWT or demo session token
        const demoRaw = localStorage.getItem('hrms_demo_session');
        let accessToken: string | null = null;
        if (demoRaw) {
          try { accessToken = JSON.parse(demoRaw)?.access_token ?? null; } catch {}
        }
        if (!accessToken) {
          accessToken = localStorage.getItem('hrms_access_token');
        }
        if (!accessToken) {
          if (!cancelled) {
            setLmsToken(null);
            setError("Not authenticated");
            setIsLoading(false);
          }
          return;
        }

        // Call the LMS bridge endpoint
        const res = await fetch(`${LMS_API_URL}/api/auth/bridge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ supabase_token: accessToken }),
        });

        const json = await res.json();

        if (!res.ok || !json.ok) {
          throw new Error(json.message || `Bridge request failed (${res.status})`);
        }

        const token: string = json.lms_token;
        sessionStorage.setItem(SESSION_KEY, token);

        if (!cancelled) {
          setLmsToken(token);
          setError(null);
        }
      } catch (err: any) {
        if (!cancelled) {
          setLmsToken(null);
          setError(err.message || "Failed to obtain LMS session");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void fetchToken();

    return () => {
      cancelled = true;
    };
  }, [trigger]);

  return { lmsToken, isLoading, error, refresh };
};
