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
import { assertNotBeforeToday, canBackdateDates } from "../../utils/dateUtils.js";

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
    `SELECT sca.*,
            COALESCE(sca.ctc, pm.ctc,
              sca.gross + COALESCE(sca.employer_pf, 0) + COALESCE(sca.employer_esi, 0) + COALESCE(pm.admin_charges, 0)
            ) AS ctc,
            COALESCE(sca.net_estimate, pm.net_in_hand,
              sca.gross - COALESCE(sca.pf_employee, 0) - COALESCE(sca.esic_employee, 0)
            ) AS net_in_hand,
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
  actorRoles?: readonly string[];
}) {
  const { employeeId, packageId, effectiveDate, reason, requestedByUserId, requestedByName, actorUserId, actorRoles } = params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || isNaN(Date.parse(effectiveDate))) {
    throw httpError("effective_date must be a valid YYYY-MM-DD date.", 400, "INVALID_DATE");
  }
  // Date lock: only super_admin / payroll_head may make a salary change effective before today.
  assertNotBeforeToday(effectiveDate, "Effective date", undefined, canBackdateDates(actorRoles));
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
  // effective_from is deliberately NOT touched: a salary change adds a new salary line effective
  // on the change date, it never moves the salary START date. Overwriting effective_from here made
  // the assignment disagree with employees.salary_start_date (the mismatch payroll then trips on).
  await db.execute(
    `UPDATE employee_salary_assignment
        SET ctc_annual = ?, updated_at = NOW()
      WHERE employee_id = ? AND active_status = 1
      LIMIT 1`,
    [Number(pkg.ctc ?? 0) * 12, employeeId]
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

// ─── Salary Trend Grid ───────────────────────────────────────────────────────
// Returns month-by-month salary (basic/gross/ctc/net) for every active employee
// matching the supplied filters, covering all 12 months of the requested
// financial year.  Derives which salary was in force each month-end by picking
// the latest effective_date that falls on or before the last day of the month.

interface MonthSlot { year: number; month: number; label: string; }

function fyMonths(fy: string): MonthSlot[] {
  const startYear = parseInt(fy.split('-')[0], 10);
  if (isNaN(startYear)) throw httpError("fy must be in YYYY-YY format (e.g. 2025-26).", 400, "INVALID_FY");
  const slots: MonthSlot[] = [];
  const LABELS = ['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar'];
  for (let i = 0; i < 12; i++) {
    const month = i < 9 ? i + 4 : i - 8;
    const year  = i < 9 ? startYear : startYear + 1;
    slots.push({ year, month, label: `${LABELS[i]}-${String(i < 9 ? startYear : startYear + 1).slice(2)}` });
  }
  return slots;
}

function lastDayStr(year: number, month: number): string {
  const d = new Date(year, month, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function toDateStr(v: unknown): string {
  if (v instanceof Date) return v.toISOString().split('T')[0];
  return String(v).split('T')[0];
}

export async function getSalaryTrend(params: {
  branchId?: string;
  fy: string;
  costCentreId?: string;
  employeeCode?: string;
}) {
  const months = fyMonths(params.fy);

  const where: string[] = ['e.active_status = 1'];
  const args: unknown[] = [];
  if (params.branchId)     { where.push('e.branch_id = ?');      args.push(params.branchId); }
  if (params.costCentreId) { where.push('e.cost_centre_id = ?'); args.push(params.costCentreId); }
  if (params.employeeCode) { where.push('e.employee_code = ?');  args.push(params.employeeCode); }

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.full_name,
            b.branch_name, cc.cost_centre_name
       FROM employees e
       LEFT JOIN branch_master b  ON b.id  = e.branch_id
       LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
      WHERE ${where.join(' AND ')}
      ORDER BY e.employee_code
      LIMIT 500`,
    args
  );
  if (!empRows.length) return { months, employees: [] };

  const ids = empRows.map((r) => r.id as string);
  const [scaRows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_id, effective_date, basic, hra, conveyance, gross,
            pf_applicable, esi_applicable,
            COALESCE(ctc, gross + COALESCE(employer_pf,0) + COALESCE(employer_esi,0)) AS ctc,
            COALESCE(net_estimate, gross - COALESCE(pf_employee,0) - COALESCE(esic_employee,0)) AS net_in_hand
       FROM salary_component_assignments
      WHERE employee_id IN (${ids.map(() => '?').join(',')})
      ORDER BY employee_id, effective_date ASC`,
    ids
  );

  const byEmp = new Map<string, RowDataPacket[]>();
  for (const row of scaRows) {
    if (!byEmp.has(row.employee_id as string)) byEmp.set(row.employee_id as string, []);
    byEmp.get(row.employee_id as string)!.push(row);
  }

  const employees = empRows.map((emp) => {
    const assignments = byEmp.get(emp.id as string) ?? [];
    const monthly = months.map(({ year, month }, idx) => {
      const ceiling = lastDayStr(year, month);
      let active: RowDataPacket | null = null;
      for (const a of assignments) {
        if (toDateStr(a.effective_date) <= ceiling) active = a;
      }
      if (!active) return null;
      const effStr = toDateStr(active.effective_date);
      const [ey, em] = effStr.split('-').map(Number);
      const changed = ey === year && em === month && idx > 0; // first month with data is not "changed"
      return {
        basic:        active.basic as number,
        hra:          active.hra as number,
        conveyance:   active.conveyance as number,
        gross:        active.gross as number,
        ctc:          active.ctc as number,
        net_in_hand:  active.net_in_hand as number,
        pf:           active.pf_applicable ? 'Y' : 'N',
        esi:          active.esi_applicable ? 'Y' : 'N',
        effective_date: effStr,
        changed,
      };
    });
    return { id: emp.id, employee_code: emp.employee_code, full_name: emp.full_name, branch_name: emp.branch_name, cost_centre_name: emp.cost_centre_name, monthly };
  });

  return { months, employees };
}
