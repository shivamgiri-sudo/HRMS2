import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import {
  type DashboardScope,
  buildScopeWhere,
  buildScopeWhereEmployees,
} from "../../shared/dashboardScope.js";
import { enrichMetric, type MetricEnrichment } from "./dashboard-target.service.js";
import { IST_DATE_EXPR } from "../../utils/dateUtils.js";

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

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
    previousValue: null,
    target: null,
    variance: null,
    variancePct: null,
    trend: undefined,
    status: undefined,
  };

  if (value !== null) {
    try {
      enrichment = await enrichMetric(metricCode, value, "monthly", higherIsBetter, branchId, processId);
      if (enrichment.target !== null && enrichment.status && enrichment.status !== "unknown") {
        const map: Record<string, MetricResult["status"]> = {
          good: "ok",
          warning: "warn",
          critical: "critical",
          unknown: "unknown",
        };
        status = map[enrichment.status] ?? status;
      }
    } catch {
      // Target enrichment must never hide the live metric.
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
  };
}

function nullResult(metricCode: string): MetricResult {
  return {
    value: null,
    previousValue: null,
    target: null,
    variance: null,
    variancePct: null,
    status: "unknown",
    trend: null,
    drilldownApi: `/api/dashboards/:dashboardCode/metric/${metricCode}/drilldown`,
    actionUrl: null,
    detail: {},
  };
}

function primaryScope(scope: DashboardScope): { branchId: string | null; processId: string | null } {
  return {
    branchId: scope.branchIds[0] ?? null,
    processId: scope.processIds[0] ?? null,
  };
}

export async function getHeadcountMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const employeeScope = buildScopeWhereEmployees(scope, "e");
    const [activeRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS active
         FROM employees e
        WHERE e.active_status = 1
          AND LOWER(COALESCE(e.employment_status, 'active')) NOT IN ('inactive','terminated','resigned','exited','absconded')
          AND ${employeeScope.sql}`,
      employeeScope.params,
    );
    const active = Number((activeRows[0] as any)?.active ?? 0);

    const requirementScope = buildScopeWhere(scope, "ws.branch_id", "ws.process_id");
    const mandateScope = buildScopeWhere(scope, "wm.branch_id", "wm.process_id");
    const [requiredRows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(
          NULLIF((
            SELECT SUM(ws.required_planned_hc)
              FROM wfm_slot_requirement ws
             WHERE ws.requirement_date = ${IST_DATE_EXPR}
               AND ${requirementScope.sql}
          ), 0),
          NULLIF((
            SELECT SUM(CEIL(wm.mandated_hc * (1 + COALESCE(wm.shrinkage_pct, 0) / 100)))
              FROM workforce_mandate wm
             WHERE wm.active_status = 1
               AND ${mandateScope.sql}
          ), 0)
        ) AS required_hc`,
      [...requirementScope.params, ...mandateScope.params],
    ).catch(() => [[{ required_hc: null }]] as any);

    const dailyScope = buildScopeWhereEmployees(scope, "e");
    const sessionScope = buildScopeWhereEmployees(scope, "e2");
    const [availableRows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(
          NULLIF((
            SELECT COUNT(DISTINCT adr.employee_id)
              FROM attendance_daily_record adr
              JOIN employees e ON e.id = adr.employee_id
             WHERE adr.record_date = ${IST_DATE_EXPR}
               AND adr.attendance_status IN ('present','half_day','week_off_worked')
               AND e.active_status = 1
               AND ${dailyScope.sql}
          ), 0),
          (
            SELECT COUNT(DISTINCT was.employee_id)
              FROM wfm_attendance_session was
              JOIN employees e2 ON e2.id = was.employee_id
             WHERE was.session_date = ${IST_DATE_EXPR}
               AND COALESCE(was.total_login_minutes, 0) > 0
               AND e2.active_status = 1
               AND ${sessionScope.sql}
          )
        ) AS available_hc`,
      [...dailyScope.params, ...sessionScope.params],
    ).catch(() => [[{ available_hc: null }]] as any);

    const required = asNumber((requiredRows[0] as any)?.required_hc);
    const available = asNumber((availableRows[0] as any)?.available_hc);
    const short = required !== null && available !== null ? Math.max(0, required - available) : null;
    const scopeIds = primaryScope(scope);

    return wrapEnriched(
      "HEADCOUNT",
      active,
      { active, required, available, short },
      active > 0 ? "ok" : "warn",
      true,
      scopeIds.branchId,
      scopeIds.processId,
    );
  } catch (error) {
    console.error("[dashboard-metric] headcount failed", error);
    return nullResult("HEADCOUNT");
  }
}

export async function getOnboardingMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const scoped = buildScopeWhere(scope, "b.branch_id", "b.process_id");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN b.bridge_status IN ('submitted','completed') THEN 1 ELSE 0 END) AS submitted,
         SUM(CASE WHEN b.bridge_status IN ('pending','initiated','in_progress') THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN b.bridge_status = 'stuck'
                    OR (b.bridge_status IN ('pending','initiated','in_progress') AND b.updated_at < DATE_SUB(NOW(), INTERVAL 3 DAY))
                  THEN 1 ELSE 0 END) AS stuck
       FROM ats_onboarding_bridge b
       WHERE ${scoped.sql}`,
      scoped.params,
    ).catch(() => [[{ total: 0, submitted: 0, pending: 0, stuck: 0 }]] as any);

    const row = rows[0] as any;
    const submitted = Number(row?.submitted ?? 0);
    const pending = Number(row?.pending ?? 0);
    const stuck = Number(row?.stuck ?? 0);
    const total = Number(row?.total ?? 0);
    const scopeIds = primaryScope(scope);

    return wrapEnriched(
      "ONBOARDING",
      pending,
      { total, submitted, pending, stuck },
      stuck > 0 ? "critical" : pending > 10 ? "warn" : "ok",
      false,
      scopeIds.branchId,
      scopeIds.processId,
    );
  } catch (error) {
    console.error("[dashboard-metric] onboarding failed", error);
    return nullResult("ONBOARDING");
  }
}

export async function getAttendanceMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const scoped = buildScopeWhereEmployees(scope, "e");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(DISTINCT CASE WHEN adr.attendance_status IN ('present','week_off_worked') THEN adr.employee_id END) AS present,
         COUNT(DISTINCT CASE WHEN adr.attendance_status = 'half_day' THEN adr.employee_id END) AS halfDay,
         COUNT(DISTINCT CASE WHEN adr.attendance_status = 'absent' THEN adr.employee_id END) AS absent,
         COUNT(DISTINCT CASE WHEN adr.attendance_status = 'missing_punch' THEN adr.employee_id END) AS missedPunch,
         COUNT(DISTINCT CASE WHEN adr.attendance_status = 'leave_approved' THEN adr.employee_id END) AS onLeave,
         COUNT(DISTINCT CASE WHEN adr.late_mark = 1 THEN adr.employee_id END) AS late,
         COUNT(DISTINCT adr.employee_id) AS marked
       FROM attendance_daily_record adr
       JOIN employees e ON e.id = adr.employee_id
       WHERE adr.record_date = ${IST_DATE_EXPR}
         AND e.active_status = 1
         AND ${scoped.sql}`,
      scoped.params,
    ).catch(() => [[null]] as any);

    const [populationRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS population
         FROM employees e
        WHERE e.active_status = 1
          AND LOWER(COALESCE(e.employment_status, 'active')) NOT IN ('inactive','terminated','resigned','exited','absconded')
          AND ${scoped.sql}`,
      scoped.params,
    ).catch(() => [[{ population: 0 }]] as any);

    if (!rows[0]) return nullResult("ATTENDANCE");
    const row = rows[0] as any;
    const present = Number(row.present ?? 0);
    const halfDay = Number(row.halfDay ?? 0);
    const absent = Number(row.absent ?? 0);
    const missedPunch = Number(row.missedPunch ?? 0);
    const onLeave = Number(row.onLeave ?? 0);
    const late = Number(row.late ?? 0);
    const marked = Number(row.marked ?? 0);
    const population = Number((populationRows[0] as any)?.population ?? 0);
    const attendanceEquivalent = present + halfDay * 0.5;
    const denominator = population > 0 ? population : marked;
    const attendanceRate = denominator > 0 ? Math.round((attendanceEquivalent / denominator) * 1000) / 10 : null;
    const notMarked = Math.max(0, population - marked);
    const scopeIds = primaryScope(scope);

    return wrapEnriched(
      "ATTENDANCE",
      attendanceRate,
      { present, halfDay, absent, late, missedPunch, onLeave, marked, population, notMarked, attendanceRate },
      attendanceRate === null ? "unknown" : attendanceRate < 70 ? "critical" : attendanceRate < 85 ? "warn" : "ok",
      true,
      scopeIds.branchId,
      scopeIds.processId,
    );
  } catch (error) {
    console.error("[dashboard-metric] attendance failed", error);
    return nullResult("ATTENDANCE");
  }
}

export async function getPayrollReadinessMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const scoped = buildScopeWhereEmployees(scope, "e");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN COALESCE(TRIM(e.bank_account_number), '') = '' THEN 1 ELSE 0 END) AS missingBank,
         SUM(CASE WHEN COALESCE(TRIM(e.pan_number), '') = '' THEN 1 ELSE 0 END) AS missingPan,
         SUM(CASE WHEN COALESCE(TRIM(e.uan_number), '') = '' THEN 1 ELSE 0 END) AS missingUan,
         SUM(CASE WHEN COALESCE(TRIM(e.bank_account_number), '') <> ''
                       AND COALESCE(TRIM(e.pan_number), '') <> ''
                       AND COALESCE(TRIM(e.uan_number), '') <> ''
                  THEN 1 ELSE 0 END) AS readyCount
       FROM employees e
       WHERE e.active_status = 1
         AND LOWER(COALESCE(e.employment_status, 'active')) NOT IN ('inactive','terminated','resigned','exited','absconded')
         AND ${scoped.sql}`,
      scoped.params,
    );

    const row = rows[0] as any;
    const total = Number(row?.total ?? 0);
    const readyCount = Number(row?.readyCount ?? 0);
    const missingBank = Number(row?.missingBank ?? 0);
    const missingPan = Number(row?.missingPan ?? 0);
    const missingUan = Number(row?.missingUan ?? 0);
    const blockerCount = Math.max(0, total - readyCount);
    const readinessPct = total > 0 ? Math.round((readyCount / total) * 1000) / 10 : null;
    const scopeIds = primaryScope(scope);

    return wrapEnriched(
      "PAYROLL_READINESS",
      readyCount,
      { total, readyCount, blockerCount, missingBank, missingPan, missingUan, readinessPct },
      blockerCount === 0 ? "ok" : blockerCount > 10 ? "critical" : "warn",
      true,
      scopeIds.branchId,
      scopeIds.processId,
    );
  } catch (error) {
    console.error("[dashboard-metric] payroll readiness failed", error);
    return nullResult("PAYROLL_READINESS");
  }
}

export async function getIncentiveMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const scoped = buildScopeWhere(scope, "i.branch_id", "i.process_id");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         SUM(CASE WHEN i.batch_status = 'pending' THEN 1 ELSE 0 END) AS pendingBatches,
         SUM(CASE WHEN i.batch_status = 'pending' THEN COALESCE(i.total_amount, 0) ELSE 0 END) AS pendingAmount,
         SUM(CASE WHEN i.batch_status = 'approved' THEN COALESCE(i.total_amount, 0) ELSE 0 END) AS approvedAmount,
         SUM(CASE WHEN i.batch_status = 'rejected' THEN 1 ELSE 0 END) AS rejectedBatches
       FROM incentive_upload_batch i
       WHERE ${scoped.sql}`,
      scoped.params,
    ).catch(() => [[{ pendingBatches: 0, pendingAmount: 0, approvedAmount: 0, rejectedBatches: 0 }]] as any);

    const row = rows[0] as any;
    const pendingBatches = Number(row?.pendingBatches ?? 0);
    const pendingAmount = Number(row?.pendingAmount ?? 0);
    const approvedAmount = Number(row?.approvedAmount ?? 0);
    const rejectedBatches = Number(row?.rejectedBatches ?? 0);
    const scopeIds = primaryScope(scope);

    return wrapEnriched(
      "INCENTIVE",
      pendingBatches,
      { pendingBatches, pendingAmount, approvedAmount, rejectedBatches },
      rejectedBatches > 0 || pendingBatches > 5 ? "warn" : "ok",
      false,
      scopeIds.branchId,
      scopeIds.processId,
    );
  } catch (error) {
    console.error("[dashboard-metric] incentive failed", error);
    return nullResult("INCENTIVE");
  }
}

export async function getTatMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const scoped = buildScopeWhere(scope, "t.branch_id", "t.process_id");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         SUM(CASE WHEN t.status = 'open' THEN 1 ELSE 0 END) AS open_count,
         SUM(CASE WHEN t.due_at < NOW() AND t.status NOT IN ('closed','resolved') THEN 1 ELSE 0 END) AS overdue,
         SUM(CASE WHEN t.status = 'sla_breached' THEN 1 ELSE 0 END) AS breached,
         AVG(CASE WHEN t.status NOT IN ('closed','resolved') THEN TIMESTAMPDIFF(HOUR, t.created_at, NOW()) END) AS avgAgeHours
       FROM task_tat_instance t
       WHERE ${scoped.sql}`,
      scoped.params,
    ).catch(() => [[{ open_count: 0, overdue: 0, breached: 0, avgAgeHours: null }]] as any);

    const row = rows[0] as any;
    const open = Number(row?.open_count ?? 0);
    const overdue = Number(row?.overdue ?? 0);
    const breached = Number(row?.breached ?? 0);
    const avgAgeHours = asNumber(row?.avgAgeHours);
    const scopeIds = primaryScope(scope);

    return wrapEnriched(
      "TAT",
      breached,
      { open, overdue, breached, avgAgeHours },
      breached > 0 ? "critical" : overdue > 0 ? "warn" : "ok",
      false,
      scopeIds.branchId,
      scopeIds.processId,
    );
  } catch (error) {
    console.error("[dashboard-metric] TAT failed", error);
    return nullResult("TAT");
  }
}

export async function getResignationMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const scoped = buildScopeWhereEmployees(scope, "e");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS totalActive,
         SUM(CASE WHEN er.exit_status = 'pending_discussion' THEN 1 ELSE 0 END) AS pendingDiscussion,
         SUM(CASE WHEN er.exit_status = 'accepted' THEN 1 ELSE 0 END) AS accepted,
         SUM(CASE WHEN er.exit_status = 'withdrawn' THEN 1 ELSE 0 END) AS withdrawn
       FROM exit_request er
       JOIN employees e ON e.id = er.employee_id
       WHERE er.exit_status NOT IN ('completed','cancelled')
         AND ${scoped.sql}`,
      scoped.params,
    ).catch(() => [[{ totalActive: 0, pendingDiscussion: 0, accepted: 0, withdrawn: 0 }]] as any);

    const row = rows[0] as any;
    const totalActive = Number(row?.totalActive ?? 0);
    const pendingDiscussion = Number(row?.pendingDiscussion ?? 0);
    const accepted = Number(row?.accepted ?? 0);
    const withdrawn = Number(row?.withdrawn ?? 0);
    const scopeIds = primaryScope(scope);

    return wrapEnriched(
      "RESIGNATION",
      pendingDiscussion,
      { pendingDiscussion, accepted, withdrawn, totalActive },
      pendingDiscussion > 5 ? "critical" : pendingDiscussion > 0 ? "warn" : "ok",
      false,
      scopeIds.branchId,
      scopeIds.processId,
    );
  } catch (error) {
    console.error("[dashboard-metric] resignation failed", error);
    return nullResult("RESIGNATION");
  }
}

export async function getDpdpWithdrawalMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const scoped = buildScopeWhereEmployees(scope, "e");
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
       WHERE ${scoped.sql}`,
      scoped.params,
    ).catch(() => [[{ total: 0, pending: 0, approved: 0, rejected: 0, holdsActive: 0, overdue: 0 }]] as any);

    const row = rows[0] as any;
    const pending = Number(row?.pending ?? 0);
    const overdue = Number(row?.overdue ?? 0);
    const scopeIds = primaryScope(scope);

    return wrapEnriched(
      "DPDP_WITHDRAWAL",
      pending,
      {
        total: Number(row?.total ?? 0),
        pending,
        approved: Number(row?.approved ?? 0),
        rejected: Number(row?.rejected ?? 0),
        holdsActive: Number(row?.holdsActive ?? 0),
        overdue,
      },
      overdue > 0 ? "critical" : pending > 0 ? "warn" : "ok",
      false,
      scopeIds.branchId,
      scopeIds.processId,
    );
  } catch (error) {
    console.error("[dashboard-metric] DPDP failed", error);
    return nullResult("DPDP_WITHDRAWAL");
  }
}

export async function getAppointmentEsignMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const scoped = buildScopeWhereEmployees(scope, "e");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN alr.current_state IN ('candidate_esign_pending','company_sign_pending','override_requested')
                       OR alr.candidate_esign_status = 'pending'
                       OR alr.company_sign_status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN alr.current_state = 'candidate_esign_pending' OR alr.candidate_esign_status = 'pending' THEN 1 ELSE 0 END) AS candidatePending,
         SUM(CASE WHEN alr.current_state = 'company_sign_pending' OR alr.company_sign_status = 'pending' THEN 1 ELSE 0 END) AS companyPending,
         SUM(CASE WHEN alr.current_state = 'override_requested' THEN 1 ELSE 0 END) AS overrideRequested,
         SUM(CASE WHEN alr.current_state IN ('completed','locked') OR alr.pdf_locked = 1 THEN 1 ELSE 0 END) AS completed
       FROM appointment_letter_request alr
       LEFT JOIN employees e ON e.id = alr.employee_id
       WHERE ${scoped.sql}`,
      scoped.params,
    ).catch(() => [[{ total: 0, pending: 0, candidatePending: 0, companyPending: 0, overrideRequested: 0, completed: 0 }]] as any);

    const row = rows[0] as any;
    const pending = Number(row?.pending ?? 0);
    const overrideRequested = Number(row?.overrideRequested ?? 0);
    const scopeIds = primaryScope(scope);

    return wrapEnriched(
      "APPOINTMENT_ESIGN",
      pending,
      {
        total: Number(row?.total ?? 0),
        pending,
        candidatePending: Number(row?.candidatePending ?? 0),
        companyPending: Number(row?.companyPending ?? 0),
        overrideRequested,
        completed: Number(row?.completed ?? 0),
      },
      overrideRequested > 0 || pending > 10 ? "warn" : "ok",
      false,
      scopeIds.branchId,
      scopeIds.processId,
    );
  } catch (error) {
    console.error("[dashboard-metric] appointment eSign failed", error);
    return nullResult("APPOINTMENT_ESIGN");
  }
}

export async function getBgvMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const scoped = buildScopeWhere(scope, "b.branch_id", "b.process_id");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         SUM(CASE WHEN bgv.bgv_status = 'pending' OR bgv.bgv_status IS NULL THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN bgv.bgv_status = 'cleared' THEN 1 ELSE 0 END) AS cleared,
         SUM(CASE WHEN bgv.bgv_status = 'flagged' THEN 1 ELSE 0 END) AS flagged,
         SUM(CASE WHEN bgv.bgv_status = 'breached' THEN 1 ELSE 0 END) AS breached
       FROM candidate_bgv_check bgv
       LEFT JOIN ats_onboarding_bridge b ON b.candidate_id = bgv.candidate_id
       WHERE ${scoped.sql}`,
      scoped.params,
    ).catch(() => [[{ pending: 0, cleared: 0, flagged: 0, breached: 0 }]] as any);

    const row = rows[0] as any;
    const pending = Number(row?.pending ?? 0);
    const cleared = Number(row?.cleared ?? 0);
    const flagged = Number(row?.flagged ?? 0);
    const breached = Number(row?.breached ?? 0);
    const scopeIds = primaryScope(scope);

    return wrapEnriched(
      "BGV",
      pending,
      { pending, cleared, flagged, breached },
      breached > 0 || flagged > 0 ? "critical" : pending > 20 ? "warn" : "ok",
      false,
      scopeIds.branchId,
      scopeIds.processId,
    );
  } catch (error) {
    console.error("[dashboard-metric] BGV failed", error);
    return nullResult("BGV");
  }
}

export async function getNameMismatchMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const scoped = buildScopeWhere(scope, "b.branch_id", "b.process_id");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         SUM(CASE WHEN nm.match_status = 'mismatch' THEN 1 ELSE 0 END) AS mismatch,
         SUM(CASE WHEN nm.match_status = 'partial' THEN 1 ELSE 0 END) AS partial,
         SUM(CASE WHEN nm.match_status = 'pending' OR nm.match_status IS NULL THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN nm.is_blocking = 1 THEN 1 ELSE 0 END) AS blocking
       FROM candidate_name_match_summary nm
       LEFT JOIN ats_onboarding_bridge b ON b.candidate_id = nm.candidate_id
       WHERE ${scoped.sql}`,
      scoped.params,
    ).catch(() => [[{ mismatch: 0, partial: 0, pending: 0, blocking: 0 }]] as any);

    const row = rows[0] as any;
    const mismatch = Number(row?.mismatch ?? 0);
    const partial = Number(row?.partial ?? 0);
    const pending = Number(row?.pending ?? 0);
    const blocking = Number(row?.blocking ?? 0);
    const scopeIds = primaryScope(scope);

    return wrapEnriched(
      "NAME_MISMATCH",
      blocking,
      { mismatch, partial, pending, blocking },
      blocking > 0 ? "critical" : mismatch > 0 ? "warn" : "ok",
      false,
      scopeIds.branchId,
      scopeIds.processId,
    );
  } catch (error) {
    console.error("[dashboard-metric] name mismatch failed", error);
    return nullResult("NAME_MISMATCH");
  }
}

export async function getJoiningDocEsignMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const scoped = buildScopeWhereEmployees(scope, "e");
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
         AND ${scoped.sql}`,
      scoped.params,
    ).catch(() => [[{ total: 0, pending: 0, completed: 0, failed: 0, overdue: 0 }]] as any);

    const row = rows[0] as any;
    const pending = Number(row?.pending ?? 0);
    const failed = Number(row?.failed ?? 0);
    const overdue = Number(row?.overdue ?? 0);
    const scopeIds = primaryScope(scope);

    return wrapEnriched(
      "JOINING_DOC_ESIGN",
      pending,
      {
        total: Number(row?.total ?? 0),
        pending,
        completed: Number(row?.completed ?? 0),
        failed,
        overdue,
      },
      overdue > 0 ? "critical" : failed > 0 || pending > 10 ? "warn" : "ok",
      false,
      scopeIds.branchId,
      scopeIds.processId,
    );
  } catch (error) {
    console.error("[dashboard-metric] joining document eSign failed", error);
    return nullResult("JOINING_DOC_ESIGN");
  }
}
