import { useState, useEffect, useRef } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import type { AIInsight } from "@/types/ai-insights";

// Module-level session cache — persists for the full browser tab session
const sessionCache = new Map<string, { insights: AIInsight[]; expires_at: number }>();
const SESSION_TTL_MS = 30 * 60 * 1000;

function cacheKey(contextType: string, data: Record<string, unknown>): string {
  return contextType + ":" + JSON.stringify(data).slice(0, 300);
}

interface UseAIInsightsOptions {
  contextType: string;
  data: Record<string, unknown>;
  role?: string;
  enabled?: boolean;
}

interface UseAIInsightsResult {
  insights: AIInsight[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useAIInsights({
  contextType,
  data,
  role = "employee",
  enabled = true,
}: UseAIInsightsOptions): UseAIInsightsResult {
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshCounter = useRef(0);

  const key = cacheKey(contextType, data);
  const dataReady = enabled && Object.keys(data).length > 0;

  useEffect(() => {
    if (!dataReady) return;

    // Check session cache
    const cached = sessionCache.get(key);
    if (cached && cached.expires_at > Date.now()) {
      setInsights(cached.insights);
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    hrmsApi
      .post<{ success: boolean; data: { insights: AIInsight[] } }>(
        "/api/ai/insights",
        { context_type: contextType, data, role }
      )
      .then((res) => {
        if (cancelled) return;
        const items = res?.data?.insights ?? [];
        sessionCache.set(key, { insights: items, expires_at: Date.now() + SESSION_TTL_MS });
        setInsights(items);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg =
          err instanceof Error ? err.message : String(err);
        if (msg.includes("429") || msg.toLowerCase().includes("rate limit")) {
          setError("rate_limit");
        } else {
          setError("unavailable");
        }
        setInsights([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // refreshCounter.current included so refresh() triggers re-run
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, dataReady, refreshCounter.current]);

  function refresh() {
    sessionCache.delete(key);
    setInsights([]);
    setError(null);
    refreshCounter.current += 1;
  }

  return { insights, isLoading, error, refresh };
}

export type { AIInsight };
