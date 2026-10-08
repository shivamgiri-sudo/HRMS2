/**
 * Framework-free polling controller: fixed interval while healthy, exponential backoff on failures,
 * suspended while the tab is hidden or the user paused. Kept pure so it is testable with fake timers.
 */
export interface PollerOptions {
  tick: () => Promise<void>;
  intervalMs: number;
  maxBackoffMs?: number;
  onStateChange?: (s: PollerState) => void;
}
export interface PollerState { running: boolean; paused: boolean; hidden: boolean; failures: number; nextDelayMs: number }

export function backoffDelay(intervalMs: number, failures: number, maxMs = 5 * 60_000): number {
  return failures <= 0 ? intervalMs : Math.min(maxMs, intervalMs * 2 ** failures);
}

export function createPoller(opts: PollerOptions) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false, paused = false, hidden = false, inflight = false, failures = 0, gen = 0;
  const snapshot = (): PollerState => ({ running, paused, hidden, failures, nextDelayMs: backoffDelay(opts.intervalMs, failures, opts.maxBackoffMs) });
  const emit = () => opts.onStateChange?.(snapshot());
  const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const active = () => running && !paused && !hidden;
  const schedule = () => {
    clear();
    if (!active()) return;
    timer = setTimeout(() => void run(), backoffDelay(opts.intervalMs, failures, opts.maxBackoffMs));
  };
  async function run() {
    if (inflight || !active()) return;
    inflight = true; const g = gen;
    try { await opts.tick(); failures = 0; } catch { failures += 1; }
    inflight = false;
    if (g !== gen) return;
    emit(); schedule();
  }
  return {
    start() { if (running) return; running = true; gen++; emit(); schedule(); },
    stop() { running = false; gen++; clear(); emit(); },
    pause() { paused = true; clear(); emit(); },
    resume() { if (!paused) return; paused = false; emit(); void run(); },
    setHidden(h: boolean) { if (hidden === h) return; hidden = h; emit(); if (h) clear(); else if (active()) void run(); },
    /** Manual refresh: runs now regardless of pause, then re-arms the timer. */
    async refreshNow() { clear(); const wasPaused = paused; paused = false; await run(); paused = wasPaused; emit(); schedule(); },
    state: snapshot,
  };
}
