import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2/promise";
import { logSensitiveAction } from "../../shared/auditLog.js";

// ─── Queue management ─────────────────────────────────────────────────────────

export async function enqueueRecalculation(params: {
  employeeId: string;
  payrollMonth: string; // YYYY-MM-01
  sourceEventType: string;
  sourceEventId?: string;
  reason?: string;
  requestedBy?: string;
}): Promise<void> {
  // Find run_id if a run exists for this employee/month
  const [runRows] = await db.execute<RowDataPacket[]>(
    `SELECT spr.id, spr.status
       FROM salary_prep_run spr
       JOIN salary_prep_line spl ON spl.run_id = spr.id
      WHERE spl.employee_id = ? AND spr.run_month = ?
      LIMIT 1`,
    [params.employeeId, params.payrollMonth],
  );
  const run = (runRows[0] as any);

  const queueId = randomUUID();

  await db.execute(
    `INSERT INTO payroll_recalculation_queue
       (id, employee_id, run_id, payroll_month, source_event_type, source_event_id,
        reason, status, requested_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [queueId, params.employeeId, run?.id ?? null, params.payrollMonth,
     params.sourceEventType, params.sourceEventId ?? null,
     params.reason ?? null, params.requestedBy ?? null],
  );

  // If run exists and is open → flag the line for recalculation
  if (run && ["draft", "processing"].includes(run.status)) {
    await db.execute(
      `UPDATE salary_prep_line
          SET needs_recalculation = 1, recalculation_reason = ?
        WHERE run_id = ? AND employee_id = ?`,
      [params.reason ?? params.sourceEventType, run.id, params.employeeId],
    );
  }

  // If run is locked/disbursed → create a payroll exception notification
  if (run && ["locked", "disbursed"].includes(run.status)) {
    await _createPostLockException(params.employeeId, run.id, params.payrollMonth, queueId, params.requestedBy);
    // Update queue to skipped_locked immediately
    await db.execute(
      `UPDATE payroll_recalculation_queue SET status = 'skipped_locked' WHERE id = ?`,
      [queueId],
    );
  }
}

async function _createPostLockException(
  employeeId: string,
  runId: string,
  payrollMonth: string,
  queueId: string,
  requestedBy?: string,
): Promise<void> {
  // Log as a sensitive action for Payroll Head review
  await logSensitiveAction({
    actor_user_id: requestedBy ?? "system",
    action_type: "post_lock_attendance_change",
    module_key: "payroll",
    entity_type: "salary_prep_run",
    entity_id: runId,
    change_summary: {
      employee_id: employeeId,
      payroll_month: payrollMonth,
      queue_id: queueId,
      status: "pending_payroll_head_review",
      message: "Attendance changed after payroll was locked. Manual review required.",
    },
  });
}

// ─── Queue listing for UI ─────────────────────────────────────────────────────

export async function listRecalcQueue(filters: {
  status?: string;
  payrollMonth?: string;
  employeeId?: string;
}, limit = 100): Promise<any[]> {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (filters.status)       { conds.push("q.status = ?");         params.push(filters.status); }
  if (filters.payrollMonth) { conds.push("q.payroll_month = ?");  params.push(filters.payrollMonth); }
  if (filters.employeeId)   { conds.push("q.employee_id = ?");    params.push(filters.employeeId); }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT q.*,
            CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
            e.employee_code
       FROM payroll_recalculation_queue q
       JOIN employees e ON e.id = q.employee_id
     ${where}
     ORDER BY q.requested_at DESC
     LIMIT ?`,
    [...params, limit],
  );
  return rows as any[];
}

// ─── Worker: process pending queue items ─────────────────────────────────────

export async function processPendingQueue(): Promise<{ processed: number; failed: number }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT q.*, spr.status AS run_status
       FROM payroll_recalculation_queue q
       LEFT JOIN salary_prep_run spr ON spr.id = q.run_id
      WHERE q.status = 'pending'
      ORDER BY q.requested_at ASC
      LIMIT 50`,
  );

  let processed = 0;
  let failed = 0;

  for (const row of rows as any[]) {
    try {
      await db.execute(
        `UPDATE payroll_recalculation_queue SET status = 'processing' WHERE id = ?`,
        [row.id],
      );

      if (!row.run_id || ["locked", "disbursed"].includes(row.run_status)) {
        await db.execute(
          `UPDATE payroll_recalculation_queue SET status = 'skipped_locked', processed_at = NOW() WHERE id = ?`,
          [row.id],
        );
        continue;
      }

      // Trigger recalculation of this employee's payroll line
      const { calculatePayrollRun } = await import("./payrollCalculate.service.js");
      await calculatePayrollRun(row.run_id, "system", row.employee_id);

      // Clear the flag on the line
      await db.execute(
        `UPDATE salary_prep_line SET needs_recalculation = 0, recalculation_reason = NULL
          WHERE run_id = ? AND employee_id = ?`,
        [row.run_id, row.employee_id],
      );

      await db.execute(
        `UPDATE payroll_recalculation_queue SET status = 'completed', processed_at = NOW() WHERE id = ?`,
        [row.id],
      );
      processed++;
    } catch (err: any) {
      await db.execute(
        `UPDATE payroll_recalculation_queue SET status = 'failed', processed_at = NOW(),
          error_message = ? WHERE id = ?`,
        [err?.message ?? String(err), row.id],
      );
      failed++;
    }
  }

  return { processed, failed };
}
