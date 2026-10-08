// Keeps the Ops Control Tower summary cache warm so the page opens instantly instead of waiting on the
// 12-40 s org-wide computation. Cache is per process, so this runs in the API server. Disable with
// OPS_SUMMARY_WARM=false. Daytime only (06:00-23:00 IST) to avoid pointless overnight database load.
import { logger } from "../../logger.js";
import { getOpsControlTowerSummary } from "./ops-control-tower.service.js";
import { refreshSummary } from "./ops-summary-cache.js";

const WARM_EVERY_MS = 4 * 60_000;
const FIRST_RUN_DELAY_MS = 20_000;
let timer: NodeJS.Timeout | null = null;

function istDate(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function istHour(): number {
  return Number(new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false })) % 24;
}

export async function warmOpsSummaryOnce(): Promise<void> {
  const hour = istHour();
  if (hour < 6 || hour >= 23) return;
  for (const date of [istDate(0), istDate(-1)]) {
    const startedAt = Date.now();
    await refreshSummary(date, () => getOpsControlTowerSummary(date));
    logger.info({ date, ms: Date.now() - startedAt }, "[ops-control-tower] summary cache warmed");
  }
}

export function startOpsSummaryWarmer(env: NodeJS.ProcessEnv = process.env): void {
  if (timer || env.OPS_SUMMARY_WARM === "false") return;
  const loop = () => {
    void warmOpsSummaryOnce().catch((err) => logger.warn({ err: (err as Error).message }, "[ops-control-tower] warm failed"));
    timer = setTimeout(loop, WARM_EVERY_MS);
    timer.unref?.();
  };
  timer = setTimeout(loop, FIRST_RUN_DELAY_MS);
  timer.unref?.();
}

export function stopOpsSummaryWarmer(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
