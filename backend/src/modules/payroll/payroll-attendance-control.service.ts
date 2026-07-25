import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { payrollGovernanceService } from "./payroll-governance.service.js";

export type AttendanceControlGap = {
  id: string;
  issueDate: string;
  employeeId: string | null;
  employeeCode: string | null;
  employeeName: string | null;
  branchName: string | null;
  processName: string | null;
  issueType: string;
  severity: "blocker" | "warning";
  source: "apr" | "ncosec" | "adr" | "regularization" | "salary_prep";
  sourceMinutes: number | null;
  adrMinutes: number | null;
  adrStatus: string | null;
  payrollImpact: string;
  actionNeeded: string;
};

type ControlParams = {
  runMonth?: string;
  runId?: string;
  from?: string;
  to?: string;
  issueType?: string;
  search?: string;
  page?: number;
  limit?: number;
};

const PAYROLL_ROLES = ["super_admin", "admin", "payroll_head", "payroll_branch", "payroll", "hr", "wfm", "branch_head"];

function monthRange(runMonth: string) {
  const [year, month] = runMonth.split("-").map(Number);
  const last = new Date(year, month, 0).getDate();
  return {
    from: `${runMonth}-01`,
    to: `${runMonth}-${String(last).padStart(2, "0")}`,
  };
}

function classifyAprStatus(minutes: number) {
  if (minutes >= 480) return "present";
  if (minutes >= 240) return "half_day";
  return "absent";
}

function normalizeDate(value: unknown) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function matchesFilters(gap: AttendanceControlGap, params: ControlParams) {
  if (params.issueType && params.issueType !== "all" && gap.issueType !== params.issueType) return false;
  const q = params.search?.trim().toLowerCase();
  if (!q) return true;
  return [gap.employeeCode, gap.employeeName, gap.branchName, gap.processName, gap.issueType]
    .some((part) => String(part ?? "").toLowerCase().includes(q));
}

async function latestRun(runMonth: string, runId?: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, run_month, status, total_employees, total_gross, total_deductions, total_net
       FROM salary_prep_run
      WHERE (? IS NULL OR id = ?)
        AND run_month = ?
      ORDER BY created_at DESC
      LIMIT 1`,
    [runId ?? null, runId ?? null, runMonth],
  );
  return (rows as RowDataPacket[])[0] as any | undefined;
}

async function sourceCounts(from: string, to: string) {
  const [[adrRows], [ibdRows], [aprRows], [regRows]] = await Promise.all([
    db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS rows_count,
              COUNT(DISTINCT employee_id) AS employees_count
         FROM attendance_daily_record
        WHERE record_date BETWEEN ? AND ?`,
      [from, to],
    ),
    db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS rows_count,
              COUNT(DISTINCT employee_code) AS employees_count
         FROM integration_biometric_daily
        WHERE activity_date BETWEEN ? AND ?`,
      [from, to],
    ),
    db.execute<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT CONCAT(UserID, '|', ReportDate)) AS rows_count,
              COUNT(DISTINCT UserID) AS employees_count
         FROM apr
        WHERE ReportDate BETWEEN ? AND ?`,
      [from, to],
    ),
    db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS rows_count,
              COUNT(DISTINCT employee_id) AS employees_count
         FROM attendance_regularization
        WHERE session_date BETWEEN ? AND ?
          AND status = 'approved'`,
      [from, to],
    ),
  ]);

  return {
    adr: (adrRows as RowDataPacket[])[0] ?? {},
    ncosec: (ibdRows as RowDataPacket[])[0] ?? {},
    apr: (aprRows as RowDataPacket[])[0] ?? {},
    regularization: (regRows as RowDataPacket[])[0] ?? {},
  };
}

async function aprGaps(from: string, to: string): Promise<AttendanceControlGap[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id AS employee_id,
            e.employee_code,
            COALESCE(NULLIF(e.full_name,''), CONCAT_WS(' ', e.first_name, e.last_name)) AS employee_name,
            bm.branch_name,
            pm.process_name,
            a.ReportDate AS issue_date,
            ROUND(COALESCE(SUM(TIME_TO_SEC(a.Net_Login)), 0) / 60) AS apr_minutes,
            adr.id AS adr_id,
            adr.attendance_status,
            COALESCE(adr.raw_minutes, adr.dialler_minutes, adr.biometric_minutes, 0) AS adr_minutes,
            adr.is_locked,
            adr.regularization_id
       FROM apr a
       JOIN employees e ON e.employee_code = a.UserID
       LEFT JOIN branch_master bm ON bm.id = e.branch_id
       LEFT JOIN process_master pm ON pm.id = e.process_id
       LEFT JOIN attendance_daily_record adr
              ON adr.employee_id = e.id AND adr.record_date = a.ReportDate
      WHERE a.ReportDate BETWEEN ? AND ?
      GROUP BY e.id, e.employee_code, employee_name, bm.branch_name, pm.process_name,
               a.ReportDate, adr.id, adr.attendance_status, adr.raw_minutes,
               adr.dialler_minutes, adr.biometric_minutes, adr.is_locked, adr.regularization_id
      HAVING adr_id IS NULL
          OR (
            COALESCE(is_locked, 0) = 0
            AND regularization_id IS NULL
            AND attendance_status <> CASE
              WHEN apr_minutes >= 480 THEN 'present'
              WHEN apr_minutes >= 240 THEN 'half_day'
              ELSE 'absent'
            END
          )
      LIMIT 500`,
    [from, to],
  );

  return (rows as any[]).map((row) => {
    const sourceMinutes = Number(row.apr_minutes ?? 0);
    const expected = classifyAprStatus(sourceMinutes);
    const missingAdr = !row.adr_id;
    return {
      id: `apr:${row.employee_id}:${normalizeDate(row.issue_date)}`,
      issueDate: normalizeDate(row.issue_date),
      employeeId: row.employee_id ?? null,
      employeeCode: row.employee_code ?? null,
      employeeName: row.employee_name ?? null,
      branchName: row.branch_name ?? null,
      processName: row.process_name ?? null,
      issueType: missingAdr ? "apr_missing_adr" : "apr_status_mismatch",
      severity: "blocker" as const,
      source: "apr" as const,
      sourceMinutes,
      adrMinutes: Number(row.adr_minutes ?? 0),
      adrStatus: row.attendance_status ?? null,
      payrollImpact: missingAdr ? "APR day is not represented in payroll ADR" : `APR expects ${expected}, ADR has ${row.attendance_status}`,
      actionNeeded: missingAdr ? "Create/reconcile ADR from APR or approved regularization" : "Review APR-vs-ADR status before payroll freeze",
    };
  });
}

async function ncosecGaps(from: string, to: string): Promise<AttendanceControlGap[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id AS employee_id,
            e.employee_code,
            COALESCE(NULLIF(e.full_name,''), CONCAT_WS(' ', e.first_name, e.last_name)) AS employee_name,
            bm.branch_name,
            pm.process_name,
            ibd.activity_date AS issue_date,
            ibd.biometric_minutes,
            ibd.total_punches,
            adr.id AS adr_id,
            adr.attendance_status,
            COALESCE(adr.biometric_minutes, adr.raw_minutes, 0) AS adr_minutes,
            adr.is_locked,
            adr.regularization_id
       FROM integration_biometric_daily ibd
       JOIN employees e ON e.employee_code = ibd.employee_code
       LEFT JOIN branch_master bm ON bm.id = e.branch_id
       LEFT JOIN process_master pm ON pm.id = e.process_id
       LEFT JOIN attendance_daily_record adr
              ON adr.employee_id = e.id AND adr.record_date = ibd.activity_date
      WHERE ibd.activity_date BETWEEN ? AND ?
        AND ibd.biometric_minutes > 0
        AND (
          adr.id IS NULL
          OR (
            COALESCE(adr.is_locked, 0) = 0
            AND adr.regularization_id IS NULL
            AND (
              COALESCE(adr.biometric_minutes, adr.raw_minutes, 0) = 0
              OR adr.attendance_status IN ('absent','missing_punch','unreconciled')
            )
          )
        )
      LIMIT 500`,
    [from, to],
  );

  return (rows as any[]).map((row) => {
    const missingAdr = !row.adr_id;
    return {
      id: `ncosec:${row.employee_id}:${normalizeDate(row.issue_date)}`,
      issueDate: normalizeDate(row.issue_date),
      employeeId: row.employee_id ?? null,
      employeeCode: row.employee_code ?? null,
      employeeName: row.employee_name ?? null,
      branchName: row.branch_name ?? null,
      processName: row.process_name ?? null,
      issueType: missingAdr ? "ncosec_missing_adr" : "ncosec_minutes_not_in_adr",
      severity: "blocker" as const,
      source: "ncosec" as const,
      sourceMinutes: Number(row.biometric_minutes ?? 0),
      adrMinutes: Number(row.adr_minutes ?? 0),
      adrStatus: row.attendance_status ?? null,
      payrollImpact: missingAdr ? "Biometric punch day is absent from payroll ADR" : "Biometric minutes are not reflected in payroll ADR",
      actionNeeded: "Run attendance reconciliation or review regularization lock",
    };
  });
}

async function salaryPrepGaps(runId: string): Promise<AttendanceControlGap[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT spl.employee_id,
            e.employee_code,
            COALESCE(NULLIF(e.full_name,''), CONCAT_WS(' ', e.first_name, e.last_name)) AS employee_name,
            bm.branch_name,
            pm.process_name,
            spr.run_month,
            spl.paid_working_days,
            spl.eligible_weekoff_days,
            spl.eligible_holiday_days,
            spl.final_payable_days
       FROM salary_prep_line spl
       JOIN salary_prep_run spr ON spr.id = spl.run_id
       JOIN employees e ON e.id = spl.employee_id
       LEFT JOIN branch_master bm ON bm.id = e.branch_id
       LEFT JOIN process_master pm ON pm.id = e.process_id
      WHERE spl.run_id = ?
        AND ABS(COALESCE(spl.final_payable_days, 0) - LEAST(
          COALESCE(spl.paid_working_days, 0)
          + COALESCE(spl.eligible_weekoff_days, 0)
          + COALESCE(spl.eligible_holiday_days, 0),
          DAY(LAST_DAY(CONCAT(spr.run_month, '-01')))
        )) > 0.01
      LIMIT 500`,
    [runId],
  );

  return (rows as any[]).map((row) => ({
    id: `salary:${row.employee_id}:${row.run_month}`,
    issueDate: `${row.run_month}-01`,
    employeeId: row.employee_id ?? null,
    employeeCode: row.employee_code ?? null,
    employeeName: row.employee_name ?? null,
    branchName: row.branch_name ?? null,
    processName: row.process_name ?? null,
    issueType: "salary_payable_days_mismatch",
    severity: "blocker" as const,
    source: "salary_prep" as const,
    sourceMinutes: null,
    adrMinutes: null,
    adrStatus: null,
    payrollImpact: `Salary line has ${row.final_payable_days} payable days; components total ${Number(row.paid_working_days ?? 0) + Number(row.eligible_weekoff_days ?? 0) + Number(row.eligible_holiday_days ?? 0)}`,
    actionNeeded: "Recalculate affected payroll line before validation",
  }));
}

async function regularizationGaps(from: string, to: string): Promise<AttendanceControlGap[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ar.id AS regularization_id,
            ar.employee_id,
            e.employee_code,
            COALESCE(NULLIF(e.full_name,''), CONCAT_WS(' ', e.first_name, e.last_name)) AS employee_name,
            bm.branch_name,
            pm.process_name,
            ar.session_date AS issue_date,
            ar.requested_status,
            adr.id AS adr_id,
            adr.attendance_status,
            adr.regularization_id AS adr_regularization_id,
            adr.is_locked,
            COALESCE(adr.raw_minutes, adr.dialler_minutes, adr.biometric_minutes, 0) AS adr_minutes
       FROM attendance_regularization ar
       JOIN employees e ON e.id = ar.employee_id
       LEFT JOIN branch_master bm ON bm.id = e.branch_id
       LEFT JOIN process_master pm ON pm.id = e.process_id
       LEFT JOIN attendance_daily_record adr
              ON adr.employee_id = ar.employee_id AND adr.record_date = ar.session_date
      WHERE ar.session_date BETWEEN ? AND ?
        AND ar.status = 'approved'
        AND (
          adr.id IS NULL
          OR adr.regularization_id <> ar.id
          OR COALESCE(adr.is_locked, 0) <> 1
        )
      LIMIT 500`,
    [from, to],
  );

  return (rows as any[]).map((row) => ({
    id: `regularization:${row.regularization_id}`,
    issueDate: normalizeDate(row.issue_date),
    employeeId: row.employee_id ?? null,
    employeeCode: row.employee_code ?? null,
    employeeName: row.employee_name ?? null,
    branchName: row.branch_name ?? null,
    processName: row.process_name ?? null,
    issueType: "approved_regularization_not_locked_in_adr",
    severity: "blocker" as const,
    source: "regularization" as const,
    sourceMinutes: null,
    adrMinutes: Number(row.adr_minutes ?? 0),
    adrStatus: row.attendance_status ?? null,
    payrollImpact: "Approved correction is not safely locked into payroll ADR",
    actionNeeded: "Relink or recreate ADR from approved regularization before payroll freeze",
  }));
}

export const payrollAttendanceControlService = {
  roles: PAYROLL_ROLES,

  async getControlTower(params: ControlParams) {
    const runMonth = params.runMonth ?? new Date().toISOString().slice(0, 7);
    const defaultRange = monthRange(runMonth);
    const from = params.from ?? defaultRange.from;
    const to = params.to ?? defaultRange.to;
    const page = Math.max(1, Number(params.page ?? 1));
    const limit = Math.min(100, Math.max(10, Number(params.limit ?? 50)));

    const run = await latestRun(runMonth, params.runId);
    const [counts, apr, ncosec, regularization, salary] = await Promise.all([
      sourceCounts(from, to),
      aprGaps(from, to),
      ncosecGaps(from, to),
      regularizationGaps(from, to),
      run?.id ? salaryPrepGaps(String(run.id)) : Promise.resolve([]),
    ]);

    const allGaps = [...apr, ...ncosec, ...regularization, ...salary]
      .filter((gap) => matchesFilters(gap, params))
      .sort((a, b) => `${b.issueDate}:${b.severity}`.localeCompare(`${a.issueDate}:${a.severity}`));

    const summaryByType = allGaps.reduce<Record<string, number>>((acc, gap) => {
      acc[gap.issueType] = (acc[gap.issueType] ?? 0) + 1;
      return acc;
    }, {});
    const blockers = allGaps.filter((gap) => gap.severity === "blocker").length;
    const warnings = allGaps.filter((gap) => gap.severity === "warning").length;

    let readiness: unknown = null;
    if (run?.id) {
      try {
        readiness = await payrollGovernanceService.readiness(String(run.id));
      } catch (err: any) {
        readiness = { error: err?.message ?? String(err) };
      }
    }

    const start = (page - 1) * limit;
    return {
      runMonth,
      from,
      to,
      run: run ?? null,
      status: blockers > 0 ? "blocked" : warnings > 0 ? "warning" : "ready",
      summary: {
        totalGaps: allGaps.length,
        blockers,
        warnings,
        issueTypes: summaryByType,
        sourceCounts: counts,
      },
      readiness,
      gaps: allGaps.slice(start, start + limit),
      total: allGaps.length,
      page,
      limit,
    };
  },
};
