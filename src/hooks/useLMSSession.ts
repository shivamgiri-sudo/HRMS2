import { useState, useEffect, useCallback } from "react";
import { apiUrl } from "@/lib/apiBase";

const SESSION_KEY = "lms_token";
const LMS_API_URL = (import.meta.env.VITE_LMS_API_URL as string | undefined) ?? "";
const BRIDGE_SECRET = (import.meta.env.VITE_LMS_BRIDGE_SECRET as string | undefined) ?? "";

export type LMSSessionState = {
  lmsToken: string | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
};

function getHrmsToken(): string | null {
  return localStorage.getItem("hrms_access_token");
}

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
    if (!LMS_API_URL) {
      setIsLoading(false);
      setError("LMS URL not configured (VITE_LMS_API_URL)");
      return;
    }

    let cancelled = false;

    const fetchToken = async () => {
      const cached = sessionStorage.getItem(SESSION_KEY);
      if (cached) {
        if (!cancelled) { setLmsToken(cached); setIsLoading(false); setError(null); }
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const hrmsToken = getHrmsToken();
        if (!hrmsToken) {
          if (!cancelled) { setLmsToken(null); setError("Not authenticated"); setIsLoading(false); }
          return;
        }

        // Fetch employee_code + email from HRMS — LMS bridge needs these for lookup
        const empRes = await fetch(apiUrl("/api/employees/me"), {
          headers: { Authorization: `Bearer ${hrmsToken}` },
        });
        const empJson = empRes.ok ? await empRes.json() : null;
        const emp = empJson?.data ?? empJson;
        const employeeCode = emp?.employee_code ?? emp?.employeeCode ?? null;
        const email = emp?.email ?? emp?.official_email ?? null;

        if (!employeeCode && !email) {
          if (!cancelled) { setLmsToken(null); setError("No employee profile found"); setIsLoading(false); }
          return;
        }

        // POST to LMS bridge with employee_id (code) + email
        // LMS bridge: POST /api/auth/bridge { employee_id?, email?, bridge_token? }
        const body: Record<string, string> = {};
        if (employeeCode) body.employee_id = String(employeeCode);
        if (email) body.email = String(email);
        if (BRIDGE_SECRET) body.bridge_token = BRIDGE_SECRET;

        const res = await fetch(`${LMS_API_URL}/api/auth/bridge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json();

        if (!res.ok || !json.ok) {
          throw new Error(json.message || `Bridge failed (${res.status})`);
        }

        const token: string = json.lms_token;
        sessionStorage.setItem(SESSION_KEY, token);
        if (!cancelled) { setLmsToken(token); setError(null); }
      } catch (err: any) {
        if (!cancelled) { setLmsToken(null); setError(err.message || "Failed to obtain LMS session"); }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void fetchToken();
    return () => { cancelled = true; };
  }, [trigger]);

  return { lmsToken, isLoading, error, refresh };
};
