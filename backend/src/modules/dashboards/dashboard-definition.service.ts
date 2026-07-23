import type { DashboardCode } from "../../shared/dashboardAccessRegistry.js";
import type { DashboardMetric } from "../../shared/dashboardMetricContract.js";
import type { DashboardScope } from "../../shared/dashboardScope.js";
import {
  getAppointmentEsignMetrics,
  getAttendanceMetrics,
  getBgvMetrics,
  getDpdpWithdrawalMetrics,
  getHeadcountMetrics,
  getIncentiveMetrics,
  getJoiningDocEsignMetrics,
  getNameMismatchMetrics,
  getOnboardingMetrics,
  getPayrollReadinessMetrics,
  getResignationMetrics,
  getTatMetrics,
  type MetricResult,
} from "./dashboard-metric.service.js";

type MetricKey =
  | "hc"
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
  | "joiningDocEsign";

type MetricDefinition = {
  code: string;
  label: string;
  unit: string;
  source: string;
  sourceTable: string | null;
  numeratorKey?: string;
  denominatorKey?: string;
  execute: (scope: DashboardScope) => Promise<MetricResult>;
};

const METRICS: Readonly<Record<MetricKey, MetricDefinition>> = {
  hc: { code: "HEADCOUNT", label: "Active headcount", unit: "employees", source: "Employee master", sourceTable: "employees", execute: getHeadcountMetrics },
  onb: { code: "ONBOARDING", label: "Onboarding pipeline", unit: "candidates", source: "ATS onboarding", sourceTable: "ats_onboarding_bridge", execute: getOnboardingMetrics },
  att: { code: "ATTENDANCE", label: "Processed attendance rate", unit: "percent", source: "Processed attendance", sourceTable: "attendance_daily_record", numeratorKey: "present", denominatorKey: "expectedToWork", execute: getAttendanceMetrics },
  payroll: { code: "PAYROLL_READINESS", label: "Payroll readiness", unit: "employees", source: "Employee payroll master", sourceTable: "employees", numeratorKey: "readyCount", denominatorKey: "total", execute: getPayrollReadinessMetrics },
  incentive: { code: "INCENTIVE", label: "Pending incentive batches", unit: "batches", source: "Incentive upload", sourceTable: "incentive_upload_batch", execute: getIncentiveMetrics },
  tat: { code: "TAT", label: "Open TAT items", unit: "items", source: "TAT governance", sourceTable: "task_tat_instance", execute: getTatMetrics },
  resign: { code: "RESIGNATION", label: "Active exits", unit: "requests", source: "Exit management", sourceTable: "exit_request", execute: getResignationMetrics },
  dpdp: { code: "DPDP", label: "Pending DPDP requests", unit: "requests", source: "DPDP consent withdrawal", sourceTable: "dpdp_consent_withdrawal", execute: getDpdpWithdrawalMetrics },
  appointmentEsign: { code: "APPOINTMENT_ESIGN", label: "Appointment eSign pending", unit: "requests", source: "Appointment letters", sourceTable: "appointment_letter_request", execute: getAppointmentEsignMetrics },
  bgv: { code: "BGV", label: "BGV pending", unit: "candidates", source: "Candidate BGV", sourceTable: "candidate_bgv_check", execute: getBgvMetrics },
  nm: { code: "NAME_MISMATCH", label: "Name mismatches", unit: "candidates", source: "Name match summary", sourceTable: "candidate_name_match_summary", execute: getNameMismatchMetrics },
  joiningDocEsign: { code: "JOINING_DOC_ESIGN", label: "Joining document eSign pending", unit: "documents", source: "Joining documents", sourceTable: "employee_joining_document_checklist", execute: getJoiningDocEsignMetrics },
};

const DASHBOARD_METRICS: Readonly<Record<DashboardCode, readonly MetricKey[]>> = {
  SUPER_ADMIN_DASHBOARD: [],
  CEO_DASHBOARD: ["hc", "att", "payroll", "onb", "resign"],
  HR_DASHBOARD: ["onb", "tat", "resign", "dpdp", "appointmentEsign", "bgv", "nm", "joiningDocEsign"],
  WFM_DASHBOARD: ["hc", "att"],
  WFM_ATTENDANCE_DASHBOARD: ["att"],
  PAYROLL_HR_DASHBOARD: ["payroll", "incentive"],
  QUALITY_DASHBOARD: [],
  OPERATIONS_DASHBOARD: ["hc", "att"],
  RECRUITER_DASHBOARD: ["onb", "tat"],
  IT_MANAGER_DASHBOARD: [],
  MANAGEMENT_DASHBOARD: ["hc", "att", "tat"],
  EMPLOYEE_SELF_DASHBOARD: ["att"],
};

function numberFromDetail(result: MetricResult, key?: string): number | null {
  if (!key) return null;
  const value = result.detail[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function adaptLegacyMetric(
  metricCode: string,
  result: MetricResult,
  scope: DashboardScope,
  asOf: Date,
): DashboardMetric {
  const definition = Object.values(METRICS).find((item) => item.code === metricCode);
  if (!definition) throw new Error(`Metric definition not found: ${metricCode}`);
  const available = result.value !== null && result.value !== undefined;
  const statusMap = {
    ok: "healthy",
    warn: "warning",
    critical: "critical",
    unknown: "unknown",
  } as const;

  return {
    code: definition.code,
    label: definition.label,
    value: available ? result.value : null,
    unit: definition.unit,
    available,
    errorCode: available ? null : "SOURCE_UNAVAILABLE",
    errorMessage: available ? null : `${definition.source} did not return a usable value`,
    source: definition.source,
    sourceTable: definition.sourceTable,
    asOf: available ? asOf.toISOString() : null,
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
    trend: result.trend,
    status: available ? statusMap[result.status] : "unknown",
    drilldownUrl: result.drilldownApi || null,
    detail: result.detail,
  };
}

export function getDashboardMetricKeys(code: DashboardCode): readonly MetricKey[] {
  return DASHBOARD_METRICS[code];
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
