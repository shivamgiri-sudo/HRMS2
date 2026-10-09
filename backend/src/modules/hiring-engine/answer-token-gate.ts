/**
 * Per-token guard for the public answer endpoint (I-5): one answer at a time per token (a second concurrent tap is told "busy, try again"
 * instead of queueing for the engine lock and a pool connection) and at most 10 answers per token per 10 minutes. In-process.
 */
const WINDOW_MS = 10 * 60_000;
const MAX_PER_WINDOW = 10;
const inFlight = new Set<string>();
const recent = new Map<string, number[]>();

export type GateResult = "ok" | "busy" | "too_many";

export function enterAnswerGate(token: string, now: number = Date.now()): GateResult {
  if (inFlight.has(token)) return "busy";
  const times = (recent.get(token) ?? []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= MAX_PER_WINDOW) { recent.set(token, times); return "too_many"; }
  times.push(now);
  recent.set(token, times);
  if (recent.size > 10_000) for (const [k, v] of recent) if (!v.some((t) => now - t < WINDOW_MS)) recent.delete(k);
  inFlight.add(token);
  return "ok";
}

export function leaveAnswerGate(token: string): void { inFlight.delete(token); }

/** Test hook. */
export function _resetAnswerGate(): void { inFlight.clear(); recent.clear(); }
