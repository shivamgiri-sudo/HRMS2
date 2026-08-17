// Database connection (lazy import — same pattern as sla-breach-worker.ts)
let db: any;
try {
  const dbModule = await import("../db/mysql.js");
  db = dbModule.db;
} catch {
  console.error("[LeaveMonthlyCreditWorker] Database module not found - worker will not run");
  process.exit(1);
}

// prorateMonthlyCredit used to be duplicated here as a self-contained inline copy —
// this worker used it in production while an identical, unit-tested copy sat in
// leave-policy.service.ts with zero live callers, so a future fix to the tested
// copy would silently not affect real behaviour. Now imports the one tested
// implementation; the formula is unchanged (verified byte-identical before the
// switch). (2026-08-13 audit)
import { leavePolicyService } from "../modules/leave/leave-policy.service.js";
const { prorateMonthlyCredit } = leavePolicyService;

// ── Configuration ────────────────────────────────────────────────────────────

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // Check every 6 hours

let intervalRef: ReturnType<typeof setInterval> | undefined;

// ── Business Logic ───────────────────────────────────────────────────────────

// ── Core Processing Function ─────────────────────────────────────────────────

/**
 * Credits CL (0.583/mo) and ML (0.417/mo) to leave_balance_ledger, and
 * EL (1.5/mo) to leave_el_accrual_ledger for every active employee.
 * Idempotent — skips employees that already have a record in leave_el_credit_log
 * for this leave_type / year / month / credit_type='monthly'.
 */
export async function creditMonthlyLeaves(
  creditYear: number,
  creditMonth: number
): Promise<void> {
  console.log(`[LeaveMonthlyWorker] Running monthly leave credit for ${creditYear}-${String(creditMonth).padStart(2, '0')}`);

  // Resolve leave type IDs
  const [ltRows]: any = await db.execute(
    `SELECT id, leave_code FROM leave_type_master WHERE leave_code IN ('CL', 'ML', 'EL') AND active_status = 1`
  );
  const leaveTypeMap: Record<string, string> = {};
  for (const r of ltRows) leaveTypeMap[r.leave_code] = r.id;

  if (!leaveTypeMap['CL'] || !leaveTypeMap['ML'] || !leaveTypeMap['EL']) {
    console.error('[LeaveMonthlyWorker] CL, ML, or EL leave type missing — aborting');
    return;
  }

  // Fetch all active employees
  const [employees]: any = await db.execute(
    `SELECT id, date_of_joining FROM employees WHERE active_status = 1 AND employment_status = 'active'`
  );

  // Load CL/ML schedule for this month (whole-number credits via leave_credit_schedule)
  const [scheduleRows]: any = await db.execute(
    `SELECT lcs.month, lcs.leave_code, lcs.credit_days, lt.id AS leave_type_id
     FROM leave_credit_schedule lcs
     JOIN leave_type_master lt ON lt.leave_code = lcs.leave_code AND lt.active_status = 1
     WHERE lcs.month = ?`,
    [creditMonth]
  );

  let credited = 0, skipped = 0;

  for (const emp of employees) {
    try {
      // Credit from schedule (CL/ML whole numbers)
      for (const schedule of scheduleRows) {
        const proration = prorateMonthlyCredit(emp.date_of_joining, creditMonth, creditYear);
        const daysToCredit = Math.round(proration * schedule.credit_days * 10) / 10;
        if (daysToCredit <= 0) continue;

        // Idempotency check
        const [exists]: any = await db.execute(
          `SELECT 1 FROM leave_el_credit_log WHERE employee_id=? AND leave_type_id=? AND credit_year=? AND credit_month=? AND credit_type='monthly' LIMIT 1`,
          [emp.id, schedule.leave_type_id, creditYear, creditMonth]
        );
        if (exists.length > 0) continue;

        // CL/ML from schedule: go to balance ledger (spendable immediately)
        await db.execute(
          `INSERT INTO leave_balance_ledger (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
           VALUES (UUID(), ?, ?, ?, ?, 0, 0)
           ON DUPLICATE KEY UPDATE allocated_days = allocated_days + ?`,
          [emp.id, schedule.leave_type_id, creditYear, daysToCredit, daysToCredit]
        );

        // Audit log
        await db.execute(
          `INSERT INTO leave_el_credit_log (id, employee_id, leave_type_id, credit_year, credit_month, credit_date, days_credited, months_served, credit_type)
           VALUES (UUID(), ?, ?, ?, ?, CURDATE(), ?, 0, 'monthly')`,
          [emp.id, schedule.leave_type_id, creditYear, creditMonth, daysToCredit]
        );
      }

      // Credit EL (1.5/month to accrual ledger, unchanged logic)
      if (!leaveTypeMap['EL']) {
        continue;
      }
      const elRate = 1.500;
      const elDaysToCredit = prorateMonthlyCredit(emp.date_of_joining, creditMonth, creditYear) * elRate;
      if (elDaysToCredit > 0) {
        const elRoundedDays = Math.round(elDaysToCredit * 1000) / 1000;

        // Idempotency check for EL
        const [elExists]: any = await db.execute(
          `SELECT 1 FROM leave_el_credit_log WHERE employee_id=? AND leave_type_id=? AND credit_year=? AND credit_month=? AND credit_type='monthly' LIMIT 1`,
          [emp.id, leaveTypeMap['EL'], creditYear, creditMonth]
        );
        if (elExists.length === 0) {
          await db.execute(
            `INSERT INTO leave_el_accrual_ledger (id, employee_id, accrual_year, accrued_days, last_credited_month)
             VALUES (UUID(), ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE accrued_days = accrued_days + ?, last_credited_month = ?`,
            [emp.id, creditYear, elRoundedDays, creditMonth, elRoundedDays, creditMonth]
          );

          // EL audit log
          await db.execute(
            `INSERT INTO leave_el_credit_log (id, employee_id, leave_type_id, credit_year, credit_month, credit_date, days_credited, months_served, credit_type)
             VALUES (UUID(), ?, ?, ?, ?, CURDATE(), ?, 0, 'monthly')`,
            [emp.id, leaveTypeMap['EL'], creditYear, creditMonth, elRoundedDays]
          );
        }
      }

      credited++;
    } catch (err: any) {
      console.error(`[LeaveMonthlyWorker] Error for employee ${emp.id}:`, err.message);
      skipped++;
    }
  }

  console.log(`[LeaveMonthlyWorker] Done — credited: ${credited}, skipped: ${skipped}`);
}

// ── Catch-up Logic ───────────────────────────────────────────────────────────

/**
 * Back-fills leave credits for employees who missed a prior month's run.
 *
 * A month qualifies for catch-up only when:
 *   (a) the worker already ran it for SOME employees (evidence in leave_el_credit_log), AND
 *   (b) at least one currently-active employee who joined BEFORE that month
 *       has no credit log entry for any leave type scheduled for that month.
 *
 * Condition (a) prevents double-crediting months that were seeded manually
 * (e.g. EL Jan–Jun 2026 were seeded via migration, not worker-run).
 * Condition (b) uses strict "joined before month-start" so proration = 1.0 is
 * guaranteed — employees who joined mid-month and got 0 days by proration are
 * not incorrectly flagged as missed.
 */
async function runCatchUp(year: number, upToMonth: number): Promise<void> {
  const [scheduleRows]: any = await db.execute(
    `SELECT DISTINCT month FROM leave_credit_schedule WHERE month <= ? ORDER BY month`,
    [upToMonth]
  );

  for (const { month } of scheduleRows) {
    // (a) Worker must have already run for at least one employee this month
    const [ran]: any = await db.execute(
      `SELECT COUNT(*) AS cnt
       FROM leave_el_credit_log l
       JOIN leave_type_master lt ON lt.id = l.leave_type_id
       JOIN leave_credit_schedule lcs ON lcs.leave_code = lt.leave_code AND lcs.month = ?
       WHERE l.credit_year = ? AND l.credit_month = ? AND l.credit_type = 'monthly'`,
      [month, year, month]
    );
    if (Number(ran[0]?.cnt ?? 0) === 0) continue;

    // (b) Any active employee who joined strictly before this month and has no entry?
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const [result]: any = await db.execute(
      `SELECT COUNT(*) AS gap
       FROM employees e
       WHERE e.active_status = 1
         AND e.employment_status = 'active'
         AND e.date_of_joining IS NOT NULL
         AND e.date_of_joining < ?
         AND NOT EXISTS (
           SELECT 1
           FROM leave_el_credit_log l2
           JOIN leave_type_master lt2 ON lt2.id = l2.leave_type_id
           WHERE l2.employee_id = e.id
             AND l2.credit_year  = ?
             AND l2.credit_month = ?
             AND l2.credit_type  = 'monthly'
             AND lt2.leave_code IN (
               SELECT leave_code FROM leave_credit_schedule WHERE month = ?
             )
         )`,
      [monthStart, year, month, month]
    );

    const gap = Number(result[0]?.gap ?? 0);
    if (gap > 0) {
      console.log(`[LeaveMonthlyWorker] Catch-up: ${gap} employees missed ${year}-${String(month).padStart(2, '0')} — back-filling`);
      await creditMonthlyLeaves(year, month);
    }
  }
}

// ── Worker Loop ──────────────────────────────────────────────────────────────

/**
 * On each 6-hour tick:
 *  1. Back-fill any employee who missed a prior month's credit (catch-up).
 *  2. If today is the 1st, run the new month's credit.
 */
async function checkAndRun(): Promise<void> {
  const now = new Date();
  const creditYear  = now.getFullYear();
  const creditMonth = now.getMonth() + 1;

  // Back-fill past months that have gaps (safe: idempotent, skips already-credited)
  const catchUpUpto = now.getDate() === 1 ? creditMonth - 1 : creditMonth - 1;
  if (catchUpUpto >= 1) {
    try {
      await runCatchUp(creditYear, catchUpUpto);
    } catch (err: any) {
      console.error('[LeaveMonthlyWorker] Catch-up error:', err.message);
    }
  }

  // New month credit on the 1st
  if (now.getDate() === 1) {
    try {
      await creditMonthlyLeaves(creditYear, creditMonth);
    } catch (err: any) {
      console.error('[LeaveMonthlyWorker] Monthly credit error:', err.message);
    }
  } else {
    console.log(`[LeaveMonthlyWorker] Day ${now.getDate()} — not 1st, skipping new credit`);
  }
}

/**
 * Start the monthly CL credit worker.
 */
export async function startWorker(): Promise<void> {
  console.log("[LeaveMonthlyCreditWorker] Starting...");
  console.log(`[LeaveMonthlyCreditWorker] Check interval: every ${CHECK_INTERVAL_MS / (60 * 60 * 1000)} hours`);

  // Run immediately on startup (handles the case where the process restarted on the 1st)
  await checkAndRun();

  // Then run on every 6-hour tick
  intervalRef = setInterval(async () => {
    await checkAndRun();
  }, CHECK_INTERVAL_MS);
}

function stopWorker(): void {
  if (intervalRef) {
    clearInterval(intervalRef);
    intervalRef = undefined;
  }
  console.log("[LeaveMonthlyCreditWorker] Stopped");
}

// ── Start Worker ─────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  startWorker().catch((error) => {
    console.error("[LeaveMonthlyCreditWorker] Fatal error:", error);
    process.exit(1);
  });
}

export { startWorker as startLeaveMonthlyWorker, stopWorker as stopLeaveMonthlyWorker };
