// Database connection
let db: any;
try {
  const dbModule = await import("../db/mysql.js");
  db = dbModule.db;
} catch {
  console.error("[ELAnnualCreditWorker] Database module not found - worker will not run");
  process.exit(1);
}

// ── Configuration ────────────────────────────────────────────────────────────

const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // Check every 12 hours

// ── Business Logic ───────────────────────────────────────────────────────────

/**
 * Compute prorated annual EL credit for an employee.
 * creditYear is the year for which credit is being granted (i.e., the current year).
 * monthsServed is calculated from the prior year (creditYear - 1).
 */
function prorateAnnualCredit(
  joinDateStr: string,
  creditYear: number
): { daysToCredit: number; monthsServed: number } {
  const join = new Date(joinDateStr);
  const joinYear = join.getFullYear();
  const joinMonth = join.getMonth() + 1; // 1-indexed
  const priorYear = creditYear - 1;

  let monthsServed: number;
  if (joinYear < priorYear) {
    // Joined before the prior year — full 12 months served
    monthsServed = 12;
  } else if (joinYear === priorYear) {
    // Joined during the prior year — partial months served
    // e.g., joined July (month 7) → 12 - 7 + 1 = 6 months
    monthsServed = 12 - joinMonth + 1;
  } else {
    // Joined in creditYear or later — no credit
    monthsServed = 0;
  }

  const daysToCredit = Math.round((18 * monthsServed / 12) * 100) / 100;
  return { daysToCredit, monthsServed };
}

// ── Core Processing ──────────────────────────────────────────────────────────

/**
 * Credit annual EL days to all eligible active employees for the given year.
 * This function is idempotent — it will skip employees already credited for creditYear.
 */
export async function creditELAnnual(creditYear: number): Promise<void> {
  console.log(`[ELAnnualCreditWorker] Starting annual EL credit for year ${creditYear}...`);

  // 1. Get EL leave_type_id
  let elLeaveTypeId: string;
  try {
    const [ltRows]: any = await db.execute(
      `SELECT id FROM leave_type_master WHERE leave_code = 'EL' LIMIT 1`
    );
    if (!ltRows || ltRows.length === 0) {
      console.error("[ELAnnualCreditWorker] EL leave type not found in leave_type_master. Aborting.");
      return;
    }
    elLeaveTypeId = ltRows[0].id;
    console.log(`[ELAnnualCreditWorker] EL leave_type_id: ${elLeaveTypeId}`);
  } catch (error: any) {
    console.error("[ELAnnualCreditWorker] Failed to fetch EL leave type:", error.message);
    return;
  }

  // 2. Get all active employees
  let employees: Array<{ id: string; date_of_joining: string }>;
  try {
    const [empRows]: any = await db.execute(
      `SELECT id, date_of_joining FROM employees WHERE active_status = 1 AND employment_status = 'active'`
    );
    employees = empRows || [];
    console.log(`[ELAnnualCreditWorker] Found ${employees.length} active employees`);
  } catch (error: any) {
    console.error("[ELAnnualCreditWorker] Failed to fetch employees:", error.message);
    return;
  }

  let credited = 0;
  let skipped = 0;

  // 3. Process each employee
  for (const emp of employees) {
    try {
      // a. Compute prorated credit
      const { daysToCredit, monthsServed } = prorateAnnualCredit(emp.date_of_joining, creditYear);

      // b. Skip if no credit due
      if (daysToCredit <= 0) {
        skipped++;
        continue;
      }

      // c. Check idempotency — has this employee already been credited for this year?
      const [existingRows]: any = await db.execute(
        `SELECT 1 FROM leave_el_credit_log
         WHERE employee_id = ? AND leave_type_id = ? AND credit_year = ? AND credit_month IS NULL AND credit_type = 'annual'
         LIMIT 1`,
        [emp.id, elLeaveTypeId, creditYear]
      );

      // d. Skip if already credited
      if (existingRows && existingRows.length > 0) {
        console.log(`[ELAnnualCreditWorker] Skipping employee ${emp.id} — already credited for ${creditYear}`);
        skipped++;
        continue;
      }

      // e. Upsert leave_balance_ledger — SET (not add) allocated_days for annual entitlement
      await db.execute(
        `INSERT INTO leave_balance_ledger (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
         VALUES (UUID(), ?, ?, ?, ?, 0, 0) AS new_row
         ON DUPLICATE KEY UPDATE allocated_days = new_row.allocated_days`,
        [emp.id, elLeaveTypeId, creditYear, daysToCredit]
      );

      // f. Insert credit log entry
      await db.execute(
        `INSERT INTO leave_el_credit_log (id, employee_id, leave_type_id, credit_year, credit_month, credit_date, days_credited, months_served, credit_type)
         VALUES (UUID(), ?, ?, ?, NULL, CURDATE(), ?, ?, 'annual')`,
        [emp.id, elLeaveTypeId, creditYear, daysToCredit, monthsServed]
      );

      console.log(`[ELAnnualCreditWorker] Credited employee ${emp.id}: ${daysToCredit} days (${monthsServed} months served)`);
      credited++;
    } catch (error: any) {
      console.error(`[ELAnnualCreditWorker] Error processing employee ${emp.id}:`, error.message);
      skipped++;
    }
  }

  console.log(`[ELAnnualCreditWorker] Annual EL credit complete — credited: ${credited}, skipped: ${skipped}`);
}

// ── Worker Logic ─────────────────────────────────────────────────────────────

/**
 * Check if today is Jan 1 and run the annual EL credit if so.
 */
async function checkAndRunAnnualCredit(): Promise<void> {
  const now = new Date();

  if (now.getMonth() === 0 && now.getDate() === 1) {
    const creditYear = now.getFullYear();
    console.log(`[ELAnnualCreditWorker] It's Jan 1 — running annual EL credit for year ${creditYear}`);
    await creditELAnnual(creditYear);
  } else {
    console.log(`[ELAnnualCreditWorker] Not Jan 1 (today: ${now.toDateString()}) — skipping`);
  }
}

// ── Start Worker ─────────────────────────────────────────────────────────────

/**
 * Start the annual EL credit worker.
 * Checks every 12 hours whether it is Jan 1; if so, credits EL to all active employees.
 */
export async function startWorker(): Promise<void> {
  console.log("[ELAnnualCreditWorker] Starting...");
  console.log(`[ELAnnualCreditWorker] Check interval: ${CHECK_INTERVAL_MS / 1000 / 60 / 60} hours`);

  // Run immediately on start
  await checkAndRunAnnualCredit();

  // Then run periodically every 12 hours
  setInterval(async () => {
    await checkAndRunAnnualCredit();
  }, CHECK_INTERVAL_MS);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Running as standalone script
  startWorker().catch((error) => {
    console.error("[ELAnnualCreditWorker] Fatal error:", error);
    process.exit(1);
  });
}

export { startWorker as startELAnnualCreditWorker };
