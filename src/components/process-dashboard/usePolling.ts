import { useCallback, useEffect, useRef, useState } from "react";
import { createPoller, type PollerState } from "./poller";

/** React wrapper: honours visibilitychange, pause/resume, manual refresh and backoff. `tick` may change freely between renders. */
export function usePolling(tick: () => Promise<void>, intervalSeconds: number, enabled = true) {
  const tickRef = useRef(tick); tickRef.current = tick;
  const [state, setState] = useState<PollerState>({ running: false, paused: false, hidden: false, failures: 0, nextDelayMs: intervalSeconds * 1000 });
  const pollerRef = useRef<ReturnType<typeof createPoller> | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const p = createPoller({ tick: () => tickRef.current(), intervalMs: Math.max(5, intervalSeconds) * 1000, onStateChange: setState });
    pollerRef.current = p;
    const onVis = () => p.setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVis);
    onVis(); p.start();
    return () => { document.removeEventListener("visibilitychange", onVis); p.stop(); pollerRef.current = null; };
  }, [intervalSeconds, enabled]);

  const pause = useCallback(() => pollerRef.current?.pause(), []);
  const resume = useCallback(() => pollerRef.current?.resume(), []);
  const refreshNow = useCallback(async () => { await pollerRef.current?.refreshNow(); }, []);
  return { ...state, pause, resume, refreshNow };
}
