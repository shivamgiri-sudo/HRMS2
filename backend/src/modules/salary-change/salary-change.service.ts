/**
 * Salary Change Center — Payroll Head changes an already-active employee's salary.
 *
 * Distinct from employee_payroll_head_review (payroll-head-review.service.ts), which is the
 * ONE-TIME onboarding gate for new hires and is already terminal ('approved') long before an
 * active employee needs a later salary change. This module never touches that table.
 *
 * The live write goes to salary_component_assignments in the exact same shape
 * writeComponentAssignment() (payroll-head-review.service.ts) already uses — same columns, same
 * 'active' status convention — so payrollCalculate.service.ts reads it identically regardless of
 * which flow wrote it. employee_salary_change_log (migration 1611) is purely the who/why trail:
 * which assignment replaced which, who asked for it, who actually submitted it.
 */
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import { getPackageById } from "../payroll-masters/payrollMasters.service.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

function httpError(message: string, statusCode: number, code?: string): Error {
  return Object.assign(new Error(message), { statusCode, code });
}

export async function getEmployeeSalaryProfile(employeeId: string) {
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.full_name, e.emp_type, e.employment_type, e.date_of_joining,
            b.branch_name, dm.designation_name, cc.cost_centre_name, pm.process_name
       FROM employees e
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN designation_master dm ON dm.id = e.designation_id
       LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
       LEFT JOIN process_master pm ON pm.id = e.process_id
      WHERE e.id = ? AND e.active_status = 1
      LIMIT 1`,
    [employeeId]
  );
  const employee = empRows[0] ?? null;
  if (!employee) throw httpError("Employee not found or inactive.", 404, "NOT_FOUND");

  // salary_component_assignments stores only basic/hra/conveyance/special_allowance/
  // gross/pf/esi/ctc. Every other component of the package — bonus above all, which is
  // 8.33% of basic and sits INSIDE gross on 229 of the 230 populated catalog rows — lives
  // on salary_package_master. Joining it is what lets the Salary Change Center show the
  // whole package, and lets the builder open pre-filled with all of it rather than a
  // partial copy that would silently drop those components on the next save.
  const [scRows] = await db.execute<RowDataPacket[]>(
    `SELECT sca.*, sca.net_estimate AS net_in_hand,
            pm.bonus, pm.lta, pm.portfolio, pm.medical, pm.pli,
            pm.other_allowance, pm.professional_tax, pm.admin_charges,
            pm.band_code AS pkg_band_code
       FROM salary_component_assignments sca
       LEFT JOIN salary_package_master pm ON pm.id = sca.package_id
      WHERE sca.employee_id = ? AND sca.status = 'active'
      ORDER BY sca.effective_date DESC LIMIT 1`,
    [employeeId]
  );

  const [historyRows] = await db.execute<RowDataPacket[]>(
    `SELECT l.*, u.email AS requested_by_email
       FROM employee_salary_change_log l
       LEFT JOIN auth_user u ON u.id = l.requested_by_user_id
      WHERE l.employee_id = ?
      ORDER BY l.created_at DESC LIMIT 20`,
    [employeeId]
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);

  return {
    employee,
    salary_components: scRows[0] ?? null,
    change_history: historyRows,
  };
}

export async function changeSalary(params: {
  employeeId: string;
  packageId: string;
  effectiveDate: string;
  reason: string;
  requestedByUserId: string | null;
  requestedByName: string | null;
  actorUserId: string;
}) {
  const { employeeId, packageId, effectiveDate, reason, requestedByUserId, requestedByName, actorUserId } = params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || isNaN(Date.parse(effectiveDate))) {
    throw httpError("effective_date must be a valid YYYY-MM-DD date.", 400, "INVALID_DATE");
  }
  if (!reason || !reason.trim()) {
    throw httpError("A reason is required.", 400, "REASON_REQUIRED");
  }

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employees WHERE id = ? AND active_status = 1 LIMIT 1`, [employeeId]
  );
  if (!empRows.length) throw httpError("Employee not found or inactive.", 404, "NOT_FOUND");

  const pkg = await getPackageById(packageId);
  if (!pkg) throw httpError("Salary package not found.", 404, "PACKAGE_NOT_FOUND");

  const [oldRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, ctc FROM salary_component_assignments WHERE employee_id = ? AND status = 'active'
      ORDER BY effective_date DESC LIMIT 1`,
    [employeeId]
  );
  const oldAssignmentId = oldRows[0]?.id as string | undefined;
  const oldCtc = oldRows[0]?.ctc as number | undefined;

  const newAssignmentId = randomUUID();
  await db.execute(
    `INSERT INTO salary_component_assignments
       (id, employee_id, effective_date, package_id, basic, hra, conveyance,
        special_allowance, gross, pf_applicable, esi_applicable, employer_pf,
        employer_esi, ctc, net_estimate, assigned_by, assigned_at, approval_reference, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, 'active')`,
    [
      newAssignmentId, employeeId, effectiveDate, pkg.id,
      pkg.basic, pkg.hra, pkg.conveyance, pkg.special_allowance, pkg.gross,
      Number(pkg.epf_employee) > 0 ? 1 : 0, Number(pkg.esic_employee) > 0 ? 1 : 0,
      pkg.epf_employer, pkg.esic_employer, pkg.ctc, pkg.net_in_hand,
      actorUserId, "salary_change_center",
    ]
  );
  // Deactivate the previous active row — a real employee has at most one active
  // salary_component_assignments row at a time, same invariant the onboarding
  // flow (writeComponentAssignment) already relies on.
  if (oldAssignmentId) {
    await db.execute(
      `UPDATE salary_component_assignments SET status = 'superseded' WHERE id = ?`,
      [oldAssignmentId]
    );
  }

  // Keep employee_salary_assignment.ctc_annual in sync, same as the onboarding flow —
  // display field only, payroll reads salary_component_assignments directly.
  await db.execute(
    `UPDATE employee_salary_assignment
        SET ctc_annual = ?, effective_from = ?, updated_at = NOW()
      WHERE employee_id = ? AND active_status = 1
      LIMIT 1`,
    [Number(pkg.ctc ?? 0) * 12, effectiveDate, employeeId]
  ).catch(() => {});

  await db.execute(
    `INSERT INTO employee_salary_change_log
       (id, employee_id, old_salary_component_assignment_id, new_salary_component_assignment_id,
        requested_by_user_id, requested_by_name, actor_user_id, reason, old_ctc, new_ctc, effective_date)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      employeeId, oldAssignmentId ?? null, newAssignmentId,
      requestedByUserId, requestedByName, actorUserId, reason.trim(),
      oldCtc ?? null, pkg.ctc, effectiveDate,
    ]
  );

  void logSensitiveAction({
    actor_user_id: actorUserId,
    action_type: "SALARY_CHANGED",
    module_key: "payroll",
    entity_type: "employee",
    entity_id: employeeId,
    change_summary: {
      old_assignment_id: oldAssignmentId ?? null,
      new_assignment_id: newAssignmentId,
      old_ctc: oldCtc ?? null,
      new_ctc: pkg.ctc,
      effective_date: effectiveDate,
      reason: reason.trim(),
      requested_by_user_id: requestedByUserId,
      requested_by_name: requestedByName,
    },
  });

  return getEmployeeSalaryProfile(employeeId);
}
