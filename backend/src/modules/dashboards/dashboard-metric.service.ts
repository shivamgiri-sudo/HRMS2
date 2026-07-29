import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import {
  type DashboardScope,
  buildEmployeeLinkedScopeWhere,
  buildScopeWhere,
  buildScopeWhereEmployees,
} from "../../shared/dashboardScope.js";
import { enrichMetric, type MetricEnrichment } from "./dashboard-target.service.js";
import { logSourceFailure } from "../../shared/apiResponse.js";
import { IST_DATE_EXPR } from "../../utils/dateUtils.js";

// ─── Shared metric wrapper shape ──────────────────────────────────────────────
export interface MetricResult {
  value: number | null;
  previousValue: number | null;
  target: number | null;
  variance: number | null;
  variancePct: number | null;
  status: "ok" | "warn" | "critical" | "unknown";
  trend: "up" | "down" | "stable" | null;
  drilldownApi: string;
  actionUrl: null;
  detail: Record<string, number | null>;
  /**
   * Set when the metric's own query threw. Carries the driver code (e.g.
   * ER_BAD_FIELD_ERROR) so a broken panel is distinguishable from an empty one.
   */
  errorCode?: string | null;
  errorMessage?: string | null;
  /**
   * Rows the metric's source held within the caller's scope. `0` means the metric
   * genuinely measured nothing — which must render as "no data recorded" rather than
   * a confident "0". `null` means the metric does not report it.
   */
  sourceRowCount?: number | null;
}

async function wrapEnriched(
  metricCode: string,
  value: number | null,
  detail: Record<string, number | null>,
  status: MetricResult["status"],
  higherIsBetter: boolean,
  branchId?: string | null,
  processId?: string | null,
  sourceRowCount?: number | null,
): Promise<MetricResult> {
  let enrichment: Partial<MetricEnrichment> = {
    previousValue: null, target: null, variance: null, variancePct: null,
    trend: undefined, status: undefined,
  };
  if (value !== null) {
    try {
      enrichment = await enrichMetric(metricCode, value, 'monthly', higherIsBetter, branchId, processId);
      // Let enrichment override status only if it has target data; otherwise keep computed status
      if (enrichment.target !== null && enrichment.status && enrichment.status !== 'unknown') {
        const statusMap: Record<string, MetricResult["status"]> = { good: "ok", warning: "warn", critical: "critical", unknown: "unknown" };
        status = statusMap[enrichment.status] ?? status;
      }
    } catch (err) {
      // Enrichment is best-effort — the metric value still stands without a target/trend.
      // Logged because a silent failure here is indistinguishable from an unseeded catalog.
      logSourceFailure("dashboard-metric.enrich", err, { metricCode });
    }
  }
  return {
    value,
    previousValue: enrichment.previousValue ?? null,
    target: enrichment.target ?? null,
    variance: enrichment.variance ?? null,
    variancePct: enrichment.variancePct ?? null,
    status,
    trend: enrichment.trend ?? null,
    drilldownApi: `/api/dashboards/:dashboardCode/metric/${metricCode}/drilldown`,
    actionUrl: null,
    detail,
    errorCode: null,
    errorMessage: null,
    sourceRowCount: sourceRowCount ?? null,
  };
}

/**
 * Returned when a metric query fails. The shape is unchanged from a "no data" result,
 * so callers keep degrading gracefully — but the failure is now always logged, because
 * a silently-swallowed ER_BAD_FIELD_ERROR is indistinguishable from an empty table.
 */
function nullResult(metricCode: string, error?: unknown): MetricResult {
  const failure = error === undefined
    ? null
    : logSourceFailure("dashboard-metric", error, { metricCode });
  return {
    value: null, previousValue: null, target: null, variance: null,
    variancePct: null, status: "unknown", trend: null,
    drilldownApi: `/api/dashboards/:dashboardCode/metric/${metricCode}/drilldown`,
    actionUrl: null, detail: {},
    // Carry the driver code through to the response so the UI can say *why* a tile is
    // blank. Previously every null was reported as a generic "SOURCE_UNAVAILABLE",
    // which read identically whether the table was empty or the SQL was invalid.
    errorCode: failure ? "QUERY_FAILED" : null,
    errorMessage: failure
      ? `${failure.errorCode ?? "query failed"}: ${failure.errorMessage}`
      : null,
    sourceRowCount: null,
  };
}

// ─── Headcount ────────────────────────────────────────────────────────────────
export async function getHeadcountMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildScopeWhereEmployees(scope, "e");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS active FROM employees e WHERE e.active_status = 1 AND LOWER(COALESCE(e.employment_status,'active')) = 'active' AND ${scopeSql}`,
      scopeParams
    );
    const active = Number((rows[0] as any)?.active ?? 0);

    // Required HC: today's planned HC from slot requirements, fallback to workforce mandate
    const { sql: reqScopeSql, params: reqScopeParams } = buildScopeWhere(scope, "branch_id", "process_id");
    const [reqRows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(
        (SELECT SUM(ws.required_planned_hc)
         FROM wfm_slot_requirement ws
         WHERE ws.requirement_date = ${IST_DATE_EXPR} AND ${reqScopeSql}),
        (SELECT SUM(CEIL(wm.mandated_hc * (1 + wm.shrinkage_pct / 100)))
         FROM workforce_mandate wm
         WHERE wm.active_status = 1 AND ${reqScopeSql})
       ) AS required_hc`,
      [...reqScopeParams, ...reqScopeParams]
    );

    // Available HC: employees clocked in/active today (IST)
    const { sql: availScopeSql, params: availScopeParams } = buildScopeWhere(scope, "e.branch_id", "e.process_id");
    const [availRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT s.employee_id) AS available_hc
       FROM wfm_attendance_session s
       JOIN employees e ON e.id = s.employee_id
       WHERE DATE(CONVERT_TZ(s.session_date, '+00:00', '+05:30')) = ${IST_DATE_EXPR}
         AND s.current_status IN ('Rostered', 'Active', 'Login')
         AND ${availScopeSql}`,
      availScopeParams
    );

    // Use scheduled/mandated HC, fall back to active headcount as baseline
    const requiredRaw = (reqRows[0] as any)?.required_hc;
    const required = requiredRaw === null || requiredRaw === undefined
      ? null
      : Number(requiredRaw);
    const available = availRows[0] != null ? Number((availRows[0] as any).available_hc ?? 0) : null;
    const short = required != null && available != null ? required - available : null;

    const status: MetricResult["status"] = active === 0 ? "warn" : "ok";
    return wrapEnriched("HEADCOUNT", active, { active, required, available, short }, status, true, scope.branchIds[0], scope.processIds[0]);
  } catch (err) {
    return nullResult("HEADCOUNT", err);
  }
}

// ─── Onboarding ───────────────────────────────────────────────────────────────
export async function getOnboardingMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    // ats_onboarding_bridge has no bridge_status/branch_id/process_id column — the
    // status column is `status`, and the only route to branch/process is via the
    // candidate's applied_for_* fields, which hold NAMES rather than FK ids.
    // The previous query referenced all three nonexistent columns, so this metric
    // raised ER_BAD_FIELD_ERROR on every CEO, HR and Recruiter dashboard load and
    // was silently reported as "no data".
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "bm.id", "pm.id");

    const [bridgeRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN b.status = 'profile_submitted' THEN 1 ELSE 0 END) AS submitted,
         SUM(CASE WHEN b.status IN ('pending','initiated') THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN b.status = 'stuck' THEN 1 ELSE 0 END) AS stuck,
         SUM(CASE WHEN b.status = 'joined' THEN 1 ELSE 0 END) AS joined
       FROM ats_onboarding_bridge b
       LEFT JOIN ats_candidate cand ON cand.id = b.candidate_id
       LEFT JOIN branch_master bm ON bm.branch_name = cand.applied_for_branch
       LEFT JOIN process_master pm ON pm.process_name = cand.applied_for_process
       WHERE ${scopeSql}`,
      scopeParams
    );

    const [otpRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS otp_verified FROM candidate_onboarding_profile WHERE otp_verified = 1`
    );

    const r = bridgeRows[0] as any;
    const submitted = Number(r?.submitted ?? 0);
    const pending = Number(r?.pending ?? 0);
    const stuck = Number(r?.stuck ?? 0);
    const joined = Number(r?.joined ?? 0);
    const total = Number(r?.total ?? 0);
    const otpPending = Number((otpRows[0] as any)?.otp_verified ?? 0);

    const status: MetricResult["status"] = stuck > 0 ? "critical" : pending > 10 ? "warn" : "ok";
    return wrapEnriched("ONBOARDING", submitted + pending, { submitted, pending, otpPending, stuck, joined, total }, status, true, scope.branchIds[0], scope.processIds[0], total);
  } catch (err) {
    return nullResult("ONBOARDING", err);
  }
}

// ─── Attendance ───────────────────────────────────────────────────────────────
export async function getAttendanceMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildEmployeeLinkedScopeWhere(
      scope,
      "employee_id",
      "branch_id",
      "process_id",
    );

    // Use live WFM attendance sessions for real-time present count
    const [liveRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT s.employee_id) AS live_present
       FROM wfm_attendance_session s
       JOIN employees e ON e.id = s.employee_id
       WHERE DATE(s.session_date) = ${IST_DATE_EXPR}
         AND s.current_status IN ('Logged In', 'Active', 'Login', 'Rostered')
         AND ${buildScopeWhereEmployees(scope, "e").sql}`,
      buildScopeWhereEmployees(scope, "e").params
    );

    // Get processed attendance records for detailed breakdown
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         SUM(CASE WHEN attendance_status = 'present' THEN 1 ELSE 0 END) AS present,
         SUM(CASE WHEN attendance_status = 'absent' THEN 1 ELSE 0 END) AS absent,
         SUM(CASE WHEN attendance_status = 'late' THEN 1 ELSE 0 END) AS late,
         SUM(CASE WHEN attendance_status IN ('missing_punch', 'missed_punch') THEN 1 ELSE 0 END) AS missedPunch,
         COUNT(*) AS total
       FROM attendance_daily_record
       WHERE record_date = ${IST_DATE_EXPR} AND ${scopeSql}`,
      scopeParams
    );

    // Get employees expected to work today (rostered, excluding leave/week-off)
    const [expectedRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS expected_to_work
       FROM attendance_daily_record
       WHERE record_date = ${IST_DATE_EXPR}
         AND attendance_status NOT IN ('on_leave', 'leave', 'week_off', 'holiday')
         AND ${scopeSql}`,
      scopeParams
    );

    const livePresent = Number((liveRows[0] as any)?.live_present ?? 0);
    const expectedToWork = Number((expectedRows[0] as any)?.expected_to_work ?? 0);

    // Live and processed attendance are intentionally kept separate. The rate
    // uses only processed attendance numerator and denominator.
    const r = rows[0] as any;
    const processedPresent = Number(r?.present ?? 0);
    const absent = Number(r?.absent ?? 0);
    const late = Number(r?.late ?? 0);
    const missedPunch = Number(r?.missedPunch ?? 0);
    const totalRecords = Number(r?.total ?? 0);

    // Use live present count if available, otherwise use processed
    const present = processedPresent;
    // Denominator: employees expected to work (from attendance records, excluding leave/week-off)
    // Fall back to total records if expected query returns 0
    const denominator = expectedToWork > 0 ? expectedToWork : (totalRecords > 0 ? totalRecords : 0);
    const attendanceRate = denominator > 0 ? Math.round((present / denominator) * 100) : null;

    const status: MetricResult["status"] =
      attendanceRate === null ? "unknown" : attendanceRate < 70 ? "critical" : attendanceRate < 85 ? "warn" : "ok";

    return wrapEnriched("ATTENDANCE", attendanceRate, {
      present,
      livePresent,
      absent,
      late,
      missedPunch,
      expectedToWork: denominator,
      attendanceRate,
    }, status, true, scope.branchIds[0], scope.processIds[0]);
  } catch (err) {
    return nullResult("ATTENDANCE", err);
  }
}

// ─── Payroll Readiness ────────────────────────────────────────────────────────
export async function getPayrollReadinessMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildScopeWhereEmployees(scope, "e");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN bank_account_number IS NULL OR bank_account_number = '' THEN 1 ELSE 0 END) AS missingBank,
         SUM(CASE WHEN pan_number IS NULL OR pan_number = '' THEN 1 ELSE 0 END) AS missingPan,
         SUM(CASE WHEN uan_number IS NULL OR uan_number = '' THEN 1 ELSE 0 END) AS missingUan,
         SUM(CASE WHEN
               (bank_account_number IS NOT NULL AND bank_account_number != '') AND
               (pan_number IS NOT NULL AND pan_number != '')
             THEN 1 ELSE 0 END) AS readyCount
       FROM employees e
       WHERE e.active_status = 1 AND LOWER(COALESCE(e.employment_status,'active')) = 'active' AND ${scopeSql}`,
      scopeParams
    );

    const r = rows[0] as any;
    const total = Number(r.total ?? 0);
    const readyCount = Number(r.readyCount ?? 0);
    const missingBank = Number(r.missingBank ?? 0);
    const missingPan = Number(r.missingPan ?? 0);
    const missingUan = Number(r.missingUan ?? 0);
    const blockerCount = total - readyCount;

    const status: MetricResult["status"] =
      blockerCount === 0 ? "ok" : blockerCount > 10 ? "critical" : "warn";

    return wrapEnriched(
      "PAYROLL_READINESS",
      readyCount,
      { total, readyCount, blockerCount, missingBank, missingPan, missingUan },
      status, true, scope.branchIds[0], scope.processIds[0]
    );
  } catch (err) {
    return nullResult("PAYROLL_READINESS", err);
  }
}

// ─── Incentive ────────────────────────────────────────────────────────────────
export async function getIncentiveMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    // The status column is `status`, not `batch_status` — the old name raised
    // ER_BAD_FIELD_ERROR on every payroll dashboard load. branch_id/process_id are real.
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "branch_id", "process_id");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS source_rows,
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pendingBatches,
         SUM(CASE WHEN status = 'pending' THEN total_amount ELSE 0 END) AS pendingAmount,
         SUM(CASE WHEN status = 'approved' THEN total_amount ELSE 0 END) AS approvedAmount,
         SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejectedBatches
       FROM incentive_upload_batch
       WHERE ${scopeSql}`,
      scopeParams
    );

    const r = rows[0] as any;
    const pendingBatches = Number(r.pendingBatches ?? 0);
    const pendingAmount = Number(r.pendingAmount ?? 0);
    const approvedAmount = Number(r.approvedAmount ?? 0);
    const rejectedBatches = Number(r.rejectedBatches ?? 0);

    const status: MetricResult["status"] =
      rejectedBatches > 0 ? "warn" : pendingBatches > 5 ? "warn" : "ok";

    return wrapEnriched(
      "INCENTIVE",
      pendingBatches,
      { pendingBatches, pendingAmount, approvedAmount, rejectedBatches },
      status, false, scope.branchIds[0], scope.processIds[0], Number(r.source_rows ?? 0)
    );
  } catch (err) {
    return nullResult("INCENTIVE", err);
  }
}

// ─── TAT ──────────────────────────────────────────────────────────────────────
export async function getTatMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    // task_tat_instance carries branch_id but no process_id, so passing a process
    // column raised ER_BAD_FIELD_ERROR for every process-scoped role. Branch scope is
    // the finest granularity this source supports.
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "branch_id", "branch_id");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS source_rows,
         SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_count,
         SUM(CASE WHEN due_at < NOW() AND status NOT IN ('closed','resolved') THEN 1 ELSE 0 END) AS overdue,
         SUM(CASE WHEN status = 'sla_breached' THEN 1 ELSE 0 END) AS breached,
         AVG(CASE WHEN status NOT IN ('closed','resolved')
             THEN TIMESTAMPDIFF(HOUR, created_at, NOW()) ELSE NULL END) AS avgAgeHours
       FROM task_tat_instance
       WHERE ${scopeSql}`,
      scopeParams
    );

    const r = rows[0] as any;
    const open = Number(r.open_count ?? 0);
    const overdue = Number(r.overdue ?? 0);
    const breached = Number(r.breached ?? 0);
    const avgAgeHours = r.avgAgeHours !== null ? Math.round(Number(r.avgAgeHours)) : null;

    const status: MetricResult["status"] =
      breached > 0 ? "critical" : overdue > 0 ? "warn" : "ok";

    return wrapEnriched("TAT", open, { open, overdue, breached, avgAgeHours }, status, false, scope.branchIds[0], scope.processIds[0], Number(r.source_rows ?? 0));
  } catch (err) {
    return nullResult("TAT", err);
  }
}

// ─── Resignation ──────────────────────────────────────────────────────────────
export async function getResignationMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    // exit_request has no exit_status column (it is `status`) and no branch/process
    // columns, so the previous query raised ER_BAD_FIELD_ERROR on every dashboard that
    // shows resignations. Scope routes through the employee instead.
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "e.branch_id", "e.process_id");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS totalActive,
         SUM(CASE WHEN er.status = 'pending_discussion' THEN 1 ELSE 0 END) AS pendingDiscussion,
         SUM(CASE WHEN er.status = 'accepted' THEN 1 ELSE 0 END) AS accepted,
         SUM(CASE WHEN er.status = 'withdrawn' THEN 1 ELSE 0 END) AS withdrawn
       FROM exit_request er
       LEFT JOIN employees e ON e.id = er.employee_id
       WHERE er.status NOT IN ('completed','cancelled') AND ${scopeSql}`,
      scopeParams
    );

    const r = rows[0] as any;
    const totalActive = Number(r.totalActive ?? 0);
    const pendingDiscussion = Number(r.pendingDiscussion ?? 0);
    const accepted = Number(r.accepted ?? 0);
    const withdrawn = Number(r.withdrawn ?? 0);

    const status: MetricResult["status"] =
      pendingDiscussion > 5 ? "critical" : pendingDiscussion > 0 ? "warn" : "ok";

    return wrapEnriched(
      "RESIGNATION",
      totalActive,
      { pendingDiscussion, accepted, withdrawn, totalActive },
      status, false, scope.branchIds[0], scope.processIds[0]
    );
  } catch (err) {
    return nullResult("RESIGNATION", err);
  }
}

// DPDP withdrawal
export async function getDpdpWithdrawalMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "e.branch_id", "e.process_id");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN dcw.status IN ('submitted','in_review') THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN dcw.status = 'approved' THEN 1 ELSE 0 END) AS approved,
         SUM(CASE WHEN dcw.status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
         SUM(CASE WHEN dcw.processing_hold_active = 1 THEN 1 ELSE 0 END) AS holdsActive,
         SUM(CASE WHEN dcw.status IN ('submitted','in_review') AND dcw.created_at < DATE_SUB(NOW(), INTERVAL 72 HOUR) THEN 1 ELSE 0 END) AS overdue
       FROM dpdp_consent_withdrawal dcw
       LEFT JOIN employees e ON e.user_id = dcw.requester_id
       WHERE ${scopeSql}`,
      scopeParams
    );

    const r = rows[0] as any;
    const pending = Number(r.pending ?? 0);
    const overdue = Number(r.overdue ?? 0);
    const status: MetricResult["status"] = overdue > 0 ? "critical" : pending > 0 ? "warn" : "ok";

    return wrapEnriched(
      "DPDP_WITHDRAWAL",
      pending,
      {
        total: Number(r.total ?? 0),
        pending,
        approved: Number(r.approved ?? 0),
        rejected: Number(r.rejected ?? 0),
        holdsActive: Number(r.holdsActive ?? 0),
        overdue,
      },
      status,
      false,
      scope.branchIds[0],
      scope.processIds[0],
    );
  } catch (err) {
    return nullResult("DPDP_WITHDRAWAL", err);
  }
}

// Appointment letter eSign
export async function getAppointmentEsignMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "e.branch_id", "e.process_id");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN alr.current_state IN ('candidate_esign_pending','company_sign_pending','override_requested')
                   OR alr.candidate_esign_status = 'pending'
                   OR alr.company_sign_status = 'pending'
             THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN alr.current_state = 'candidate_esign_pending' OR alr.candidate_esign_status = 'pending' THEN 1 ELSE 0 END) AS candidatePending,
         SUM(CASE WHEN alr.current_state = 'company_sign_pending' OR alr.company_sign_status = 'pending' THEN 1 ELSE 0 END) AS companyPending,
         SUM(CASE WHEN alr.current_state = 'override_requested' THEN 1 ELSE 0 END) AS overrideRequested,
         SUM(CASE WHEN alr.current_state IN ('completed','locked') OR alr.pdf_locked = 1 THEN 1 ELSE 0 END) AS completed
       FROM appointment_letter_request alr
       LEFT JOIN employees e ON e.id = alr.employee_id
       WHERE ${scopeSql}`,
      scopeParams
    );

    const r = rows[0] as any;
    const pending = Number(r.pending ?? 0);
    const overrideRequested = Number(r.overrideRequested ?? 0);
    const status: MetricResult["status"] = overrideRequested > 0 ? "warn" : pending > 10 ? "warn" : "ok";

    return wrapEnriched(
      "APPOINTMENT_ESIGN",
      pending,
      {
        total: Number(r.total ?? 0),
        pending,
        candidatePending: Number(r.candidatePending ?? 0),
        companyPending: Number(r.companyPending ?? 0),
        overrideRequested,
        completed: Number(r.completed ?? 0),
      },
      status,
      false,
      scope.branchIds[0],
      scope.processIds[0],
    );
  } catch (err) {
    return nullResult("APPOINTMENT_ESIGN", err);
  }
}

// ─── BGV ──────────────────────────────────────────────────────────────────────
export async function getBgvMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    // candidate_bgv_check has no `bgv_status` column (it is `status`), and
    // ats_onboarding_bridge carries no branch/process columns to scope by — so the
    // previous query raised ER_BAD_FIELD_ERROR and the BGV tile was permanently blank.
    // Scope routes via the candidate, as the other candidate-keyed metrics do.
    //
    // Status buckets are taken from the values actually present: verified, failed,
    // not_started, manual_review, mismatch, queued. Anything awaiting action counts as
    // pending — treating only the literal 'pending' as outstanding would have dropped
    // 87 of 194 records on the floor.
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "bm.id", "pm.id");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS source_rows,
         SUM(CASE WHEN bgv.status IS NULL OR bgv.status IN ('pending','not_started','queued','manual_review','in_progress') THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN bgv.status IN ('cleared','verified','passed') THEN 1 ELSE 0 END) AS cleared,
         SUM(CASE WHEN bgv.status IN ('flagged','failed','mismatch','discrepancy') THEN 1 ELSE 0 END) AS flagged,
         SUM(CASE WHEN bgv.status = 'breached' THEN 1 ELSE 0 END) AS breached
       FROM candidate_bgv_check bgv
       LEFT JOIN ats_candidate cand ON cand.id = bgv.candidate_id
       LEFT JOIN branch_master bm ON bm.branch_name = cand.applied_for_branch
       LEFT JOIN process_master pm ON pm.process_name = cand.applied_for_process
       WHERE ${scopeSql}`,
      scopeParams
    );

    // A `!rows[0]` fallback used to sit here reading ats_onboarding_bridge.bgv_consent_given.
    // It was unreachable (a bare aggregate always returns exactly one row) and the column
    // it referenced does not exist, so it could only ever have thrown. Removed rather than
    // left as a second broken path behind the first.

    const r = rows[0] as any;
    const pending = Number(r.pending ?? 0);
    const cleared = Number(r.cleared ?? 0);
    const flagged = Number(r.flagged ?? 0);
    const breached = Number(r.breached ?? 0);

    const status: MetricResult["status"] =
      breached > 0 || flagged > 0 ? "critical" : pending > 20 ? "warn" : "ok";

    return wrapEnriched("BGV", pending, { pending, cleared, flagged, breached }, status, false, scope.branchIds[0], scope.processIds[0], Number(r.source_rows ?? 0));
  } catch (err) {
    return nullResult("BGV", err);
  }
}

// ─── Name Mismatch ────────────────────────────────────────────────────────────
export async function getNameMismatchMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    // The previous query referenced nm.match_status and nm.is_blocking (neither exists —
    // the real columns are overall_match_status and blocks_employee_code) and scoped on
    // ats_onboarding_bridge.branch_id/process_id, which that table also lacks. Every
    // execution raised ER_BAD_FIELD_ERROR and was reported as "no data".
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "bm.id", "pm.id");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS source_rows,
         SUM(CASE WHEN nm.overall_match_status = 'mismatch' THEN 1 ELSE 0 END) AS mismatch,
         SUM(CASE WHEN nm.overall_match_status = 'partial' THEN 1 ELSE 0 END) AS partial,
         SUM(CASE WHEN nm.overall_match_status = 'pending' OR nm.overall_match_status IS NULL THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN nm.blocks_employee_code = 1 THEN 1 ELSE 0 END) AS blocking
       FROM candidate_name_match_summary nm
       LEFT JOIN ats_candidate cand ON cand.id = nm.candidate_id
       LEFT JOIN branch_master bm ON bm.branch_name = cand.applied_for_branch
       LEFT JOIN process_master pm ON pm.process_name = cand.applied_for_process
       WHERE ${scopeSql}`,
      scopeParams
    );

    const r = rows[0] as any;
    const mismatch = Number(r.mismatch ?? 0);
    const partial = Number(r.partial ?? 0);
    const pending = Number(r.pending ?? 0);
    const blocking = Number(r.blocking ?? 0);

    const status: MetricResult["status"] =
      blocking > 0 ? "critical" : mismatch > 0 ? "warn" : "ok";

    return wrapEnriched("NAME_MISMATCH", mismatch + partial, { mismatch, partial, pending, blocking }, status, false, scope.branchIds[0], scope.processIds[0], Number(r.source_rows ?? 0));
  } catch (err) {
    return nullResult("NAME_MISMATCH", err);
  }
}

// ─── Joining Document eSign ──────────────────────────────────────────────────
export async function getJoiningDocEsignMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "e.branch_id", "e.process_id");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN c.status IN ('pending_candidate_esign','esign_initiated') THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN c.status IN ('esign_completed','completed','signed_verified') THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN c.status = 'esign_failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN c.status IN ('pending_candidate_esign','esign_initiated') AND c.due_at < NOW() THEN 1 ELSE 0 END) AS overdue
       FROM employee_joining_document_checklist c
       JOIN employees e ON e.id = c.employee_id
       WHERE c.action_type = 'esign'
         AND ${scopeSql}`,
      scopeParams,
    );

    const r = rows[0] as any;
    const pending = Number(r.pending ?? 0);
    const overdue = Number(r.overdue ?? 0);
    const failed = Number(r.failed ?? 0);
    const status: MetricResult["status"] = overdue > 0 ? "critical" : failed > 0 ? "warn" : pending > 10 ? "warn" : "ok";

    return wrapEnriched(
      "JOINING_DOC_ESIGN",
      pending,
      {
        total: Number(r.total ?? 0),
        pending,
        completed: Number(r.completed ?? 0),
        failed,
        overdue,
      },
      status,
      false,
      scope.branchIds[0],
      scope.processIds[0],
    );
  } catch (err) {
    return nullResult("JOINING_DOC_ESIGN", err);
  }
}
