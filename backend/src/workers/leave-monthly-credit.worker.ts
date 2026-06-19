// Database connection (lazy import — same pattern as sla-breach-worker.ts)
let db: any;
try {
  const dbModule = await import("../db/mysql.js");
  db = dbModule.db;
} catch {
  console.error("[LeaveMonthlyCreditWorker] Database module not found - worker will not run");
  process.exit(1);
}

// ── Configuration ────────────────────────────────────────────────────────────

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // Check every 6 hours

// ── Business Logic ───────────────────────────────────────────────────────────

/**
 * Inline prorate logic — intentionally NOT imported from leave-policy.service
 * to keep this worker self-contained.
 *
 * Returns:
 *   1.0  — employee joined before the credit month (full credit)
 *   0..1 — employee joined during the credit month (prorated)
 *   0    — employee joins after the credit month (no credit)
 */
function prorateMonthlyCredit(
  joinDateStr: string,
  creditMonth: number,
  creditYear: number
): number {
  const join = new Date(joinDateStr);
  const joinYear = join.getFullYear();
  const joinMonth = join.getMonth() + 1; // 1-indexed
  const joinDay = join.getDate();

  if (joinYear < creditYear || (joinYear === creditYear && joinMonth < creditMonth)) {
    return 1.0;
  }

  if (joinYear === creditYear && joinMonth === creditMonth) {
    // new Date(year, month, 0) → last day of the credit month (month is 1-indexed, day 0 = prev month last day)
    const daysInMonth = new Date(creditYear, creditMonth, 0).getDate();
    const daysRemaining = daysInMonth - joinDay + 1;
    return Math.round((daysRemaining / daysInMonth) * 100) / 100;
  }

  return 0; // joined after the credit month
}

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

  const RATES: Record<string, number> = { CL: 0.583, ML: 0.417, EL: 1.500 };
  let credited = 0, skipped = 0;

  for (const emp of employees) {
    try {
      for (const code of ['CL', 'ML', 'EL']) {
        const leaveTypeId = leaveTypeMap[code];
        const rate = RATES[code];
        const daysToCredit = prorateMonthlyCredit(emp.date_of_joining, creditMonth, creditYear) * rate;
        if (daysToCredit <= 0) continue;
        const roundedDays = Math.round(daysToCredit * 1000) / 1000;

        // Idempotency check
        const [exists]: any = await db.execute(
          `SELECT 1 FROM leave_el_credit_log WHERE employee_id=? AND leave_type_id=? AND credit_year=? AND credit_month=? AND credit_type='monthly' LIMIT 1`,
          [emp.id, leaveTypeId, creditYear, creditMonth]
        );
        if (exists.length > 0) continue;

        if (code === 'EL') {
          // EL goes to accrual ledger, NOT balance ledger
          await db.execute(
            `INSERT INTO leave_el_accrual_ledger (id, employee_id, accrual_year, accrued_days, last_credited_month)
             VALUES (UUID(), ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE accrued_days = accrued_days + ?, last_credited_month = ?`,
            [emp.id, creditYear, roundedDays, creditMonth, roundedDays, creditMonth]
          );
        } else {
          // CL and ML go to balance ledger (spendable immediately)
          await db.execute(
            `INSERT INTO leave_balance_ledger (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
             VALUES (UUID(), ?, ?, ?, ?, 0, 0)
             ON DUPLICATE KEY UPDATE allocated_days = allocated_days + ?`,
            [emp.id, leaveTypeId, creditYear, roundedDays, roundedDays]
          );
        }

        // Audit log
        await db.execute(
          `INSERT INTO leave_el_credit_log (id, employee_id, leave_type_id, credit_year, credit_month, credit_date, days_credited, months_served, credit_type)
           VALUES (UUID(), ?, ?, ?, ?, CURDATE(), ?, 0, 'monthly')`,
          [emp.id, leaveTypeId, creditYear, creditMonth, roundedDays]
        );
      }
      credited++;
    } catch (err: any) {
      console.error(`[LeaveMonthlyWorker] Error for employee ${emp.id}:`, err.message);
      skipped++;
    }
  }

  console.log(`[LeaveMonthlyWorker] Done — credited: ${credited}, skipped: ${skipped}`);
}

// ── Worker Loop ──────────────────────────────────────────────────────────────

/**
 * On each 6-hour tick, check whether today is the 1st of the month.
 * If so, run the monthly leave credit job.
 */
async function checkAndRun(): Promise<void> {
  const now = new Date();
  if (now.getDate() !== 1) {
    console.log(`[LeaveMonthlyWorker] Day ${now.getDate()} — not 1st, skipping`);
    return;
  }
  const creditYear = now.getFullYear();
  const creditMonth = now.getMonth() + 1;
  try {
    await creditMonthlyLeaves(creditYear, creditMonth);
  } catch (err: any) {
    console.error('[LeaveMonthlyWorker] Error:', err.message);
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
  setInterval(async () => {
    await checkAndRun();
  }, CHECK_INTERVAL_MS);
}

// ── Start Worker ─────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  startWorker().catch((error) => {
    console.error("[LeaveMonthlyCreditWorker] Fatal error:", error);
    process.exit(1);
  });
}

export { startWorker as startLeaveMonthlyWorker };
