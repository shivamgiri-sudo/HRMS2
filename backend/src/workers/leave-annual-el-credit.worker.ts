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

let intervalRef: ReturnType<typeof setInterval> | undefined;

// ── Core Processing ──────────────────────────────────────────────────────────

/**
 * Run all annual leave jobs for the given creditYear:
 * 1. Transfer prior year EL accrual ledger → current year spendable balance
 * 2. Credit PTRL 4 days for creditYear
 * 3. Credit MTRL 180 days for creditYear
 * 4. Expire prior year unused CL/ML/PTRL/MTRL balances
 */
export async function runAnnualLeaveJobs(creditYear: number): Promise<void> {
  console.log(`[AnnualLeaveWorker] Starting annual leave jobs for ${creditYear}`);

  // Resolve all needed leave type IDs
  const [ltRows]: any = await db.execute(
    `SELECT id, leave_code FROM leave_type_master WHERE leave_code IN ('EL','CL','ML','PTRL','MTRL') AND active_status = 1`
  );
  const ltMap: Record<string, string> = {};
  for (const r of ltRows) ltMap[r.leave_code] = r.id;

  // Get all active employees
  const [employees]: any = await db.execute(
    `SELECT id, date_of_joining FROM employees WHERE active_status = 1 AND employment_status = 'active'`
  );

  const priorYear = creditYear - 1;
  let elTransferred = 0, ptrlCredited = 0, mtrlCredited = 0, expired = 0;

  for (const emp of employees) {
    try {
      // ── 1. Transfer EL accrual (priorYear) → balance (creditYear) ──
      const [accrualRows]: any = await db.execute(
        `SELECT accrued_days FROM leave_el_accrual_ledger WHERE employee_id=? AND accrual_year=?`,
        [emp.id, priorYear]
      );
      const accrued = Number(accrualRows[0]?.accrued_days ?? 0);

      if (accrued > 0 && ltMap['EL']) {
        // Check idempotency: has EL already been credited for creditYear?
        const [elExists]: any = await db.execute(
          `SELECT 1 FROM leave_el_credit_log WHERE employee_id=? AND leave_type_id=? AND credit_year=? AND credit_month IS NULL AND credit_type='annual' LIMIT 1`,
          [emp.id, ltMap['EL'], creditYear]
        );
        if (elExists.length === 0) {
          await db.execute(
            `INSERT INTO leave_balance_ledger (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
             VALUES (UUID(), ?, ?, ?, ?, 0, 0)
             ON DUPLICATE KEY UPDATE allocated_days = ?`,
            [emp.id, ltMap['EL'], creditYear, accrued, accrued]
          );
          await db.execute(
            `INSERT INTO leave_el_credit_log (id, employee_id, leave_type_id, credit_year, credit_month, credit_date, days_credited, months_served, credit_type)
             VALUES (UUID(), ?, ?, ?, NULL, CURDATE(), ?, 12, 'annual')`,
            [emp.id, ltMap['EL'], creditYear, accrued]
          );
          elTransferred++;
        }
      }

      // Initialize empty accrual ledger for the new creditYear
      await db.execute(
        `INSERT INTO leave_el_accrual_ledger (id, employee_id, accrual_year, accrued_days, last_credited_month)
         VALUES (UUID(), ?, ?, 0, 0)
         ON DUPLICATE KEY UPDATE accrued_days = accrued_days`,
        [emp.id, creditYear]
      );

      // ── 2. Credit PTRL (4 days) ──
      if (ltMap['PTRL']) {
        await db.execute(
          `INSERT INTO leave_balance_ledger (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
           VALUES (UUID(), ?, ?, ?, 4.00, 0, 0)
           ON DUPLICATE KEY UPDATE allocated_days = 4.00, used_days = 0`,
          [emp.id, ltMap['PTRL'], creditYear]
        );
        ptrlCredited++;
      }

      // ── 3. Credit MTRL (180 days) ──
      if (ltMap['MTRL']) {
        await db.execute(
          `INSERT INTO leave_balance_ledger (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
           VALUES (UUID(), ?, ?, ?, 180.00, 0, 0)
           ON DUPLICATE KEY UPDATE allocated_days = 180.00, used_days = 0`,
          [emp.id, ltMap['MTRL'], creditYear]
        );
        mtrlCredited++;
      }

      // ── 4. Expire prior year CL/ML/PTRL/MTRL unused balance ──
      // Set used_days = allocated_days so available = 0 (balance expires, not deleted for audit)
      for (const code of ['CL', 'ML', 'PTRL', 'MTRL']) {
        if (ltMap[code]) {
          await db.execute(
            `UPDATE leave_balance_ledger
             SET used_days = allocated_days + COALESCE(adjusted_days, 0)
             WHERE employee_id=? AND leave_type_id=? AND balance_year=?
             AND (allocated_days + COALESCE(adjusted_days,0) - used_days) > 0`,
            [emp.id, ltMap[code], priorYear]
          );
        }
      }
      expired++;

    } catch (err: any) {
      console.error(`[AnnualLeaveWorker] Error for ${emp.id}:`, err.message);
    }
  }

  console.log(`[AnnualLeaveWorker] Done — EL transferred: ${elTransferred}, PTRL: ${ptrlCredited}, MTRL: ${mtrlCredited}, expiry processed: ${expired}`);
}

// ── Worker Logic ─────────────────────────────────────────────────────────────

/**
 * Check if today is Jan 1 and run the annual EL credit if so.
 */
async function checkAndRunAnnualCredit(): Promise<void> {
  const now = new Date();
  if (now.getMonth() === 0 && now.getDate() === 1) {
    await runAnnualLeaveJobs(now.getFullYear());
  } else {
    console.log(`[AnnualLeaveWorker] Not Jan 1 (${now.toDateString()}) — skipping`);
  }
}

// ── Start Worker ─────────────────────────────────────────────────────────────

/**
 * Start the annual EL credit worker.
 * Checks every 12 hours whether it is Jan 1; if so, credits EL to all active employees.
 */
export async function startWorker(): Promise<void> {
  console.log("[AnnualLeaveWorker] Starting...");
  console.log(`[AnnualLeaveWorker] Check interval: ${CHECK_INTERVAL_MS / 1000 / 60 / 60} hours`);

  // Run immediately on start
  await checkAndRunAnnualCredit();

  // Then run periodically every 12 hours
  intervalRef = setInterval(async () => {
    await checkAndRunAnnualCredit();
  }, CHECK_INTERVAL_MS);
}

function stopWorker(): void {
  if (intervalRef) {
    clearInterval(intervalRef);
    intervalRef = undefined;
  }
  console.log("[AnnualLeaveWorker] Stopped");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Running as standalone script
  startWorker().catch((error) => {
    console.error("[AnnualLeaveWorker] Fatal error:", error);
    process.exit(1);
  });
}

export { startWorker as startAnnualLeaveWorker, stopWorker as stopAnnualLeaveWorker };
