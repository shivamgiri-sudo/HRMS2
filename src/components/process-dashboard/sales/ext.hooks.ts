import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { usePolling } from "../usePolling";
import { fetchLive, type Kind } from "./extApi";
import { parseExtUrl, serializeExtUrl, type ExtUrl } from "./ext.model";

/** URL-synced filter state; changing a filter resets the page. */
export function useExtUrl() {
  const [sp, setSp] = useSearchParams();
  const state = parseExtUrl(sp);
  const update = useCallback((patch: Partial<ExtUrl>, push = false) => {
    setSp((cur) => { const s = parseExtUrl(cur); const reset = Object.keys(patch).some((k) => !["page", "agent", "day", "sort", "dir"].includes(k)); return serializeExtUrl({ ...s, ...(reset ? { page: 1 } : {}), ...patch }, cur); }, { replace: !push });
  }, [setSp]);
  return { state, update };
}

/** Polls the cheap /live fingerprint; when it changes, every query of this tab is refetched. */
export function useExtLive(processId: string, kind: Kind, refreshSeconds: number) {
  const qc = useQueryClient();
  const etag = useRef<string | undefined>(undefined);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t); }, []);
  useEffect(() => { etag.current = undefined; }, [processId]);
  const tick = useCallback(async () => {
    const r = await fetchLive(processId, kind);
    setCheckedAt(Date.now());
    const had = etag.current !== undefined;
    if (r.etag !== etag.current) { etag.current = r.etag; if (had) void qc.invalidateQueries({ queryKey: [`pd-${kind}`, processId] }); }
  }, [processId, kind, qc]);
  const poll = usePolling(tick, refreshSeconds, true);
  const refreshAll = useCallback(async () => { await Promise.all([qc.invalidateQueries({ queryKey: [`pd-${kind}`, processId] }), poll.refreshNow()]); }, [qc, kind, processId, poll]);
  return { poll, checkedAt, now, refreshAll };
}
