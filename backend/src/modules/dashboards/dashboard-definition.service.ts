import type { DashboardCode } from "../../shared/dashboardAccessRegistry.js";
import type { DashboardMetric } from "../../shared/dashboardMetricContract.js";
import type { DashboardScope } from "../../shared/dashboardScope.js";
import {
  getAppointmentEsignMetrics,
  getAttendanceExceptionMetrics,
  getAttendanceMetrics,
  getBgvMetrics,
  getBiometricActivityMetrics,
  getDocumentComplianceMetrics,
  getDpdpWithdrawalMetrics,
  getHeadcountMetrics,
  getHiringAlertMetrics,
  getIncentiveMetrics,
  getJoiningDocEsignMetrics,
  getLeaveApprovalMetrics,
  getNameMismatchMetrics,
  getOnboardingMetrics,
  getPayrollReadinessMetrics,
  getRecruiterActivityMetrics,
  getResignationMetrics,
  getSalaryComponentMetrics,
  getTatMetrics,
  getTrainingProgressMetrics,
  type MetricResult,
} from "./dashboard-metric.service.js";
import {
  getAttendanceStatusMetric,
  getLatecomingMetric,
  getUnplannedLeaveMetric,
  getPipStatusMetric,
  getQualityBaselineMetric,
  getAttritionMetric,
  getShrinkageMetric,
  getRevenueMetric,
} from "./performance-scorecard-drilldown.js";

type MetricKey =
  | "hc"
  | "hiringAlert"
  | "onb"
  | "att"
  | "payroll"
  | "incentive"
  | "tat"
  | "resign"
  | "dpdp"
  | "appointmentEsign"
  | "bgv"
  | "nm"
  | "joiningDocEsign"
  | "attException"
  | "docCompliance"
  | "biometric"
  | "salaryComponents"
  | "recruiterActivity"
  | "training"
  | "leaveApprovals"
  | "attendanceStatus"
  | "latecoming"
  | "unplannedLeave"
  | "pipStatus"
  | "qualityBaseline"
  | "attrition"
  | "shrinkage"
  | "revenue";

type MetricDefinition = {
  code: string;
  label: string;
  unit: string;
  source: string;
  sourceTable: string | null;
  numeratorKey?: string;
  denominatorKey?: string;
  /**
   * Direction of goodness, used to seed dashboard_metric_catalog.higher_is_better and to
   * decide whether a value above its target reads as good or critical.
   *
   * This must equal the flag the metric passes to wrapEnriched; the two are different
   * expressions of one fact and drifting them would make a tile show "good" for a rising
   * backlog. dashboard-metric-code-contract.test.ts pins them together.
   */
  higherIsBetter: boolean;
  /** Owning module, for grouping in the catalog. */
  moduleCode: string;
  execute: (scope: DashboardScope) => Promise<MetricResult>;
};

const METRICS: Readonly<Record<MetricKey, MetricDefinition>> = {
  hc: { code: "HEADCOUNT", label: "Active headcount", unit: "employees", source: "Employee master", sourceTable: "employees", higherIsBetter: true, moduleCode: "hrms", execute: getHeadcountMetrics },
  hiringAlert: { code: "HIRING_ALERT", label: "Hiring shortage", unit: "seats", source: "Cost centre billing mandate", sourceTable: "workforce_mandate", higherIsBetter: false, moduleCode: "hrms", execute: getHiringAlertMetrics },
  onb: { code: "ONBOARDING", label: "Onboarding pipeline", unit: "candidates", source: "ATS onboarding", sourceTable: "ats_onboarding_bridge", higherIsBetter: true, moduleCode: "ats", execute: getOnboardingMetrics },
  att: { code: "ATTENDANCE", label: "Processed attendance rate", unit: "percent", source: "Processed attendance", sourceTable: "attendance_daily_record", numeratorKey: "attendedDays", denominatorKey: "expectedToWork", higherIsBetter: true, moduleCode: "attendance", execute: getAttendanceMetrics },
  payroll: { code: "PAYROLL_READINESS", label: "Payroll readiness", unit: "employees", source: "Employee payroll master", sourceTable: "employees", numeratorKey: "readyCount", denominatorKey: "total", higherIsBetter: true, moduleCode: "payroll", execute: getPayrollReadinessMetrics },
  incentive: { code: "INCENTIVE", label: "Pending incentive batches", unit: "batches", source: "Incentive upload", sourceTable: "incentive_upload_batch", higherIsBetter: false, moduleCode: "payroll", execute: getIncentiveMetrics },
  tat: { code: "TAT", label: "Open TAT items", unit: "items", source: "TAT governance", sourceTable: "task_tat_instance", higherIsBetter: false, moduleCode: "governance", execute: getTatMetrics },
  resign: { code: "RESIGNATION", label: "Active exits", unit: "requests", source: "Exit management", sourceTable: "exit_request", higherIsBetter: false, moduleCode: "exit", execute: getResignationMetrics },
  dpdp: { code: "DPDP", label: "Pending DPDP requests", unit: "requests", source: "DPDP consent withdrawal", sourceTable: "dpdp_consent_withdrawal", higherIsBetter: false, moduleCode: "compliance", execute: getDpdpWithdrawalMetrics },
  appointmentEsign: { code: "APPOINTMENT_ESIGN", label: "Appointment eSign pending", unit: "requests", source: "Appointment letters", sourceTable: "appointment_letter_request", higherIsBetter: false, moduleCode: "onboarding", execute: getAppointmentEsignMetrics },
  bgv: { code: "BGV", label: "BGV pending", unit: "candidates", source: "Candidate BGV", sourceTable: "candidate_bgv_check", higherIsBetter: false, moduleCode: "ats", execute: getBgvMetrics },
  nm: { code: "NAME_MISMATCH", label: "Name mismatches", unit: "candidates", source: "Name match summary", sourceTable: "candidate_name_match_summary", higherIsBetter: false, moduleCode: "ats", execute: getNameMismatchMetrics },
  joiningDocEsign: { code: "JOINING_DOC_ESIGN", label: "Joining document eSign pending", unit: "documents", source: "Joining documents", sourceTable: "employee_joining_document_checklist", higherIsBetter: false, moduleCode: "onboarding", execute: getJoiningDocEsignMetrics },
  attException: { code: "ATTENDANCE_EXCEPTIONS", label: "Open attendance exceptions", unit: "issues", source: "Attendance reconciliation", sourceTable: "attendance_reconciliation_issue", numeratorKey: "blockers", denominatorKey: "openTotal", higherIsBetter: false, moduleCode: "attendance", execute: getAttendanceExceptionMetrics },
  docCompliance: { code: "DOC_COMPLIANCE", label: "Employees with no documents", unit: "employees", source: "Employee documents", sourceTable: "employee_documents", numeratorKey: "employeesWithDocs", denominatorKey: "activeEmployees", higherIsBetter: false, moduleCode: "hrms", execute: getDocumentComplianceMetrics },
  biometric: { code: "BIOMETRIC_ACTIVITY", label: "Biometric punch coverage", unit: "employees", source: "Biometric daily activity", sourceTable: "integration_biometric_daily", numeratorKey: "completePunchPairs", denominatorKey: "employees", higherIsBetter: true, moduleCode: "attendance", execute: getBiometricActivityMetrics },
  salaryComponents: { code: "SALARY_COMPONENTS", label: "Payroll components in latest run", unit: "components", source: "Salary component lines", sourceTable: "salary_prep_line_component", higherIsBetter: true, moduleCode: "payroll", execute: getSalaryComponentMetrics },
  recruiterActivity: { code: "RECRUITER_ACTIVITY", label: "Recruiter pipeline (30d)", unit: "leads", source: "Recruiter hiring activity", sourceTable: "ats_recruiter_hiring_activity", numeratorKey: "selected", denominatorKey: "leads", higherIsBetter: true, moduleCode: "ats", execute: getRecruiterActivityMetrics },
  training: { code: "TRAINING_PROGRESS", label: "Training completion rate", unit: "percent", source: "LMS progress snapshot", sourceTable: "lms_learning_progress_snapshot", numeratorKey: "completed", denominatorKey: "assignments", higherIsBetter: true, moduleCode: "lms", execute: getTrainingProgressMetrics },
  leaveApprovals: { code: "LEAVE_APPROVALS", label: "Pending leave approvals", unit: "requests", source: "Leave requests", sourceTable: "leave_request", higherIsBetter: false, moduleCode: "leave", execute: getLeaveApprovalMetrics },
  attendanceStatus: { code: "ATTENDANCE_STATUS", label: "Attendance", unit: "days", source: "Attendance snapshot", sourceTable: "employee_performance_daily_snapshot", higherIsBetter: true, moduleCode: "performance-scorecard", execute: getAttendanceStatusMetric },
  latecoming: { code: "LATECOMING", label: "Latecoming", unit: "minutes", source: "Attendance snapshot", sourceTable: "employee_performance_daily_snapshot", higherIsBetter: false, moduleCode: "performance-scorecard", execute: getLatecomingMetric },
  unplannedLeave: { code: "UNPLANNED_LEAVE", label: "Unplanned Leave", unit: "days", source: "Attendance snapshot", sourceTable: "employee_performance_daily_snapshot", higherIsBetter: false, moduleCode: "performance-scorecard", execute: getUnplannedLeaveMetric },
  pipStatus: { code: "PIP_STATUS", label: "PIP Status", unit: "status", source: "PIP records", sourceTable: "pip_record", higherIsBetter: true, moduleCode: "performance-scorecard", execute: getPipStatusMetric },
  qualityBaseline: { code: "QUALITY_BASELINE", label: "Quality", unit: "score", source: "KPI daily actuals", sourceTable: "kpi_daily_actual", higherIsBetter: true, moduleCode: "performance-scorecard", execute: getQualityBaselineMetric },
  attrition: { code: "ATTRITION", label: "Attrition", unit: "%", source: "Attrition analytics", sourceTable: "employee_performance_daily_snapshot", higherIsBetter: false, moduleCode: "performance-scorecard", execute: getAttritionMetric },
  shrinkage: { code: "SHRINKAGE", label: "Shrinkage", unit: "%", source: "Shrinkage analytics", sourceTable: "employee_performance_daily_snapshot", higherIsBetter: false, moduleCode: "performance-scorecard", execute: getShrinkageMetric },
  revenue: { code: "REVENUE", label: "Revenue", unit: "INR", source: "Finance/BI", sourceTable: "employee_performance_daily_snapshot", higherIsBetter: true, moduleCode: "performance-scorecard", execute: getRevenueMetric },
};

/**
 * Which metrics each dashboard requests.
 *
 * SUPER_ADMIN, QUALITY and IT_MANAGER were empty arrays, so `/summary` returned
 * `metrics: {}` for them. That was not a cosmetic gap: SuperAdminReferenceLayout reads
 * `metricDetail(m, "att", …)` for Present / On Leave / Absent Today and the attendance
 * donut, so four KPI cards and a chart were permanently blank on the most privileged
 * dashboard — with no UI change needed to fix them once the bundle is populated.
 *
 * Bundles are chosen against sources that actually hold rows. `tat` is deliberately
 * absent everywhere it was not already present: task_tat_instance is empty in
 * production, so adding it would ship more blank tiles.
 */
const DASHBOARD_METRICS: Readonly<Record<DashboardCode, readonly MetricKey[]>> = {
  // Fixes 4 blank KPI cards + the attendance donut with no layout change.
  // attException + docCompliance give the org-wide blocker roll-up: the exceptions that
  // stop a payroll run, and the active employees with no document on file.
  SUPER_ADMIN_DASHBOARD: ["hc", "att", "onb", "resign", "payroll", "attException", "docCompliance", "hiringAlert"],
  // `bgv` added 31-Jul-2026 (CEO UAT): the layout renders a BGV Pending tile but the
  // bundle never requested the metric, so it was a permanent em-dash.
  //
  // `nm`, `incentive` and `tat` are deliberately NOT added, even though the layout
  // has tiles for them and builders exist. Their source tables are empty in
  // production — candidate_name_match_summary 0 rows, incentive_upload_batch 0,
  // task_tat_instance 0 — so requesting them would render a confident "0" that
  // asserts "no name mismatches" and "no TAT breaches" when neither pipeline is
  // running. A false zero on an executive dashboard is worse than a blank. Those
  // three tiles are removed from CeoReferenceLayout instead; re-add the keys here
  // once the pipelines feed data.
  CEO_DASHBOARD: ["hc", "att", "payroll", "onb", "resign", "attException", "docCompliance", "bgv"],
  // `tat` and `dpdp` removed 2026-08-28, on exactly the reasoning already written into the
  // CEO bundle below: task_tat_instance and dpdp_consent_withdrawal hold 0 rows on a
  // COUNT(*), so requesting them asserted "no open TAT items" and "no pending DPDP
  // requests" about pipelines that are not running. Neither had a consumer either — no
  // layout in src/pages/dashboards reads metrics.tat or metrics.dpdp — so this removes a
  // query per request as well as a false zero. `nm` stays: candidate_name_match_summary
  // holds real rows (7), just few. Re-add the day their sources start writing.
  HR_DASHBOARD: [
    "onb", "resign", "appointmentEsign", "bgv", "nm", "joiningDocEsign",
    "hc", "att", "docCompliance", "training", "leaveApprovals", "hiringAlert",
  ],
  WFM_DASHBOARD: ["hc", "att", "attException", "biometric"],
  // "hc" added — WfmAttendanceReferenceLayout.tsx's first tile, "Total Employees",
  // reads metricDetail(m, "hc", "active") but this bundle never requested it, so
  // it rendered a permanent blank. getHeadcountMetrics is cheap post-fix (already
  // parallelized this session), so there's no cost concern to adding it here.
  WFM_ATTENDANCE_DASHBOARD: ["hc", "att", "attException", "biometric"],
  // `incentive` KEPT. information_schema.table_rows reported incentive_upload_batch as
  // empty, but that column is an InnoDB estimate — COUNT(*) is 1 (a rejected batch), so
  // the metric is measuring something real and PayrollReferenceLayout already renders
  // metricUnavailableReason() for it if that ever changes.
  PAYROLL_HR_DASHBOARD: ["payroll", "incentive", "salaryComponents", "attException"],
  // Scoped headcount and attendance context for QA; audit scores stay on /api/quality-dashboard/*.
  QUALITY_DASHBOARD: ["hc", "att"],
  OPERATIONS_DASHBOARD: ["hc", "att"],
  // `tat` removed — same empty source as HR above.
  RECRUITER_DASHBOARD: ["onb", "recruiterActivity"],
  // Incoming joiners are provisioning demand; exits are deprovisioning and asset recovery.
  IT_MANAGER_DASHBOARD: ["hc", "onb", "resign"],
  // `tat` removed — same empty source as HR above. `onb` ADDED: ManagerReferenceLayout's
  // "New Joiners (This Month)" tile falls back to metricDetail(m, "onb", …) when the
  // workforce summary has no new_joiners_30d, and the bundle never requested it, so the
  // fallback was dead code.
  // hiringAlert added for branch heads: dashboardAccessRegistry maps branch_head to this
  // dashboard (variant "manager"), and resolveDashboardScope narrows them to their own branch
  // and processes, so the tile answers "how short am I" for their scope only.
  MANAGEMENT_DASHBOARD: ["hc", "att", "onb", "training", "leaveApprovals", "hiringAlert"],
  EMPLOYEE_SELF_DASHBOARD: ["att", "leaveApprovals"],
  PERFORMANCE_SCORECARD: [
    "attendanceStatus", "latecoming", "unplannedLeave", "pipStatus",
    "qualityBaseline", "attrition", "shrinkage", "revenue",
  ],
};

function numberFromDetail(result: MetricResult, key?: string): number | null {
  if (!key) return null;
  const value = result.detail[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * A metric-supplied `asOf` is usually a bare date ("2026-08-11" — the day the metric's
 * own query is anchored on), not a full ISO datetime, so it fails the contract's
 * `z.string().datetime()` check as-is. Anchoring it to midnight UTC keeps the day the
 * metric actually describes while still satisfying the schema. Falls back to the
 * request's own generation time when the metric didn't compute one of its own.
 */
function normalizeAsOf(value: string | null | undefined, generatedAt: Date): string {
  if (!value) return generatedAt.toISOString();
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? generatedAt.toISOString() : parsed.toISOString();
}

export function adaptLegacyMetric(
  metricCode: string,
  result: MetricResult,
  scope: DashboardScope,
  generatedAt: Date,
): DashboardMetric {
  const definition = Object.values(METRICS).find((item) => item.code === metricCode);
  if (!definition) throw new Error(`Metric definition not found: ${metricCode}`);
  const rawAvailable = result.value !== null && result.value !== undefined;
  const statusMap = {
    ok: "healthy",
    warn: "warning",
    critical: "critical",
    unknown: "unknown",
  } as const;

  // Three outcomes look identical on a dashboard tile but need different responses:
  //   QUERY_FAILED       the SQL is broken — an engineering problem
  //   NO_DATA_IN_SOURCE  the query worked and the source holds nothing in scope, so
  //                      the tile must say "no data recorded" rather than a confident 0
  //   available          a real measurement, including a real zero
  // `available` stays true for an empty source: the read succeeded, so it must not be
  // reported in the dashboard's "sources unavailable" banner.
  // An empty source is an empty source whether or not the metric could compute a value
  // from it. Several metrics return null rather than 0 when there is nothing to divide by
  // — attendanceRate and avgCompletionPct both do — so requiring `available` here sent a
  // team-scoped manager with no mapped reports down the !available branch and reported
  // SOURCE_UNAVAILABLE: the tile said the database was unreachable when the query had in
  // fact run perfectly and matched no rows. QUERY_FAILED still wins, because a metric that
  // actually threw has a row count of nothing for a different reason.
  const emptySource = result.sourceRowCount === 0 && result.errorCode !== "QUERY_FAILED";
  // An empty source counts as AVAILABLE — the read succeeded. unavailableMetricCodes()
  // drives the red "database sources unavailable" banner off this flag, and listing empty
  // tables there is what buried real breakage among routine empties.
  const available = rawAvailable || emptySource;
  const errorCode = emptySource
    ? "NO_DATA_IN_SOURCE"
    : !available
      ? (result.errorCode ?? "SOURCE_UNAVAILABLE")
      : null;
  // Same precedence as errorCode above — an empty source explains itself, and must not be
  // described as a source that "did not return a usable value".
  const errorMessage = emptySource
    ? `${definition.source} holds no records for this scope yet`
    : !available
      ? (result.errorMessage ?? `${definition.source} did not return a usable value`)
      : null;

  return {
    code: definition.code,
    label: definition.label,
    value: available ? result.value : null,
    unit: definition.unit,
    available,
    errorCode,
    errorMessage,
    source: definition.source,
    sourceTable: definition.sourceTable,
    // Prefer the metric's own anchor date (e.g. attendance's last-reconciled day) over
    // the request time — this was previously always the request time regardless of
    // what the metric itself computed, because this parameter shared its name with the
    // one below and silently won every time. See normalizeAsOf above.
    asOf: available ? normalizeAsOf(result.asOf, generatedAt) : null,
    periodStart: null,
    periodEnd: null,
    timezone: "Asia/Kolkata",
    scope: {
      level: scope.level,
      branchIds: scope.branchIds,
      processIds: scope.processIds,
      employeeIds: scope.employeeIds,
    },
    numerator: numberFromDetail(result, definition.numeratorKey),
    denominator: numberFromDetail(result, definition.denominatorKey),
    target: result.target,
    previousValue: result.previousValue,
    variancePct: result.variancePct,
    changePct: result.changePct,
    trend: result.trend,
    status: available ? statusMap[result.status] : "unknown",
    drilldownUrl: result.drilldownApi || null,
    detail: result.detail,
  };
}

export function getDashboardMetricKeys(code: DashboardCode): readonly MetricKey[] {
  return DASHBOARD_METRICS[code];
}

/**
 * Every metric code the catalog can emit.
 *
 * The drilldown service switches on these, and its cases had drifted to a different
 * naming generation (ONBOARDING_PENDING vs ONBOARDING), silently disabling most
 * drilldowns. Exposing the canonical list lets a test and the audit script assert
 * the two stay in step.
 */
export function getAllMetricCodes(): readonly string[] {
  return Object.values(METRICS).map((definition) => definition.code);
}

export type MetricCatalogEntry = {
  metricCode: string;
  metricName: string;
  moduleCode: string;
  dataSource: string | null;
  unit: string;
  higherIsBetter: boolean;
};

/**
 * The catalog rows dashboard_metric_catalog should hold, derived from the same constant
 * the dashboards execute. Generating the seed from here rather than hand-writing SQL is
 * what keeps metric_code, unit and higher_is_better identical to what the code enriches
 * under — a mismatch in any of the three silently disables targets for that metric.
 */
export function getMetricCatalogEntries(): readonly MetricCatalogEntry[] {
  return Object.values(METRICS).map((definition) => ({
    metricCode: definition.code,
    metricName: definition.label,
    moduleCode: definition.moduleCode,
    dataSource: definition.sourceTable,
    unit: definition.unit,
    higherIsBetter: definition.higherIsBetter,
  }));
}

export type RoleMetricConfigEntry = {
  dashboardCode: DashboardCode;
  metricCode: string;
  displayOrder: number;
  isPrimary: boolean;
};

/**
 * The role/dashboard/metric rows dashboard_role_metric_config should hold, derived from
 * DASHBOARD_METRICS so the configured order matches the order dashboards actually render.
 *
 * display_order follows bundle position. is_primary marks the first three, which are the
 * tiles a layout puts above the fold.
 */
export function getRoleMetricConfigEntries(): readonly RoleMetricConfigEntry[] {
  const entries: RoleMetricConfigEntry[] = [];
  for (const [dashboardCode, keys] of Object.entries(DASHBOARD_METRICS) as Array<
    [DashboardCode, readonly MetricKey[]]
  >) {
    keys.forEach((key, index) => {
      entries.push({
        dashboardCode,
        metricCode: METRICS[key].code,
        displayOrder: index + 1,
        isPrimary: index < 3,
      });
    });
  }
  return entries;
}

/**
 * Runs a single metric by its published code, for callers that work in metric codes rather
 * than dashboards — the snapshot writer records every metric across every scope, which is
 * not the shape of any one dashboard's bundle.
 *
 * Returns null for an unknown code rather than throwing, so one stale code in a caller's
 * list cannot abort a whole run.
 */
export async function executeMetricByCode(
  metricCode: string,
  scope: DashboardScope,
): Promise<MetricResult | null> {
  const normalized = String(metricCode).trim().toUpperCase();
  const definition = Object.values(METRICS).find((entry) => entry.code === normalized);
  if (!definition) return null;
  return definition.execute(scope);
}

export function isMetricConfiguredForDashboard(code: DashboardCode, metricCode: string): boolean {
  const normalizedMetricCode = String(metricCode).trim().toUpperCase();
  return DASHBOARD_METRICS[code].some((key) => METRICS[key].code === normalizedMetricCode);
}

export async function executeDashboardMetrics(
  code: DashboardCode,
  scope: DashboardScope,
  asOf = new Date(),
): Promise<Record<string, DashboardMetric>> {
  const entries = await Promise.all(
    DASHBOARD_METRICS[code].map(async (key) => {
      const definition = METRICS[key];
      const result = await definition.execute(scope);
      return [key, adaptLegacyMetric(definition.code, result, scope, asOf)] as const;
    }),
  );
  return Object.fromEntries(entries);
}
