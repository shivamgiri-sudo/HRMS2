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
  available: boolean;
  errorCode: string | null;
}

const columnCache = new Map<string, Set<string>>();

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function tableColumns(table: string): Promise<Set<string>> {
  const cached = columnCache.get(table);
  if (cached) return cached;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ?`,
    [table],
  );
  const columns = new Set(rows.map((row) => String(row.column_name)));
  columnCache.set(table, columns);
  return columns;
}

async function requireColumns(table: string, columns: readonly string[]): Promise<boolean> {
  const available = await tableColumns(table);
  return columns.every((column) => available.has(column));
}

function primaryScope(scope: DashboardScope): { branchId: string | null; processId: string | null } {
  return {
    branchId: scope.branchIds[0] ?? null,
    processId: scope.processIds[0] ?? null,
  };
}

async function result(
  metricCode: string,
  value: number | null,
  detail: Record<string, number | null>,
  status: MetricResult["status"],
  higherIsBetter: boolean,
  scope: DashboardScope,
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
      const ids = primaryScope(scope);
      enrichment = await enrichMetric(metricCode, value, "monthly", higherIsBetter, ids.branchId, ids.processId);
      if (enrichment.target !== null && enrichment.status && enrichment.status !== "unknown") {
        const statusMap: Record<string, MetricResult["status"]> = {
          good: "ok",
          warning: "warn",
          critical: "critical",
          unknown: "unknown",
        };
        status = statusMap[enrichment.status] ?? status;
      }
    } catch {
      // Targets are optional and must never hide a live value.
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
    available: true,
    errorCode: null,
  };
}

function unavailable(metricCode: string, errorCode = "SOURCE_QUERY_FAILED"): MetricResult {
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
    available: false,
    errorCode: `${metricCode}_${errorCode}`,
  };
}

function logFailure(metric: string, error: unknown): void {
  console.error(`[dashboard-metric] ${metric} failed`, error instanceof Error ? error.message : error);
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

    let required: number | null = null;
    if (await requireColumns("wfm_slot_requirement", ["requirement_date", "required_planned_hc", "branch_id", "process_id"])) {
      const scoped = buildScopeWhere(scope, "ws.branch_id", "ws.process_id");
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT SUM(ws.required_planned_hc) AS required_hc
           FROM wfm_slot_requirement ws
          WHERE ws.requirement_date = ${IST_DATE_EXPR} AND ${scoped.sql}`,
        scoped.params,
      );
      required = numberOrNull((rows[0] as any)?.required_hc);
    }

    const attendanceScope = buildScopeWhereEmployees(scope, "e");
    const [availableRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT adr.employee_id) AS available_hc
         FROM attendance_daily_record adr
         JOIN employees e ON e.id = adr.employee_id
        WHERE adr.record_date = ${IST_DATE_EXPR}
          AND adr.attendance_status IN ('present','half_day','week_off_worked')
          AND e.active_status = 1
          AND ${attendanceScope.sql}`,
      attendanceScope.params,
    );
    const available = Number((availableRows[0] as any)?.available_hc ?? 0);
    const short = required === null ? null : Math.max(0, required - available);

    return result("HEADCOUNT", active, { active, required, available, short }, active > 0 ? "ok" : "warn", true, scope);
  } catch (error) {
    logFailure("headcount", error);
    return unavailable("HEADCOUNT");
  }
}

export async function getOnboardingMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    if (!await requireColumns("ats_onboarding_bridge", ["status", "employee_id", "created_at"])) {
      return unavailable("ONBOARDING", "SCHEMA_MISMATCH");
    }

    const scoped = buildScopeWhereEmployees(scope, "e");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN LOWER(COALESCE(b.status,'')) IN ('submitted','completed','approved','joined') THEN 1 ELSE 0 END) AS submitted,
         SUM(CASE WHEN LOWER(COALESCE(b.status,'pending')) IN ('pending','initiated','in_progress','token_sent') THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN LOWER(COALESCE(b.status,'')) = 'stuck'
                   OR (LOWER(COALESCE(b.status,'pending')) IN ('pending','initiated','in_progress','token_sent')
                       AND b.created_at < DATE_SUB(NOW(), INTERVAL 3 DAY))
                  THEN 1 ELSE 0 END) AS stuck
       FROM ats_onboarding_bridge b
       LEFT JOIN employees e ON e.id = b.employee_id
       WHERE ${scoped.sql}`,
      scoped.params,
    );

    const row = rows[0] as any;
    const total = Number(row?.total ?? 0);
    const submitted = Number(row?.submitted ?? 0);
    const pending = Number(row?.pending ?? 0);
    const stuck = Number(row?.stuck ?? 0);

    return result("ONBOARDING", pending, { total, submitted, pending, stuck }, stuck > 0 ? "critical" : pending > 10 ? "warn" : "ok", false, scope);
  } catch (error) {
    logFailure("onboarding", error);
    return unavailable("ONBOARDING");
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
         COUNT(DISTINCT CASE WHEN adr.attendance_status IN ('missing_punch','unreconciled') THEN adr.employee_id END) AS missedPunch,
         COUNT(DISTINCT CASE WHEN adr.attendance_status = 'leave_approved' THEN adr.employee_id END) AS onLeave,
         COUNT(DISTINCT CASE WHEN adr.late_mark = 1 THEN adr.employee_id END) AS late,
         COUNT(DISTINCT adr.employee_id) AS marked
       FROM attendance_daily_record adr
       JOIN employees e ON e.id = adr.employee_id
       WHERE adr.record_date = ${IST_DATE_EXPR}
         AND e.active_status = 1
         AND ${scoped.sql}`,
      scoped.params,
    );

    const [populationRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS population
         FROM employees e
        WHERE e.active_status = 1
          AND LOWER(COALESCE(e.employment_status, 'active')) NOT IN ('inactive','terminated','resigned','exited','absconded')
          AND ${scoped.sql}`,
      scoped.params,
    );

    const row = rows[0] as any;
    const present = Number(row?.present ?? 0);
    const halfDay = Number(row?.halfDay ?? 0);
    const absent = Number(row?.absent ?? 0);
    const missedPunch = Number(row?.missedPunch ?? 0);
    const onLeave = Number(row?.onLeave ?? 0);
    const late = Number(row?.late ?? 0);
    const marked = Number(row?.marked ?? 0);
    const population = Number((populationRows[0] as any)?.population ?? 0);
    const denominator = population > 0 ? population : marked;
    const attendanceRate = denominator > 0 ? Math.round(((present + halfDay * 0.5) / denominator) * 1000) / 10 : 0;
    const notMarked = Math.max(0, population - marked);

    return result(
      "ATTENDANCE",
      attendanceRate,
      { present, halfDay, absent, late, missedPunch, onLeave, marked, population, notMarked, attendanceRate },
      attendanceRate < 70 ? "critical" : attendanceRate < 85 ? "warn" : "ok",
      true,
      scope,
    );
  } catch (error) {
    logFailure("attendance", error);
    return unavailable("ATTENDANCE");
  }
}

export async function getPayrollReadinessMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const employeeColumns = await tableColumns("employees");
    const required = ["bank_account_number", "pan_number", "uan_number"];
    if (!required.every((column) => employeeColumns.has(column))) {
      return unavailable("PAYROLL_READINESS", "SCHEMA_MISMATCH");
    }

    const scoped = buildScopeWhereEmployees(scope, "e");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN COALESCE(TRIM(e.bank_account_number),'') = '' THEN 1 ELSE 0 END) AS missingBank,
         SUM(CASE WHEN COALESCE(TRIM(e.pan_number),'') = '' THEN 1 ELSE 0 END) AS missingPan,
         SUM(CASE WHEN COALESCE(TRIM(e.uan_number),'') = '' THEN 1 ELSE 0 END) AS missingUan,
         SUM(CASE WHEN COALESCE(TRIM(e.bank_account_number),'') <> ''
                       AND COALESCE(TRIM(e.pan_number),'') <> ''
                       AND COALESCE(TRIM(e.uan_number),'') <> '' THEN 1 ELSE 0 END) AS readyCount
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
    const readinessPct = total > 0 ? Math.round((readyCount / total) * 1000) / 10 : 0;

    return result("PAYROLL_READINESS", readyCount, { total, readyCount, blockerCount, missingBank, missingPan, missingUan, readinessPct }, blockerCount > 10 ? "critical" : blockerCount > 0 ? "warn" : "ok", true, scope);
  } catch (error) {
    logFailure("payroll readiness", error);
    return unavailable("PAYROLL_READINESS");
  }
}

export async function getIncentiveMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    if (!await requireColumns("incentive_upload_batch", ["batch_status", "total_amount", "branch_id", "process_id"])) {
      return unavailable("INCENTIVE", "SOURCE_NOT_CONFIGURED");
    }
    const scoped = buildScopeWhere(scope, "i.branch_id", "i.process_id");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         SUM(CASE WHEN i.batch_status = 'pending' THEN 1 ELSE 0 END) AS pendingBatches,
         SUM(CASE WHEN i.batch_status = 'pending' THEN COALESCE(i.total_amount,0) ELSE 0 END) AS pendingAmount,
         SUM(CASE WHEN i.batch_status = 'approved' THEN COALESCE(i.total_amount,0) ELSE 0 END) AS approvedAmount,
         SUM(CASE WHEN i.batch_status = 'rejected' THEN 1 ELSE 0 END) AS rejectedBatches
       FROM incentive_upload_batch i WHERE ${scoped.sql}`,
      scoped.params,
    );
    const row = rows[0] as any;
    const pendingBatches = Number(row?.pendingBatches ?? 0);
    const pendingAmount = Number(row?.pendingAmount ?? 0);
    const approvedAmount = Number(row?.approvedAmount ?? 0);
    const rejectedBatches = Number(row?.rejectedBatches ?? 0);
    return result("INCENTIVE", pendingBatches, { pendingBatches, pendingAmount, approvedAmount, rejectedBatches }, rejectedBatches > 0 || pendingBatches > 5 ? "warn" : "ok", false, scope);
  } catch (error) {
    logFailure("incentive", error);
    return unavailable("INCENTIVE");
  }
}

export async function getTatMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    if (!await requireColumns("task_tat_instance", ["status", "due_at", "created_at", "branch_id", "process_id"])) {
      return unavailable("TAT", "SOURCE_NOT_CONFIGURED");
    }
    const scoped = buildScopeWhere(scope, "t.branch_id", "t.process_id");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         SUM(CASE WHEN t.status = 'open' THEN 1 ELSE 0 END) AS openCount,
         SUM(CASE WHEN t.due_at < NOW() AND t.status NOT IN ('closed','resolved') THEN 1 ELSE 0 END) AS overdue,
         SUM(CASE WHEN t.status = 'sla_breached' THEN 1 ELSE 0 END) AS breached,
         AVG(CASE WHEN t.status NOT IN ('closed','resolved') THEN TIMESTAMPDIFF(HOUR,t.created_at,NOW()) END) AS avgAgeHours
       FROM task_tat_instance t WHERE ${scoped.sql}`,
      scoped.params,
    );
    const row = rows[0] as any;
    const open = Number(row?.openCount ?? 0);
    const overdue = Number(row?.overdue ?? 0);
    const breached = Number(row?.breached ?? 0);
    const avgAgeHours = numberOrNull(row?.avgAgeHours);
    return result("TAT", breached, { open, overdue, breached, avgAgeHours }, breached > 0 ? "critical" : overdue > 0 ? "warn" : "ok", false, scope);
  } catch (error) {
    logFailure("TAT", error);
    return unavailable("TAT");
  }
}

export async function getResignationMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    if (!await requireColumns("exit_request", ["employee_id", "status"])) {
      return unavailable("RESIGNATION", "SCHEMA_MISMATCH");
    }
    const scoped = buildScopeWhereEmployees(scope, "e");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS totalActive,
         SUM(CASE WHEN LOWER(er.status) IN ('draft','submitted','manager_review','manager_discussion','pending_discussion') THEN 1 ELSE 0 END) AS pendingDiscussion,
         SUM(CASE WHEN LOWER(er.status) IN ('accepted','approved','confirmed','notice_period') THEN 1 ELSE 0 END) AS accepted,
         SUM(CASE WHEN LOWER(er.status) IN ('withdrawn','revoked') THEN 1 ELSE 0 END) AS withdrawn
       FROM exit_request er
       JOIN employees e ON e.id = er.employee_id
       WHERE LOWER(er.status) NOT IN ('completed','cancelled','rejected') AND ${scoped.sql}`,
      scoped.params,
    );
    const row = rows[0] as any;
    const totalActive = Number(row?.totalActive ?? 0);
    const pendingDiscussion = Number(row?.pendingDiscussion ?? 0);
    const accepted = Number(row?.accepted ?? 0);
    const withdrawn = Number(row?.withdrawn ?? 0);
    return result("RESIGNATION", pendingDiscussion, { pendingDiscussion, accepted, withdrawn, totalActive }, pendingDiscussion > 5 ? "critical" : pendingDiscussion > 0 ? "warn" : "ok", false, scope);
  } catch (error) {
    logFailure("resignation", error);
    return unavailable("RESIGNATION");
  }
}

export async function getDpdpWithdrawalMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const columns = await tableColumns("dpdp_consent_withdrawal");
    if (!columns.has("status") || !columns.has("requester_id")) {
      return unavailable("DPDP_WITHDRAWAL", "SOURCE_NOT_CONFIGURED");
    }
    const scoped = buildScopeWhereEmployees(scope, "e");
    const holdExpr = columns.has("processing_hold_active")
      ? "SUM(CASE WHEN dcw.processing_hold_active = 1 THEN 1 ELSE 0 END)"
      : "0";
    const createdAtExpr = columns.has("created_at")
      ? "SUM(CASE WHEN dcw.status IN ('submitted','in_review') AND dcw.created_at < DATE_SUB(NOW(), INTERVAL 72 HOUR) THEN 1 ELSE 0 END)"
      : "0";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN dcw.status IN ('submitted','in_review','pending') THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN dcw.status = 'approved' THEN 1 ELSE 0 END) AS approved,
              SUM(CASE WHEN dcw.status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
              ${holdExpr} AS holdsActive,
              ${createdAtExpr} AS overdue
         FROM dpdp_consent_withdrawal dcw
         LEFT JOIN employees e ON e.user_id = dcw.requester_id
        WHERE ${scoped.sql}`,
      scoped.params,
    );
    const row = rows[0] as any;
    const pending = Number(row?.pending ?? 0);
    const overdue = Number(row?.overdue ?? 0);
    return result("DPDP_WITHDRAWAL", pending, {
      total: Number(row?.total ?? 0), pending, approved: Number(row?.approved ?? 0),
      rejected: Number(row?.rejected ?? 0), holdsActive: Number(row?.holdsActive ?? 0), overdue,
    }, overdue > 0 ? "critical" : pending > 0 ? "warn" : "ok", false, scope);
  } catch (error) {
    logFailure("DPDP", error);
    return unavailable("DPDP_WITHDRAWAL");
  }
}

export async function getAppointmentEsignMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const columns = await tableColumns("appointment_letter_request");
    if (!columns.has("employee_id")) return unavailable("APPOINTMENT_ESIGN", "SOURCE_NOT_CONFIGURED");
    const scoped = buildScopeWhereEmployees(scope, "e");
    const state = columns.has("current_state") ? "alr.current_state" : "''";
    const candidate = columns.has("candidate_esign_status") ? "alr.candidate_esign_status" : "''";
    const company = columns.has("company_sign_status") ? "alr.company_sign_status" : "''";
    const locked = columns.has("pdf_locked") ? "alr.pdf_locked" : "0";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN ${state} IN ('candidate_esign_pending','company_sign_pending','override_requested')
                         OR ${candidate} = 'pending' OR ${company} = 'pending' THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN ${state} = 'candidate_esign_pending' OR ${candidate} = 'pending' THEN 1 ELSE 0 END) AS candidatePending,
              SUM(CASE WHEN ${state} = 'company_sign_pending' OR ${company} = 'pending' THEN 1 ELSE 0 END) AS companyPending,
              SUM(CASE WHEN ${state} = 'override_requested' THEN 1 ELSE 0 END) AS overrideRequested,
              SUM(CASE WHEN ${state} IN ('completed','locked') OR ${locked} = 1 THEN 1 ELSE 0 END) AS completed
         FROM appointment_letter_request alr
         LEFT JOIN employees e ON e.id = alr.employee_id
        WHERE ${scoped.sql}`,
      scoped.params,
    );
    const row = rows[0] as any;
    const pending = Number(row?.pending ?? 0);
    const overrideRequested = Number(row?.overrideRequested ?? 0);
    return result("APPOINTMENT_ESIGN", pending, {
      total: Number(row?.total ?? 0), pending,
      candidatePending: Number(row?.candidatePending ?? 0),
      companyPending: Number(row?.companyPending ?? 0),
      overrideRequested, completed: Number(row?.completed ?? 0),
    }, overrideRequested > 0 || pending > 10 ? "warn" : "ok", false, scope);
  } catch (error) {
    logFailure("appointment eSign", error);
    return unavailable("APPOINTMENT_ESIGN");
  }
}

export async function getBgvMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    if (!await requireColumns("candidate_bgv_check", ["candidate_id", "status"])) {
      return unavailable("BGV", "SCHEMA_MISMATCH");
    }
    const scoped = buildScopeWhereEmployees(scope, "e");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         SUM(CASE WHEN bgv.status IS NULL OR bgv.status IN ('not_started','consent_pending','queued','in_progress') THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN bgv.status IN ('verified','waived') THEN 1 ELSE 0 END) AS cleared,
         SUM(CASE WHEN bgv.status IN ('mismatch','manual_review') THEN 1 ELSE 0 END) AS flagged,
         SUM(CASE WHEN bgv.status IN ('failed','expired') THEN 1 ELSE 0 END) AS breached
       FROM candidate_bgv_check bgv
       LEFT JOIN ats_onboarding_bridge b ON b.candidate_id = bgv.candidate_id
       LEFT JOIN employees e ON e.id = b.employee_id
       WHERE ${scoped.sql}`,
      scoped.params,
    );
    const row = rows[0] as any;
    const pending = Number(row?.pending ?? 0);
    const cleared = Number(row?.cleared ?? 0);
    const flagged = Number(row?.flagged ?? 0);
    const breached = Number(row?.breached ?? 0);
    return result("BGV", pending, { pending, cleared, flagged, breached }, breached > 0 || flagged > 0 ? "critical" : pending > 20 ? "warn" : "ok", false, scope);
  } catch (error) {
    logFailure("BGV", error);
    return unavailable("BGV");
  }
}

export async function getNameMismatchMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    if (!await requireColumns("candidate_name_match_summary", ["candidate_id", "match_status", "is_blocking"])) {
      return unavailable("NAME_MISMATCH", "SOURCE_NOT_CONFIGURED");
    }
    const scoped = buildScopeWhereEmployees(scope, "e");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         SUM(CASE WHEN nm.match_status = 'mismatch' THEN 1 ELSE 0 END) AS mismatch,
         SUM(CASE WHEN nm.match_status = 'partial' THEN 1 ELSE 0 END) AS partial,
         SUM(CASE WHEN nm.match_status = 'pending' OR nm.match_status IS NULL THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN nm.is_blocking = 1 THEN 1 ELSE 0 END) AS blocking
       FROM candidate_name_match_summary nm
       LEFT JOIN ats_onboarding_bridge b ON b.candidate_id = nm.candidate_id
       LEFT JOIN employees e ON e.id = b.employee_id
       WHERE ${scoped.sql}`,
      scoped.params,
    );
    const row = rows[0] as any;
    const mismatch = Number(row?.mismatch ?? 0);
    const partial = Number(row?.partial ?? 0);
    const pending = Number(row?.pending ?? 0);
    const blocking = Number(row?.blocking ?? 0);
    return result("NAME_MISMATCH", blocking, { mismatch, partial, pending, blocking }, blocking > 0 ? "critical" : mismatch > 0 ? "warn" : "ok", false, scope);
  } catch (error) {
    logFailure("name mismatch", error);
    return unavailable("NAME_MISMATCH");
  }
}

export async function getJoiningDocEsignMetrics(scope: DashboardScope): Promise<MetricResult> {
  try {
    const columns = await tableColumns("employee_joining_document_checklist");
    if (!columns.has("employee_id") || !columns.has("status")) {
      return unavailable("JOINING_DOC_ESIGN", "SOURCE_NOT_CONFIGURED");
    }
    const scoped = buildScopeWhereEmployees(scope, "e");
    const actionFilter = columns.has("action_type") ? "c.action_type = 'esign' AND" : "";
    const overdueExpr = columns.has("due_at")
      ? "SUM(CASE WHEN c.status IN ('pending_candidate_esign','esign_initiated') AND c.due_at < NOW() THEN 1 ELSE 0 END)"
      : "0";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN c.status IN ('pending_candidate_esign','esign_initiated') THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN c.status IN ('esign_completed','completed','signed_verified') THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN c.status = 'esign_failed' THEN 1 ELSE 0 END) AS failed,
              ${overdueExpr} AS overdue
         FROM employee_joining_document_checklist c
         JOIN employees e ON e.id = c.employee_id
        WHERE ${actionFilter} ${scoped.sql}`,
      scoped.params,
    );
    const row = rows[0] as any;
    const pending = Number(row?.pending ?? 0);
    const failed = Number(row?.failed ?? 0);
    const overdue = Number(row?.overdue ?? 0);
    return result("JOINING_DOC_ESIGN", pending, {
      total: Number(row?.total ?? 0), pending, completed: Number(row?.completed ?? 0), failed, overdue,
    }, overdue > 0 ? "critical" : failed > 0 || pending > 10 ? "warn" : "ok", false, scope);
  } catch (error) {
    logFailure("joining document eSign", error);
    return unavailable("JOINING_DOC_ESIGN");
  }
}
