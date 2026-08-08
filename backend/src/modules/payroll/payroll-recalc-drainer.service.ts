import type { RowDataPacket } from "mysql2";
import { sqlLimit } from "../../db/pagination.js";
import { db } from "../../db/mysql.js";
import { recalculateOpenPayrollForEmployee } from "./payroll-targeted-recalculation.service.js";
import { logger } from "../../lib/logger.js";

export async function drainPayrollRecalcQueue(
  payrollMonth: string, // YYYY-MM
  batchSize = 200,
): Promise<{ processed: number; failed: number; skipped_locked: number }> {
  const monthDate = /^\d{4}-\d{2}$/.test(payrollMonth)
    ? `${payrollMonth}-01`
    : payrollMonth;

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
    // Mark processing
    await db.execute(
      `UPDATE payroll_recalculation_queue SET status = 'processing' WHERE id = ?`,
      [entry.id],
    );
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
          `UPDATE payroll_recalculation_queue
              SET status = 'completed', processed_at = NOW()
            WHERE id = ?`,
          [entry.id],
        );
        processed++;
      } else {
        // queued (closed run) or no_open_run
        await db.execute(
          `UPDATE payroll_recalculation_queue
              SET status = 'skipped_locked', processed_at = NOW(),
                  error_message = ?
            WHERE id = ?`,
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
          WHERE id = ?`,
        [msg.slice(0, 500), entry.id],
      );
      failed++;
    }
  }

  return { processed, failed, skipped_locked };
}
