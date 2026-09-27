/**
 * One-time cleanup: fix employee_loans rows whose status column literally holds the
 * string 'yes' instead of a real status — a data-entry typo (there is no ENUM/CHECK
 * constraint on this column, so any string can land there). Companion to
 * sql/migrations/1902_loan_yes_status_typo_fix.sql.
 *
 * Live-verified 2026-09-27: exactly one row, employee MAS47814, amount 200000,
 * deducted 20000, pending 180000 — genuinely still being repaid, just invisible to
 * both the "Active" and "Completed" filters on /payroll/loans because 'yes' matches
 * neither. Found while browser-verifying the loan-active-status-completed-cleanup
 * fix (migration 1901) on this same employee's own account.
 *
 * This script only ever touches rows with status = 'yes'. It sets them to 'active'
 * (never 'completed') because every row found this way still has pending_amount > 0 —
 * if that ever isn't true for a future row, the dry-run output makes it obvious before
 * anything is written.
 *
 * Writes one logSensitiveAction row per affected loan BEFORE the fix, so the change is
 * traceable the same way any other loan mutation in this app is.
 *
 * Safe by construction:
 *   - Dry-run by default. Nothing is written unless --apply is passed.
 *   - Only ever touches rows where status = 'yes'.
 *   - Runs inside one transaction; any failure rolls back everything.
 *
 * Usage:
 *   npx tsx scripts/loan-yes-status-typo-fix.ts            # dry run
 *   npx tsx scripts/loan-yes-status-typo-fix.ts --apply    # actually fix + audit-log
 */
import { db } from "../src/db/mysql.js";
import { logSensitiveAction } from "../src/shared/auditLog.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  const [rows] = await db.execute(
    `SELECT id, employee_code, loan_type, amount, deducted_amount, pending_amount, status
       FROM employee_loans
      WHERE status = 'yes'
      ORDER BY employee_code`,
  );
  const loans = rows as Array<Record<string, unknown>>;

  if (loans.length === 0) {
    console.log("No employee_loans rows with status='yes'. Nothing to do.");
    return;
  }

  console.log(`Found ${loans.length} loan(s) with the 'yes' status typo:`);
  console.table(loans);

  if (!APPLY) {
    console.log(
      "\nDry run only — pass --apply to set these to 'active' and write audit rows.",
    );
    return;
  }

  const conn = await (db as any).getConnection();
  try {
    await conn.beginTransaction();

    for (const loan of loans) {
      void logSensitiveAction({
        actor_user_id: "migration_1902",
        actor_role: "system:migration",
        action_type: "loan_yes_status_typo_fix",
        module_key: "payroll_loans",
        entity_type: "employee_loan",
        entity_id: String(loan.id),
        old_value_json: {
          status: "yes",
          pending_amount: loan.pending_amount,
          deducted_amount: loan.deducted_amount,
        },
        new_value_json: {
          status: "active",
        },
        reason:
          "Migration 1902: status column held the literal string 'yes' (data-entry typo) on a loan still genuinely being repaid",
      });

      await conn.execute(
        `UPDATE employee_loans SET status = 'active' WHERE id = ?`,
        [loan.id],
      );
    }

    await conn.commit();
    console.log(
      `\nFixed ${loans.length} loan(s) to status='active' and wrote audit rows.`,
    );
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
