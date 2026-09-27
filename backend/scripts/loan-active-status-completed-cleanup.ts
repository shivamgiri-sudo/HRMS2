/**
 * One-time cleanup: mark employee_loans rows status='completed' wherever they
 * are still 'active' but pending_amount = 0 — legacy-import artifacts (the
 * legacy db_bill.LoanMaster source only ever recorded PendingAmount; it had no
 * "completed" state, so the one-time import stamped every row 'active'
 * regardless of whether it was already fully repaid). Companion to
 * sql/migrations/1901_loan_active_status_completed_cleanup.sql.
 *
 * Live-verified 2026-09-27: 219 rows are 'active', 185 of those already have
 * pending_amount = 0 (fully repaid), across 30+ employees who each carry
 * several stale 'active' rows alongside — or instead of — a genuinely open
 * loan. /payroll/loans lists every 'active' row, so a fully repaid legacy
 * advance from years ago shows next to a real current loan, both labelled
 * "active".
 *
 * Multiple simultaneous active loans per employee are legitimate and are not
 * touched by this script (payroll/loans.service.ts applyPayrollDeductions
 * deducts them oldest-first) — this only clears rows that are already at
 * pending_amount = 0.
 *
 * Writes one logSensitiveAction row per affected loan BEFORE flipping it, so
 * the change is traceable the same way any other loan mutation in this app is.
 *
 * Safe by construction:
 *   - Dry-run by default. Nothing is written unless --apply is passed.
 *   - Only ever touches rows where status = 'active' AND pending_amount = 0.
 *   - Runs inside one transaction; any failure rolls back everything.
 *
 * Usage:
 *   npx tsx scripts/loan-active-status-completed-cleanup.ts            # dry run
 *   npx tsx scripts/loan-active-status-completed-cleanup.ts --apply    # actually flip + audit-log
 */
import { db } from "../src/db/mysql.js";
import { logSensitiveAction } from "../src/shared/auditLog.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  const [rows] = await db.execute(
    `SELECT id, employee_code, loan_type, amount, deducted_amount, pending_amount, legacy_loan_id
       FROM employee_loans
      WHERE status = 'active' AND pending_amount = 0
      ORDER BY employee_code, legacy_loan_id`,
  );
  const loans = rows as Array<Record<string, unknown>>;

  if (loans.length === 0) {
    console.log(
      "No employee_loans rows with status='active' and pending_amount=0. Nothing to do.",
    );
    return;
  }

  console.log(
    `Found ${loans.length} loan(s) that are 'active' but already fully repaid:`,
  );
  console.table(loans);

  if (!APPLY) {
    console.log(
      "\nDry run only — pass --apply to mark these 'completed' and write audit rows.",
    );
    return;
  }

  const conn = await (db as any).getConnection();
  try {
    await conn.beginTransaction();

    for (const loan of loans) {
      void logSensitiveAction({
        actor_user_id: "migration_1901",
        actor_role: "system:migration",
        action_type: "loan_active_status_completed_cleanup",
        module_key: "payroll_loans",
        entity_type: "employee_loan",
        entity_id: String(loan.id),
        old_value_json: {
          status: "active",
          pending_amount: loan.pending_amount,
          deducted_amount: loan.deducted_amount,
        },
        new_value_json: {
          status: "completed",
        },
        reason:
          "Migration 1901: legacy-import row already fully repaid (pending_amount=0) but never transitioned out of 'active'",
      });

      await conn.execute(
        `UPDATE employee_loans SET status = 'completed' WHERE id = ?`,
        [loan.id],
      );
    }

    await conn.commit();
    console.log(
      `\nMarked ${loans.length} loan(s) 'completed' and wrote audit rows.`,
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
