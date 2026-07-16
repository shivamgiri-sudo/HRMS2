import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { type DashboardScope, buildScopeWhere } from "../../shared/dashboardScope.js";
import { enrichMetric, type MetricEnrichment } from "./dashboard-target.service.js";
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
}

async function wrapEnriched(
  metricCode: string,
  value: number | null,
  detail: Record<string, number | null>,
  status: MetricResult["status"],
  higherIsBetter: boolean,
  branchId?: string | null,
  processId?: string | null,
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
    } catch { /* enrichment is best-effort */ }
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
  };
}

function nullResult(metricCode: string): MetricResult {
  return {
    value: null, previousValue: null, target: null, variance: null,
    variancePct: null, status: "unknown", trend: null,
    drilldownApi: `/api/dashboards/:dashboardCode/metric/${metricCode}/drilldown`,
    actionUrl: null, detail: {},
  };
}

// ─── Headcount ────────────────────────────────────────────────────────────────
export async function getHeadcountMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "branch_id", "process_id");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS active FROM employees WHERE employment_status = 'active' AND ${scopeSql}`,
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
    ).catch(() => [[{ required_hc: null }]] as any);

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
    ).catch(() => [[{ available_hc: null }]] as any);

    // Use scheduled/mandated HC, fall back to active headcount as baseline
    const required = reqRows[0] != null
      ? (Number((reqRows[0] as any).required_hc ?? 0) || active || null)
      : (active || null);
    const available = availRows[0] != null ? Number((availRows[0] as any).available_hc ?? 0) : null;
    const short = required != null && available != null ? required - available : null;

    const status: MetricResult["status"] = active === 0 ? "warn" : "ok";
    return wrapEnriched("HEADCOUNT", active, { active, required, available, short }, status, true, scope.branchIds[0], scope.processIds[0]);
  } catch {
    return nullResult("HEADCOUNT");
  }
}

// ─── Onboarding ───────────────────────────────────────────────────────────────
export async function getOnboardingMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "branch_id", "process_id");

    const [bridgeRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN bridge_status = 'submitted' THEN 1 ELSE 0 END) AS submitted,
         SUM(CASE WHEN bridge_status IN ('pending','initiated') THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN bridge_status = 'stuck' THEN 1 ELSE 0 END) AS stuck
       FROM ats_onboarding_bridge
       WHERE ${scopeSql}`,
      scopeParams
    ).catch(() => [[{ total: 0, submitted: 0, pending: 0, stuck: 0 }]] as any);

    const [otpRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS otp_verified FROM candidate_onboarding_profile WHERE otp_verified = 1`
    ).catch(() => [[{ otp_verified: 0 }]] as any);

    const r = bridgeRows[0] as any;
    const submitted = Number(r?.submitted ?? 0);
    const pending = Number(r?.pending ?? 0);
    const stuck = Number(r?.stuck ?? 0);
    const otpPending = Number((otpRows[0] as any)?.otp_verified ?? 0);

    const status: MetricResult["status"] = stuck > 0 ? "critical" : pending > 10 ? "warn" : "ok";
    return wrapEnriched("ONBOARDING", submitted + pending, { submitted, pending, otpPending, stuck }, status, true, scope.branchIds[0], scope.processIds[0]);
  } catch {
    return nullResult("ONBOARDING");
  }
}

// ─── Attendance ───────────────────────────────────────────────────────────────
export async function getAttendanceMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "branch_id", "process_id");

    // Use live WFM attendance sessions for real-time present count
    const [liveRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT s.employee_id) AS live_present
       FROM wfm_attendance_session s
       JOIN employees e ON e.id = s.employee_id
       WHERE DATE(s.session_date) = ${IST_DATE_EXPR}
         AND s.current_status IN ('Logged In', 'Active', 'Login', 'Rostered')
         AND ${buildScopeWhere(scope, "e.branch_id", "e.process_id").sql}`,
      buildScopeWhere(scope, "e.branch_id", "e.process_id").params
    ).catch(() => [[{ live_present: 0 }]] as any);

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
    ).catch(() => [[null]] as any);

    // Get total active employees for attendance rate calculation
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total_employees FROM employees WHERE employment_status = 'active' AND ${scopeSql}`,
      scopeParams
    ).catch(() => [[{ total_employees: 0 }]] as any);

    const livePresent = Number((liveRows[0] as any)?.live_present ?? 0);
    const totalEmployees = Number((empRows[0] as any)?.total_employees ?? 0);

    // Prefer live data, fall back to processed data
    const r = rows[0] as any;
    const processedPresent = Number(r?.present ?? 0);
    const absent = Number(r?.absent ?? 0);
    const late = Number(r?.late ?? 0);
    const missedPunch = Number(r?.missedPunch ?? 0);

    // Use live present count if available, otherwise use processed
    const present = livePresent > 0 ? livePresent : processedPresent;
    const attendanceRate = totalEmployees > 0 ? Math.round((present / totalEmployees) * 100) : null;

    const status: MetricResult["status"] =
      attendanceRate === null ? "unknown" : attendanceRate < 70 ? "critical" : attendanceRate < 85 ? "warn" : "ok";

    return wrapEnriched("ATTENDANCE", attendanceRate, { present, absent, late, missedPunch, attendanceRate }, status, true, scope.branchIds[0], scope.processIds[0]);
  } catch {
    return nullResult("ATTENDANCE");
  }
}

// ─── Payroll Readiness ────────────────────────────────────────────────────────
export async function getPayrollReadinessMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "branch_id", "process_id");

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
       FROM employees
       WHERE status = 'active' AND ${scopeSql}`,
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
      { readyCount, blockerCount, missingBank, missingPan, missingUan },
      status, true, scope.branchIds[0], scope.processIds[0]
    );
  } catch {
    return nullResult("PAYROLL_READINESS");
  }
}

// ─── Incentive ────────────────────────────────────────────────────────────────
export async function getIncentiveMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "branch_id", "process_id");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         SUM(CASE WHEN batch_status = 'pending' THEN 1 ELSE 0 END) AS pendingBatches,
         SUM(CASE WHEN batch_status = 'pending' THEN total_amount ELSE 0 END) AS pendingAmount,
         SUM(CASE WHEN batch_status = 'approved' THEN total_amount ELSE 0 END) AS approvedAmount,
         SUM(CASE WHEN batch_status = 'rejected' THEN 1 ELSE 0 END) AS rejectedBatches
       FROM incentive_upload_batch
       WHERE ${scopeSql}`,
      scopeParams
    ).catch(() => [[{ pendingBatches: 0, pendingAmount: 0, approvedAmount: 0, rejectedBatches: 0 }]] as any);

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
      status, false, scope.branchIds[0], scope.processIds[0]
    );
  } catch {
    return nullResult("INCENTIVE");
  }
}

// ─── TAT ──────────────────────────────────────────────────────────────────────
export async function getTatMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "branch_id", "process_id");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_count,
         SUM(CASE WHEN due_at < NOW() AND status NOT IN ('closed','resolved') THEN 1 ELSE 0 END) AS overdue,
         SUM(CASE WHEN status = 'sla_breached' THEN 1 ELSE 0 END) AS breached,
         AVG(CASE WHEN status NOT IN ('closed','resolved')
             THEN TIMESTAMPDIFF(HOUR, created_at, NOW()) ELSE NULL END) AS avgAgeHours
       FROM task_tat_instance
       WHERE ${scopeSql}`,
      scopeParams
    ).catch(() => [[{ open_count: 0, overdue: 0, breached: 0, avgAgeHours: null }]] as any);

    const r = rows[0] as any;
    const open = Number(r.open_count ?? 0);
    const overdue = Number(r.overdue ?? 0);
    const breached = Number(r.breached ?? 0);
    const avgAgeHours = r.avgAgeHours !== null ? Math.round(Number(r.avgAgeHours)) : null;

    const status: MetricResult["status"] =
      breached > 0 ? "critical" : overdue > 0 ? "warn" : "ok";

    return wrapEnriched("TAT", open, { open, overdue, breached, avgAgeHours }, status, false, scope.branchIds[0], scope.processIds[0]);
  } catch {
    return nullResult("TAT");
  }
}

// ─── Resignation ──────────────────────────────────────────────────────────────
export async function getResignationMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "branch_id", "process_id");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS totalActive,
         SUM(CASE WHEN exit_status = 'pending_discussion' THEN 1 ELSE 0 END) AS pendingDiscussion,
         SUM(CASE WHEN exit_status = 'accepted' THEN 1 ELSE 0 END) AS accepted,
         SUM(CASE WHEN exit_status = 'withdrawn' THEN 1 ELSE 0 END) AS withdrawn
       FROM exit_request
       WHERE exit_status NOT IN ('completed','cancelled') AND ${scopeSql}`,
      scopeParams
    ).catch(() => [[{ totalActive: 0, pendingDiscussion: 0, accepted: 0, withdrawn: 0 }]] as any);

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
  } catch {
    return nullResult("RESIGNATION");
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
    ).catch(() => [[{ total: 0, pending: 0, approved: 0, rejected: 0, holdsActive: 0, overdue: 0 }]] as any);

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
  } catch {
    return nullResult("DPDP_WITHDRAWAL");
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
    ).catch(() => [[{ total: 0, pending: 0, candidatePending: 0, companyPending: 0, overrideRequested: 0, completed: 0 }]] as any);

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
  } catch {
    return nullResult("APPOINTMENT_ESIGN");
  }
}

// ─── BGV ──────────────────────────────────────────────────────────────────────
export async function getBgvMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "b.branch_id", "b.process_id");

    // Try candidate_bgv_check joined to ats_onboarding_bridge for scope columns
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         SUM(CASE WHEN bgv.bgv_status = 'pending' OR bgv.bgv_status IS NULL THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN bgv.bgv_status = 'cleared' THEN 1 ELSE 0 END) AS cleared,
         SUM(CASE WHEN bgv.bgv_status = 'flagged' THEN 1 ELSE 0 END) AS flagged,
         SUM(CASE WHEN bgv.bgv_status = 'breached' THEN 1 ELSE 0 END) AS breached
       FROM candidate_bgv_check bgv
       LEFT JOIN ats_onboarding_bridge b ON b.candidate_id = bgv.candidate_id
       WHERE ${scopeSql}`,
      scopeParams
    ).catch(() => [[null]] as any);

    if (!rows[0]) {
      // Fallback: derive from ats_onboarding_bridge with scope
      const [bridgeRows] = await db.execute<RowDataPacket[]>(
        `SELECT
           SUM(CASE WHEN bgv_consent_given = 0 OR bgv_consent_given IS NULL THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN bgv_consent_given = 1 THEN 1 ELSE 0 END) AS cleared,
           0 AS flagged,
           0 AS breached
         FROM ats_onboarding_bridge b
         WHERE ${scopeSql}`,
        scopeParams
      ).catch(() => [[{ pending: 0, cleared: 0, flagged: 0, breached: 0 }]] as any);

      const rb = bridgeRows[0] as any;
      return wrapEnriched("BGV", Number(rb?.pending ?? 0), {
        pending: Number(rb?.pending ?? 0),
        cleared: Number(rb?.cleared ?? 0),
        flagged: 0,
        breached: 0,
      }, "ok", false, scope.branchIds[0], scope.processIds[0]);
    }

    const r = rows[0] as any;
    const pending = Number(r.pending ?? 0);
    const cleared = Number(r.cleared ?? 0);
    const flagged = Number(r.flagged ?? 0);
    const breached = Number(r.breached ?? 0);

    const status: MetricResult["status"] =
      breached > 0 || flagged > 0 ? "critical" : pending > 20 ? "warn" : "ok";

    return wrapEnriched("BGV", pending, { pending, cleared, flagged, breached }, status, false, scope.branchIds[0], scope.processIds[0]);
  } catch {
    return nullResult("BGV");
  }
}

// ─── Name Mismatch ────────────────────────────────────────────────────────────
export async function getNameMismatchMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(scope, "b.branch_id", "b.process_id");

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         SUM(CASE WHEN nm.match_status = 'mismatch' THEN 1 ELSE 0 END) AS mismatch,
         SUM(CASE WHEN nm.match_status = 'partial' THEN 1 ELSE 0 END) AS partial,
         SUM(CASE WHEN nm.match_status = 'pending' OR nm.match_status IS NULL THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN nm.is_blocking = 1 THEN 1 ELSE 0 END) AS blocking
       FROM candidate_name_match_summary nm
       LEFT JOIN ats_onboarding_bridge b ON b.candidate_id = nm.candidate_id
       WHERE ${scopeSql}`,
      scopeParams
    ).catch(() => [[{ mismatch: 0, partial: 0, pending: 0, blocking: 0 }]] as any);

    const r = rows[0] as any;
    const mismatch = Number(r.mismatch ?? 0);
    const partial = Number(r.partial ?? 0);
    const pending = Number(r.pending ?? 0);
    const blocking = Number(r.blocking ?? 0);

    const status: MetricResult["status"] =
      blocking > 0 ? "critical" : mismatch > 0 ? "warn" : "ok";

    return wrapEnriched("NAME_MISMATCH", mismatch + partial, { mismatch, partial, pending, blocking }, status, false, scope.branchIds[0], scope.processIds[0]);
  } catch {
    return nullResult("NAME_MISMATCH");
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
    ).catch(() => [[{ total: 0, pending: 0, completed: 0, failed: 0, overdue: 0 }]] as any);

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
  } catch {
    return nullResult("JOINING_DOC_ESIGN");
  }
}
