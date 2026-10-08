import { processDueSchedules } from "./mis-schedule.service.js";

/**
 * Minute tick for scheduled MIS emails. Off unless MIS_EMAIL_SCHEDULER_ENABLED=true, so
 * starting the backend never sends mail by itself.
 *
 * Run it on ONE backend only. Two backends sharing the database cannot double-send (each run is
 * leased in its row before sending), but the second one would just do nothing useful.
 */
const TICK_MS = 60_000;
let timer: NodeJS.Timeout | null = null;
let ticking = false;

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const sent = await processDueSchedules(new Date());
    if (sent > 0) console.log(`[mis-schedule] sent ${sent} scheduled MIS email(s)`);
  } catch (err) {
    console.error("[mis-schedule] tick failed:", err instanceof Error ? err.message : err);
  } finally {
    ticking = false;
  }
}

export function startMisEmailScheduler(): void {
  if (timer) return;
  timer = setInterval(() => { void tick(); }, TICK_MS);
  timer.unref();
  console.log("[mis-schedule] scheduler started (checks every 60s)");
}

export function stopMisEmailScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
