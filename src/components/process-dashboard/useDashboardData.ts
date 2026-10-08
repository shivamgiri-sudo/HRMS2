import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { fetchAgent, fetchAgents, fetchConfigs, fetchDay, fetchLive, fetchOverview } from "./api";
import { usePolling } from "./usePolling";
import { apiUrl } from "@/lib/apiBase";
import { getAuthToken } from "@/lib/hrmsApi";
import { PD_API } from "./api";
import type { DashUrlState } from "./urlState";
import type { LiveResponse } from "./types";

const KEY = "process-dashboard";
const STALE = 10_000;
// A data change only affects the numbers; the tab probes (sales/inbound/outbound), the alerts chip and /configs have their own cadence.
const DATA_SCOPES = new Set(["overview", "agents", "agent", "day", "forecast", "forecast-agents", "why"]);
export const invalidateData = (qc: QueryClient, processId: string) =>
  qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === KEY && q.queryKey[1] === processId && DATA_SCOPES.has(String(q.queryKey[2])) });

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
    // The SSE stream may already have applied this very snapshot while this request was in flight: do not refetch everything twice.
    if (res.etag !== undefined && res.etag === etag.current) return;
    const had = etag.current !== undefined;
    if (res.etag !== undefined) etag.current = res.etag;
    setLive(res);
    if (had || res.etag === undefined) void invalidateData(qc, processId);
  }, [processId, qc]);

  const poll = usePolling(tick, config?.refreshSeconds ?? 30, ready);
  // Optional SSE push. EventSource cannot send the Bearer header this app authenticates with (it 401s on every connect), so the stream is read
  // with fetch. It is closed while the user has paused or the tab is hidden, and on any failure: the /live polling below is the authoritative fallback.
  const streamOn = ready && !poll.paused && !poll.hidden;
  useEffect(() => {
    if (!streamOn || typeof fetch === "undefined" || typeof TextDecoder === "undefined") return undefined;
    const ctrl = new AbortController();
    const onFrame = (frame: string) => {
      const ev = frame.split("\n").find((l) => l.startsWith("event:"))?.slice(6).trim();
      const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
      if (ev !== "live" || !dataLine) return;
      try {
        const res = (JSON.parse(dataLine.slice(5).trim()) as { data?: LiveResponse }).data;
        if (!res || res.changed === false || (res.etag !== undefined && res.etag === etag.current)) return;
        const had = etag.current !== undefined;
        if (res.etag !== undefined) etag.current = res.etag;
        setLive(res); setLastCheckedAt(Date.now());
        if (had) void invalidateData(qc, processId);
      } catch { /* malformed frame: ignore */ }
    };
    void (async () => {
      try {
        const token = getAuthToken();
        const r = await fetch(apiUrl(`${PD_API}/${encodeURIComponent(processId)}/stream`), {
          headers: { Accept: "text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, credentials: "include", signal: ctrl.signal,
        });
        if (!r.ok || !r.body) return;
        const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          buf += dec.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n\n")) >= 0) { onFrame(buf.slice(0, i)); buf = buf.slice(i + 2); }
        }
      } catch { /* aborted or network failure: polling covers it */ }
    })();
    return () => ctrl.abort();
  }, [streamOn, processId, qc]);

  const refreshAll = useCallback(async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: [KEY, processId] }), poll.refreshNow()]);
  }, [qc, processId, poll]);

  return { configs, config, ready, overview, agents, agent, day, live, lastCheckedAt, now, poll, refreshAll };
}
