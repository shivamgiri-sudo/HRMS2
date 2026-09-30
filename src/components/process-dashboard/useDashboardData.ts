import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchAgent, fetchAgents, fetchConfigs, fetchDay, fetchLive, fetchOverview } from "./api";
import { usePolling } from "./usePolling";
import { apiUrl } from "@/lib/apiBase";
import { PD_API } from "./api";
import type { DashUrlState } from "./urlState";
import type { LiveResponse } from "./types";

const KEY = "process-dashboard";
const STALE = 10_000;

export function useDashboardData(processId: string, s: DashUrlState) {
  const qc = useQueryClient();
  const configs = useQuery({ queryKey: [KEY, "configs"], queryFn: fetchConfigs, staleTime: 60_000 });
  const config = useMemo(() => configs.data?.find((c) => c.processId === processId) ?? null, [configs.data, processId]);
  const ready = !!config?.configured && config.enabled !== false;

  const scopeKey = [s.from, s.to, s.tl, s.lob];
  const overview = useQuery({ queryKey: [KEY, processId, "overview", ...scopeKey], queryFn: () => fetchOverview(processId, s), enabled: ready, placeholderData: keepPreviousData, staleTime: STALE });
  const agents = useQuery({ queryKey: [KEY, processId, "agents", ...scopeKey, s.q, s.sort, s.dir, s.page], queryFn: () => fetchAgents(processId, s), enabled: ready, placeholderData: keepPreviousData, staleTime: STALE });
  const agent = useQuery({ queryKey: [KEY, processId, "agent", s.agent, s.from, s.to], queryFn: () => fetchAgent(processId, s.agent, s), enabled: ready && !!s.agent });
  const day = useQuery({ queryKey: [KEY, processId, "day", s.day, s.tl, s.lob], queryFn: () => fetchDay(processId, s.day, s), enabled: ready && !!s.day });

  const etag = useRef<string | undefined>(undefined);
  const [live, setLive] = useState<LiveResponse | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t); }, []);
  useEffect(() => { etag.current = undefined; setLive(null); }, [processId]);

  const tick = useCallback(async () => {
    const res = await fetchLive(processId, etag.current);
    setLastCheckedAt(Date.now());
    if (res.changed === false) return;
    const had = etag.current !== undefined;
    if (res.etag !== undefined) etag.current = res.etag;
    setLive(res);
    if (had || res.etag === undefined) void qc.invalidateQueries({ queryKey: [KEY, processId] });
  }, [processId, qc]);

  // Optional SSE push (cookie auth). Any failure closes it quietly: the /live polling below is the authoritative fallback.
  useEffect(() => {
    if (!ready || typeof EventSource === "undefined") return undefined;
    let es: EventSource | null = null;
    try {
      es = new EventSource(apiUrl(`${PD_API}/${encodeURIComponent(processId)}/stream`), { withCredentials: true });
      es.addEventListener("live", (ev) => {
        try {
          const res = (JSON.parse((ev as MessageEvent).data) as { data?: LiveResponse }).data;
          if (!res || res.changed === false || (res.etag !== undefined && res.etag === etag.current)) return;
          const had = etag.current !== undefined;
          if (res.etag !== undefined) etag.current = res.etag;
          setLive(res); setLastCheckedAt(Date.now());
          if (had) void qc.invalidateQueries({ queryKey: [KEY, processId] });
        } catch { /* malformed frame: ignore */ }
      });
      es.onerror = () => { es?.close(); es = null; };
    } catch { es = null; }
    return () => { es?.close(); };
  }, [ready, processId, qc]);

  const poll = usePolling(tick, config?.refreshSeconds ?? 30, ready);
  const refreshAll = useCallback(async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: [KEY, processId] }), poll.refreshNow()]);
  }, [qc, processId, poll]);

  return { configs, config, ready, overview, agents, agent, day, live, lastCheckedAt, now, poll, refreshAll };
}
