/**
 * Cost-centre attendance finalization — the branch-scoped payroll attendance sign-off chain.
 *
 * Owner requirement, 2026-09-02. Branch Payroll HR (payroll_hr) and the Branch WFM person (wfm)
 * open their branch, see every cost centre under it, drill into one to see each employee's month
 * (TotalDays / A / P / OD / HD / L / H / W / SalDays), and finalize that cost centre. It then goes
 * to the Branch Head, and from there to the HO Payroll Head. After the HO has approved, a
 * correction still found before payroll runs needs an unlock the Payroll Head alone can grant, and
 * granting it sends the cost centre back through all three stages.
 *
 * WHAT THIS IS NOT
 * It is not a second payroll engine and it computes no pay. The eight day-count columns come from
 * shared/attendanceDayCounts.ts — the same arithmetic the Attendance Register report has always
 * used, extracted so there is one copy — plus calculateWeekoffEligibility() from the payroll
 * engine itself. payrollCalculate.service.ts is untouched: it keeps deriving payable days its own
 * way for the payslip. This screen is a governance gate over the attendance INPUT, not a
 * replacement for the calculation.
 *
 * WHY A SNAPSHOT (payroll_cc_attendance_line)
 * The live grid is re-derived from attendance_daily_record on every read, so a regularization
 * approved between HR finalizing and the Payroll Head approving moves the numbers under the
 * approvers' feet. Finalize therefore snapshots what was finalized; the reads return both, and the
 * UI tells an approver when the live data has drifted from what they are being asked to approve.
 *
 * WHY cycle_no
 * An unlock is not an edit. Granting one increments cycle_no and starts a fresh pass; the previous
 * cycle's snapshot and approval events stay exactly where they are, so "what did the Branch Head
 * approve before the correction" is still answerable.
 */

import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { calculateWeekoffEligibility } from "./weekoff-eligibility.service.js";
import {
  ATTENDANCE_STATUS_CODE,
  resolveMissingDayCell,
  countDayCodes,
  computePaidBase,
  computeSalDays,
} from "../../shared/attendanceDayCounts.js";
import {
  recordFinanceApprovalEvent,
  listFinanceApprovalEvents,
} from "../../shared/financeApprovalEvent.js";

// ---------------------------------------------------------------------------
// Types and constants
// ---------------------------------------------------------------------------

/** entity_type in finance_approval_event (1089) — polymorphic by design, no FK. */
export const CC_ATTENDANCE_ENTITY_TYPE = "payroll_cc_attendance";

/**
 * Employees with no cost centre are grouped under this sentinel rather than dropped.
 * Rare but real: 1 of 1,115 active employees on 2026-09-02, and employee-master-bulk.service.ts
 * still accepts a blank cost_centre_code. An employee invisible to payroll attendance sign-off is
 * exactly the failure this screen exists to prevent.
 */
export const UNASSIGNED_COST_CENTRE = "UNASSIGNED";

export type CcAttendanceStatus =
  | "unprocessed"
  | "hr_finalized"
  | "branch_head_approved"
  | "ho_approved"
  | "unlock_requested";

/** Who owns each stage — recorded as actor_role on the approval event (the STAGE, not the login). */
const STAGE_ROLE = {
  hr: "payroll_hr",
  branch: "branch_head",
  ho: "payroll_head",
} as const;

/** super_admin is the only break-glass exemption from maker-checker, matching branch-budget.service.ts. */
const MAKER_CHECKER_EXEMPT = new Set(["super_admin"]);

export class CcAttendanceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "CcAttendanceError";
  }
}

function refuse(status: number, code: string, message: string): CcAttendanceError {
  return new CcAttendanceError(status, code, message);
}

export type EmployeeDayRow = {
  employee_id: string;
  employee_code: string | null;
  employee_name: string;
  emp_location: string;
  total_days: number;
  absent_days: number;
  present_days: number;
  od_days: number;
  half_days: number;
  leave_days: number;
  holiday_days: number;
  weekoff_days: number;
  sal_days: number;
};

// ---------------------------------------------------------------------------
// Schema bootstrap
//
// Mirrors payroll-branch-readiness.service.ts's ensureTable(): the sibling table on this same
// page is created on demand for the same reason, so a environment whose migration has not been
// applied yet serves the screen instead of 500ing on every read. The authoritative definition is
// 1651_payroll_cc_attendance_finalization.sql and the two must stay identical.
// ---------------------------------------------------------------------------

let tablesEnsured = false;

async function ensureTables(): Promise<void> {
  if (tablesEnsured) return;
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS payroll_cc_attendance_finalization (
        id CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,
        process_month VARCHAR(7) COLLATE utf8mb4_unicode_ci NOT NULL,
        branch_id CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,
        cost_centre_id VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
        cost_centre_name VARCHAR(255) COLLATE utf8mb4_unicode_ci NULL,
        status ENUM('unprocessed','hr_finalized','branch_head_approved','ho_approved','unlock_requested')
          COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unprocessed',
        cycle_no INT NOT NULL DEFAULT 1,
        total_employees INT NOT NULL DEFAULT 0,
        hr_finalized_by CHAR(36) COLLATE utf8mb4_unicode_ci NULL,
        hr_finalized_at DATETIME NULL,
        hr_remarks TEXT COLLATE utf8mb4_unicode_ci NULL,
        branch_head_approved_by CHAR(36) COLLATE utf8mb4_unicode_ci NULL,
        branch_head_approved_at DATETIME NULL,
        branch_head_remarks TEXT COLLATE utf8mb4_unicode_ci NULL,
        ho_approved_by CHAR(36) COLLATE utf8mb4_unicode_ci NULL,
        ho_approved_at DATETIME NULL,
        ho_remarks TEXT COLLATE utf8mb4_unicode_ci NULL,
        last_rejected_by CHAR(36) COLLATE utf8mb4_unicode_ci NULL,
        last_rejected_at DATETIME NULL,
        last_rejected_stage VARCHAR(32) COLLATE utf8mb4_unicode_ci NULL,
        last_rejected_reason TEXT COLLATE utf8mb4_unicode_ci NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_cc_att_month_branch_cc (process_month, branch_id, cost_centre_id),
        KEY idx_cc_att_branch_month_status (branch_id, process_month, status),
        KEY idx_cc_att_month_status (process_month, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS payroll_cc_attendance_line (
        id CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,
        finalization_id CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,
        cycle_no INT NOT NULL DEFAULT 1,
        employee_id CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,
        employee_code VARCHAR(64) COLLATE utf8mb4_unicode_ci NULL,
        employee_name VARCHAR(255) COLLATE utf8mb4_unicode_ci NULL,
        emp_location VARCHAR(255) COLLATE utf8mb4_unicode_ci NULL,
        total_days INT NOT NULL DEFAULT 0,
        absent_days DECIMAL(6,2) NOT NULL DEFAULT 0,
        present_days DECIMAL(6,2) NOT NULL DEFAULT 0,
        od_days DECIMAL(6,2) NOT NULL DEFAULT 0,
        half_days DECIMAL(6,2) NOT NULL DEFAULT 0,
        leave_days DECIMAL(6,2) NOT NULL DEFAULT 0,
        holiday_days DECIMAL(6,2) NOT NULL DEFAULT 0,
        weekoff_days DECIMAL(6,2) NOT NULL DEFAULT 0,
        sal_days DECIMAL(6,2) NOT NULL DEFAULT 0,
        captured_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_cc_att_line_cycle_emp (finalization_id, cycle_no, employee_id),
        KEY idx_cc_att_line_final_cycle (finalization_id, cycle_no)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS payroll_cc_attendance_unlock_request (
        id CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,
        finalization_id CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,
        cycle_no INT NOT NULL DEFAULT 1,
        process_month VARCHAR(7) COLLATE utf8mb4_unicode_ci NOT NULL,
        branch_id CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,
        cost_centre_id VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
        reason TEXT COLLATE utf8mb4_unicode_ci NOT NULL,
        status ENUM('pending','approved','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
        requested_by CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,
        requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reviewed_by CHAR(36) COLLATE utf8mb4_unicode_ci NULL,
        reviewed_at DATETIME NULL,
        review_notes TEXT COLLATE utf8mb4_unicode_ci NULL,
        PRIMARY KEY (id),
        KEY idx_cc_att_unlock_final_status (finalization_id, status),
        KEY idx_cc_att_unlock_status (status, requested_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    tablesEnsured = true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[CcAttendance] ensureTables warning — ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Month helpers
// ---------------------------------------------------------------------------

/**
 * process_month is VARCHAR(7) 'YYYY-MM' everywhere in payroll (salary_prep_run.run_month is the
 * same), and comparing it to a DATE matches zero rows. Every caller goes through this.
 */
export function assertMonth(month: string): string {
  const m = String(month ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(m)) {
    throw refuse(400, "CC_ATT_BAD_MONTH", "month must be in YYYY-MM format");
  }
  return m;
}

function monthBounds(month: string) {
  const [yr, mo] = month.split("-").map(Number);
  const daysInMonth = new Date(yr, mo, 0).getDate();
  return {
    yr,
    mo,
    daysInMonth,
    firstDay: `${month}-01`,
    lastDay: `${month}-${String(daysInMonth).padStart(2, "0")}`,
  };
}

/** SQL fragment + params selecting the employees of one cost centre in one branch. */
function costCentrePredicate(costCentreId: string): { sql: string; params: unknown[] } {
  if (costCentreId === UNASSIGNED_COST_CENTRE) {
    return { sql: "(e.cost_centre_id IS NULL OR e.cost_centre_id = '')", params: [] };
  }
  return { sql: "e.cost_centre_id = ?", params: [costCentreId] };
}

// ---------------------------------------------------------------------------
// Reads — cost centre list
// ---------------------------------------------------------------------------

export type CostCentreRow = {
  cost_centre_id: string;
  cost_centre_code: string | null;
  cost_centre_name: string;
  total_employees: number;
  status: CcAttendanceStatus;
  cycle_no: number;
  finalization_id: string | null;
  hr_finalized_at: string | null;
  branch_head_approved_at: string | null;
  ho_approved_at: string | null;
  last_rejected_stage: string | null;
  last_rejected_reason: string | null;
  pending_unlock_request_id: string | null;
};

/**
 * Every cost centre with at least one employee in this branch, plus its sign-off state.
 *
 * Driven from employees rather than from cost_centre_master: a cost centre with no staff this
 * month has nothing to finalize and would only add noise, while an employee whose cost centre is
 * missing must still appear (the UNASSIGNED bucket).
 */
export async function listCostCentres(month: string, branchId: string): Promise<CostCentreRow[]> {
  await ensureTables();
  const m = assertMonth(month);

  // The bucket expression is inlined rather than bound as a placeholder, and it MUST be spelled
  // identically in SELECT and GROUP BY: this server runs with only_full_group_by, which does not
  // recognise two parameterised COALESCE(...) expressions as the same expression and rejects the
  // query outright with errno 1055. UNASSIGNED_COST_CENTRE is a module constant, never user
  // input, so there is nothing to inject.
  const bucket = `COALESCE(NULLIF(e.cost_centre_id, ''), '${UNASSIGNED_COST_CENTRE}')`;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
        ${bucket} AS cost_centre_id,
        MAX(cc.cost_centre_code) AS cost_centre_code,
        MAX(cc.cost_centre_name) AS cost_centre_name,
        COUNT(*) AS total_employees
       FROM employees e
       LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
      WHERE e.branch_id = ?
        AND e.active_status = 1
      GROUP BY ${bucket}
      -- ORDER BY repeats the aggregate rather than naming the alias: inside an expression
      -- (alias IS NULL) MySQL resolves the name to the base column cc.cost_centre_name, which
      -- only_full_group_by then rejects for the same reason as above. Unnamed cost centres —
      -- the UNASSIGNED bucket — sort last.
      ORDER BY MAX(cc.cost_centre_name) IS NULL, MAX(cc.cost_centre_name)`,
    [branchId]
  );

  const [finalizations] = await db.execute<RowDataPacket[]>(
    `SELECT f.*,
            (SELECT u.id FROM payroll_cc_attendance_unlock_request u
              WHERE u.finalization_id = f.id AND u.status = 'pending'
              ORDER BY u.requested_at DESC LIMIT 1) AS pending_unlock_request_id
       FROM payroll_cc_attendance_finalization f
      WHERE f.process_month = ? AND f.branch_id = ?`,
    [m, branchId]
  );
  const byCostCentre = new Map<string, RowDataPacket>();
  for (const f of finalizations) byCostCentre.set(String(f.cost_centre_id), f);

  return rows.map((r) => {
    const ccId = String(r.cost_centre_id);
    const f = byCostCentre.get(ccId);
    return {
      cost_centre_id: ccId,
      cost_centre_code: r.cost_centre_code ? String(r.cost_centre_code) : null,
      cost_centre_name:
        ccId === UNASSIGNED_COST_CENTRE
          ? "Unassigned (no cost centre)"
          : String(r.cost_centre_name ?? r.cost_centre_code ?? ccId),
      total_employees: Number(r.total_employees ?? 0),
      status: (f ? String(f.status) : "unprocessed") as CcAttendanceStatus,
      cycle_no: f ? Number(f.cycle_no ?? 1) : 1,
      finalization_id: f ? String(f.id) : null,
      hr_finalized_at: f?.hr_finalized_at ? String(f.hr_finalized_at) : null,
      branch_head_approved_at: f?.branch_head_approved_at ? String(f.branch_head_approved_at) : null,
      ho_approved_at: f?.ho_approved_at ? String(f.ho_approved_at) : null,
      last_rejected_stage: f?.last_rejected_stage ? String(f.last_rejected_stage) : null,
      last_rejected_reason: f?.last_rejected_reason ? String(f.last_rejected_reason) : null,
      pending_unlock_request_id: f?.pending_unlock_request_id
        ? String(f.pending_unlock_request_id)
        : null,
    };
  });
}

/** Status rollup for the branch header — how far through the month this branch is. */
export async function branchSummary(month: string, branchId: string) {
  const costCentres = await listCostCentres(month, branchId);
  const counts: Record<CcAttendanceStatus, number> = {
    unprocessed: 0,
    hr_finalized: 0,
    branch_head_approved: 0,
    ho_approved: 0,
    unlock_requested: 0,
  };
  let employees = 0;
  for (const cc of costCentres) {
    counts[cc.status] += 1;
    employees += cc.total_employees;
  }
  return {
    total_cost_centres: costCentres.length,
    total_employees: employees,
    counts,
    fully_approved: costCentres.length > 0 && counts.ho_approved === costCentres.length,
  };
}

// ---------------------------------------------------------------------------
// Reads — the employee day grid
// ---------------------------------------------------------------------------

/**
 * The live grid for one cost centre, derived from attendance_daily_record.
 *
 * Employee population mirrors the Attendance Register's two-population rule: every currently
 * active employee, PLUS anyone inactive who was actually engaged during the month (present /
 * half-day / on-duty / leave / holiday / worked week-off). Someone who worked half the month and
 * then left still has days that have to be signed off; someone whose every row is missing_punch
 * is noise the register deliberately excludes.
 */
export async function getLiveEmployeeGrid(
  month: string,
  branchId: string,
  costCentreId: string
): Promise<EmployeeDayRow[]> {
  const m = assertMonth(month);
  const { yr, mo, daysInMonth, firstDay, lastDay } = monthBounds(m);
  const cc = costCentrePredicate(costCentreId);

  const [attRows] = await db.execute<RowDataPacket[]>(
    `SELECT
        e.id AS employee_id,
        e.employee_code,
        CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS emp_name,
        COALESCE(b.branch_name, '') AS emp_location,
        e.date_of_joining,
        DAY(adr.record_date) AS day_num,
        adr.attendance_status
       FROM employees e
       LEFT JOIN attendance_daily_record adr
              ON adr.employee_id = e.id
             AND adr.record_date BETWEEN ? AND ?
       LEFT JOIN branch_master b ON b.id = e.branch_id
      WHERE e.branch_id = ?
        AND ${cc.sql}
        AND (e.active_status = 1 OR EXISTS (
              SELECT 1 FROM attendance_daily_record _x
               WHERE _x.employee_id = e.id
                 AND _x.record_date BETWEEN ? AND ?
                 AND _x.attendance_status IN
                     ('present','half_day','on_duty','leave_approved','holiday','week_off_worked')
            ))
      ORDER BY e.employee_code, adr.record_date`,
    [firstDay, lastDay, branchId, ...cc.params, firstDay, lastDay]
  );

  // Pivot: one entry per employee, day cells keyed 1..daysInMonth.
  type Pivot = {
    employee_id: string;
    employee_code: string | null;
    emp_name: string;
    emp_location: string;
    date_of_joining: Date | null;
    cells: Record<number, string>;
  };
  const empMap = new Map<string, Pivot>();
  for (const row of attRows) {
    const id = String(row.employee_id);
    if (!empMap.has(id)) {
      const doj = row.date_of_joining ? new Date(row.date_of_joining as string) : null;
      if (doj) doj.setHours(0, 0, 0, 0);
      empMap.set(id, {
        employee_id: id,
        employee_code: row.employee_code ? String(row.employee_code) : null,
        emp_name: String(row.emp_name ?? "").trim(),
        emp_location: String(row.emp_location ?? ""),
        date_of_joining: doj,
        cells: {},
      });
    }
    if (row.day_num == null) continue; // LEFT JOIN found no attendance record
    const emp = empMap.get(id)!;
    emp.cells[Number(row.day_num)] =
      ATTENDANCE_STATUS_CODE[String(row.attendance_status)] ?? String(row.attendance_status ?? "");
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Promise.all(
    Array.from(empMap.values()).map(async (emp): Promise<EmployeeDayRow> => {
      for (let d = 1; d <= daysInMonth; d++) {
        if (emp.cells[d] !== undefined) continue;
        emp.cells[d] = resolveMissingDayCell(new Date(yr, mo - 1, d), emp.date_of_joining, today);
      }
      const counts = countDayCodes((d) => emp.cells[d] ?? "", daysInMonth);
      const paidBase = computePaidBase(counts);
      // The payroll engine's own function — same slabs, same month-relative rule as the payslip.
      // counts.holiday is passed so this grid applies the same holiday-aware eligibility test
      // as the engine that pays. Omitting it showed fewer week-offs here than payroll grants.
      const eligibleWO = await calculateWeekoffEligibility(emp.employee_id, paidBase, m, counts.holiday);
      return {
        employee_id: emp.employee_id,
        employee_code: emp.employee_code,
        employee_name: emp.emp_name,
        emp_location: emp.emp_location,
        total_days: daysInMonth,
        absent_days: counts.absent,
        present_days: counts.present,
        od_days: counts.od,
        half_days: counts.hd,
        leave_days: counts.leave,
        holiday_days: counts.holiday,
        weekoff_days: eligibleWO,
        sal_days: computeSalDays(paidBase, eligibleWO, counts.holiday, daysInMonth),
      };
    })
  );
}

/** The snapshot the current cycle was finalized on, if there is one. */
async function getSnapshot(finalizationId: string, cycleNo: number): Promise<EmployeeDayRow[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_id, employee_code, employee_name, emp_location, total_days,
            absent_days, present_days, od_days, half_days, leave_days, holiday_days,
            weekoff_days, sal_days
       FROM payroll_cc_attendance_line
      WHERE finalization_id = ? AND cycle_no = ?
      ORDER BY employee_code`,
    [finalizationId, cycleNo]
  );
  // DECIMAL columns arrive from mysql2 as strings — Number() them here rather than at the twelve
  // call sites, where a .toFixed() on a string is the crash that took out /quality-dashboard.
  return rows.map((r) => ({
    employee_id: String(r.employee_id),
    employee_code: r.employee_code ? String(r.employee_code) : null,
    employee_name: String(r.employee_name ?? ""),
    emp_location: String(r.emp_location ?? ""),
    total_days: Number(r.total_days ?? 0),
    absent_days: Number(r.absent_days ?? 0),
    present_days: Number(r.present_days ?? 0),
    od_days: Number(r.od_days ?? 0),
    half_days: Number(r.half_days ?? 0),
    leave_days: Number(r.leave_days ?? 0),
    holiday_days: Number(r.holiday_days ?? 0),
    weekoff_days: Number(r.weekoff_days ?? 0),
    sal_days: Number(r.sal_days ?? 0),
  }));
}

/**
 * The drill-down payload: live numbers, the finalized snapshot, and whether they still agree.
 *
 * Drift is computed here rather than left to the UI so every consumer — screen, export, a future
 * digest — answers "is the Payroll Head approving what HR finalized?" the same way.
 */
export async function getCostCentreDetail(month: string, branchId: string, costCentreId: string) {
  await ensureTables();
  const m = assertMonth(month);
  const record = await findFinalization(m, branchId, costCentreId);
  const live = await getLiveEmployeeGrid(m, branchId, costCentreId);

  let snapshot: EmployeeDayRow[] = [];
  if (record && record.status !== "unprocessed") {
    snapshot = await getSnapshot(String(record.id), Number(record.cycle_no ?? 1));
  }

  const drifted: string[] = [];
  if (snapshot.length > 0) {
    const liveById = new Map(live.map((r) => [r.employee_id, r]));
    for (const snap of snapshot) {
      const l = liveById.get(snap.employee_id);
      if (!l || l.sal_days !== snap.sal_days) drifted.push(snap.employee_code ?? snap.employee_id);
    }
    for (const l of live) {
      if (!snapshot.some((s) => s.employee_id === l.employee_id)) {
        drifted.push(l.employee_code ?? l.employee_id);
      }
    }
  }

  // The pending unlock request travels with the detail so the Payroll Head can act on it from the
  // same drawer they are reading the numbers in. Without this the chain dead-ends at
  // 'unlock_requested': the endpoints exist but the screen has no id to send them.
  let pendingUnlockRequestId: string | null = null;
  if (record && String(record.status) === "unlock_requested") {
    const [reqRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM payroll_cc_attendance_unlock_request
        WHERE finalization_id = ? AND status = 'pending'
        ORDER BY requested_at DESC LIMIT 1`,
      [String(record.id)]
    );
    pendingUnlockRequestId = reqRows[0] ? String(reqRows[0].id) : null;
  }

  return {
    month: m,
    branch_id: branchId,
    cost_centre_id: costCentreId,
    status: (record ? String(record.status) : "unprocessed") as CcAttendanceStatus,
    cycle_no: record ? Number(record.cycle_no ?? 1) : 1,
    finalization: record ?? null,
    pending_unlock_request_id: pendingUnlockRequestId,
    rows: live,
    snapshot,
    drifted_employee_codes: drifted,
  };
}

// ---------------------------------------------------------------------------
// Finalization row helpers
// ---------------------------------------------------------------------------

async function findFinalization(
  month: string,
  branchId: string,
  costCentreId: string,
  connection?: PoolConnection,
  forUpdate = false
): Promise<RowDataPacket | null> {
  const executor = connection ?? db;
  const [rows] = await executor.execute<RowDataPacket[]>(
    `SELECT * FROM payroll_cc_attendance_finalization
      WHERE process_month = ? AND branch_id = ? AND cost_centre_id = ?
      LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [month, branchId, costCentreId]
  );
  return rows[0] ?? null;
}

async function resolveCostCentreName(costCentreId: string): Promise<string | null> {
  if (costCentreId === UNASSIGNED_COST_CENTRE) return "Unassigned (no cost centre)";
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT cost_centre_name, cost_centre_code FROM cost_centre_master WHERE id = ? LIMIT 1",
    [costCentreId]
  );
  const r = rows[0];
  if (!r) return null;
  return String(r.cost_centre_name ?? r.cost_centre_code ?? costCentreId);
}

export type Actor = { userId: string; role: string; roles?: string[] };

/**
 * The exemption is checked across ALL of the caller's roles, not just the primary one on the JWT.
 * A super_admin whose token happens to present a different primary role is still a super_admin,
 * and — more importantly — a user who holds payroll_hr AND branch_head is NOT exempt just because
 * their primary role reads branch_head. That combination is exactly what this guard exists for.
 */
function assertNotSelf(previousActorId: string | null, actor: Actor, message: string) {
  if (!previousActorId) return;
  if (previousActorId !== actor.userId) return;
  const held = [actor.role, ...(actor.roles ?? [])].map((r) => String(r ?? "").toLowerCase());
  if (held.some((r) => MAKER_CHECKER_EXEMPT.has(r))) return;
  throw refuse(409, "CC_ATT_MAKER_CHECKER", message);
}

// ---------------------------------------------------------------------------
// Stage 1 — Branch Payroll HR / Branch WFM finalize
// ---------------------------------------------------------------------------

/**
 * Snapshot the grid and hand the cost centre to the Branch Head.
 *
 * Allowed only from 'unprocessed' — which is also where a sent-back packet and a granted unlock
 * both land, so there is exactly one entry point into the chain.
 */
export async function finalize(
  month: string,
  branchId: string,
  costCentreId: string,
  actor: Actor,
  remarks?: string
) {
  await ensureTables();
  const m = assertMonth(month);
  const rows = await getLiveEmployeeGrid(m, branchId, costCentreId);
  if (rows.length === 0) {
    throw refuse(
      409,
      "CC_ATT_NO_EMPLOYEES",
      "This cost centre has no employees to finalize for the selected month"
    );
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    let record = await findFinalization(m, branchId, costCentreId, connection, true);
    if (record && String(record.status) !== "unprocessed") {
      throw refuse(
        409,
        "CC_ATT_WRONG_STAGE",
        `This cost centre is already ${String(record.status).replace(/_/g, " ")} — it cannot be finalized again`
      );
    }

    const cycleNo = record ? Number(record.cycle_no ?? 1) : 1;
    const finalizationId = record ? String(record.id) : randomUUID();
    const fromStatus = record ? String(record.status) : "unprocessed";

    if (!record) {
      await connection.execute(
        `INSERT INTO payroll_cc_attendance_finalization
           (id, process_month, branch_id, cost_centre_id, cost_centre_name, status, cycle_no,
            total_employees, hr_finalized_by, hr_finalized_at, hr_remarks)
         VALUES (?, ?, ?, ?, ?, 'hr_finalized', 1, ?, ?, NOW(), ?)`,
        [
          finalizationId,
          m,
          branchId,
          costCentreId,
          await resolveCostCentreName(costCentreId),
          rows.length,
          actor.userId,
          remarks?.trim() || null,
        ]
      );
    } else {
      // Concurrency: another session finalizing the same cost centre in the same second must lose,
      // not silently overwrite. FOR UPDATE above already serialises, and the status guard here is
      // the same belt-and-braces check every GRN transition uses.
      const [res] = await connection.execute<ResultSetHeader>(
        `UPDATE payroll_cc_attendance_finalization
            SET status = 'hr_finalized', total_employees = ?, hr_finalized_by = ?,
                hr_finalized_at = NOW(), hr_remarks = ?,
                branch_head_approved_by = NULL, branch_head_approved_at = NULL, branch_head_remarks = NULL,
                ho_approved_by = NULL, ho_approved_at = NULL, ho_remarks = NULL
          WHERE id = ? AND status = 'unprocessed'`,
        [rows.length, actor.userId, remarks?.trim() || null, finalizationId]
      );
      if (res.affectedRows !== 1) {
        throw refuse(409, "CC_ATT_STATE_CHANGED", "This cost centre changed state — reload and try again");
      }
    }

    // Re-snapshot this cycle from scratch. A retry after a partial failure must not leave half of
    // an old grid behind, and the unique key would reject the duplicate rows anyway.
    await connection.execute(
      "DELETE FROM payroll_cc_attendance_line WHERE finalization_id = ? AND cycle_no = ?",
      [finalizationId, cycleNo]
    );
    for (const r of rows) {
      await connection.execute(
        `INSERT INTO payroll_cc_attendance_line
           (id, finalization_id, cycle_no, employee_id, employee_code, employee_name, emp_location,
            total_days, absent_days, present_days, od_days, half_days, leave_days, holiday_days,
            weekoff_days, sal_days)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(), finalizationId, cycleNo, r.employee_id, r.employee_code, r.employee_name,
          r.emp_location, r.total_days, r.absent_days, r.present_days, r.od_days, r.half_days,
          r.leave_days, r.holiday_days, r.weekoff_days, r.sal_days,
        ]
      );
    }

    await recordFinanceApprovalEvent(
      {
        entityType: CC_ATTENDANCE_ENTITY_TYPE,
        entityId: finalizationId,
        action: "finalize",
        fromStatus,
        toStatus: "hr_finalized",
        decision: "finalized",
        actorUserId: actor.userId,
        actorRole: STAGE_ROLE.hr,
        remarks: remarks?.trim() || null,
        details: { month: m, branchId, costCentreId, cycleNo, employees: rows.length },
      },
      connection
    );

    await connection.commit();
    return { finalizationId, status: "hr_finalized" as const, cycleNo, employees: rows.length };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// ---------------------------------------------------------------------------
// Stages 2 and 3 — Branch Head, then HO Payroll Head
// ---------------------------------------------------------------------------

type Stage = "branch" | "ho";

const STAGE_RULES: Record<Stage, { from: CcAttendanceStatus; to: CcAttendanceStatus; role: string }> = {
  branch: { from: "hr_finalized", to: "branch_head_approved", role: STAGE_ROLE.branch },
  ho: { from: "branch_head_approved", to: "ho_approved", role: STAGE_ROLE.ho },
};

export async function approve(
  stage: Stage,
  month: string,
  branchId: string,
  costCentreId: string,
  actor: Actor,
  remarks?: string
) {
  await ensureTables();
  const m = assertMonth(month);
  const rule = STAGE_RULES[stage];

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const record = await findFinalization(m, branchId, costCentreId, connection, true);
    if (!record) throw refuse(404, "CC_ATT_NOT_FOUND", "This cost centre has not been finalized yet");
    if (String(record.status) !== rule.from) {
      throw refuse(
        409,
        "CC_ATT_WRONG_STAGE",
        `This cost centre is ${String(record.status).replace(/_/g, " ")} — it is not waiting for ${
          stage === "branch" ? "Branch Head" : "Payroll Head"
        } approval`
      );
    }

    // Maker-checker by actor identity, not merely by role: one person holding both payroll_hr and
    // branch_head for their own branch would otherwise clear two stages of a three-stage chain.
    assertNotSelf(
      record.hr_finalized_by ? String(record.hr_finalized_by) : null,
      actor,
      "You finalized this cost centre, so you cannot also approve it. A different approver must review it."
    );
    if (stage === "ho") {
      assertNotSelf(
        record.branch_head_approved_by ? String(record.branch_head_approved_by) : null,
        actor,
        "You approved this cost centre as Branch Head, so you cannot also give it HO approval."
      );
    }

    const setCols =
      stage === "branch"
        ? "branch_head_approved_by = ?, branch_head_approved_at = NOW(), branch_head_remarks = ?"
        : "ho_approved_by = ?, ho_approved_at = NOW(), ho_remarks = ?";

    const [res] = await connection.execute<ResultSetHeader>(
      `UPDATE payroll_cc_attendance_finalization
          SET status = ?, ${setCols}
        WHERE id = ? AND status = ?`,
      [rule.to, actor.userId, remarks?.trim() || null, record.id, rule.from]
    );
    if (res.affectedRows !== 1) {
      throw refuse(409, "CC_ATT_STATE_CHANGED", "This cost centre changed state — reload and try again");
    }

    await recordFinanceApprovalEvent(
      {
        entityType: CC_ATTENDANCE_ENTITY_TYPE,
        entityId: String(record.id),
        action: "approve",
        fromStatus: rule.from,
        toStatus: rule.to,
        decision: "approved",
        actorUserId: actor.userId,
        actorRole: rule.role,
        remarks: remarks?.trim() || null,
        details: { month: m, branchId, costCentreId, cycleNo: Number(record.cycle_no ?? 1) },
      },
      connection
    );

    await connection.commit();
    return { finalizationId: String(record.id), status: rule.to, cycleNo: Number(record.cycle_no ?? 1) };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Send a packet back down to the branch, before HO approval.
 *
 * Deliberately NOT an unlock: nothing is approved end-to-end yet, so there is nothing to unlock —
 * the reviewer simply declines and the branch fixes and re-finalizes. The reason is mandatory
 * because "rejected" with no reason is a dead end for whoever has to act on it.
 */
export async function sendBack(
  stage: Stage,
  month: string,
  branchId: string,
  costCentreId: string,
  actor: Actor,
  reason: string
) {
  await ensureTables();
  const m = assertMonth(month);
  if (!reason?.trim()) {
    throw refuse(400, "CC_ATT_REASON_REQUIRED", "A reason is required to send a cost centre back");
  }
  const rule = STAGE_RULES[stage];

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const record = await findFinalization(m, branchId, costCentreId, connection, true);
    if (!record) throw refuse(404, "CC_ATT_NOT_FOUND", "This cost centre has not been finalized yet");
    if (String(record.status) !== rule.from) {
      throw refuse(
        409,
        "CC_ATT_WRONG_STAGE",
        `This cost centre is ${String(record.status).replace(/_/g, " ")} — there is nothing to send back at this stage`
      );
    }

    const [res] = await connection.execute<ResultSetHeader>(
      `UPDATE payroll_cc_attendance_finalization
          SET status = 'unprocessed',
              last_rejected_by = ?, last_rejected_at = NOW(),
              last_rejected_stage = ?, last_rejected_reason = ?
        WHERE id = ? AND status = ?`,
      [actor.userId, rule.role, reason.trim(), record.id, rule.from]
    );
    if (res.affectedRows !== 1) {
      throw refuse(409, "CC_ATT_STATE_CHANGED", "This cost centre changed state — reload and try again");
    }

    await recordFinanceApprovalEvent(
      {
        entityType: CC_ATTENDANCE_ENTITY_TYPE,
        entityId: String(record.id),
        action: "return",
        fromStatus: rule.from,
        toStatus: "unprocessed",
        decision: "sent_back",
        actorUserId: actor.userId,
        actorRole: rule.role,
        remarks: reason.trim(),
        details: { month: m, branchId, costCentreId, cycleNo: Number(record.cycle_no ?? 1) },
      },
      connection
    );

    await connection.commit();
    return { finalizationId: String(record.id), status: "unprocessed" as const };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// ---------------------------------------------------------------------------
// Unlock — the after-HO-approval correction path
// ---------------------------------------------------------------------------

/**
 * The branch asks the Payroll Head to reopen a cost centre the HO has already approved.
 *
 * Only from 'ho_approved'. Before that point a reviewer can simply send the packet back
 * (sendBack), and no one needs the Payroll Head's permission for that.
 */
export async function requestUnlock(
  month: string,
  branchId: string,
  costCentreId: string,
  reason: string,
  actor: Actor
) {
  await ensureTables();
  const m = assertMonth(month);
  // Ten characters, matching the existing per-employee attendance unlock endpoint's rule. A
  // one-word reason is what makes an audit trail unreadable six weeks later.
  if (!reason?.trim() || reason.trim().length < 10) {
    throw refuse(
      400,
      "CC_ATT_UNLOCK_REASON_REQUIRED",
      "A reason of at least 10 characters is required to request an unlock"
    );
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const record = await findFinalization(m, branchId, costCentreId, connection, true);
    if (!record) throw refuse(404, "CC_ATT_NOT_FOUND", "This cost centre has not been finalized yet");
    if (String(record.status) !== "ho_approved") {
      throw refuse(
        409,
        "CC_ATT_NOT_APPROVED",
        "Only a cost centre already approved by the Payroll Head needs an unlock request"
      );
    }

    const requestId = randomUUID();
    await connection.execute(
      `INSERT INTO payroll_cc_attendance_unlock_request
         (id, finalization_id, cycle_no, process_month, branch_id, cost_centre_id, reason,
          status, requested_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        requestId, record.id, Number(record.cycle_no ?? 1), m, branchId, costCentreId,
        reason.trim(), actor.userId,
      ]
    );

    const [res] = await connection.execute<ResultSetHeader>(
      `UPDATE payroll_cc_attendance_finalization
          SET status = 'unlock_requested'
        WHERE id = ? AND status = 'ho_approved'`,
      [record.id]
    );
    if (res.affectedRows !== 1) {
      throw refuse(409, "CC_ATT_STATE_CHANGED", "This cost centre changed state — reload and try again");
    }

    await recordFinanceApprovalEvent(
      {
        entityType: CC_ATTENDANCE_ENTITY_TYPE,
        entityId: String(record.id),
        action: "request_unlock",
        fromStatus: "ho_approved",
        toStatus: "unlock_requested",
        decision: "unlock_requested",
        actorUserId: actor.userId,
        actorRole: actor.role,
        remarks: reason.trim(),
        details: { month: m, branchId, costCentreId, requestId, cycleNo: Number(record.cycle_no ?? 1) },
      },
      connection
    );

    await connection.commit();
    return { requestId, finalizationId: String(record.id), status: "unlock_requested" as const };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * The Payroll Head grants or refuses the unlock.
 *
 * Granting increments cycle_no and returns the cost centre to 'unprocessed', so the branch does
 * its regularization/leave corrections and then runs the whole three-stage chain again — which is
 * the point: an unlocked month is not silently re-approved on the strength of the old sign-offs.
 */
export async function reviewUnlock(
  requestId: string,
  decision: "approve" | "reject",
  actor: Actor,
  reviewNotes?: string
) {
  await ensureTables();
  if (decision === "reject" && !reviewNotes?.trim()) {
    throw refuse(400, "CC_ATT_REJECT_REASON_REQUIRED", "A reason is required to reject an unlock request");
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<RowDataPacket[]>(
      "SELECT * FROM payroll_cc_attendance_unlock_request WHERE id = ? FOR UPDATE",
      [requestId]
    );
    const request = rows[0];
    if (!request) throw refuse(404, "CC_ATT_UNLOCK_NOT_FOUND", "Unlock request not found");
    if (String(request.status) !== "pending") {
      throw refuse(409, "CC_ATT_UNLOCK_WRONG_STAGE", `This unlock request is already ${request.status}`);
    }
    assertNotSelf(
      String(request.requested_by),
      actor,
      "You raised this unlock request, so you cannot review it. A different Payroll Head must decide."
    );

    const nextRequestStatus = decision === "approve" ? "approved" : "rejected";
    await connection.execute(
      `UPDATE payroll_cc_attendance_unlock_request
          SET status = ?, reviewed_by = ?, reviewed_at = NOW(), review_notes = ?
        WHERE id = ?`,
      [nextRequestStatus, actor.userId, reviewNotes?.trim() || null, requestId]
    );

    const finalizationId = String(request.finalization_id);
    const nextStatus: CcAttendanceStatus = decision === "approve" ? "unprocessed" : "ho_approved";

    const [res] = await connection.execute<ResultSetHeader>(
      decision === "approve"
        ? `UPDATE payroll_cc_attendance_finalization
              SET status = 'unprocessed',
                  cycle_no = cycle_no + 1,
                  hr_finalized_by = NULL, hr_finalized_at = NULL, hr_remarks = NULL,
                  branch_head_approved_by = NULL, branch_head_approved_at = NULL, branch_head_remarks = NULL,
                  ho_approved_by = NULL, ho_approved_at = NULL, ho_remarks = NULL,
                  last_rejected_by = NULL, last_rejected_at = NULL,
                  last_rejected_stage = NULL, last_rejected_reason = NULL
            WHERE id = ? AND status = 'unlock_requested'`
        : `UPDATE payroll_cc_attendance_finalization
              SET status = 'ho_approved'
            WHERE id = ? AND status = 'unlock_requested'`,
      [finalizationId]
    );
    if (res.affectedRows !== 1) {
      throw refuse(409, "CC_ATT_STATE_CHANGED", "This cost centre changed state — reload and try again");
    }

    await recordFinanceApprovalEvent(
      {
        entityType: CC_ATTENDANCE_ENTITY_TYPE,
        entityId: finalizationId,
        action: decision === "approve" ? "unlock_granted" : "unlock_refused",
        fromStatus: "unlock_requested",
        toStatus: nextStatus,
        decision: nextRequestStatus,
        actorUserId: actor.userId,
        actorRole: STAGE_ROLE.ho,
        remarks: reviewNotes?.trim() || null,
        details: {
          requestId,
          month: String(request.process_month),
          branchId: String(request.branch_id),
          costCentreId: String(request.cost_centre_id),
          previousCycleNo: Number(request.cycle_no ?? 1),
        },
      },
      connection
    );

    await connection.commit();
    return { requestId, status: nextRequestStatus, finalizationStatus: nextStatus };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** Pending unlock requests the Payroll Head has to decide on, newest first. */
export async function listPendingUnlockRequests(month?: string, branchId?: string) {
  await ensureTables();
  const clauses = ["u.status = 'pending'"];
  const params: unknown[] = [];
  if (month) {
    clauses.push("u.process_month = ?");
    params.push(assertMonth(month));
  }
  if (branchId) {
    clauses.push("u.branch_id = ?");
    params.push(branchId);
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT u.id, u.finalization_id, u.process_month, u.branch_id, u.cost_centre_id, u.reason,
            u.requested_by, u.requested_at, u.cycle_no,
            f.cost_centre_name,
            COALESCE(b.branch_name, '') AS branch_name
       FROM payroll_cc_attendance_unlock_request u
       LEFT JOIN payroll_cc_attendance_finalization f ON f.id = u.finalization_id
       LEFT JOIN branch_master b ON b.id = u.branch_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY u.requested_at DESC
      LIMIT 200`,
    params
  );
  return rows;
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/**
 * The approval timeline for one cost centre, across every cycle, with actor names resolved.
 *
 * Reads finance_approval_event (1089) rather than a private log table: it is polymorphic by
 * design, is written in the same transaction as each transition, and throws rather than silently
 * dropping a row — which is what a sign-off history has to do.
 */
export async function getHistory(month: string, branchId: string, costCentreId: string) {
  await ensureTables();
  const m = assertMonth(month);
  const record = await findFinalization(m, branchId, costCentreId);
  if (!record) return { finalization_id: null, events: [] as RowDataPacket[] };

  const events = (await listFinanceApprovalEvents(
    CC_ATTENDANCE_ENTITY_TYPE,
    String(record.id)
  )) as RowDataPacket[];

  const actorIds = Array.from(
    new Set(events.map((e) => String(e.actor_user_id)).filter(Boolean))
  );
  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    // auth_user stores no name, only email — resolve it through employees.user_id, the same way
    // payroll-audit-trail.routes.ts and payroll-window.routes.ts already do.
    const [userRows] = await db.query<RowDataPacket[]>(
      `SELECT au.id,
              COALESCE(
                NULLIF(TRIM(CONCAT(COALESCE(ae.first_name,''),' ',COALESCE(ae.last_name,''))), ''),
                au.email
              ) AS display_name
         FROM auth_user au
         LEFT JOIN employees ae ON ae.user_id = au.id
        WHERE au.id IN (?)`,
      [actorIds]
    );
    for (const u of userRows) names.set(String(u.id), String(u.display_name ?? ""));
  }

  return {
    finalization_id: String(record.id),
    events: events.map((e) => ({ ...e, actor_name: names.get(String(e.actor_user_id)) ?? null })),
  };
}

export const payrollCcAttendanceService = {
  listCostCentres,
  branchSummary,
  getCostCentreDetail,
  getLiveEmployeeGrid,
  finalize,
  approve,
  sendBack,
  requestUnlock,
  reviewUnlock,
  listPendingUnlockRequests,
  getHistory,
};
