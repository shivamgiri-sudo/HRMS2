import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { reconciliationService, shrinkageService, alertService } from "./rta.service.js";
import { nowIST } from "../../shared/timezone.js";
import { logger } from "../../lib/logger.js";

const RUN_HOUR   = 23;
const RUN_MINUTE = 15; // 15 min after attendance-engine sweep (23:00)
const SYSTEM_USER = "system-rta-nightly";

let nextRun: NodeJS.Timeout | undefined;

function yesterdayIST(): string {
  const today = nowIST().split("T")[0]!;
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const prev = new Date(y, m - 1, d - 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}-${String(prev.getDate()).padStart(2, "0")}`;
}

export async function runRtaNightly(): Promise<{ date: string; reconciled: number; alerts: number }> {
  const date = yesterdayIST();
  logger.info({ date }, "[RTA Nightly] Starting reconciliation + shrinkage + alerts");

  const reconResult = await reconciliationService.reconcileDate(date, { userId: SYSTEM_USER });
  logger.info({ date, ...reconResult }, "[RTA Nightly] Reconciliation complete");

  await shrinkageService.calculateSnapshot(date, { userId: SYSTEM_USER });
  logger.info({ date }, "[RTA Nightly] Shrinkage snapshot written");

  // Additionally compute a branch-scoped snapshot for each active branch, on
  // top of (not replacing) the org-wide row above. calculateSnapshot upserts
  // on (snapshot_date, process_id, branch_id) — see shrinkage_daily_snapshot's
  // uq_shr_date_proc unique key — so re-running this nightly for the same
  // date/branch is safe and idempotent. Process-level scoping is intentionally
  // NOT added here: wfm_roster_assignment.process_name is NULL on ~81% of
  // rows, so it isn't reliable enough yet (branch_name is populated on ~98%).
  // Each branch is isolated in its own try/catch, mirroring the per-employee
  // error-isolation pattern in performance-scorecard-snapshot.service.ts's
  // writeEmployeePerformanceSnapshots — one branch failing must not abort the
  // others or the org-wide call above.
  try {
    const [branchRows] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM branch_master WHERE active_status = 1"
    );
    for (const row of branchRows as RowDataPacket[]) {
      const branchId = row.id as string;
      try {
        await shrinkageService.calculateSnapshot(date, { branchId, userId: SYSTEM_USER });
      } catch (err) {
        logger.error({ err, date, branchId }, "[RTA Nightly] Branch shrinkage snapshot failed");
      }
    }
    logger.info({ date, branches: (branchRows as RowDataPacket[]).length }, "[RTA Nightly] Branch shrinkage snapshots complete");
  } catch (err) {
    logger.error({ err, date }, "[RTA Nightly] Failed to load active branches for shrinkage snapshots");
  }

  const alertsFired = await alertService.fireAlertsForDate(date, { userId: SYSTEM_USER });
  logger.info({ date, alertsFired }, "[RTA Nightly] Alerts fired");

  return { date, reconciled: reconResult.reconciled, alerts: alertsFired };
}

export function msUntilNextRtaRun(now = new Date()): number {
  const next = new Date(now);
  next.setHours(RUN_HOUR, RUN_MINUTE, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function startRtaNightlyCron(): void {
  if (nextRun) return;
  nextRun = setTimeout(async () => {
    try {
      await runRtaNightly();
    } catch (err) {
      logger.error({ err }, "[RTA Nightly] Pipeline failed");
    } finally {
      nextRun = undefined;
      startRtaNightlyCron();
    }
  }, msUntilNextRtaRun());
  nextRun.unref();
}

export function stopRtaNightlyCron(): void {
  if (nextRun) { clearTimeout(nextRun); nextRun = undefined; }
}
