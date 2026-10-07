// Keeps the P&L allocation summary warm so the Statement / Process Matrix never wait on a cold
// compute. getCachedAllocationSummary (canonical-pnl.service.ts) already serves the last good value
// and refreshes in the background — but only once a value exists. After every restart (each deploy)
// the first caller per period paid the full computation: measured 2026-10-06 on live, the Process
// Matrix summary took ~32 s cold and the Statement 50-90 s, against ~3 s warm. This fills the cache
// right after boot and keeps it fresh during working hours. The cache is per process, so this runs
// in the API server (server.ts). Disable with PNL_SUMMARY_WARM=false.
import { logger } from "../../logger.js";
import { getCachedAllocationSummary, shiftPeriod } from "./canonical-pnl.service.js";

const WARM_EVERY_MS = 10 * 60_000;
const FIRST_RUN_DELAY_MS = 45_000;
let timer: NodeJS.Timeout | null = null;

function istNow(): Date {
  return new Date(Date.now() + 5.5 * 3600_000);
}

/** The months people open: the one just closed (the P&L page default), the running one, and —
 *  from the 20th, when Branch Heads forecast — next month. */
export function periodsToWarm(now: Date = istNow()): string[] {
  const current = now.toISOString().slice(0, 7);
  const periods = [shiftPeriod(current, -1), current];
  if (now.getUTCDate() >= 20) periods.push(shiftPeriod(current, 1));
  return periods;
}

export async function warmPnlSummaryOnce(): Promise<void> {
  const hour = istNow().getUTCHours();
  if (hour < 6 || hour >= 23) return;
  // One period at a time: each compute is several dozen queries; running them together would
  // only contend with live traffic for the same connections.
  for (const period of periodsToWarm()) {
    const startedAt = Date.now();
    await getCachedAllocationSummary({ period });
    logger.info({ period, ms: Date.now() - startedAt }, "[pnl] allocation summary warmed");
  }
}

export function startPnlSummaryWarmer(env: NodeJS.ProcessEnv = process.env): void {
  if (timer || env.PNL_SUMMARY_WARM === "false") return;
  const loop = () => {
    void warmPnlSummaryOnce().catch((err) => logger.warn({ err: (err as Error).message }, "[pnl] summary warm failed"));
    timer = setTimeout(loop, WARM_EVERY_MS);
    timer.unref?.();
  };
  timer = setTimeout(loop, FIRST_RUN_DELAY_MS);
  timer.unref?.();
}

export function stopPnlSummaryWarmer(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
