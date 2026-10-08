// Keeps the P&L allocation summary warm so the Statement / Process Matrix never wait on a cold
// compute. getCachedAllocationSummary (canonical-pnl.service.ts) already serves the last good value
// and refreshes in the background — but only once a value exists. After every restart (each deploy)
// the first caller per period paid the full computation: measured 2026-10-06 on live, the Process
// Matrix summary took ~32 s cold and the Statement 50-90 s, against ~3 s warm. This fills the cache
// right after boot and keeps it fresh during working hours. The cache is per process, so this runs
// in the API server (server.ts). Disable with PNL_SUMMARY_WARM=false.
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { refreshAllocationSummary, shiftPeriod } from "./canonical-pnl.service.js";
import { OWN_COMPANY_SQL } from "./pnl-actuals.service.js";

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

/** Branches with an active MAS cost centre — the ones a Branch Head opens the P&L for. */
async function tradingBranchIds(): Promise<string[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT ccm.branch_id FROM cost_centre_master ccm
      WHERE ccm.active_status = 1 AND ccm.branch_id IS NOT NULL AND ${OWN_COMPANY_SQL}`,
  );
  return rows.map((r) => String(r.branch_id));
}

/**
 * The exact cache scopes the P&L routes build (scopedFilters in process-pnl.routes.ts /
 * bpo-pnl.routes.ts): { period } for a company-wide user, and { period, branchId, branchIds:[id] }
 * for a user confined to one branch — the same shape, so the warmed entry is the one they read.
 */
export function scopesToWarm(period: string, branchIds: string[]) {
  return [{ period }, ...branchIds.map((id) => ({ period, branchId: id, branchIds: [id] }))];
}

export async function warmPnlSummaryOnce(): Promise<void> {
  const hour = istNow().getUTCHours();
  if (hour < 6 || hour >= 23) return;
  const branches = await tradingBranchIds().catch(() => [] as string[]);
  // One scope at a time: each compute is several dozen queries; running them together would only
  // contend with live traffic for the same connections.
  for (const period of periodsToWarm()) {
    for (const scope of scopesToWarm(period, branches)) {
      const startedAt = Date.now();
      try {
        await refreshAllocationSummary(scope);
        logger.info({ period, branchId: (scope as { branchId?: string }).branchId ?? "all", ms: Date.now() - startedAt }, "[pnl] allocation summary warmed");
      } catch (err) {
        logger.warn({ period, err: (err as Error).message }, "[pnl] allocation summary warm failed");
      }
    }
  }
}

export function startPnlSummaryWarmer(env: NodeJS.ProcessEnv = process.env): void {
  if (timer || env.PNL_SUMMARY_WARM === "false") return;
  // The next round is scheduled only once this one has finished: a round over the company plus
  // every branch can take minutes, and overlapping rounds would double the database load.
  const loop = async () => {
    await warmPnlSummaryOnce().catch((err) => logger.warn({ err: (err as Error).message }, "[pnl] summary warm failed"));
    timer = setTimeout(() => void loop(), WARM_EVERY_MS);
    timer.unref?.();
  };
  timer = setTimeout(() => void loop(), FIRST_RUN_DELAY_MS);
  timer.unref?.();
}

export function stopPnlSummaryWarmer(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
