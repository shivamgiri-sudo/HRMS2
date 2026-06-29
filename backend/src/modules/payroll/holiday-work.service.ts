import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { logSensitiveAction } from "../../shared/auditLog.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HolidayWorkPolicy {
  id: string;
  policy_name: string;
  payout_basis: "NET_DAILY" | "GROSS_DAILY" | "BASIC_DAILY" | "FIXED_AMOUNT";
  payout_type: "NO_EXTRA_PAY" | "HALF_DAY_EXTRA" | "DOUBLE_PAY_TOTAL" |
               "EXTRA_1X" | "EXTRA_1_5X" | "EXTRA_2X" | "COMP_OFF_ONLY" | "FIXED_AMOUNT";
  extra_multiplier: number;
  fixed_amount: number;
  min_hours_for_half_day: number;
  min_hours_for_full_day: number;
  comp_off_allowed: boolean;
  double_pay_allowed: boolean;
  payroll_head_approval_required: boolean;
  superadmin_approval_required: boolean;
  taxable: boolean;
  pf_applicable: boolean;
  esic_applicable: boolean;
  payslip_visible: boolean;
}

export interface HolidayWorkRequest {
  id: string;
  holiday_id: string;
  request_month: string;
  branch_id: string;
  process_id: string;
  cost_centre_id: string | null;
  department_id: string | null;
  requested_by: string;
  request_reason: string;
  client_approval_reference: string | null;
  payout_policy_id: string;
  status: string;
  current_approval_stage: string;
  min_hours_required: number;
  remarks: string | null;
  designation_ids?: string[];
}

// Payout multiplier lookup
const MULTIPLIER: Record<string, number> = {
  NO_EXTRA_PAY: 0,
  HALF_DAY_EXTRA: 0.5,
  DOUBLE_PAY_TOTAL: 1.0,
  EXTRA_1X: 1.0,
  EXTRA_1_5X: 1.5,
  EXTRA_2X: 2.0,
  COMP_OFF_ONLY: 0,
  FIXED_AMOUNT: 0,
};

// ─── Config helper ────────────────────────────────────────────────────────────

async function getConfigFlag(key: string, branchId?: string, processId?: string): Promise<string> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT config_value FROM payroll_config_flags
     WHERE config_key = ?
       AND (branch_id = ? OR branch_id IS NULL)
       AND (process_id = ? OR process_id IS NULL)
     ORDER BY
       (branch_id IS NOT NULL) DESC,
       (process_id IS NOT NULL) DESC
     LIMIT 1`,
    [key, branchId ?? null, processId ?? null],
  );
  return (rows[0] as any)?.config_value ?? "";
}

// ─── Holiday applicability ────────────────────────────────────────────────────

/**
 * Resolve which holidays apply to a given employee on a specific date.
 * Returns holiday rows that are applicable based on cost-centre and designation mapping.
 */
export async function resolveHolidaysForEmployee(
  employeeId: string,
  date: string,
): Promise<Array<{ id: string; holiday_name: string; holiday_type: string }>> {
  // Get employee profile
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT branch_id, process_id, cost_centre_id, department_id, designation_id,
            salary_start_date, date_of_joining, date_of_leaving
       FROM employees WHERE id = ? LIMIT 1`,
    [employeeId],
  );
  const emp = (empRows[0] as any);
  if (!emp) return [];

  const salaryStart = emp.salary_start_date ?? emp.date_of_joining;

  // Holiday must be on or after salary start
  if (salaryStart && date < salaryStart) return [];
  // Holiday must be before date of leaving
  if (emp.date_of_leaving && date > emp.date_of_leaving) return [];

  // New joiner cutoff check
  const cutoffEnabled = (await getConfigFlag("new_joiner_holiday_cutoff_enabled")) === "true";
  if (cutoffEnabled && salaryStart) {
    const cutoffDay = parseInt(await getConfigFlag("new_joiner_cutoff_day") || "15", 10);
    const joinDay = new Date(salaryStart).getDate();
    const joinMonth = salaryStart.slice(0, 7);
    const holidayMonth = date.slice(0, 7);
    if (joinMonth === holidayMonth && joinDay > cutoffDay) {
      // Check override
      const [ovRows] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM payroll_new_joiner_holiday_override
         WHERE employee_id = ? AND payroll_month = ?`,
        [employeeId, `${holidayMonth}-01`],
      );
      if ((ovRows as any[]).length === 0) return [];
    }
  }

  // Find holidays for this date
  const [holidays] = await db.execute<RowDataPacket[]>(
    `SELECT lhm.id, lhm.holiday_name, lhm.holiday_type
       FROM leave_holiday_master lhm
      WHERE lhm.holiday_date = ? AND lhm.active_status = 1`,
    [date],
  );

  const applicable: Array<{ id: string; holiday_name: string; holiday_type: string }> = [];

  for (const h of holidays as any[]) {
    // Check cost-centre mapping
    const [ccMaps] = await db.execute<RowDataPacket[]>(
      `SELECT id, is_mandatory FROM holiday_cost_centre_mapping
       WHERE holiday_id = ? AND is_active = 1`,
      [h.id],
    );

    if ((ccMaps as any[]).length === 0) {
      // No mapping → national/branch — applies to all
    } else {
      const matches = (ccMaps as any[]).some((m: any) =>
        (m.branch_id === null || m.branch_id === emp.branch_id) &&
        (m.process_id === null || m.process_id === emp.process_id) &&
        (m.cost_centre_id === null || m.cost_centre_id === emp.cost_centre_id) &&
        (m.department_id === null || m.department_id === emp.department_id),
      );
      if (!matches) continue;
    }

    // Check designation mapping
    const [dMaps] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM holiday_designation_mapping
       WHERE holiday_id = ? AND is_active = 1`,
      [h.id],
    );

    if ((dMaps as any[]).length > 0 && emp.designation_id) {
      const desigMatch = (dMaps as any[]).some((d: any) => d.designation_id === emp.designation_id);
      if (!desigMatch) continue;
    }

    applicable.push({ id: h.id, holiday_name: h.holiday_name, holiday_type: h.holiday_type });
  }

  return applicable;
}

// ─── Holiday work request CRUD ────────────────────────────────────────────────

export async function listHolidayWorkPolicies(): Promise<HolidayWorkPolicy[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM holiday_work_policy_master WHERE is_active = 1 ORDER BY policy_name`,
  );
  return rows as HolidayWorkPolicy[];
}

export async function listHolidayWorkRequests(filters: {
  branchId?: string;
  processId?: string;
  status?: string;
  requestMonth?: string;
}): Promise<any[]> {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (filters.branchId)     { conds.push("hwr.branch_id = ?");     params.push(filters.branchId); }
  if (filters.processId)    { conds.push("hwr.process_id = ?");    params.push(filters.processId); }
  if (filters.status)       { conds.push("hwr.status = ?");        params.push(filters.status); }
  if (filters.requestMonth) { conds.push("hwr.request_month = ?"); params.push(filters.requestMonth); }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT hwr.*,
            lhm.holiday_name, lhm.holiday_date,
            hwpm.policy_name, hwpm.payout_type, hwpm.extra_multiplier
       FROM holiday_work_request hwr
       JOIN leave_holiday_master lhm   ON lhm.id = hwr.holiday_id
       JOIN holiday_work_policy_master hwpm ON hwpm.id = hwr.payout_policy_id
     ${where}
     ORDER BY hwr.created_at DESC`,
    params,
  );
  return rows as any[];
}

export async function createHolidayWorkRequest(
  input: Omit<HolidayWorkRequest, "id" | "status" | "current_approval_stage">,
  actorId: string,
): Promise<string> {
  const id = randomUUID();
  await db.execute(
    `INSERT INTO holiday_work_request
       (id, holiday_id, request_month, branch_id, process_id, cost_centre_id,
        department_id, requested_by, request_reason, client_approval_reference,
        payout_policy_id, status, current_approval_stage, min_hours_required)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', 'branch_payroll', ?)`,
    [id, input.holiday_id, input.request_month, input.branch_id, input.process_id,
     input.cost_centre_id ?? null, input.department_id ?? null,
     input.requested_by, input.request_reason, input.client_approval_reference ?? null,
     input.payout_policy_id, input.min_hours_required ?? 480],
  );

  // Insert designations
  if (input.designation_ids?.length) {
    for (const desigId of input.designation_ids) {
      await db.execute(
        `INSERT IGNORE INTO holiday_work_request_designation (id, request_id, designation_id)
         VALUES (?, ?, ?)`,
        [randomUUID(), id, desigId],
      );
    }
  }

  // Log
  await _logApproval(id, actorId, "wfm", "submitted", null, "submitted");

  await logSensitiveAction({
    actor_user_id: actorId,
    action_type: "holiday_work_request_created",
    module_key: "payroll",
    entity_type: "holiday_work_request",
    entity_id: id,
    change_summary: { holiday_id: input.holiday_id, request_month: input.request_month },
  });

  return id;
}

export async function approveHolidayWorkRequest(
  requestId: string,
  action: "validate" | "approve_payroll_head" | "approve_superadmin" | "reject" | "cancel",
  actorId: string,
  actorRole: string,
  remarks?: string,
): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT status FROM holiday_work_request WHERE id = ? LIMIT 1`,
    [requestId],
  );
  const current = (rows[0] as any)?.status;
  if (!current) throw new Error("Holiday work request not found");

  const transitions: Record<string, { toStatus: string; nextStage: string }> = {
    validate:              { toStatus: "branch_payroll_validated", nextStage: "payroll_head" },
    approve_payroll_head:  { toStatus: "payroll_head_approved",    nextStage: "superadmin" },
    approve_superadmin:    { toStatus: "superadmin_approved",       nextStage: "payroll" },
    reject:                { toStatus: "rejected",                  nextStage: "closed" },
    cancel:                { toStatus: "cancelled",                 nextStage: "closed" },
  };

  const t = transitions[action];
  if (!t) throw new Error(`Unknown action: ${action}`);

  await db.execute(
    `UPDATE holiday_work_request
        SET status = ?, current_approval_stage = ?, remarks = ?, updated_at = NOW()
      WHERE id = ?`,
    [t.toStatus, t.nextStage, remarks ?? null, requestId],
  );

  await _logApproval(requestId, actorId, actorRole, action, current, t.toStatus, remarks);

  // After super admin approves → auto-populate employee eligibility list
  if (action === "approve_superadmin") {
    await _populateEmployeeEligibility(requestId);
  }

  await logSensitiveAction({
    actor_user_id: actorId,
    action_type: `holiday_work_request_${action}`,
    module_key: "payroll",
    entity_type: "holiday_work_request",
    entity_id: requestId,
    change_summary: { from_status: current, to_status: t.toStatus, actor_role: actorRole },
  });
}

async function _populateEmployeeEligibility(requestId: string): Promise<void> {
  const [reqRows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM holiday_work_request WHERE id = ? LIMIT 1`,
    [requestId],
  );
  const req = (reqRows[0] as any);
  if (!req) return;

  // Get designations for this request
  const [desigRows] = await db.execute<RowDataPacket[]>(
    `SELECT designation_id FROM holiday_work_request_designation WHERE request_id = ?`,
    [requestId],
  );
  const designationIds = (desigRows as any[]).map((d: any) => d.designation_id);

  // Find eligible employees in scope
  let empQuery = `SELECT e.id FROM employees e
    WHERE e.active_status = 1
      AND e.branch_id = ?
      AND e.process_id = ?`;
  const empParams: unknown[] = [req.branch_id, req.process_id];

  if (req.cost_centre_id) {
    empQuery += " AND e.cost_centre_id = ?";
    empParams.push(req.cost_centre_id);
  }
  if (designationIds.length > 0) {
    empQuery += ` AND e.designation_id IN (${designationIds.map(() => "?").join(",")})`;
    empParams.push(...designationIds);
  }

  const [emps] = await db.execute<RowDataPacket[]>(empQuery, empParams);

  for (const emp of emps as any[]) {
    await db.execute(
      `INSERT IGNORE INTO holiday_work_request_employee
         (id, request_id, employee_id, eligibility_status, calculation_status)
       VALUES (?, ?, ?, 'pending', 'pending')`,
      [randomUUID(), requestId, emp.id],
    );
  }
}

// ─── Payout calculation ───────────────────────────────────────────────────────

/**
 * Calculate holiday work extra payout for an employee.
 * base_net_salary: net salary BEFORE adding holiday extra (avoids circular calc).
 * active_calendar_days: calendar days employee was active in the month.
 */
export function calculateHolidayWorkPayout(
  policy: Pick<HolidayWorkPolicy, "payout_basis" | "payout_type" | "extra_multiplier" | "fixed_amount">,
  baseNetSalary: number,
  baseGrossSalary: number,
  basicSalary: number,
  activeCalendarDays: number,
  workedMinutes: number,
  minHoursFullDay: number,
  minHoursHalfDay: number,
): { payout_unit: "none" | "half_day" | "full_day"; payout_amount: number } {
  // Determine worked unit
  let payoutUnit: "none" | "half_day" | "full_day" = "none";
  if (workedMinutes >= minHoursFullDay) payoutUnit = "full_day";
  else if (workedMinutes >= minHoursHalfDay) payoutUnit = "half_day";
  else return { payout_unit: "none", payout_amount: 0 };

  const unitMultiplier = payoutUnit === "full_day" ? 1 : 0.5;

  if (policy.payout_type === "COMP_OFF_ONLY" || policy.payout_type === "NO_EXTRA_PAY") {
    return { payout_unit: payoutUnit, payout_amount: 0 };
  }

  if (policy.payout_type === "FIXED_AMOUNT") {
    return { payout_unit: payoutUnit, payout_amount: policy.fixed_amount * unitMultiplier };
  }

  // Daily rate basis
  let dailyRate = 0;
  const safeCalDays = activeCalendarDays > 0 ? activeCalendarDays : 30;

  switch (policy.payout_basis) {
    case "NET_DAILY":   dailyRate = baseNetSalary   / safeCalDays; break;
    case "GROSS_DAILY": dailyRate = baseGrossSalary / safeCalDays; break;
    case "BASIC_DAILY": dailyRate = basicSalary     / safeCalDays; break;
    default:            dailyRate = baseNetSalary   / safeCalDays;
  }

  const multiplier = MULTIPLIER[policy.payout_type] ?? 0;
  const payoutAmount = dailyRate * multiplier * unitMultiplier;

  return { payout_unit: payoutUnit, payout_amount: Math.round(payoutAmount * 100) / 100 };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function _logApproval(
  requestId: string,
  approverId: string,
  approverRole: string,
  action: string,
  fromStatus: string | null,
  toStatus: string,
  remarks?: string,
): Promise<void> {
  await db.execute(
    `INSERT INTO holiday_work_approval_log
       (id, request_id, approver_id, approver_role, action, from_status, to_status, remarks)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), requestId, approverId, approverRole, action,
     fromStatus, toStatus, remarks ?? null],
  );
}
