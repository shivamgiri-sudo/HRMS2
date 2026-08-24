/**
 * Loan EMI payroll write-back (2026-08-25).
 *
 * payrollCalculate.service.ts sums each employee's active loans' deduction_per_month
 * into salary_prep_line.loan_emi every run — a real deduction line on the payslip —
 * but nothing ever wrote that back to employee_loans.deducted_amount/pending_amount.
 * Confirmed live: SUM(loan_emi) across all 103 historical runs is 0 everywhere, so the
 * "Deducted/Pending" figures Loan Management shows are frozen legacy-import values,
 * not a live ledger.
 *
 * This closes that gap at the one point money actually leaves — a run reaching
 * 'disbursed' (see payroll.service.ts::updateRunStatus's own ruling comment on why
 * that is the point, not 'finalized'). It does not touch payroll calculation: it only
 * reconciles the employee_loans ledger against a loan_emi figure the calculator has
 * already computed and already put on the payslip.
 */
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

interface LoanEmiLine extends RowDataPacket {
  employee_id: string;
  loan_emi: string | number;
}

interface ActiveLoanRow extends RowDataPacket {
  id: string;
  deducted_amount: string | number;
  pending_amount: string | number;
  status: string;
}

/**
 * Apportions each employee's already-calculated run-month loan_emi against their
 * active loans, oldest first — the same tie-break a human clearing this manually
 * would use, and the same clamp-at-zero/auto-complete behaviour the existing manual
 * POST /:id/record-payment handler already uses (loans.routes.ts).
 *
 * Deliberately isolated: a failure here must never fail the disbursal transition
 * itself. Call sites should log and continue on throw, not propagate.
 */
export async function applyPayrollDeductions(runId: string, actorUserId: string): Promise<void> {
  const [lines] = await db.execute<LoanEmiLine[]>(
    `SELECT employee_id, loan_emi
       FROM salary_prep_line
      WHERE run_id = ? AND loan_emi > 0`,
    [runId]
  );
  if (lines.length === 0) return;

  const conn = await (db as any).getConnection();
  try {
    await conn.beginTransaction();

    for (const line of lines) {
      let remaining = Number(line.loan_emi);
      if (!remaining || Number.isNaN(remaining) || remaining <= 0) continue;

      const [loans] = await conn.execute<ActiveLoanRow[]>(
        `SELECT id, deducted_amount, pending_amount, status
           FROM employee_loans
          WHERE employee_id = ? AND status = 'active'
          ORDER BY start_date ASC
          FOR UPDATE`,
        [line.employee_id]
      );

      for (const loan of loans) {
        if (remaining <= 0) break;

        const pending = Number(loan.pending_amount);
        const applied = Math.min(remaining, Math.max(0, pending));
        if (applied <= 0) continue;

        const newDeducted = Number(loan.deducted_amount) + applied;
        const newPending = Math.max(0, pending - applied);
        const newStatus = newPending <= 0 ? "completed" : loan.status;
        remaining -= applied;

        await conn.execute<ResultSetHeader>(
          `UPDATE employee_loans SET deducted_amount = ?, pending_amount = ?, status = ? WHERE id = ?`,
          [newDeducted, newPending, newStatus, loan.id]
        );

        void logSensitiveAction({
          actor_user_id: actorUserId,
          actor_role: "system:payroll_disbursal",
          action_type: "loan_payroll_deduction_applied",
          module_key: "payroll_loans",
          entity_type: "employee_loan",
          entity_id: loan.id,
          old_value_json: {
            deducted_amount: loan.deducted_amount,
            pending_amount: loan.pending_amount,
            status: loan.status,
          },
          new_value_json: {
            run_id: runId,
            amount_applied: applied,
            deducted_amount: newDeducted,
            pending_amount: newPending,
            status: newStatus,
          },
        });
      }
      // Any `remaining` left over (loan_emi exceeded the sum of active loans'
      // pending_amount — e.g. a loan was manually part-paid outside payroll in the
      // same window) is intentionally not applied anywhere else. It is evidence of a
      // stale/mismatched deduction_per_month, not something to force onto a loan
      // that's already clear — left for Finance to reconcile, not silently absorbed.
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
