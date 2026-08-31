import { createHash } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { payrollGovernanceService } from "./payroll-governance.service.js";
import { inboxService } from "../inbox/inbox.service.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

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
  payrollSourceLabel?: string | null;
  aprMinutes?: number | null;
  aprStatus?: string | null;
  biometricMinutes?: number | null;
  biometricStatus?: string | null;
  payrollImpact: string;
  actionNeeded: string;
  reportingManagerId?: string | null;
  reportingManagerName?: string | null;
  reportingManagerUserId?: string | null;
  reviewStatus?: string | null;
  reviewNote?: string | null;
  resolvedThrough?: string | null;
  resolvedDetail?: string | null;
};

type ControlParams = {
  runMonth?: string;
  runId?: string;
  from?: string;
  to?: string;
  issueType?: string;
  reviewStatus?: string;
  search?: string;
  branchId?: string;
  processId?: string;
  page?: number;
  limit?: number;
};

const PAYROLL_ROLES = ["super_admin", "admin", "payroll_head", "payroll_branch", "payroll", "hr", "wfm", "branch_head"];
const REVIEW_PRIORITY: Record<string, number> = {
  open: 0,
  notified: 1,
  regularization_required: 2,
  reviewed: 3,
  no_issue: 4,
};
const ISSUE_PRIORITY: Record<string, number> = {
  dialler_penalty_biometric_supports_better: 0,
  biometric_penalty_dialler_supports_better: 0,
  approved_regularization_not_locked_in_adr: 1,
  salary_payable_days_mismatch: 1,
  dialler_missing_adr: 2,
  ncosec_missing_adr: 2,
  ncosec_minutes_not_in_adr: 3,
};

function sortControlGaps(a: AttendanceControlGap, b: AttendanceControlGap) {
  const aReview = REVIEW_PRIORITY[String(a.reviewStatus ?? "open")] ?? 99;
  const bReview = REVIEW_PRIORITY[String(b.reviewStatus ?? "open")] ?? 99;
  if (aReview !== bReview) return aReview - bReview;
  if (a.severity !== b.severity) return a.severity === "blocker" ? -1 : 1;
  const aIssue = ISSUE_PRIORITY[a.issueType] ?? 99;
  const bIssue = ISSUE_PRIORITY[b.issueType] ?? 99;
  if (aIssue !== bIssue) return aIssue - bIssue;
  return `${b.issueDate}:${b.issueType}:${b.employeeCode ?? ""}`.localeCompare(
    `${a.issueDate}:${a.issueType}:${a.employeeCode ?? ""}`,
  );
}

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

function statusRank(status: string | null | undefined) {
  if (status === "present" || status === "leave_approved" || status === "holiday" || status === "week_off") return 1;
  if (status === "half_day") return 0.5;
  return 0;
}

function classifyBiometricStatus(minutes: number) {
  if (minutes >= 540) return "present";
  if (minutes >= 270) return "half_day";
  return "absent";
}

let reviewTableEnsured = false;
async function ensureReviewTable() {
  if (reviewTableEnsured) return;
  await db.execute(
    `CREATE TABLE IF NOT EXISTS payroll_attendance_conflict_review (
      id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
      conflict_key    VARCHAR(255) NOT NULL,
      employee_id     CHAR(36)     NULL,
      issue_date      DATE         NOT NULL,
      issue_type      VARCHAR(100) NOT NULL,
      status          ENUM('open','notified','reviewed','no_issue','regularization_required') NOT NULL DEFAULT 'open',
      manager_user_id CHAR(36)     NULL,
      reviewed_by     CHAR(36)     NULL,
      reviewed_at     DATETIME     NULL,
      review_note     TEXT         NULL,
      created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_payroll_att_conflict (conflict_key),
      KEY idx_payroll_att_conflict_employee_date (employee_id, issue_date),
      KEY idx_payroll_att_conflict_status (status),
      KEY idx_payroll_att_conflict_manager (manager_user_id)
    )`,
  );
  reviewTableEnsured = true;
}

async function attachReviewState(gaps: AttendanceControlGap[]) {
  await ensureReviewTable();
  const keys = gaps.map((gap) => gap.id);
  if (keys.length === 0) return gaps;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT conflict_key, status, review_note, created_at
       FROM payroll_attendance_conflict_review
      WHERE conflict_key IN (${keys.map(() => "?").join(",")})`,
    keys,
  );
  const byKey = new Map((rows as RowDataPacket[]).map((row) => [String(row.conflict_key), row]));
  return gaps.map((gap) => {
    const review = byKey.get(gap.id);
    return {
      ...gap,
      reviewStatus: String(review?.status ?? "open"),
      reviewNote: review?.review_note ? String(review.review_note) : null,
      reviewCreatedAt: review?.created_at ? String(review.created_at) : null,
    };
  });
}

async function attachResolutionState(gaps: AttendanceControlGap[]) {
  const keys = gaps
    .filter((gap) => gap.employeeId && gap.issueDate)
    .map((gap) => [gap.employeeId as string, gap.issueDate]);
  if (keys.length === 0) return gaps;

  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT adr.employee_id,
            DATE_FORMAT(adr.record_date, '%Y-%m-%d') AS record_date,
            adr.attendance_status,
            adr.attendance_source,
            adr.source_system,
            adr.created_by,
            adr.regularization_id,
            adr.override_by
       FROM attendance_daily_record adr
      WHERE (${keys.map(() => "(adr.employee_id = ? AND adr.record_date = ?)").join(" OR ")})`,
    keys.flat(),
  );

  const byEmployeeDate = new Map<string, any>();
  for (const row of rows as any[]) {
    byEmployeeDate.set(`${row.employee_id}__${row.record_date}`, row);
  }

  return gaps.map((gap) => {
    if (!gap.employeeId || !gap.issueDate) return gap;
    const adr = byEmployeeDate.get(`${gap.employeeId}__${gap.issueDate}`);
    if (!adr) return gap;

    let resolvedThrough: string | null = null;
    let resolvedDetail: string | null = null;
    const attendanceStatus = String(adr.attendance_status ?? "");
    const sourceSystem = String(adr.source_system ?? "");
    const createdBy = String(adr.created_by ?? "");

    if (gap.issueType === "dialler_missing_adr" && sourceSystem === "apr.ReportDate" && createdBy === "payroll_attendance_control") {
      resolvedThrough = "APR repair";
      resolvedDetail = "ADR created from APR evidence";
    } else if (adr.regularization_id) {
      resolvedThrough = "Attendance regularization";
      resolvedDetail = `Locked through regularization (${attendanceStatus || "updated"})`;
    } else if (adr.override_by) {
      resolvedThrough = "Manual override";
      resolvedDetail = `Manually overridden to ${attendanceStatus || "updated"}`;
    } else if (attendanceStatus === "leave_approved") {
      resolvedThrough = "Leave approval";
      resolvedDetail = "Resolved through approved leave";
    } else if (sourceSystem === "apr.ReportDate") {
      resolvedThrough = "APR";
      resolvedDetail = `Payroll ADR now using APR as ${attendanceStatus || "updated"}`;
    } else if (sourceSystem.toLowerCase().includes("regularization")) {
      resolvedThrough = "Attendance regularization";
      resolvedDetail = `Resolved through ${sourceSystem}`;
    } else if (sourceSystem.toLowerCase().includes("manual")) {
      resolvedThrough = "Manual override";
      resolvedDetail = `Resolved through ${sourceSystem}`;
    } else if (
      sourceSystem.toLowerCase().includes("cosec")
      || sourceSystem.toLowerCase().includes("biometric")
      || String(adr.attendance_source ?? "").toLowerCase() === "biometric"
    ) {
      resolvedThrough = "COSEC biometric";
      resolvedDetail = `Payroll ADR now using biometric as ${attendanceStatus || "updated"}`;
    }

    return {
      ...gap,
      resolvedThrough,
      resolvedDetail,
    };
  });
}

async function upsertReview(gap: AttendanceControlGap, status: string, actorUserId: string | null, note?: string | null) {
  await ensureReviewTable();
  await db.execute(
    `INSERT INTO payroll_attendance_conflict_review
       (id, conflict_key, employee_id, issue_date, issue_type, status, manager_user_id, reviewed_by, reviewed_at, review_note)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
     ON DUPLICATE KEY UPDATE
       employee_id = VALUES(employee_id),
       issue_date = VALUES(issue_date),
       issue_type = VALUES(issue_type),
       status = VALUES(status),
       manager_user_id = VALUES(manager_user_id),
       reviewed_by = VALUES(reviewed_by),
       reviewed_at = NOW(),
       review_note = VALUES(review_note)`,
    [
      gap.id,
      gap.employeeId,
      gap.issueDate,
      gap.issueType,
      status,
      gap.reportingManagerUserId ?? null,
      actorUserId,
      note ?? null,
    ],
  );
}

function parseAprGapKey(key: string) {
  const parts = String(key).split(":");
  if (parts.length !== 3 || parts[0] !== "apr") return null;
  return { employeeId: parts[1], issueDate: parts[2] };
}

function parseNcosecGapKey(key: string) {
  const parts = String(key).split(":");
  if (parts.length !== 3 || parts[0] !== "ncosec") return null;
  return { employeeId: parts[1], issueDate: parts[2] };
}

function compactEntityId(value: string) {
  return createHash("sha1").update(value).digest("hex").slice(0, 36);
}

function normalizeDate(value: unknown) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

// Split out from matchesFilters so the issue-type dropdown can be built from the
// set that ignores the issue-type filter. Applying it before computing
// summary.issueTypes collapsed the dropdown to the single selected value, which
// left no way back to another type without clearing the filter first.
function matchesIssueType(gap: AttendanceControlGap, params: ControlParams) {
  return !params.issueType || params.issueType === "all" || gap.issueType === params.issueType;
}

function matchesSearch(gap: AttendanceControlGap, params: ControlParams) {
  const q = params.search?.trim().toLowerCase();
  if (!q) return true;
  return [gap.employeeCode, gap.employeeName, gap.branchName, gap.processName, gap.issueType]
    .some((part) => String(part ?? "").toLowerCase().includes(q));
}

function matchesFilters(gap: AttendanceControlGap, params: ControlParams) {
  return matchesIssueType(gap, params) && matchesSearch(gap, params);
}

// Each per-source query is capped so one runaway month cannot pull the whole
// table into memory. The cap used to be 500 with no signal when it bit: in
// 2026-08 aprGaps was already at 492, so the next day of dialler data would have
// silently dropped rows while summary.totalGaps still read as complete. Fetching
// CAP + 1 lets the caller detect the cliff and say so.
const SOURCE_ROW_CAP = 5000;

function capReached(rows: unknown[]) {
  return rows.length > SOURCE_ROW_CAP;
}

/**
 * `dateExpr` must be a SQL expression for the day the gap falls on, written by
 * this module — never anything derived from a request. When given, employees who
 * had already left by that day are excluded, and so are inactive employees with
 * no leaving date recorded at all.
 *
 * That second group is the reason this exists. In 2026-08, 445 of the 492
 * dialler gaps belonged to inactive employees with a NULL date_of_leaving —
 * 90% of the page's headline number. They are a data-quality contradiction (the
 * APR feed still carries an agent code for someone marked inactive), not
 * attendance to repair, and `repairMissingAdr` would have written ADR rows for
 * people who are not on payroll.
 *
 * Leavers are matched on date rather than dropped wholesale, so someone who left
 * mid-month keeps the days they actually worked — those still have to reconcile
 * for their final settlement.
 */
function employeeScope(alias = "e", params: ControlParams, dateExpr?: string) {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (dateExpr) {
    clauses.push(`(
      ${alias}.active_status = 1
      OR (${alias}.date_of_leaving IS NOT NULL AND ${alias}.date_of_leaving >= ${dateExpr})
    )`);
  }
  if (params.branchId) {
    clauses.push(`${alias}.branch_id = ?`);
    values.push(params.branchId);
  }
  if (params.processId) {
    clauses.push(`${alias}.process_id = ?`);
    values.push(params.processId);
  }
  const q = params.search?.trim();
  if (q) {
    clauses.push(`(
      ${alias}.employee_code LIKE ?
      OR COALESCE(NULLIF(${alias}.full_name,''), CONCAT_WS(' ', ${alias}.first_name, ${alias}.last_name)) LIKE ?
    )`);
    values.push(`%${q}%`, `%${q}%`);
  }
  return {
    sql: clauses.length ? ` AND ${clauses.join(" AND ")}` : "",
    values,
  };
}

async function latestRun(runMonth: string, runId?: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, run_month, status, total_employees, total_gross, total_deductions, total_net, attendance_snapshot_locked
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

async function aprGaps(from: string, to: string, params: ControlParams): Promise<AttendanceControlGap[]> {
  const scope = employeeScope("e", params, "a.ReportDate");
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
        ${scope.sql}
      GROUP BY e.id, e.employee_code, employee_name, bm.branch_name, pm.process_name,
               a.ReportDate, adr.id, adr.attendance_status, adr.raw_minutes,
               adr.dialler_minutes, adr.biometric_minutes, adr.is_locked, adr.regularization_id
      HAVING adr_id IS NULL
      LIMIT ${SOURCE_ROW_CAP + 1}`,
    [from, to, ...scope.values],
  );

  return (rows as any[]).map((row) => {
    const sourceMinutes = Number(row.apr_minutes ?? 0);
    return {
      id: `apr:${row.employee_id}:${normalizeDate(row.issue_date)}`,
      issueDate: normalizeDate(row.issue_date),
      employeeId: row.employee_id ?? null,
      employeeCode: row.employee_code ?? null,
      employeeName: row.employee_name ?? null,
      branchName: row.branch_name ?? null,
      processName: row.process_name ?? null,
      issueType: "dialler_missing_adr",
      severity: "blocker" as const,
      source: "apr" as const,
      sourceMinutes,
      adrMinutes: Number(row.adr_minutes ?? 0),
      adrStatus: row.attendance_status ?? null,
      payrollSourceLabel: "ADR pending",
      aprMinutes: sourceMinutes,
      aprStatus: classifyAprStatus(sourceMinutes),
      biometricMinutes: null,
      biometricStatus: null,
      payrollImpact: "Dialler evidence exists, but payroll ADR has no day record",
      actionNeeded: "Create ADR through attendance policy or approved regularization; do not rewrite APR source",
    };
  });
}

async function crossEvidencePenaltyConflicts(from: string, to: string, params: ControlParams): Promise<AttendanceControlGap[]> {
  const scope = employeeScope("e", params, "adr.record_date");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT adr.employee_id,
            e.employee_code,
            COALESCE(NULLIF(e.full_name,''), CONCAT_WS(' ', e.first_name, e.last_name)) AS employee_name,
            e.reporting_manager_id,
            COALESCE(NULLIF(mgr.full_name,''), CONCAT_WS(' ', mgr.first_name, mgr.last_name)) AS reporting_manager_name,
            mgr.user_id AS reporting_manager_user_id,
            bm.branch_name,
            pm.process_name,
            adr.record_date AS issue_date,
            adr.attendance_source,
            adr.source_system,
            adr.attendance_status,
            COALESCE(adr.raw_minutes, adr.dialler_minutes, adr.biometric_minutes, 0) AS adr_minutes,
            COALESCE(adr.regularization_id, '') AS regularization_id,
            COALESCE(adr.is_locked, 0) AS is_locked,
            COALESCE(apr.apr_minutes, 0) AS apr_minutes,
            COALESCE(ibd.biometric_minutes, 0) AS biometric_minutes
       FROM attendance_daily_record adr
       JOIN employees e ON e.id = adr.employee_id
       LEFT JOIN employees mgr ON mgr.id = e.reporting_manager_id
       LEFT JOIN branch_master bm ON bm.id = e.branch_id
       LEFT JOIN process_master pm ON pm.id = e.process_id
       LEFT JOIN (
         SELECT UserID, ReportDate, ROUND(COALESCE(SUM(TIME_TO_SEC(Net_Login)), 0) / 60) AS apr_minutes
           FROM apr
          WHERE ReportDate BETWEEN ? AND ?
          GROUP BY UserID, ReportDate
       ) apr ON apr.UserID = e.employee_code AND apr.ReportDate = adr.record_date
       LEFT JOIN integration_biometric_daily ibd
              ON ibd.employee_code = e.employee_code AND ibd.activity_date = adr.record_date
      WHERE adr.record_date BETWEEN ? AND ?
        AND adr.regularization_id IS NULL
        ${scope.sql}
        AND (
          COALESCE(apr.apr_minutes, 0) > 0
          OR COALESCE(ibd.biometric_minutes, 0) > 0
        )
      LIMIT ${SOURCE_ROW_CAP + 1}`,
    [from, to, from, to, ...scope.values],
  );

  const gaps: AttendanceControlGap[] = [];
  for (const row of rows as any[]) {
    const adrStatus = String(row.attendance_status ?? "");
    const payrollRank = statusRank(adrStatus);
    const aprMinutes = Number(row.apr_minutes ?? 0);
    const biometricMinutes = Number(row.biometric_minutes ?? 0);
    const aprStatus = classifyAprStatus(aprMinutes);
    const biometricStatus = classifyBiometricStatus(biometricMinutes);
    const aprRank = aprMinutes > 0 ? statusRank(aprStatus) : -1;
    const biometricRank = biometricMinutes > 0 ? statusRank(biometricStatus) : -1;
    const sourceSystem = String(row.source_system ?? "").toLowerCase();
    const attendanceSource = String(row.attendance_source ?? "").toLowerCase();
    const payrollUsesDialler = attendanceSource === "dialler" || sourceSystem.includes("apr");
    const payrollUsesBiometric = attendanceSource === "biometric" || sourceSystem.includes("cosec") || sourceSystem.includes("biometric");

    if (payrollUsesDialler && biometricRank > payrollRank) {
      gaps.push({
        id: `conflict:dialler-penalty:${row.employee_id}:${normalizeDate(row.issue_date)}`,
        issueDate: normalizeDate(row.issue_date),
        employeeId: row.employee_id ?? null,
        employeeCode: row.employee_code ?? null,
        employeeName: row.employee_name ?? null,
        branchName: row.branch_name ?? null,
        processName: row.process_name ?? null,
        issueType: "dialler_penalty_biometric_supports_better",
        severity: "blocker",
        source: "adr",
        sourceMinutes: aprMinutes,
        adrMinutes: Number(row.adr_minutes ?? 0),
        adrStatus,
        payrollSourceLabel: "Payroll using APR dialler",
        aprMinutes,
        aprStatus,
        biometricMinutes,
        biometricStatus,
        payrollImpact: `Payroll uses APR/dialler result as ${adrStatus}; COSEC biometric evidence supports ${biometricStatus}`,
        actionNeeded: "Send to reporting manager for review/regularization decision; keep APR and COSEC source data unchanged",
        reportingManagerId: row.reporting_manager_id ?? null,
        reportingManagerName: row.reporting_manager_name ?? null,
        reportingManagerUserId: row.reporting_manager_user_id ?? null,
      });
    }

    if (payrollUsesBiometric && aprRank > payrollRank) {
      gaps.push({
        id: `conflict:biometric-penalty:${row.employee_id}:${normalizeDate(row.issue_date)}`,
        issueDate: normalizeDate(row.issue_date),
        employeeId: row.employee_id ?? null,
        employeeCode: row.employee_code ?? null,
        employeeName: row.employee_name ?? null,
        branchName: row.branch_name ?? null,
        processName: row.process_name ?? null,
        issueType: "biometric_penalty_dialler_supports_better",
        severity: "blocker",
        source: "adr",
        sourceMinutes: biometricMinutes,
        adrMinutes: Number(row.adr_minutes ?? 0),
        adrStatus,
        payrollSourceLabel: "Payroll using COSEC biometric",
        aprMinutes,
        aprStatus,
        biometricMinutes,
        biometricStatus,
        payrollImpact: `Payroll uses COSEC/biometric result as ${adrStatus}; APR dialler evidence supports ${aprStatus}`,
        actionNeeded: "Send to reporting manager for review/regularization decision; keep APR and COSEC source data unchanged",
        reportingManagerId: row.reporting_manager_id ?? null,
        reportingManagerName: row.reporting_manager_name ?? null,
        reportingManagerUserId: row.reporting_manager_user_id ?? null,
      });
    }
  }
  return gaps;
}

async function ncosecGaps(from: string, to: string, params: ControlParams): Promise<AttendanceControlGap[]> {
  const scope = employeeScope("e", params, "ibd.activity_date");
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
        ${scope.sql}
        AND (
          adr.id IS NULL
          OR (
            COALESCE(adr.is_locked, 0) = 0
            AND adr.regularization_id IS NULL
            AND (
              COALESCE(adr.biometric_minutes, adr.raw_minutes, 0) = 0
              OR adr.attendance_status IN ('missing_punch','unreconciled')
            )
          )
        )
      LIMIT ${SOURCE_ROW_CAP + 1}`,
    [from, to, ...scope.values],
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
      payrollSourceLabel: missingAdr ? "ADR missing" : "Payroll using COSEC biometric",
      aprMinutes: null,
      aprStatus: null,
      biometricMinutes: Number(row.biometric_minutes ?? 0),
      biometricStatus: classifyBiometricStatus(Number(row.biometric_minutes ?? 0)),
      payrollImpact: missingAdr ? "Biometric evidence exists, but payroll ADR has no day record" : "Biometric evidence is not reflected in payroll ADR",
      actionNeeded: "Review biometric evidence through attendance policy or regularization; do not rewrite COSEC source data",
    };
  });
}

async function salaryPrepGaps(runId: string, params: ControlParams): Promise<AttendanceControlGap[]> {
  const scope = employeeScope("e", params);
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
        ${scope.sql}
        AND ABS(COALESCE(spl.final_payable_days, 0) - LEAST(
          COALESCE(spl.paid_working_days, 0)
          + COALESCE(spl.eligible_weekoff_days, 0)
          + COALESCE(spl.eligible_holiday_days, 0),
          DAY(LAST_DAY(CONCAT(spr.run_month, '-01')))
        )) > 0.01
      LIMIT ${SOURCE_ROW_CAP + 1}`,
    [runId, ...scope.values],
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
    payrollSourceLabel: "Salary prep line",
    aprMinutes: null,
    aprStatus: null,
    biometricMinutes: null,
    biometricStatus: null,
    payrollImpact: `Salary line has ${row.final_payable_days} payable days; components total ${Number(row.paid_working_days ?? 0) + Number(row.eligible_weekoff_days ?? 0) + Number(row.eligible_holiday_days ?? 0)}`,
    actionNeeded: "Recalculate affected payroll line before validation",
  }));
}

async function regularizationGaps(from: string, to: string, params: ControlParams): Promise<AttendanceControlGap[]> {
  const scope = employeeScope("e", params, "ar.session_date");
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
        ${scope.sql}
        AND (
          adr.id IS NULL
          OR adr.regularization_id <> ar.id
          OR COALESCE(adr.is_locked, 0) <> 1
        )
      LIMIT ${SOURCE_ROW_CAP + 1}`,
    [from, to, ...scope.values],
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
    payrollSourceLabel: "Approved regularization",
    aprMinutes: null,
    aprStatus: null,
    biometricMinutes: null,
    biometricStatus: null,
    payrollImpact: "Approved correction is not safely locked into payroll ADR",
    actionNeeded: "Relink or recreate ADR from approved regularization before payroll freeze",
  }));
}

async function repairMissingAdrFromApr(conflictKeys: string[], actorUserId: string | null) {
  let repaired = 0;
  let skipped = 0;
  for (const key of conflictKeys) {
    const parsed = parseAprGapKey(key);
    if (!parsed) {
      skipped += 1;
      continue;
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.id AS employee_id,
              e.employee_code,
              e.branch_id,
              e.process_id,
              DATE_FORMAT(a.ReportDate, '%Y-%m-%d') AS record_date,
              ROUND(COALESCE(SUM(TIME_TO_SEC(a.Net_Login)), 0) / 60) AS apr_minutes,
              adr.id AS adr_id,
              adr.is_locked,
              adr.override_by,
              adr.regularization_id
         FROM employees e
         JOIN apr a
           ON a.UserID = e.employee_code
         LEFT JOIN attendance_daily_record adr
           ON adr.employee_id = e.id
          AND adr.record_date = a.ReportDate
        WHERE e.id = ?
          AND a.ReportDate = ?
        GROUP BY e.id, e.employee_code, e.branch_id, e.process_id, a.ReportDate,
                 adr.id, adr.is_locked, adr.override_by, adr.regularization_id
        LIMIT 1`,
      [parsed.employeeId, parsed.issueDate],
    );
    const row = (rows as any[])[0];
    if (!row) {
      skipped += 1;
      continue;
    }

    const protectedAdr = Boolean(row.adr_id) && (
      Number(row.is_locked ?? 0) === 1 ||
      Boolean(row.override_by) ||
      Boolean(row.regularization_id)
    );
    if (protectedAdr) {
      skipped += 1;
      continue;
    }

    const aprMinutes = Math.max(0, Math.round(Number(row.apr_minutes ?? 0)));
    const classification = classifyAprStatus(aprMinutes);
    const lwpValue = classification === "present" ? 0 : classification === "half_day" ? 0.5 : 1;

    await db.execute(
      `INSERT INTO attendance_daily_record
         (id, employee_id, record_date, branch_id, process_id, attendance_source, source_system,
          source_record_date, source_reference, dialler_minutes, raw_minutes, attendance_status,
          lwp_value, late_mark, late_by_minutes, processed_at, created_by)
       VALUES (UUID(), ?, ?, ?, ?, 'dialler', 'apr.ReportDate',
               ?, ?, ?, ?, ?, ?, 0, 0, NOW(), 'payroll_attendance_control')
       ON DUPLICATE KEY UPDATE
         attendance_source  = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, 'dialler', attendance_source),
         source_system      = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, 'apr.ReportDate', source_system),
         source_record_date = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, VALUES(source_record_date), source_record_date),
         source_reference   = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, VALUES(source_reference), source_reference),
         dialler_minutes    = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, VALUES(dialler_minutes), dialler_minutes),
         raw_minutes        = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, VALUES(raw_minutes), raw_minutes),
         attendance_status  = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, VALUES(attendance_status), attendance_status),
         lwp_value          = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, VALUES(lwp_value), lwp_value),
         processed_at       = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, NOW(), processed_at),
         created_by         = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, 'payroll_attendance_control', created_by)`,
      [
        row.employee_id,
        row.record_date,
        row.branch_id ?? null,
        row.process_id ?? null,
        row.record_date,
        row.employee_code,
        aprMinutes,
        aprMinutes,
        classification,
        lwpValue,
      ],
    );

    const gap: AttendanceControlGap = {
      id: key,
      issueDate: row.record_date,
      employeeId: row.employee_id,
      employeeCode: row.employee_code,
      employeeName: null,
      branchName: null,
      processName: null,
      issueType: "dialler_missing_adr",
      severity: "blocker",
      source: "apr",
      sourceMinutes: aprMinutes,
      adrMinutes: aprMinutes,
      adrStatus: classification,
      payrollSourceLabel: "Payroll using APR dialler",
      aprMinutes,
      aprStatus: classification,
      biometricMinutes: null,
      biometricStatus: null,
      payrollImpact: "APR evidence repaired into payroll ADR",
      actionNeeded: "Review repaired payroll day if any exception exists",
    };
    await upsertReview(gap, "reviewed", actorUserId, "ADR repaired from APR evidence");
    repaired += 1;
  }

  return { requested: conflictKeys.length, repaired, skipped };
}

async function repairMissingAdrFromNcosec(conflictKeys: string[], actorUserId: string | null) {
  let repaired = 0;
  let skipped = 0;
  for (const key of conflictKeys) {
    const parsed = parseNcosecGapKey(key);
    if (!parsed) {
      skipped += 1;
      continue;
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.id AS employee_id,
              e.employee_code,
              e.branch_id,
              e.process_id,
              DATE_FORMAT(ibd.activity_date, '%Y-%m-%d') AS record_date,
              COALESCE(ibd.biometric_minutes, 0) AS biometric_minutes,
              adr.id AS adr_id,
              adr.is_locked,
              adr.override_by,
              adr.regularization_id
         FROM employees e
         JOIN integration_biometric_daily ibd
           ON ibd.employee_code = e.employee_code
         LEFT JOIN attendance_daily_record adr
           ON adr.employee_id = e.id
          AND adr.record_date = ibd.activity_date
        WHERE e.id = ?
          AND ibd.activity_date = ?
        LIMIT 1`,
      [parsed.employeeId, parsed.issueDate],
    );
    const row = (rows as any[])[0];
    if (!row) {
      skipped += 1;
      continue;
    }

    const protectedAdr = Boolean(row.adr_id) && (
      Number(row.is_locked ?? 0) === 1 ||
      Boolean(row.override_by) ||
      Boolean(row.regularization_id)
    );
    if (protectedAdr) {
      skipped += 1;
      continue;
    }

    const biometricMinutes = Math.max(0, Math.round(Number(row.biometric_minutes ?? 0)));
    if (biometricMinutes <= 0) {
      skipped += 1;
      continue;
    }
    const classification = classifyBiometricStatus(biometricMinutes);
    const lwpValue = classification === "present" ? 0 : classification === "half_day" ? 0.5 : 1;

    await db.execute(
      `INSERT INTO attendance_daily_record
         (id, employee_id, record_date, branch_id, process_id, attendance_source, source_system,
          source_record_date, source_reference, biometric_minutes, raw_minutes, attendance_status,
          lwp_value, late_mark, late_by_minutes, processed_at, created_by)
       VALUES (UUID(), ?, ?, ?, ?, 'biometric', 'cosec_sqlserver',
               ?, ?, ?, ?, ?, ?, 0, 0, NOW(), 'payroll_attendance_control')
       ON DUPLICATE KEY UPDATE
         attendance_source  = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, 'biometric', attendance_source),
         source_system      = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, 'cosec_sqlserver', source_system),
         source_record_date = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, VALUES(source_record_date), source_record_date),
         source_reference   = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, VALUES(source_reference), source_reference),
         biometric_minutes  = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, VALUES(biometric_minutes), biometric_minutes),
         raw_minutes        = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, VALUES(raw_minutes), raw_minutes),
         attendance_status  = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, VALUES(attendance_status), attendance_status),
         lwp_value          = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, VALUES(lwp_value), lwp_value),
         processed_at       = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, NOW(), processed_at),
         created_by         = IF(is_locked = 0 AND override_by IS NULL AND regularization_id IS NULL, 'payroll_attendance_control', created_by)`,
      [
        row.employee_id,
        row.record_date,
        row.branch_id ?? null,
        row.process_id ?? null,
        row.record_date,
        row.employee_code,
        biometricMinutes,
        biometricMinutes,
        classification,
        lwpValue,
      ],
    );

    const gap: AttendanceControlGap = {
      id: key,
      issueDate: row.record_date,
      employeeId: row.employee_id,
      employeeCode: row.employee_code,
      employeeName: null,
      branchName: null,
      processName: null,
      issueType: "ncosec_missing_adr",
      severity: "blocker",
      source: "ncosec",
      sourceMinutes: biometricMinutes,
      adrMinutes: biometricMinutes,
      adrStatus: classification,
      payrollSourceLabel: "Payroll using COSEC biometric",
      aprMinutes: null,
      aprStatus: null,
      biometricMinutes,
      biometricStatus: classification,
      payrollImpact: "COSEC biometric evidence repaired into payroll ADR",
      actionNeeded: "Review repaired payroll day if any exception exists",
    };
    await upsertReview(gap, "reviewed", actorUserId, "ADR repaired from COSEC biometric evidence");
    repaired += 1;
  }

  return { requested: conflictKeys.length, repaired, skipped };
}

export const payrollAttendanceControlService = {
  roles: PAYROLL_ROLES,

  /**
   * Full detail behind one gap row, for the drill-down drawer.
   *
   * A gap is not a stored record — it is an employee-day derived from several
   * feeds — so this re-reads every source for that one day rather than trusting
   * anything the list already returned. That is the point of the drawer: it
   * answers "why is this a gap" from the underlying evidence.
   *
   * Gap keys come in six shapes (see the `id:` assignments above); all of them
   * resolve to an employee plus a date, except the regularization one, which
   * carries only its own row id and has to be looked up.
   */
  async getGapDetail(key: string) {
    const parts = String(key).split(":");
    let employeeId: string | null = null;
    let issueDate: string | null = null;

    if (parts[0] === "regularization" && parts[1]) {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT employee_id, DATE_FORMAT(session_date, '%Y-%m-%d') AS session_date
           FROM attendance_regularization WHERE id = ? LIMIT 1`,
        [parts[1]],
      );
      const row = (rows as any[])[0];
      if (row) {
        employeeId = String(row.employee_id);
        issueDate = String(row.session_date);
      }
    } else if (parts[0] === "conflict") {
      // conflict:<variant>:<employeeId>:<date>
      employeeId = parts[2] ?? null;
      issueDate = parts[3] ?? null;
    } else {
      // apr:/ncosec:/salary:<employeeId>:<date-or-run-month>
      employeeId = parts[1] ?? null;
      issueDate = parts[2] ?? null;
    }

    if (!employeeId || !issueDate) {
      return null;
    }
    // salary: keys carry a run month (YYYY-MM); widen it to that month so the
    // day-scoped reads below still return the month's evidence.
    const isMonthKey = /^\d{4}-\d{2}$/.test(issueDate);
    const from = isMonthKey ? monthRange(issueDate).from : issueDate;
    const to = isMonthKey ? monthRange(issueDate).to : issueDate;

    const [
      [employeeRows], [adrRows], [ibdRows], [punchRows],
      [aprRows], [regRows], [leaveRows], [rosterRows], [reviewRows], [auditRows],
    ] = await Promise.all([
      db.execute<RowDataPacket[]>(
        `SELECT e.id, e.employee_code, e.biometric_code,
                COALESCE(NULLIF(e.full_name,''), CONCAT_WS(' ', e.first_name, e.last_name)) AS employee_name,
                e.active_status, DATE_FORMAT(e.date_of_joining,'%Y-%m-%d') AS date_of_joining,
                DATE_FORMAT(e.date_of_leaving,'%Y-%m-%d') AS date_of_leaving,
                bm.branch_name, pm.process_name, dm.dept_name, dg.designation_name
           FROM employees e
           LEFT JOIN branch_master bm ON bm.id = e.branch_id
           LEFT JOIN process_master pm ON pm.id = e.process_id
           LEFT JOIN department_master dm ON dm.id = e.department_id
           LEFT JOIN designation_master dg ON dg.id = e.designation_id
          WHERE e.id = ? LIMIT 1`,
        [employeeId],
      ),
      db.execute<RowDataPacket[]>(
        `SELECT DATE_FORMAT(record_date,'%Y-%m-%d') AS record_date, attendance_status, lwp_value,
                raw_minutes, biometric_minutes, dialler_minutes, biometric_status, apr_status,
                attendance_source, source_system, source_reference, mismatch_flag, is_locked,
                regularization_id, override_by, override_reason, late_mark, late_by_minutes,
                created_by, created_at, updated_at
           FROM attendance_daily_record
          WHERE employee_id = ? AND record_date BETWEEN ? AND ?
          ORDER BY record_date`,
        [employeeId, from, to],
      ),
      db.execute<RowDataPacket[]>(
        `SELECT ibd.integration_key, ibd.source_table, DATE_FORMAT(ibd.activity_date,'%Y-%m-%d') AS activity_date,
                ibd.first_punch, ibd.last_punch, ibd.total_punches, ibd.biometric_minutes
           FROM integration_biometric_daily ibd
           JOIN employees e ON e.id = ?
            AND (ibd.employee_code = e.employee_code OR ibd.employee_code = e.biometric_code)
          WHERE ibd.activity_date BETWEEN ? AND ?
          ORDER BY ibd.activity_date`,
        [employeeId, from, to],
      ),
      db.execute<RowDataPacket[]>(
        `SELECT DATE_FORMAT(punch_date,'%Y-%m-%d') AS punch_date, first_punch_in, last_punch_out,
                total_punches, raw_minutes, source_system, cosec_user_id
           FROM biometric_attendance_log
          WHERE employee_id = ? AND punch_date BETWEEN ? AND ?
          ORDER BY punch_date`,
        [employeeId, from, to],
      ),
      db.execute<RowDataPacket[]>(
        `SELECT DATE_FORMAT(a.ReportDate,'%Y-%m-%d') AS report_date, a.campaign_id, a.Calls,
                a.Net_Login, a.Login_Time, a.Logout_Time, a.process_name, a.source
           FROM apr a JOIN employees e ON e.employee_code = a.UserID
          WHERE e.id = ? AND a.ReportDate BETWEEN ? AND ?
          ORDER BY a.ReportDate`,
        [employeeId, from, to],
      ),
      db.execute<RowDataPacket[]>(
        `SELECT id, DATE_FORMAT(session_date,'%Y-%m-%d') AS session_date, requested_status, status,
                reason, reason_code, reviewed_by, reviewed_at, reviewer_note, payroll_impact, created_at
           FROM attendance_regularization
          WHERE employee_id = ? AND session_date BETWEEN ? AND ?
          ORDER BY created_at DESC`,
        [employeeId, from, to],
      ),
      db.execute<RowDataPacket[]>(
        `SELECT lr.id, lr.leave_type_code, lr.status,
                DATE_FORMAT(lr.from_date,'%Y-%m-%d') AS from_date,
                DATE_FORMAT(lr.to_date,'%Y-%m-%d') AS to_date,
                lr.total_days, lr.reason, lr.approved_by, lr.approved_at
           FROM leave_request lr
          WHERE lr.employee_id = ? AND lr.to_date >= ? AND lr.from_date <= ?
          ORDER BY lr.from_date DESC`,
        [employeeId, from, to],
      ),
      db.execute<RowDataPacket[]>(
        `SELECT DATE_FORMAT(roster_date,'%Y-%m-%d') AS roster_date, is_week_off, shift_start_time,
                shift_end_time, roster_status, publish_status, scheduled_minutes
           FROM wfm_roster_assignment
          WHERE employee_id = ? AND roster_date BETWEEN ? AND ?
          ORDER BY roster_date`,
        [employeeId, from, to],
      ),
      db.execute<RowDataPacket[]>(
        `SELECT conflict_key, issue_type, status, review_note, reviewed_by, reviewed_at, created_at, updated_at
           FROM payroll_attendance_conflict_review
          WHERE employee_id = ? AND issue_date BETWEEN ? AND ?
          ORDER BY updated_at DESC`,
        [employeeId, from, to],
      ),
      db.execute<RowDataPacket[]>(
        `SELECT action_type, module_key, entity_type, entity_id, actor_user_id, metadata_json, created_at
           FROM audit_log
          WHERE module_key = 'payroll' AND entity_type = 'attendance_daily_record'
            AND entity_id LIKE ?
          ORDER BY created_at DESC LIMIT 20`,
        [`%${employeeId}%`],
      ),
    ]);

    return {
      key,
      employeeId,
      issueDate,
      window: { from, to },
      employee: (employeeRows as any[])[0] ?? null,
      attendanceRecords: adrRows,
      biometricDaily: ibdRows,
      biometricPunches: punchRows,
      aprRecords: aprRows,
      regularizations: regRows,
      leaveRequests: leaveRows,
      rosterAssignments: rosterRows,
      reviewHistory: reviewRows,
      auditTrail: auditRows,
    };
  },

  async getControlTower(params: ControlParams) {
    const runMonth = params.runMonth ?? new Date().toISOString().slice(0, 7);
    const defaultRange = monthRange(runMonth);
    const from = params.from ?? defaultRange.from;
    const to = params.to ?? defaultRange.to;
    const page = Math.max(1, Number(params.page ?? 1));
    const limit = Math.min(100, Math.max(10, Number(params.limit ?? 50)));

    const run = await latestRun(runMonth, params.runId);
    const [counts, apr, ncosec, crossConflicts, regularization, salary] = await Promise.all([
      sourceCounts(from, to),
      aprGaps(from, to, params),
      ncosecGaps(from, to, params),
      crossEvidencePenaltyConflicts(from, to, params),
      regularizationGaps(from, to, params),
      run?.id ? salaryPrepGaps(String(run.id), params) : Promise.resolve([]),
    ]);

    // Each source query fetched SOURCE_ROW_CAP + 1 rows; more than the cap means
    // it hit the ceiling and the counts below understate reality. Report which
    // sources were clipped rather than presenting a short total as complete.
    const truncatedSources = (
      [
        ["apr", apr],
        ["ncosec", ncosec],
        ["cross_evidence", crossConflicts],
        ["regularization", regularization],
        ["salary_prep", salary],
      ] as const
    )
      .filter(([, rows]) => capReached(rows))
      .map(([name]) => name);

    const allSources = [...crossConflicts, ...apr, ...ncosec, ...regularization, ...salary];

    // Everything except the issue-type filter. The dropdown is built from this so
    // it keeps listing every type that is present under the current branch,
    // process, search and review filters — picking one type no longer hides the rest.
    const searchScoped = allSources.filter((gap) => matchesSearch(gap, params));

    const allGapsBeforeReview = searchScoped.filter((gap) => matchesIssueType(gap, params));
    const reviewedGaps = await attachReviewState(allGapsBeforeReview);
    const visibleFilter = (gap: AttendanceControlGap) => {
      const status = String(gap.reviewStatus ?? "open");
      if (params.reviewStatus && params.reviewStatus !== "all") {
        return status === params.reviewStatus;
      }
      return !["reviewed", "no_issue"].includes(status);
    };
    const visibleGaps = reviewedGaps.filter(visibleFilter).sort(sortControlGaps);

    const summaryByType = visibleGaps.reduce<Record<string, number>>((acc, gap) => {
      acc[gap.issueType] = (acc[gap.issueType] ?? 0) + 1;
      return acc;
    }, {});

    // Review state is only attached to the issue-type-filtered set, so the option
    // list is derived from the search-scoped set instead. It is the union of the
    // types actually present plus whatever is currently selected, so the active
    // choice never vanishes from its own dropdown.
    const availableIssueTypes = Array.from(
      new Set([
        ...searchScoped.map((gap) => gap.issueType),
        ...(params.issueType && params.issueType !== "all" ? [params.issueType] : []),
      ]),
    ).sort();
    const blockers = visibleGaps.filter((gap) => gap.severity === "blocker").length;
    const warnings = visibleGaps.filter((gap) => gap.severity === "warning").length;

    let readiness: unknown = null;
    if (run?.id) {
      try {
        readiness = await payrollGovernanceService.readiness(String(run.id));
      } catch (err: any) {
        readiness = { error: err?.message ?? String(err) };
      }
    }

    const start = (page - 1) * limit;
    const pageGaps = await attachResolutionState(visibleGaps.slice(start, start + limit));
    return {
      runMonth,
      from,
      to,
      run: run
        ? {
            ...run,
            attendance_snapshot_locked: Number(run.attendance_snapshot_locked ?? 0),
          }
        : null,
      status: blockers > 0 ? "blocked" : warnings > 0 ? "warning" : "ready",
      summary: {
        totalGaps: visibleGaps.length,
        blockers,
        warnings,
        issueTypes: summaryByType,
        availableIssueTypes,
        sourceCounts: counts,
        truncatedSources,
        sourceRowCap: SOURCE_ROW_CAP,
      },
      readiness,
      gaps: pageGaps,
      total: visibleGaps.length,
      page,
      limit,
    };
  },

  async notifyReportingManagers(params: ControlParams & { conflictKeys?: string[]; actorUserId?: string | null }) {
    const runMonth = params.runMonth ?? new Date().toISOString().slice(0, 7);
    const defaultRange = monthRange(runMonth);
    const from = params.from ?? defaultRange.from;
    const to = params.to ?? defaultRange.to;
    const conflicts = (await crossEvidencePenaltyConflicts(from, to, params))
      .filter((gap) => matchesFilters(gap, params))
      .filter((gap) => !params.conflictKeys?.length || params.conflictKeys.includes(gap.id));

    let notified = 0;
    let skippedNoManager = 0;
    for (const gap of conflicts) {
      if (!gap.reportingManagerUserId) {
        skippedNoManager += 1;
        continue;
      }
      await inboxService.createItem({
        user_id: gap.reportingManagerUserId,
        type: "payroll_attendance_conflict",
        title: `Attendance payroll conflict: ${gap.employeeCode ?? gap.employeeName ?? "Employee"}`,
        description: `${gap.issueDate}: ${gap.payrollImpact}. ${gap.actionNeeded}`,
        entity_type: "attendance_daily_record",
        entity_id: compactEntityId(gap.id),
        action_url: `/payroll/attendance-control-tower?runMonth=${encodeURIComponent(runMonth)}&search=${encodeURIComponent(gap.employeeCode ?? "")}`,
        priority: "high",
      }, 24 * 60);
      await upsertReview(gap, "notified", params.actorUserId ?? null, "Notification sent to reporting manager");
      notified += 1;
    }

    return {
      runMonth,
      from,
      to,
      conflictCount: conflicts.length,
      notified,
      skippedNoManager,
    };
  },

  async updateReviewStatus(params: {
    runMonth?: string;
    conflictKeys: string[];
    status: "reviewed" | "no_issue" | "regularization_required";
    actorUserId: string | null;
    note?: string | null;
  }) {
    const runMonth = params.runMonth ?? new Date().toISOString().slice(0, 7);
    const range = monthRange(runMonth);
    const conflicts = await crossEvidencePenaltyConflicts(range.from, range.to, {});
    const byKey = new Map(conflicts.map((gap) => [gap.id, gap]));
    let updated = 0;
    for (const key of params.conflictKeys) {
      const gap = byKey.get(key);
      if (!gap) continue;
      await upsertReview(gap, params.status, params.actorUserId, params.note ?? null);
      updated += 1;
    }

    // Marking a cross-evidence conflict "no_issue" is a decision that an attendance
    // discrepancy should not be pursued, and it is taken against records that feed
    // payable days. The Payroll Audit Trail reads sensitive_action_log, and this
    // service wrote nothing to it, so those decisions left no trace of who made them.
    if (updated > 0) {
      await logSensitiveAction({
        actor_user_id: params.actorUserId ?? "system",
        action_type: "ATTENDANCE_CONFLICT_REVIEWED",
        module_key: "payroll",
        entity_type: "payroll_attendance_conflict_review",
        entity_id: runMonth,
        change_summary: {
          run_month: runMonth,
          status: params.status,
          conflicts_updated: updated,
          conflicts_requested: params.conflictKeys.length,
          note: params.note ?? null,
        },
      });
    }

    return { runMonth, updated, requested: params.conflictKeys.length, status: params.status };
  },

  async getMissingAdrKeys(from: string, to: string, employeeCode?: string) {
    const empFilter = employeeCode ? " AND e.employee_code = ?" : "";
    const values: unknown[] = employeeCode ? [from, to, employeeCode] : [from, to];
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.id AS employee_id,
              DATE_FORMAT(ibd.activity_date, '%Y-%m-%d') AS activity_date
         FROM integration_biometric_daily ibd
         JOIN employees e ON e.employee_code = ibd.employee_code
         LEFT JOIN attendance_daily_record adr
                ON adr.employee_id = e.id AND adr.record_date = ibd.activity_date
        WHERE ibd.activity_date BETWEEN ? AND ?
          AND ibd.biometric_minutes > 0
          ${empFilter}
          AND adr.id IS NULL
          AND (
            e.active_status = 1
            OR (e.date_of_leaving IS NOT NULL AND e.date_of_leaving >= ibd.activity_date)
          )
        LIMIT 500`,
      values,
    );
    return (rows as any[]).map((row) => `ncosec:${row.employee_id}:${row.activity_date}`);
  },

  async snapshotCosecState(from: string, to: string, employeeCode?: string) {
    const empFilter = employeeCode ? " AND ibd.employee_code = ?" : "";
    const values: unknown[] = employeeCode ? [from, to, employeeCode] : [from, to];
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ibd.employee_code,
              DATE_FORMAT(ibd.activity_date, '%Y-%m-%d') AS activity_date,
              ibd.first_punch, ibd.last_punch, ibd.total_punches, ibd.biometric_minutes,
              ibd.source_table
         FROM integration_biometric_daily ibd
        WHERE ibd.activity_date BETWEEN ? AND ?
          ${empFilter}
        ORDER BY ibd.employee_code, ibd.activity_date`,
      values,
    );
    return rows as any[];
  },

  async repairMissingAdr(params: { conflictKeys: string[]; actorUserId: string | null }) {
    const aprKeys = params.conflictKeys.filter((key) => String(key).startsWith("apr:"));
    const ncosecKeys = params.conflictKeys.filter((key) => String(key).startsWith("ncosec:"));
    const aprResult = aprKeys.length ? await repairMissingAdrFromApr(aprKeys, params.actorUserId) : { requested: 0, repaired: 0, skipped: 0 };
    const ncosecResult = ncosecKeys.length ? await repairMissingAdrFromNcosec(ncosecKeys, params.actorUserId) : { requested: 0, repaired: 0, skipped: 0 };

    const repaired = aprResult.repaired + ncosecResult.repaired;

    // This writes attendance_daily_record rows, and payable days are derived from
    // that table — so a repair changes what someone is paid. It is the most
    // consequential action in this service and was the least visible: nothing here
    // wrote to sensitive_action_log or payroll_calculation_audit, the two tables the
    // Payroll Audit Trail screen reads, so attendance could be materially altered
    // with no record of who did it or which days were touched.
    //
    // Logged even when nothing was repaired: an attempt that skipped every key is
    // itself worth seeing, since it usually means the evidence did not support the
    // repair the operator believed they were making.
    await logSensitiveAction({
      actor_user_id: params.actorUserId ?? "system",
      action_type: "ATTENDANCE_ADR_REPAIRED",
      module_key: "payroll",
      entity_type: "attendance_daily_record",
      entity_id: `repair:${repaired}`,
      change_summary: {
        requested: aprResult.requested + ncosecResult.requested,
        repaired,
        skipped: aprResult.skipped + ncosecResult.skipped,
        apr: aprResult,
        ncosec: ncosecResult,
        // The keys carry employee and date, so the audit row says which attendance
        // was written rather than only how many rows.
        conflict_keys: params.conflictKeys,
      },
    });

    return {
      requested: aprResult.requested + ncosecResult.requested,
      repaired,
      skipped: aprResult.skipped + ncosecResult.skipped,
    };
  },
};
