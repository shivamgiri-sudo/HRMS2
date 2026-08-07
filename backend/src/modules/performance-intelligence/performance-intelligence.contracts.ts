import type { DashboardScope } from "../../shared/dashboardScope.js";

export type PerformanceMetricCode = string;
export type PerformanceDirection = "higher_is_better" | "lower_is_better";
export type CalculationStatus = "verified" | "legacy_unverified" | "missing";
export type MetricStatus = "on_track" | "watch" | "off_track" | "no_target" | "missing";
export type MetricUnit = "count" | "seconds" | "percent" | "currency" | string;
export type AggregationMethod = "sum" | "average" | "weighted_average" | "ratio" | "latest" | string;

export interface PerformanceQuery {
  from: string;
  to: string;
  branchId?: string;
  processId?: string;
  employeeId?: string;
  page: number;
  pageSize: number;
}

export interface PerformanceFilterOption {
  id: string;
  label: string;
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
  branchOptions: PerformanceFilterOption[];
  processOptions: PerformanceFilterOption[];
  subjectEmployeeId: string | null;
}

export interface MetricFact {
  employeeId: string;
  metricCode: PerformanceMetricCode;
  metricName: string;
  unit: MetricUnit;
  aggregationMethod: AggregationMethod;
  decimalPlaces: number;
  displayOrder: number;
  scoreDate: string;
  actualValue: number | null;
  numeratorValue: number | null;
  denominatorValue: number | null;
  calculationMultiplier: number | null;
  targetValue: number | null;
  weightage: number;
  maxAchievementPct: number;
  direction: PerformanceDirection;
  sourceSystem: string | null;
  sourceRecordCount: number | null;
  formulaVersion: string | null;
  computedAt: string;
}

export interface PerformanceMetricResult {
  metricCode: PerformanceMetricCode;
  label: string;
  unit: MetricUnit;
  value: number | null;
  target: number | null;
  weightage: number;
  displayOrder: number;
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
  listFilterOptions(scope: DashboardScope): Promise<{
    branches: PerformanceFilterOption[];
    processes: PerformanceFilterOption[];
  }>;
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
