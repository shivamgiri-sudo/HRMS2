/**
 * Payroll Readiness Refresh Worker
 *
 * payroll_branch_readiness (bank_details_pct, uan_complete_pct, noc_resolved,
 * holiday_work_approved, readiness_score, readiness_status) is only ever recomputed
 * on demand — payrollBranchReadinessService.getOrRefresh() runs when a human opens
 * the branch-readiness summary or a specific branch/process detail. There was no
 * background job keeping it current.
 *
 * Confirmed live 2026-08-13: three real branches for the active 2026-07 payroll
 * cycle sat at readiness_score = 0.00 for 11–16 days despite bank_details_pct of
 * 79–90% on the same rows — not a computation bug (verified computeScore() against
 * the rows' own live field values correctly produces 22–24), just staleness: nobody
 * had reopened that month's dashboard. A payroll release gate showing numbers that
 * are two weeks stale to anyone who glances at it without manually refreshing is
 * itself a real gap, separate from any calculation defect.
 *
 * This worker periodically calls the exact same getHOSummary() path a human loading
 * the summary page triggers, for every currently in-progress payroll month — so the
 * dashboard is never more than one interval stale, whether or not anyone has opened
 * it recently.
 *
 * Scope: only 'draft'/'processing' salary_prep_run months, not 'approved' or
 * 'FINALIZED'. Live check 2026-08-13: a naive "not finalized" filter matches 15
 * months back to 2025-04 (mostly 'approved' — already past the prep-gate stage,
 * awaiting lock/disbursement). Recomputing "live" bank%/UAN% against *today's*
 * employee data for a year-old approved month would attribute current completion
 * figures to a closed cycle, which is wrong, not just wasteful. 'draft'/'processing'
 * are the stages where this dashboard is actually the gate — narrowing to them was
 * a deliberate choice, not an oversight (live count 2026-08-13: exactly 3 months).
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";
import { payrollBranchReadinessService } from "../modules/payroll/payroll-branch-readiness.service.js";
import { withWorkerLock, registerTimer, unregisterTimer } from "./worker-utils.js";

const WORKER_NAME = "payroll-readiness-refresh";
const INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours — live active-branch count is 7, cheap at this cadence

let intervalTimer: NodeJS.Timeout | null = null;

function isMissingTableError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && String((error as { code?: unknown }).code ?? "") === "ER_NO_SUCH_TABLE";
}

async function getOpenPayrollMonths(): Promise<string[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT run_month FROM salary_prep_run
      WHERE LOWER(COALESCE(status, '')) IN ('draft', 'processing')
      ORDER BY run_month DESC`
  );
  return (rows as RowDataPacket[]).map((r) => String(r.run_month));
}

async function runRefresh(): Promise<void> {
  let months: string[];
  try {
    months = await getOpenPayrollMonths();
  } catch (err: unknown) {
    if (isMissingTableError(err)) {
      console.warn(`[${WORKER_NAME}] salary_prep_run missing — skipping until migrated`);
      return;
    }
    throw err;
  }

  if (months.length === 0) {
    console.log(`[${WORKER_NAME}] No draft/processing payroll months — nothing to refresh`);
    return;
  }

  let branchesRefreshed = 0;
  for (const month of months) {
    try {
      const records = await payrollBranchReadinessService.getHOSummary(month);
      branchesRefreshed += records.length;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[${WORKER_NAME}] getHOSummary failed for ${month}: ${msg}`);
    }
  }

  console.log(
    `[${WORKER_NAME}] Refreshed ${months.length} open month(s) [${months.join(", ")}], ${branchesRefreshed} branch-record(s) total`
  );
}

async function runGuarded(): Promise<void> {
  try {
    await withWorkerLock(WORKER_NAME, runRefresh);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${WORKER_NAME}] Error:`, msg);
  }
}

export async function startPayrollReadinessRefreshWorker(): Promise<void> {
  console.log(`[${WORKER_NAME}] Starting (interval: ${INTERVAL_MS / 3600000}h)`);
  void runGuarded();
  intervalTimer = setInterval(() => void runGuarded(), INTERVAL_MS);
  registerTimer(`${WORKER_NAME}-interval`, intervalTimer);
}

export function stopPayrollReadinessRefreshWorker(): void {
  if (intervalTimer) {
    clearInterval(intervalTimer);
    unregisterTimer(`${WORKER_NAME}-interval`);
    intervalTimer = null;
  }
  console.log(`[${WORKER_NAME}] stopped`);
}
