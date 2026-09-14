/**
 * One-time cleanup: clamp employee_loans.pending_amount to 0 wherever it is
 * negative — 11 rows, all legacy-import artifacts (the app's own record-payment
 * handler already clamps at Math.max(0, pending - paid) and could never produce
 * these). Companion to sql/migrations/1603_loan_negative_pending_cleanup.sql.
 *
 * Writes one logSensitiveAction row per affected loan BEFORE clamping it, so the
 * change is traceable the same way any other loan mutation in this app is —
 * migration 1603's raw UPDATE alone would leave no record of what each row held
 * beforehand.
 *
 * Safe by construction:
 *   - Dry-run by default. Nothing is written unless --apply is passed.
 *   - Only ever touches rows where pending_amount < 0.
 *   - Runs inside one transaction; any failure rolls back everything.
 *
 * Usage:
 *   npx tsx scripts/loan-negative-pending-cleanup.ts            # dry run
 *   npx tsx scripts/loan-negative-pending-cleanup.ts --apply    # actually clamp + audit-log
 */
import { db } from "../src/db/mysql.js";
import { logSensitiveAction } from "../src/shared/auditLog.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  const [rows] = await db.execute(
    `SELECT id, employee_code, status, amount, deducted_amount, pending_amount
       FROM employee_loans
      WHERE pending_amount < 0
      ORDER BY pending_amount ASC`,
  );
  const loans = rows as Array<Record<string, unknown>>;

  if (loans.length === 0) {
    console.log("No employee_loans rows with negative pending_amount. Nothing to do.");
    return;
  }

  console.log(`Found ${loans.length} loan(s) with negative pending_amount:`);
  console.table(loans);

  if (!APPLY) {
    console.log("\nDry run only — pass --apply to clamp these to 0 and write audit rows.");
    return;
  }

  const conn = await (db as any).getConnection();
  try {
    await conn.beginTransaction();

    for (const loan of loans) {
      void logSensitiveAction({
        actor_user_id: "migration_1603",
        actor_role: "system:migration",
        action_type: "loan_negative_pending_cleanup",
        module_key: "payroll_loans",
        entity_type: "employee_loan",
        entity_id: String(loan.id),
        old_value_json: {
          pending_amount: loan.pending_amount,
          deducted_amount: loan.deducted_amount,
          status: loan.status,
        },
        new_value_json: {
          pending_amount: 0,
        },
        reason: "Migration 1603: clamp legacy-import negative pending_amount to 0",
      });

      await conn.execute(
        `UPDATE employee_loans SET pending_amount = 0 WHERE id = ?`,
        [loan.id],
      );
    }

    await conn.commit();
    console.log(`\nClamped ${loans.length} loan(s) to pending_amount = 0 and wrote audit rows.`);
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
