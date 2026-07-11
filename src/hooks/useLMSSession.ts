import { useState, useEffect, useCallback } from "react";
import { hrmsApi } from "@/lib/hrmsApi";

interface LMSSessionState {
  lmsToken: string | null;
  lmsUserType: string | null;
  storageKey: string | null;
  launchUrl: string | null;
  route: string | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useLMSSession(): LMSSessionState {
  const [lmsToken, setLmsToken] = useState<string | null>(null);
  const [lmsUserType, setLmsUserType] = useState<string | null>(null);
  const [storageKey, setStorageKey] = useState<string | null>(null);
  const [launchUrl, setLaunchUrl] = useState<string | null>(null);
  const [route, setRoute] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSession = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await hrmsApi.get<{
        success: boolean;
        lmsToken: string;
        lmsUserType: string;
        storageKey: string;
        launchUrl: string;
        route: string;
        message?: string;
      }>("/api/lms/sso-session");

      if (!res.success) {
        throw new Error(res.message ?? "SSO session failed");
      }

      setLmsToken(res.lmsToken);
      setLmsUserType(res.lmsUserType);
      setStorageKey(res.storageKey);
      setLaunchUrl(res.launchUrl);
      setRoute(res.route);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "LMS session unavailable");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  return { lmsToken, lmsUserType, storageKey, launchUrl, route, isLoading, error, refresh: fetchSession };
}
