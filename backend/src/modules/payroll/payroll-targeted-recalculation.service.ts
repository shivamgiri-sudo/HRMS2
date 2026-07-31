import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { calculatePayrollRunScoped } from "./payrollCalculate.service.js";

const CLOSED_RUN_STATUSES = new Set(["locked", "disbursed"]);

export async function queuePayrollRecalculation(params: {
  employeeId: string;
  payrollMonth: string;
  sourceEventType: string;
  sourceEventId?: string | null;
  reason: string;
  requestedBy?: string | null;
}) {
  await db.execute(
    `INSERT INTO payroll_recalculation_queue
       (id, employee_id, payroll_month, source_event_type, source_event_id, reason, status, requested_by, requested_at)
     VALUES (UUID(), ?, ?, ?, ?, ?, 'pending', ?, NOW())`,
    [
      params.employeeId,
      `${params.payrollMonth}-01`,
      params.sourceEventType,
      params.sourceEventId ?? null,
      params.reason,
      params.requestedBy ?? null,
    ],
  );
}

export async function recalculateOpenPayrollForEmployee(params: {
  employeeId: string;
  payrollMonth: string;
  sourceEventType: string;
  sourceEventId?: string | null;
  reason: string;
  actorUserId?: string | null;
}): Promise<{ status: "recalculated" | "queued" | "no_open_run"; runId: string | null; message: string }> {
  const [runRows] = await db.execute<RowDataPacket[]>(
    `SELECT spr.id, spr.status
       FROM salary_prep_run spr
       JOIN salary_prep_line spl ON spl.run_id = spr.id AND spl.employee_id = ?
      WHERE spr.run_month = ?
      ORDER BY spr.created_at DESC
      LIMIT 1`,
    [params.employeeId, params.payrollMonth],
  );
  const run = runRows[0] as any;
  if (!run) {
    await queuePayrollRecalculation({
      employeeId: params.employeeId,
      payrollMonth: params.payrollMonth,
      sourceEventType: params.sourceEventType,
      sourceEventId: params.sourceEventId,
      reason: `${params.reason}; no active salary run line found`,
      requestedBy: params.actorUserId,
    });
    return { status: "no_open_run", runId: null, message: "No salary run line exists for this employee/month; queued recalculation." };
  }

  if (CLOSED_RUN_STATUSES.has(String(run.status))) {
    await queuePayrollRecalculation({
      employeeId: params.employeeId,
      payrollMonth: params.payrollMonth,
      sourceEventType: params.sourceEventType,
      sourceEventId: params.sourceEventId,
      reason: `${params.reason}; run is ${run.status}`,
      requestedBy: params.actorUserId,
    });
    return { status: "queued", runId: String(run.id), message: `Run is ${run.status}; queued recalculation/adjustment.` };
  }

  await calculatePayrollRunScoped(String(run.id), params.actorUserId ?? "system", { employeeIds: [params.employeeId] });
  return { status: "recalculated", runId: String(run.id), message: "Employee salary line recalculated." };
}
