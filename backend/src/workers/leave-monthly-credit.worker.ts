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
 * Credits 1 CL day (prorated for mid-month joiners) to every active employee.
 * Idempotent — skips employees that already have a record in leave_el_credit_log
 * for this leave_type / year / month / credit_type='monthly'.
 */
export async function creditCLMonthly(
  creditYear: number,
  creditMonth: number
): Promise<void> {
  console.log(
    `[LeaveMonthlyCreditWorker] Running CL monthly credit for ${creditYear}-${String(creditMonth).padStart(2, "0")}`
  );

  // 1. Resolve CL leave_type_id
  const [ltRows]: any = await db.execute(
    `SELECT id FROM leave_type_master WHERE leave_code = 'CL' LIMIT 1`
  );

  if (!ltRows || ltRows.length === 0) {
    console.error("[LeaveMonthlyCreditWorker] CL leave type not found in leave_type_master — aborting");
    return;
  }

  const leaveTypeId: string = ltRows[0].id;

  // 2. Fetch all active employees
  const [employees]: any = await db.execute(
    `SELECT id, date_of_joining FROM employees WHERE active_status = 1 AND employment_status = 'active'`
  );

  if (!employees || employees.length === 0) {
    console.log("[LeaveMonthlyCreditWorker] No active employees found — nothing to credit");
    return;
  }

  let credited = 0;
  let skipped = 0;

  // 3. Process each employee
  for (const emp of employees) {
    const employeeId: string = emp.id;
    const dateOfJoining: string = emp.date_of_joining;

    // 3a. Compute prorated days
    const daysToCredit = prorateMonthlyCredit(dateOfJoining, creditMonth, creditYear);

    // 3b. Skip if no days to credit (employee joined after the credit month)
    if (daysToCredit <= 0) {
      skipped++;
      continue;
    }

    // 3c. Idempotency check — has this employee already been credited this month?
    const [existingRows]: any = await db.execute(
      `SELECT 1 FROM leave_el_credit_log
       WHERE employee_id   = ?
         AND leave_type_id = ?
         AND credit_year   = ?
         AND credit_month  = ?
         AND credit_type   = 'monthly'
       LIMIT 1`,
      [employeeId, leaveTypeId, creditYear, creditMonth]
    );

    if (existingRows && existingRows.length > 0) {
      // 3d. Already credited — skip (idempotent)
      skipped++;
      continue;
    }

    // 3e. Upsert leave_balance_ledger
    await db.execute(
      `INSERT INTO leave_balance_ledger
         (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
       VALUES (UUID(), ?, ?, ?, ?, 0, 0)
       ON DUPLICATE KEY UPDATE allocated_days = allocated_days + ?`,
      [employeeId, leaveTypeId, creditYear, daysToCredit, daysToCredit]
    );

    // 3f. Insert audit record into leave_el_credit_log
    await db.execute(
      `INSERT INTO leave_el_credit_log
         (id, employee_id, leave_type_id, credit_year, credit_month, credit_date, days_credited, months_served, credit_type)
       VALUES (UUID(), ?, ?, ?, ?, CURDATE(), ?, 0, 'monthly')`,
      [employeeId, leaveTypeId, creditYear, creditMonth, daysToCredit]
    );

    credited++;
  }

  // 4. Summary log
  console.log(
    `[LeaveMonthlyCreditWorker] Done — credited: ${credited}, skipped: ${skipped}`
  );
}

// ── Worker Loop ──────────────────────────────────────────────────────────────

/**
 * On each 6-hour tick, check whether today is the 1st of the month.
 * If so, run the CL monthly credit job.
 */
async function checkAndRun(): Promise<void> {
  const now = new Date();
  const dayOfMonth = now.getDate();

  if (dayOfMonth !== 1) {
    console.log(
      `[LeaveMonthlyCreditWorker] Today is the ${dayOfMonth}${dayOfMonth === 2 ? "nd" : dayOfMonth === 3 ? "rd" : "th"} — not the 1st, skipping`
    );
    return;
  }

  const creditYear = now.getFullYear();
  const creditMonth = now.getMonth() + 1; // 1-indexed

  try {
    await creditCLMonthly(creditYear, creditMonth);
  } catch (error: any) {
    console.error("[LeaveMonthlyCreditWorker] Error during creditCLMonthly:", error.message);
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

export { startWorker as startLeaveMonthlyCreditWorker };
