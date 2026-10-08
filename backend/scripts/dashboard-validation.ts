/**
 * Per-widget / per-datapoint validation for the role dashboards. READ ONLY.
 *
 * The dashboards' failure mode is not "the page crashes" — it is "the page shows a
 * number that nobody checked". So for every datapoint a widget renders, this module
 * recomputes the expected value with an INDEPENDENT query (written against the live
 * schema, deliberately not by calling the same helper the service uses) and compares.
 *
 * Three outcomes are reported distinctly, because they need different fixes:
 *   MATCH        — service value equals the independent value
 *   MISMATCH     — the widget is showing a wrong number
 *   NO_DATA      — the source table is genuinely empty; the widget must say so,
 *                  not render a confident 0
 *   QUERY_FAILED — the service's own query raised; the widget silently blanks today
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import type { DashboardScope } from "../src/shared/dashboardScope.js";
import { buildScopeWhere, buildScopeWhereEmployees } from "../src/shared/dashboardScope.js";
import type { MetricResult } from "../src/modules/dashboards/dashboard-metric.service.js";
import { LATEST_COMPLETE_ATTENDANCE_DATE_SQL } from "../src/shared/attendanceStatus.js";

export type CheckOutcome = "MATCH" | "MISMATCH" | "NO_DATA" | "QUERY_FAILED" | "SKIPPED";

export type DatapointCheck = {
  metric: string;
  datapoint: string;
  serviceValue: number | null;
  expectedValue: number | null;
  outcome: CheckOutcome;
  note?: string;
};

async function q(sql: string, params: unknown[] = []): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  return rows;
}

async function scalar(sql: string, params: unknown[] = []): Promise<number | null> {
  const rows = await q(sql, params);
  const first = rows[0] as Record<string, unknown> | undefined;
  if (!first) return null;
  const value = Object.values(first)[0];
  return value === null || value === undefined ? null : Number(value);
}

/** Row count of a table, or null if the table does not exist. */
export async function rowCount(table: string): Promise<number | null> {
  try {
    return await scalar(`SELECT COUNT(*) AS n FROM \`${table}\``);
  } catch {
    return null;
  }
}

function compare(
  metric: string,
  datapoint: string,
  serviceValue: number | null,
  expectedValue: number | null,
  sourceRows: number | null,
  note?: string,
): DatapointCheck {
  // A metric whose whole source table is empty is a data gap, not a code defect.
  if (sourceRows === 0) {
    return { metric, datapoint, serviceValue, expectedValue, outcome: "NO_DATA", note };
  }
  if (serviceValue === null && expectedValue !== null) {
    return {
      metric, datapoint, serviceValue, expectedValue, outcome: "QUERY_FAILED",
      note: note ?? "service returned null while the source has rows",
    };
  }
  const outcome: CheckOutcome = Number(serviceValue ?? NaN) === Number(expectedValue ?? NaN)
    ? "MATCH"
    : "MISMATCH";
  return { metric, datapoint, serviceValue, expectedValue, outcome, note };
}

const detail = (m: MetricResult, key: string): number | null => {
  const v = (m.detail ?? {})[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

/**
 * The date the dashboards should anchor "today" to.
 *
 * Production attendance trails by a day or two (the most recent record_date often has
 * a single stray row), so a CURDATE()-anchored tile reads ~0. Validation must compare
 * against the same day the widget claims to show.
 */
export async function latestAttendanceDate(): Promise<string | null> {
  // Must be the SAME definition the metric uses, or the comparison measures the
  // anchor rule rather than the metric. Imported rather than re-expressed.
  const rows = await q(`SELECT ${LATEST_COMPLETE_ATTENDANCE_DATE_SQL} AS record_date`);
  const v = (rows[0] as any)?.record_date;
  return v ? String(v) : null;
}

// ── Per-metric validators ────────────────────────────────────────────────────

export async function validateHeadcount(scope: DashboardScope, m: MetricResult): Promise<DatapointCheck[]> {
  const s = buildScopeWhereEmployees(scope, "e");
  const active = await scalar(
    `SELECT COUNT(*) FROM employees e
      WHERE e.active_status = 1
        AND LOWER(COALESCE(e.employment_status,'active')) = 'active'
        AND ${s.sql}`,
    s.params,
  );
  return [
    compare("HEADCOUNT", "active", detail(m, "active") ?? m.value, active, active),
  ];
}

export async function validateOnboarding(scope: DashboardScope, m: MetricResult): Promise<DatapointCheck[]> {
  const total = await rowCount("ats_onboarding_bridge");
  const s = buildScopeWhere(scope, "bm.id", "pm.id");
  const base = `
    FROM ats_onboarding_bridge b
    LEFT JOIN ats_candidate cand ON cand.id = b.candidate_id
    LEFT JOIN branch_master bm ON bm.branch_name = cand.applied_for_branch
    LEFT JOIN process_master pm ON pm.process_name = cand.applied_for_process
    WHERE ${s.sql}`;

  const pending = await scalar(`SELECT COUNT(*) ${base} AND b.status IN ('pending','initiated')`, s.params);
  const submitted = await scalar(`SELECT COUNT(*) ${base} AND b.status = 'profile_submitted'`, s.params);
  const joined = await scalar(`SELECT COUNT(*) ${base} AND b.status = 'joined'`, s.params);
  const scopedTotal = await scalar(`SELECT COUNT(*) ${base}`, s.params);

  return [
    compare("ONBOARDING", "pending", detail(m, "pending"), pending, total),
    compare("ONBOARDING", "submitted", detail(m, "submitted"), submitted, total),
    compare("ONBOARDING", "joined", detail(m, "joined"), joined, total),
    compare("ONBOARDING", "total", detail(m, "total"), scopedTotal, total),
  ];
}

export async function validateAttendance(scope: DashboardScope, m: MetricResult): Promise<DatapointCheck[]> {
  const total = await rowCount("attendance_daily_record");
  const day = await latestAttendanceDate();
  if (!day) {
    return [{
      metric: "ATTENDANCE", datapoint: "*", serviceValue: m.value, expectedValue: null,
      outcome: "NO_DATA", note: "no attendance day with >10 records",
    }];
  }
  const s = buildScopeWhereEmployees(scope, "e");
  const base = `
    FROM attendance_daily_record a
    JOIN employees e ON e.id = a.employee_id
    WHERE a.record_date = ? AND ${s.sql}`;
  const params = [day, ...s.params];

  // 'present' must include week_off_worked, matching shared/attendanceStatus.ts.
  const present = await scalar(`SELECT COUNT(*) ${base} AND a.attendance_status IN ('present','week_off_worked')`, params);
  const absent = await scalar(`SELECT COUNT(*) ${base} AND a.attendance_status='absent'`, params);
  const missing = await scalar(`SELECT COUNT(*) ${base} AND a.attendance_status='missing_punch'`, params);
  const half = await scalar(`SELECT COUNT(*) ${base} AND a.attendance_status='half_day'`, params);
  const late = await scalar(`SELECT COUNT(*) ${base} AND a.late_mark=1`, params);
  const onLeave = await scalar(`SELECT COUNT(*) ${base} AND a.attendance_status IN ('leave_approved','on_leave','leave')`, params);
  const expected = await scalar(
    `SELECT COUNT(*) ${base} AND a.attendance_status NOT IN ('holiday','week_off','leave_approved','on_leave','leave')`,
    params,
  );

  const todayRows = await scalar(
    `SELECT COUNT(*) FROM attendance_daily_record
      WHERE record_date = DATE(CONVERT_TZ(NOW(),'+00:00','+05:30'))`,
  );

  const note = `anchored on ${day}; rows dated today = ${todayRows ?? 0}`;
  return [
    compare("ATTENDANCE", "present", detail(m, "present"), present, total, note),
    compare("ATTENDANCE", "absent", detail(m, "absent"), absent, total, note),
    compare("ATTENDANCE", "missedPunch", detail(m, "missedPunch"), missing, total, note),
    compare("ATTENDANCE", "halfDay", detail(m, "halfDay"), half, total, note),
    compare("ATTENDANCE", "late", detail(m, "late"), late, total, note),
    compare("ATTENDANCE", "onLeave", detail(m, "onLeave"), onLeave, total, note),
    compare("ATTENDANCE", "expectedToWork", detail(m, "expectedToWork"), expected, total, note),
  ];
}

export async function validatePayrollReadiness(scope: DashboardScope, m: MetricResult): Promise<DatapointCheck[]> {
  const s = buildScopeWhereEmployees(scope, "e");
  // Must use the SAME active-employee predicate as the metric (and as HEADCOUNT):
  // active_status alone counts 2 extra rows whose employment_status is not 'active',
  // which previously showed up as a false off-by-2 against the service.
  const total = await scalar(
    `SELECT COUNT(*) FROM employees e
      WHERE e.active_status = 1
        AND LOWER(COALESCE(e.employment_status,'active')) = 'active'
        AND ${s.sql}`,
    s.params,
  );
  const ready = await scalar(
    `SELECT COUNT(*) FROM employees e
      WHERE e.active_status = 1
        AND LOWER(COALESCE(e.employment_status,'active')) = 'active'
        AND COALESCE(TRIM(e.bank_account_number),'') <> ''
        AND COALESCE(TRIM(e.pan_number),'') <> ''
        AND ${s.sql}`,
    s.params,
  );
  return [
    compare("PAYROLL_READINESS", "total", detail(m, "total"), total, total),
    compare("PAYROLL_READINESS", "readyCount", detail(m, "readyCount"), ready, total),
  ];
}

export async function validateBgv(scope: DashboardScope, m: MetricResult): Promise<DatapointCheck[]> {
  const total = await rowCount("candidate_bgv_check");
  const s = buildScopeWhere(scope, "bm.id", "pm.id");
  const base = `
    FROM candidate_bgv_check bgv
    LEFT JOIN ats_candidate cand ON cand.id = bgv.candidate_id
    LEFT JOIN branch_master bm ON bm.branch_name = cand.applied_for_branch
    LEFT JOIN process_master pm ON pm.process_name = cand.applied_for_process
    WHERE ${s.sql}`;

  const pending = await scalar(
    `SELECT COUNT(*) ${base} AND (bgv.status IS NULL OR bgv.status IN ('pending','not_started','queued','manual_review','in_progress'))`, s.params);
  const cleared = await scalar(
    `SELECT COUNT(*) ${base} AND bgv.status IN ('cleared','verified','passed')`, s.params);
  const flagged = await scalar(
    `SELECT COUNT(*) ${base} AND bgv.status IN ('flagged','failed','mismatch','discrepancy')`, s.params);
  const scoped = await scalar(`SELECT COUNT(*) ${base}`, s.params);

  const checks = [
    compare("BGV", "pending", detail(m, "pending"), pending, total),
    compare("BGV", "cleared", detail(m, "cleared"), cleared, total),
    compare("BGV", "flagged", detail(m, "flagged"), flagged, total),
  ];
  // Every record must land in exactly one bucket; a gap means statuses are being dropped.
  const bucketed = (pending ?? 0) + (cleared ?? 0) + (flagged ?? 0);
  checks.push({
    metric: "BGV",
    datapoint: "buckets cover all rows",
    serviceValue: bucketed,
    expectedValue: scoped,
    outcome: bucketed === scoped ? "MATCH" : "MISMATCH",
    note: bucketed === scoped ? "" : "some BGV statuses fall into no bucket and are invisible",
  });
  return checks;
}

export async function validateResignation(scope: DashboardScope, m: MetricResult): Promise<DatapointCheck[]> {
  const total = await rowCount("exit_request");
  const s = buildScopeWhere(scope, "e.branch_id", "e.process_id");
  const active = await scalar(
    `SELECT COUNT(*) FROM exit_request er
       LEFT JOIN employees e ON e.id = er.employee_id
      WHERE er.status NOT IN ('completed','cancelled') AND ${s.sql}`,
    s.params,
  );
  return [compare("RESIGNATION", "totalActive", detail(m, "totalActive") ?? m.value, active, total)];
}

// ── Validators for the newly-added metric sources ────────────────────────────
// Each recomputes the value from the same source with an independently-written query.
// That method has caught three wrong assumptions of mine so far, so no new metric ships
// without one.

export async function validateAttendanceExceptions(scope: DashboardScope, m: MetricResult): Promise<DatapointCheck[]> {
  const total = await rowCount("attendance_reconciliation_issue");
  const s = buildScopeWhere(scope, "emp.branch_id", "emp.process_id");
  // issue_date, not created_at (which does not exist); open is resolved_at IS NULL.
  const base = `
    FROM attendance_reconciliation_issue ari
    LEFT JOIN employees emp ON emp.id = ari.employee_id
    WHERE ari.issue_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND ${s.sql}`;

  const openTotal = await scalar(`SELECT COUNT(*) ${base} AND ari.resolved_at IS NULL`, s.params);
  const blockers = await scalar(`SELECT COUNT(*) ${base} AND ari.resolved_at IS NULL AND ari.severity='blocker'`, s.params);
  const missingAdr = await scalar(`SELECT COUNT(*) ${base} AND ari.resolved_at IS NULL AND ari.issue_type='missing_adr'`, s.params);
  const payable = await scalar(
    `SELECT COUNT(*) ${base} AND ari.resolved_at IS NULL AND ari.issue_type='salary_payable_days_mismatch'`,
    s.params,
  );

  return [
    compare("ATTENDANCE_EXCEPTIONS", "openTotal", detail(m, "openTotal") ?? m.value, openTotal, total),
    compare("ATTENDANCE_EXCEPTIONS", "blockers", detail(m, "blockers"), blockers, total),
    compare("ATTENDANCE_EXCEPTIONS", "missingAdr", detail(m, "missingAdr"), missingAdr, total),
    compare("ATTENDANCE_EXCEPTIONS", "payableMismatch", detail(m, "payableMismatch"), payable, total),
  ];
}

export async function validateDocCompliance(scope: DashboardScope, m: MetricResult): Promise<DatapointCheck[]> {
  const total = await rowCount("employee_documents");
  const s = buildScopeWhereEmployees(scope, "e");
  // Counted over ACTIVE employees only, and with a NOT EXISTS rather than the service's
  // LEFT JOIN aggregate, so the two disagree if either is wrong.
  const activeEmployees = await scalar(
    `SELECT COUNT(*) FROM employees e WHERE e.active_status = 1 AND ${s.sql}`, s.params,
  );
  const noDocs = await scalar(
    `SELECT COUNT(*) FROM employees e
      WHERE e.active_status = 1 AND ${s.sql}
        AND NOT EXISTS (SELECT 1 FROM employee_documents d WHERE d.employee_id = e.id)`,
    s.params,
  );
  const verifiedDocs = await scalar(
    `SELECT COUNT(*) FROM employee_documents d JOIN employees e ON e.id = d.employee_id
      WHERE e.active_status = 1 AND d.verified = 1 AND ${s.sql}`,
    s.params,
  );

  return [
    compare("DOC_COMPLIANCE", "activeEmployees", detail(m, "activeEmployees"), activeEmployees, total),
    compare("DOC_COMPLIANCE", "employeesWithNoDocs", detail(m, "employeesWithNoDocs") ?? m.value, noDocs, total),
    compare("DOC_COMPLIANCE", "verifiedDocs", detail(m, "verifiedDocs"), verifiedDocs, total),
  ];
}

export async function validateBiometricActivity(scope: DashboardScope, m: MetricResult): Promise<DatapointCheck[]> {
  const total = await rowCount("integration_biometric_daily");
  const s = buildScopeWhereEmployees(scope, "e");
  // Must use the same "latest complete day" anchor as the metric, or this measures the
  // anchor rule instead of the metric. Today is excluded because a partial day reads as
  // mass early departure (1.54h at 15:00 vs 10.34h the day before).
  const day = await scalar(`SELECT 1 FROM integration_biometric_daily WHERE activity_date < CURDATE() LIMIT 1`);
  if (day === null) {
    return [{
      metric: "BIOMETRIC_ACTIVITY", datapoint: "*", serviceValue: m.value, expectedValue: null,
      outcome: "NO_DATA", note: "no biometric activity before today",
    }];
  }
  const base = `
    FROM integration_biometric_daily b
    JOIN employees e ON e.employee_code = b.employee_code
    WHERE b.activity_date = (SELECT MAX(activity_date) FROM integration_biometric_daily WHERE activity_date < CURDATE())
      AND e.active_status = 1 AND ${s.sql}`;

  const employees = await scalar(`SELECT COUNT(DISTINCT b.employee_code) ${base}`, s.params);
  const pairs = await scalar(`SELECT COUNT(*) ${base} AND b.total_punches >= 2`, s.params);
  const single = await scalar(`SELECT COUNT(*) ${base} AND b.total_punches = 1`, s.params);

  return [
    compare("BIOMETRIC_ACTIVITY", "employees", detail(m, "employees") ?? m.value, employees, total),
    compare("BIOMETRIC_ACTIVITY", "completePunchPairs", detail(m, "completePunchPairs"), pairs, total),
    compare("BIOMETRIC_ACTIVITY", "singlePunchOnly", detail(m, "singlePunchOnly"), single, total),
  ];
}

export async function validateSalaryComponents(scope: DashboardScope, m: MetricResult): Promise<DatapointCheck[]> {
  const total = await rowCount("salary_prep_line_component");
  const s = buildScopeWhereEmployees(scope, "e");
  const base = `
    FROM salary_prep_line_component c
    JOIN employees e ON e.id = c.employee_id
    WHERE c.run_id = (SELECT id FROM salary_prep_run ORDER BY run_month DESC, created_at DESC LIMIT 1)
      AND ${s.sql}`;

  const codes = await scalar(`SELECT COUNT(DISTINCT c.component_code) ${base}`, s.params);
  const earningLines = await scalar(`SELECT COUNT(*) ${base} AND c.component_type='earning'`, s.params);
  const deductionLines = await scalar(`SELECT COUNT(*) ${base} AND c.component_type='deduction'`, s.params);

  return [
    compare("SALARY_COMPONENTS", "componentCodes", detail(m, "componentCodes") ?? m.value, codes, total),
    compare("SALARY_COMPONENTS", "earningLines", detail(m, "earningLines"), earningLines, total),
    compare("SALARY_COMPONENTS", "deductionLines", detail(m, "deductionLines"), deductionLines, total),
  ];
}

export async function validateRecruiterActivity(scope: DashboardScope, m: MetricResult): Promise<DatapointCheck[]> {
  const total = await rowCount("ats_recruiter_hiring_activity");
  const s = buildScopeWhere(scope, "bm.id", "pm.id");
  const base = `
    FROM ats_recruiter_hiring_activity r
    LEFT JOIN branch_master bm ON bm.branch_name = r.branch_name
    LEFT JOIN process_master pm ON pm.process_name = r.process_name
    WHERE r.activity_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND ${s.sql}`;

  const leads = await scalar(`SELECT COUNT(*) ${base}`, s.params);
  const selected = await scalar(`SELECT COUNT(*) ${base} AND r.final_selection_flag = 1`, s.params);
  const joined = await scalar(`SELECT COUNT(*) ${base} AND r.joined_flag = 1`, s.params);
  // Guards the finding that recruiter FK columns are unusable: if a future change starts
  // grouping by recruiter_employee_id, this drops from 15 to ~5 and the check fires.
  const recruiters = await scalar(`SELECT COUNT(DISTINCT r.recruiter_name_snapshot) ${base}`, s.params);

  return [
    compare("RECRUITER_ACTIVITY", "leads", detail(m, "leads") ?? m.value, leads, total),
    compare("RECRUITER_ACTIVITY", "recruiters", detail(m, "recruiters"), recruiters, total),
    compare("RECRUITER_ACTIVITY", "selected", detail(m, "selected"), selected, total),
    compare("RECRUITER_ACTIVITY", "joined", detail(m, "joined"), joined, total),
  ];
}

export async function validateTrainingProgress(scope: DashboardScope, m: MetricResult): Promise<DatapointCheck[]> {
  const total = await rowCount("lms_learning_progress_snapshot");
  const s = buildScopeWhereEmployees(scope, "e");
  const base = `
    FROM lms_learning_progress_snapshot snap
    JOIN employees e ON e.id = snap.employee_id AND e.active_status = 1
    WHERE ${s.sql}`;

  const assignments = await scalar(`SELECT COUNT(*) ${base}`, s.params);
  const completed = await scalar(`SELECT COUNT(*) ${base} AND snap.status='completed'`, s.params);
  const notStarted = await scalar(`SELECT COUNT(*) ${base} AND snap.status='not_started'`, s.params);
  const learners = await scalar(`SELECT COUNT(DISTINCT snap.employee_id) ${base}`, s.params);

  return [
    compare("TRAINING_PROGRESS", "assignments", detail(m, "assignments"), assignments, total),
    compare("TRAINING_PROGRESS", "completed", detail(m, "completed"), completed, total),
    compare("TRAINING_PROGRESS", "notStarted", detail(m, "notStarted"), notStarted, total),
    compare("TRAINING_PROGRESS", "learners", detail(m, "learners"), learners, total),
  ];
}

export async function validateLeaveApprovals(scope: DashboardScope, m: MetricResult): Promise<DatapointCheck[]> {
  const total = await rowCount("leave_request");
  const s = buildScopeWhereEmployees(scope, "e");
  const base = `
    FROM leave_request lr
    JOIN employees e ON e.id = lr.employee_id AND e.active_status = 1
    WHERE ${s.sql}`;

  const pending = await scalar(`SELECT COUNT(*) ${base} AND lr.status='pending'`, s.params);
  const started = await scalar(`SELECT COUNT(*) ${base} AND lr.status='pending' AND lr.from_date < CURDATE()`, s.params);
  const approved = await scalar(`SELECT COUNT(*) ${base} AND lr.status='approved'`, s.params);

  return [
    compare("LEAVE_APPROVALS", "pending", detail(m, "pending") ?? m.value, pending, total),
    compare("LEAVE_APPROVALS", "pendingAlreadyStarted", detail(m, "pendingAlreadyStarted"), started, total),
    compare("LEAVE_APPROVALS", "approved", detail(m, "approved"), approved, total),
  ];
}

/** Metrics whose source table is empty in production — validated as NO_DATA, not 0. */
const EMPTY_SOURCE_METRICS: Record<string, string> = {
  TAT: "task_tat_instance",
  NAME_MISMATCH: "candidate_name_match_summary",
  DPDP_WITHDRAWAL: "dpdp_consent_withdrawal",
  INCENTIVE: "incentive_upload_batch",
};

export async function validateEmptySourceMetric(
  metricCode: string,
  m: MetricResult,
): Promise<DatapointCheck[]> {
  const table = EMPTY_SOURCE_METRICS[metricCode];
  if (!table) return [];
  const rows = await rowCount(table);
  return [{
    metric: metricCode,
    datapoint: "value",
    serviceValue: m.value,
    expectedValue: rows === null ? null : 0,
    outcome: rows === null ? "QUERY_FAILED" : rows === 0 ? "NO_DATA" : "SKIPPED",
    note: rows === null ? `${table} does not exist` : `${table} has ${rows} rows`,
  }];
}

export function summarise(checks: DatapointCheck[]): Record<CheckOutcome, number> {
  const out: Record<CheckOutcome, number> = {
    MATCH: 0, MISMATCH: 0, NO_DATA: 0, QUERY_FAILED: 0, SKIPPED: 0,
  };
  for (const c of checks) out[c.outcome]++;
  return out;
}
