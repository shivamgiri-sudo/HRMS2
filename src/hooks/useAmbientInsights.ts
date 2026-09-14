import { useState, useEffect, useRef } from "react";
import { hrmsApi } from "@/lib/hrmsApi";

export type AmbientChip = {
  label: string;
  severity: "critical" | "warning" | "info";
  action_url?: string;
};

// Module-level cache: contextType -> { chips, expires_at }
const ambientCache = new Map<string, { chips: AmbientChip[]; expires_at: number }>();
const REFRESH_MS = 5 * 60 * 1000; // 5 minutes

export function useAmbientInsights(contextType: string): {
  chips: AmbientChip[];
  loading: boolean;
  refresh: () => void;
} {
  const [chips, setChips] = useState<AmbientChip[]>(() => {
    const cached = ambientCache.get(contextType);
    return cached && cached.expires_at > Date.now() ? cached.chips : [];
  });
  const [loading, setLoading] = useState(false);
  const tickRef = useRef(0);

  const doFetch = async (key: string, cancelled: { v: boolean }) => {
    const cached = ambientCache.get(key);
    if (cached && cached.expires_at > Date.now()) {
      if (!cancelled.v) setChips(cached.chips);
      return;
    }
    if (!cancelled.v) setLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: { answer?: string; insights?: { label: string; severity?: string; action_url?: string }[] } }>(
        `/api/ai/role-insights?context_type=${encodeURIComponent(key)}`
      );
      if (cancelled.v) return;
      const raw = res?.data?.insights ?? [];
      const parsed: AmbientChip[] = raw.slice(0, 3).map((i) => ({
        label: i.label,
        severity: (["critical", "warning", "info"].includes(i.severity ?? "") ? i.severity : "info") as AmbientChip["severity"],
        action_url: i.action_url,
      }));
      ambientCache.set(key, { chips: parsed, expires_at: Date.now() + REFRESH_MS });
      setChips(parsed);
    } catch {
      // AI unavailable — keep existing chips, fail silently
    } finally {
      if (!cancelled.v) setLoading(false);
    }
  };

  useEffect(() => {
    if (!contextType) return;
    const cancelled = { v: false };
    setChips([]);
    void doFetch(contextType, cancelled);
    const interval = setInterval(() => void doFetch(contextType, cancelled), REFRESH_MS);
    return () => {
      cancelled.v = true;
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextType, tickRef.current]);

  function refresh() {
    ambientCache.delete(contextType);
    setChips([]);
    tickRef.current += 1;
  }

  return { chips, loading, refresh };
}
