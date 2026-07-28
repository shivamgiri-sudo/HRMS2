export type PerformanceMetricCode = string;
export type PerformanceScopeLevel =
  | "ORG_ALL"
  | "BRANCH_ALL"
  | "PROCESS_ALL"
  | "TEAM_ONLY"
  | "SELF_ONLY"
  | "CUSTOM_SCOPE";

export interface PerformanceFilterOption {
  id: string;
  label: string;
}

export interface PerformanceContext {
  effectiveRole: string;
  scopeLevel: PerformanceScopeLevel;
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
  unit: "count" | "seconds" | "percent" | "currency" | string;
  value: number | null;
  target: number | null;
  weightage: number;
  displayOrder: number;
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
