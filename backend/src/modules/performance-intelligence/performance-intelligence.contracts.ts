import type { DashboardScope } from "../../shared/dashboardScope.js";

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
export type PerformanceDirection = "higher_is_better" | "lower_is_better";
export type CalculationStatus = "verified" | "legacy_unverified" | "missing";
export type MetricStatus = "on_track" | "watch" | "off_track" | "no_target" | "missing";

export interface PerformanceQuery {
  from: string;
  to: string;
  branchId?: string;
  processId?: string;
  employeeId?: string;
  page: number;
  pageSize: number;
}

export interface PerformanceContext {
  effectiveRole: string;
  scopeLevel: DashboardScope["level"];
  scopeLabel: string;
  canViewPeople: boolean;
  canSelectBranch: boolean;
  canSelectProcess: boolean;
  effectiveBranchIds: string[];
  effectiveProcessIds: string[];
  subjectEmployeeId: string | null;
}

export interface MetricFact {
  employeeId: string;
  metricCode: PerformanceMetricCode;
  scoreDate: string;
  actualValue: number | null;
  numeratorValue: number | null;
  denominatorValue: number | null;
  targetValue: number | null;
  direction: PerformanceDirection;
  sourceSystem: string | null;
  sourceRecordCount: number | null;
  formulaVersion: string | null;
  computedAt: string;
}

export interface PerformanceMetricResult {
  metricCode: PerformanceMetricCode;
  label: string;
  unit: "count" | "seconds" | "percent" | "currency";
  value: number | null;
  target: number | null;
  achievementPct: number | null;
  status: MetricStatus;
  calculationStatus: CalculationStatus;
  sourceSystems: string[];
  recordCount: number;
  latestComputedAt: string | null;
}

export interface PerformanceTrendPoint {
  date: string;
  metrics: PerformanceMetricResult[];
}

export interface PerformancePersonRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  branchName: string | null;
  processName: string | null;
  metrics: PerformanceMetricResult[];
  overallAchievementPct: number | null;
}

export interface PaginatedPeople {
  rows: PerformancePersonRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PerformanceRepository {
  findSubjectEmployeeId(userId: string): Promise<string | null>;
  canAccessEmployee(scope: DashboardScope, employeeId: string): Promise<boolean>;
  listMetricFacts(
    scope: DashboardScope,
    query: PerformanceQuery,
    subjectEmployeeId: string | null,
  ): Promise<MetricFact[]>;
  listDailyTrendFacts(
    scope: DashboardScope,
    query: PerformanceQuery,
    subjectEmployeeId: string | null,
  ): Promise<MetricFact[]>;
  listPeople(
    scope: DashboardScope,
    query: PerformanceQuery,
  ): Promise<{ rows: Omit<PerformancePersonRow, "metrics" | "overallAchievementPct">[]; total: number }>;
  listMetricFactsForEmployees(
    scope: DashboardScope,
    query: PerformanceQuery,
    employeeIds: string[],
  ): Promise<MetricFact[]>;
}
