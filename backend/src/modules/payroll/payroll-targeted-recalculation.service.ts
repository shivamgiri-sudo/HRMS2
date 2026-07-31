import { randomUUID } from "crypto";
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
  // EVERY run the employee has a line in for this month, not just the newest.
  //
  // `salary_prep_run` carries UNIQUE (run_month, branch_filter, process_filter),
  // but both filter columns are nullable and MySQL treats NULLs as distinct — and
  // all 67 production runs have both NULL, so that constraint has never prevented
  // a duplicate. 2026-07 really does hold two full-company runs, and 1,288
  // employees have a line in both.
  //
  // The previous `ORDER BY created_at DESC LIMIT 1` therefore refreshed one line
  // and silently left the other holding pre-change values — which is what the
  // `salary_payable_days_mismatch` reconciliation issues are made of. There is no
  // reliable way to tell which run is authoritative (both are `processing`, both
  // unfiltered), so the only correct answer is to update all of them.
  const [runRows] = await db.execute<RowDataPacket[]>(
    `SELECT spr.id, spr.status
       FROM salary_prep_run spr
       JOIN salary_prep_line spl ON spl.run_id = spr.id AND spl.employee_id = ?
      WHERE spr.run_month = ?
      ORDER BY spr.created_at DESC`,
    [params.employeeId, params.payrollMonth],
  );
  const runs = runRows as any[];

  if (runs.length === 0) {
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

  const openRuns = runs.filter((r) => !CLOSED_RUN_STATUSES.has(String(r.status)));
  const closedRuns = runs.filter((r) => CLOSED_RUN_STATUSES.has(String(r.status)));

  // A closed run cannot be rewritten in place; queue it so the divergence is at
  // least recorded rather than lost.
  for (const run of closedRuns) {
    await queuePayrollRecalculation({
      employeeId: params.employeeId,
      payrollMonth: params.payrollMonth,
      sourceEventType: params.sourceEventType,
      sourceEventId: params.sourceEventId,
      reason: `${params.reason}; run ${run.id} is ${run.status}`,
      requestedBy: params.actorUserId,
    });
  }

  if (openRuns.length === 0) {
    const statuses = [...new Set(closedRuns.map((r) => String(r.status)))].join(", ");
    return {
      status: "queued",
      runId: String(closedRuns[0].id),
      message: `All ${closedRuns.length} run(s) for this month are ${statuses}; queued recalculation/adjustment.`,
    };
  }

  for (const run of openRuns) {
    // Snapshot BEFORE
    const [beforeRows] = await db.execute<RowDataPacket[]>(
      `SELECT paid_working_days, final_payable_days, net_salary, gross_salary
         FROM salary_prep_line
        WHERE run_id = ? AND employee_id = ? LIMIT 1`,
      [String(run.id), params.employeeId],
    );
    const before = (beforeRows as any[])[0] ?? null;

    await calculatePayrollRunScoped(String(run.id), params.actorUserId ?? "system", {
      employeeIds: [params.employeeId],
    });

    // Snapshot AFTER
    const [afterRows] = await db.execute<RowDataPacket[]>(
      `SELECT paid_working_days, final_payable_days, net_salary, gross_salary
         FROM salary_prep_line
        WHERE run_id = ? AND employee_id = ? LIMIT 1`,
      [String(run.id), params.employeeId],
    );
    const after = (afterRows as any[])[0] ?? null;

    // Write audit event only when values changed
    if (before && after) {
      const diffPaidDays = Number(after.paid_working_days) - Number(before.paid_working_days);
      const diffFinalDays = Number(after.final_payable_days) - Number(before.final_payable_days);
      const diffNet = Math.round((Number(after.net_salary) - Number(before.net_salary)) * 100) / 100;
      const diffGross = Math.round((Number(after.gross_salary) - Number(before.gross_salary)) * 100) / 100;
      if (diffPaidDays !== 0 || diffFinalDays !== 0 || diffNet !== 0) {
        await db.execute(
          `INSERT INTO payroll_calculation_audit (id, run_id, employee_id, event_type, event_detail, actor_user_id)
           VALUES (?, ?, ?, 'SALARY_DRIFT_RECALC', ?, ?)`,
          [
            randomUUID(),
            String(run.id),
            params.employeeId,
            JSON.stringify({
              event: "SALARY_DRIFT_RECALC",
              trigger: params.sourceEventType,
              before: {
                paid_working_days: Number(before.paid_working_days),
                final_payable_days: Number(before.final_payable_days),
                net_salary: Number(before.net_salary),
                gross_salary: Number(before.gross_salary),
              },
              after: {
                paid_working_days: Number(after.paid_working_days),
                final_payable_days: Number(after.final_payable_days),
                net_salary: Number(after.net_salary),
                gross_salary: Number(after.gross_salary),
              },
              diff: {
                paid_working_days: diffPaidDays,
                final_payable_days: diffFinalDays,
                net_salary: diffNet,
                gross_salary: diffGross,
              },
            }),
            params.actorUserId ?? "system",
          ],
        );
      }
    }
  }

  const suffix = closedRuns.length ? `; ${closedRuns.length} closed run(s) queued instead` : "";
  return {
    status: "recalculated",
    runId: String(openRuns[0].id),
    message: openRuns.length === 1
      ? `Employee salary line recalculated.${suffix}`
      : `Employee salary line recalculated across ${openRuns.length} open runs.${suffix}`,
  };
}

export { drainPayrollRecalcQueue } from "./payroll-recalc-drainer.service.js";
