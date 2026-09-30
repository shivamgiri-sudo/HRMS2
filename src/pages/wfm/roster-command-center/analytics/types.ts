/** API shapes for the Roster Analytics panel (mirror backend roster-analytics*.service.ts). */

export interface ShrinkageBreakdown {
  plannedLeave: { count: number; pct: number };
  unplannedAbsence: { count: number; pct: number };
  lateArrival: { count: number; pct: number };
  earlyDeparture: { count: number; pct: number };
  training: { count: number; pct: number };
  total: { count: number; pct: number };
}

export interface ShrinkageIntelligence {
  branchId: string;
  branchName: string;
  weekStart: string;
  weekEnd: string;
  breakdown: ShrinkageBreakdown;
  budgetPct: number;
  varianceFromBudget: number;
  trendVsPrevWeek: number;
  prevWeekPct?: number;
  costImpact: { hoursLost: number; estimatedCostINR: number; productivityLossPct: number };
  dayOfWeekPattern: Array<{ day: string; date?: string; shrinkagePct: number; isHighRisk: boolean }>;
  managerRanking: Array<{ managerId: string; managerName: string; teamSize: number; shrinkagePct: number; unplannedCount: number; rank: number }>;
  processRanking: Array<{ processId: string; processName: string; planned: number; shrinkagePct: number }>;
}

export type OutlierCategory = "HIGH_QUALITY_LOW_ATTENDANCE" | "LOW_QUALITY_HIGH_ATTENDANCE" | "BOTH_LOW" | "BOTH_HIGH";

export interface QualityCorrelation {
  period: string;
  sampleSize?: number;
  insufficientData?: boolean;
  correlation: { coefficient: number; interpretation: string; insight: string };
  segments: {
    highAdherence: { count: number; avgQuality: number; adherenceRange: string };
    mediumAdherence: { count: number; avgQuality: number; adherenceRange: string };
    lowAdherence: { count: number; avgQuality: number; adherenceRange: string };
  };
  outliers: Array<{ employeeId: string; employeeCode: string; employeeName: string; adherencePct: number; qualityPct: number; category: OutlierCategory }>;
  actionableInsights: string[];
}

export interface CostImpact {
  period: string;
  assumptions?: { hourlyCostINR: number; costSource: string; shortShiftPct: number };
  metrics: { totalPlannedHours: number; actualWorkedHours: number; hoursLost: number; avgHourlyCostINR: number; directCostLossINR: number; productivityImpactPct: number };
  breakdown: { unplannedAbsenceCost: number; lateCost: number; earlyDepartureCost: number; incompleteShiftCost: number };
  projectedAnnual: { currentTrend: number; ifImproved5Pct: number; potentialSavings: number };
  benchmarks: { industryAvgShrinkage: number; currentShrinkage: number; gapPct: number };
}

export interface Forecast {
  branchId: string;
  nextWeek: {
    weekStart: string;
    predictedShrinkagePct: number;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    riskDays: Array<{ date: string; day: string; predictedPct: number; reason: string }>;
  };
  patterns: { mondayEffect: number; fridayEffect: number; monthEndEffect: number };
  recommendations: string[];
}

// ── Drill-down payloads ──────────────────────────────────────────────────────

export interface ShrinkageDetail {
  kind: string; key: string | null; label: string; weekStart: string; weekEnd: string; budgetPct: number;
  summary: { counted: number; shrinkageCount: number; shrinkagePct: number; breakdown: ShrinkageBreakdown; hoursLost: number; costINR: number };
  totalRecords: number;
  records: Array<{
    employeeId: string; employeeCode: string | null; employeeName: string | null; managerName: string | null; processName: string | null;
    date: string; day: string; status: string; assignmentType: string | null; expectedHours: number; workedHours: number;
    lateMinutes: number; hoursLost: number; clockIn: string | null;
  }>;
  trend: Array<{ weekStart: string; shrinkagePct: number; base: number }>;
  timeline: unknown[];
  audit: unknown[];
}

export interface EmployeeDetail {
  employee: {
    id: string; code: string | null; name: string | null; designation: string | null; employmentStatus: string | null; active: boolean;
    dateOfJoining: string | null; branchName: string | null; processName: string | null; managerName: string | null;
  };
  period: string;
  summary: { planned: number; attended: number; adherencePct: number | null; hoursLost: number; costINR: number };
  days: Array<{ date: string; day: string; status: string; assignmentType: string | null; expectedHours: number; workedHours: number; lateMinutes: number; hoursLost: number; clockIn: string | null; clockOut: string | null }>;
  adherenceTrend: Array<{ period: string; planned: number; attended: number; adherencePct: number; hoursLost: number; costINR: number }>;
  quality: Array<{ period: string; metric: string; unit: string | null; value: number | null }>;
  timeline: unknown[];
  audit: unknown[];
}

export type CostComponent = "total" | "absent" | "late" | "early" | "incomplete";

export interface CostDetail {
  period: string; component: CostComponent; hourlyCostINR: number;
  summary: { hoursLost: number; costINR: number; employees: number };
  topEmployees: Array<{ employeeId: string; employeeCode: string; employeeName: string; days: number; hoursLost: number; costINR: number }>;
  daily: Array<{ date: string; hoursLost: number; costINR: number }>;
  trend: Array<{ period: string; hoursLost: number; costINR: number; lossPct: number }>;
  timeline: unknown[];
  audit: unknown[];
}

export interface ForecastDayDetail {
  date: string; day: string;
  summary: { sameWeekdaySamples: number; avgAbsencePct: number };
  history: Array<{ date: string; planned: number; absent: number; absencePct: number }>;
  timeline: unknown[];
  audit: unknown[];
}

export type DrawerTarget =
  | { type: "shrinkage"; kind: string; key?: string; label: string }
  | { type: "employee"; id: string; label: string }
  | { type: "cost"; component: CostComponent; label: string }
  | { type: "forecast"; date: string; label: string }
  | { type: "correlation"; label: string };
