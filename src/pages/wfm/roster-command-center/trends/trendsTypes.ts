/** API shapes for /api/roster-analytics/trends/* (see backend roster-trends.*.service.ts). */

export interface Counts { scheduled: number; present: number; absent: number; onLeave: number; late: number }
export interface Rates { shrinkagePct: number; unplannedPct: number; plannedPct: number; attendancePct: number; lateRatePct: number }
export type CountsRates = Counts & Rates;

export interface DayPoint extends CountsRates { date: string; hasData: boolean }

export interface ShrinkageTrend {
  from: string; to: string; effectiveTo: string; clamped: boolean; futureOnly: boolean;
  days: DayPoint[]; summary: DayPoint; previous: DayPoint | null;
  previousWindow?: { from: string; to: string }; missingDates?: string[];
}

export interface ProcessRow extends CountsRates { processId: string; processName: string }
export interface ProcessShrinkage { from: string; to: string; effectiveTo: string; processes: ProcessRow[] }

export interface MemberRow extends CountsRates {
  employeeId: string; employeeCode: string; employeeName: string; branchName: string | null; avgLateMinutes: number;
}

export interface Funnel {
  total: number; published: number; unpublished: number; awaitingAck: number; acknowledged: number; disputed: number;
  publishedPct: number; ackPctOfPublished: number; disputedPctOfPublished: number;
}
export interface CycleRow {
  id: string; status: string; processName: string | null; branchName: string | null; weekStart: string; weekEnd: string;
  publishedAt: string | null; publishedBy: string | null; ackDeadline: string | null;
}
export interface PublishOverview {
  from: string; to: string; funnel: Funnel; previous: Funnel | null;
  deltas: { publishedPct: number | null; ackPctOfPublished: number | null };
  byStage: Array<{ status: string; count: number }>;
  byWeek: Array<Funnel & { week: string }>;
  upcomingUnpublished: number;
  cycleCounts: Array<{ status: string; count: number }>;
  cycles: CycleRow[]; cyclesTruncated: boolean; cyclesIgnoreLob: boolean;
}

export interface LatenessOverview {
  from: string; to: string; threshold: number;
  totals: { events: number; employees: number; avgNetMinutes: number; mild: number; moderate: number; severe: number; severePct: number; habitualEmployees: number };
  daily: Array<{ date: string; events: number; employees: number }>;
  habitual: Array<{ employeeId: string; employeeCode: string; employeeName: string; branchName: string | null; processName: string | null; events: number; avgNetMinutes: number; maxMinutes: number }>;
  habitualTruncated: boolean;
  byProcess: Array<{ processId: string | null; name: string; events: number; employees: number }>;
}

/** aon-bucket-* report rows (existing reports-suite API). */
export interface AonRow { aon_bucket?: string; headcount?: number; exits?: number; month?: string }
