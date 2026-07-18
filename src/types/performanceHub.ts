export const PERFORMANCE_METRIC_CODES = [
  "CALLS",
  "AHT",
  "ADHERENCE",
  "UTILIZATION",
  "QUALITY_SCORE",
  "FATAL_RATE",
  "CONVERSION_RATE",
  "SALES_COUNT",
  "REVENUE",
  "AOV",
  "COD_SHARE",
  "RTO_RATE",
] as const;

export type PerformanceMetricCode = (typeof PERFORMANCE_METRIC_CODES)[number];
export type PerformanceScopeLevel =
  | "ORG_ALL"
  | "BRANCH_ALL"
  | "PROCESS_ALL"
  | "TEAM_ONLY"
  | "SELF_ONLY"
  | "CUSTOM_SCOPE";

export interface PerformanceContext {
  effectiveRole: string;
  scopeLevel: PerformanceScopeLevel;
  scopeLabel: string;
  canViewPeople: boolean;
  canSelectBranch: boolean;
  canSelectProcess: boolean;
  effectiveBranchIds: string[];
  effectiveProcessIds: string[];
  subjectEmployeeId: string | null;
}

export interface PerformanceFilters {
  from: string;
  to: string;
  branchId?: string;
  processId?: string;
  employeeId?: string;
  page?: number;
  pageSize?: number;
}

export interface PerformanceMetric {
  metricCode: PerformanceMetricCode;
  label: string;
  unit: "count" | "seconds" | "percent" | "currency";
  value: number | null;
  target: number | null;
  achievementPct: number | null;
  status: "on_track" | "watch" | "off_track" | "no_target" | "missing";
  calculationStatus: "verified" | "legacy_unverified" | "missing";
  sourceSystems: string[];
  recordCount: number;
  latestComputedAt: string | null;
}

export interface PerformanceTrendPoint {
  date: string;
  metrics: PerformanceMetric[];
}

export interface PerformancePerson {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  branchName: string | null;
  processName: string | null;
  metrics: PerformanceMetric[];
  overallAchievementPct: number | null;
}

export interface PerformancePeople {
  rows: PerformancePerson[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PerformanceEnvelope<T> {
  success: true;
  data: T;
  meta: {
    generatedAt: string;
    period?: { from: string; to: string };
  };
}

export function shouldShowPerformancePeople(context: PerformanceContext): boolean {
  return context.canViewPeople && context.scopeLevel !== "SELF_ONLY";
}
