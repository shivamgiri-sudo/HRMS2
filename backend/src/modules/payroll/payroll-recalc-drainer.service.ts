import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { sqlLimit } from "../../db/pagination.js";
import { db } from "../../db/mysql.js";
import { recalculateOpenPayrollForEmployee } from "./payroll-targeted-recalculation.service.js";
import { logger } from "../../lib/logger.js";

/**
 * How long a 'processing' claim may be held before it is treated as abandoned.
 *
 * A single employee-month recalculation takes seconds. Thirty minutes is far beyond any real
 * duration and well short of leaving a crashed claim stuck indefinitely — the previous behaviour,
 * where an abandoned row was never looked at again.
 */
const STALE_CLAIM_MINUTES = 30;

export async function drainPayrollRecalcQueue(
  payrollMonth: string, // YYYY-MM
  batchSize = 200,
): Promise<{ processed: number; failed: number; skipped_locked: number }> {
  const monthDate = /^\d{4}-\d{2}$/.test(payrollMonth)
    ? `${payrollMonth}-01`
    : payrollMonth;

  // Reclaim abandoned claims before selecting work.
  //
  // The claim below is atomic and every path out of the try block writes a terminal status, so a
  // row can only remain 'processing' if the PROCESS DIED between claiming and finishing — a crash,
  // an OOM, or a pm2 restart mid-recalculation. Nothing ever looked at those rows again: the
  // SELECT reads 'pending' only, so an abandoned claim was invisible forever and that employee's
  // salary_prep_line silently stayed stale against attendance.
  //
  // Found live 2026-08-17: one row claimed 2026-08-12, processed_at still NULL five days later.
  // One row today, but it is one per crash and nothing was going to surface it.
  //
  // STALE_CLAIM_MINUTES is deliberately generous. A single employee-month recalculation is
  // seconds of work; anything holding a claim for half an hour is not slow, it is gone. Too short
  // a window would reclaim a live claim and run the recalculation twice over one employee-month —
  // the exact interleaving the atomic claim exists to prevent.
  const [reclaimed] = await db.execute<ResultSetHeader>(
    `UPDATE payroll_recalculation_queue
        SET status = 'pending',
            error_message = CONCAT('Reclaimed after an abandoned claim (worker died mid-recalculation). ',
                                   COALESCE(error_message, ''))
      WHERE payroll_month = ?
        AND status = 'processing'
        AND processed_at IS NULL
        AND requested_at < DATE_SUB(NOW(), INTERVAL ${STALE_CLAIM_MINUTES} MINUTE)`,
    [monthDate],
  );
  if (reclaimed.affectedRows > 0) {
    logger.warn(
      { month: payrollMonth, reclaimed: reclaimed.affectedRows },
      "[RecalcDrainer] reclaimed abandoned claims — a worker died mid-recalculation",
    );
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_id, payroll_month, reason
       FROM payroll_recalculation_queue
      WHERE payroll_month = ?
        AND status = 'pending'
      ORDER BY requested_at ASC
      ${sqlLimit(batchSize)}`,
    [monthDate],
  );
  const entries = rows as Array<{ id: string; employee_id: string; payroll_month: string; reason: string }>;

  let processed = 0;
  let failed = 0;
  let skipped_locked = 0;

  for (const entry of entries) {
    // Claim the entry, don't just label it.
    //
    // This was `SET status = 'processing' WHERE id = ?` with the result discarded, so it was a
    // note about intent rather than a claim. The SELECT above and this write are not atomic
    // together, and there are two ways in — the COSEC sync worker and a manual sync route — so
    // both can read the same pending row and both proceed. That runs the payroll
    // recalculation engine twice over one employee-month, interleaving read-modify-write on
    // the same salary_prep_line.
    //
    // Not hypothetical headroom: this queue has already processed 3,164 entries in production.
    // Losing the claim now costs nothing — the winner does the work and the loser moves on.
    const [claim] = await db.execute<ResultSetHeader>(
      `UPDATE payroll_recalculation_queue SET status = 'processing' WHERE id = ? AND status = 'pending'`,
      [entry.id],
    );
    if (claim.affectedRows !== 1) {
      // Another drainer took it between our SELECT and here.
      continue;
    }
    try {
      const result = await recalculateOpenPayrollForEmployee({
        employeeId: entry.employee_id,
        payrollMonth: entry.payroll_month.slice(0, 7), // YYYY-MM
        sourceEventType: "cosec_sync",
        reason: entry.reason,
        actorUserId: "system",
      });

      if (result.status === "recalculated") {
        await db.execute(
          // AND status = 'processing': if this claim was reclaimed as abandoned and picked up by
          // another drainer, this (resurrected) worker must not overwrite the newer claim's result.
          `UPDATE payroll_recalculation_queue
              SET status = 'completed', processed_at = NOW()
            WHERE id = ? AND status = 'processing'`,
          [entry.id],
        );
        processed++;
      } else {
        // queued (closed run) or no_open_run
        await db.execute(
          `UPDATE payroll_recalculation_queue
              SET status = 'skipped_locked', processed_at = NOW(),
                  error_message = ?
            WHERE id = ? AND status = 'processing'`,
          [result.message, entry.id],
        );
        skipped_locked++;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ employeeId: entry.employee_id, err: msg }, "[RecalcDrainer] failed for employee");
      await db.execute(
        `UPDATE payroll_recalculation_queue
            SET status = 'failed', processed_at = NOW(), error_message = ?
          WHERE id = ? AND status = 'processing'`,
        [msg.slice(0, 500), entry.id],
      );
      failed++;
    }
  }

  return { processed, failed, skipped_locked };
}
