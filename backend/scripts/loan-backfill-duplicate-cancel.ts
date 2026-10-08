/**
 * Cancel employee_loans rows that the 2026-09-08 db_bill backfill created as duplicates of a loan
 * HRMS already held.
 *
 * The backfill wrote "Created <date> from db_bill salary_data ... HRMS held zero employee_loans
 * rows" for loans that already existed (synced earlier from db_bill.LoanMaster, so they carry a
 * legacy_loan_id). Both rows are 'active', and every consumer sums them, so the employee's EMI is
 * doubled (MAS47814: 40,000 instead of 20,000).
 *
 * A row is a duplicate only when ALL of these hold, so a genuine second loan is never touched:
 *   - status = 'active', legacy_loan_id IS NULL, reason starts with 'Created ' and mentions 'from db_bill salary_data'
 *   - another ACTIVE row for the same employee has the same amount, start_date, installments and
 *     deduction_per_month AND a legacy_loan_id (the real record)
 *
 * Dry-run by default; --apply cancels them (soft cancel, status = 'cancelled', same as the loans
 * route) inside one transaction and writes a logSensitiveAction row per loan first.
 *
 *   npx tsx scripts/loan-backfill-duplicate-cancel.ts            # dry run
 *   npx tsx scripts/loan-backfill-duplicate-cancel.ts --apply
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { logSensitiveAction } from "../src/shared/auditLog.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  const [rows] = await db.execute(
    `SELECT d.id, d.employee_code, d.amount, d.start_date, d.installments, d.deduction_per_month,
            d.deducted_amount, d.pending_amount, r.id AS real_loan_id, r.legacy_loan_id,
            r.deducted_amount AS real_deducted, r.pending_amount AS real_pending
       FROM employee_loans d
       JOIN employee_loans r
         ON r.employee_id = d.employee_id AND r.id <> d.id AND r.status = 'active'
        AND r.legacy_loan_id IS NOT NULL
        AND r.amount = d.amount AND r.start_date = d.start_date
        AND r.installments = d.installments AND r.deduction_per_month = d.deduction_per_month
      WHERE d.status = 'active' AND d.legacy_loan_id IS NULL
        AND d.reason LIKE 'Created %' AND d.reason LIKE '%from db_bill salary_data%'
      ORDER BY d.employee_code`,
  );
  const dupes = rows as Array<Record<string, unknown>>;
  console.log(`Backfill duplicates found: ${dupes.length}`);
  if (dupes.length === 0) return;
  console.table(dupes);
  const ids = new Set(dupes.map((d) => String(d.id)));
  if (ids.size !== dupes.length) {
    console.log("A duplicate row matches more than one real loan — refusing to guess. Review by hand.");
    process.exitCode = 1;
    return;
  }
  if (dupes.some((d) => Number(d.deducted_amount) > 0)) {
    console.log("At least one duplicate already has deductions recorded — refusing; review by hand.");
    process.exitCode = 1;
    return;
  }
  if (!APPLY) {
    console.log("\nDry run only — pass --apply to cancel these rows.");
    return;
  }

  const conn = await (db as any).getConnection();
  try {
    await conn.beginTransaction();
    for (const d of dupes) {
      await logSensitiveAction({
        actor_user_id: "ops_loan_duplicate_cancel",
        actor_role: "system:ops",
        action_type: "loan_backfill_duplicate_cancel",
        module_key: "payroll_loans",
        entity_type: "employee_loan",
        entity_id: String(d.id),
        old_value_json: { status: "active", pending_amount: d.pending_amount, deducted_amount: d.deducted_amount },
        new_value_json: { status: "cancelled", duplicate_of: d.real_loan_id },
        reason: "Duplicate of the synced loan created by the 2026-09-08 db_bill backfill; doubled the EMI",
      });
      await conn.execute(`UPDATE employee_loans SET status = 'cancelled' WHERE id = ? AND status = 'active'`, [d.id]);
    }
    await conn.commit();
    console.log(`\nCancelled ${dupes.length} duplicate loan row(s).`);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

main().then(() => process.exit()).catch((e) => { console.error(e); process.exit(1); });
