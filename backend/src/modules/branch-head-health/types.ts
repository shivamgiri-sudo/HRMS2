import type { HeadBranch } from "./scope.js";
import type { PillarScore } from "./score.js";
import type { ProcessGroups } from "./processes.js";
import type { DataHealth } from "./dataHealth.js";

export type SectionStatus = "ok" | "empty" | "error";

export interface SectionResult<T> {
  status: SectionStatus;
  data: T | null;
  asOf: string;
  message?: string;
}

export interface LeaderboardRow {
  manager: string;
  late: number;
  shrinkagePct: number | null;
}

export interface AttritionData {
  critical: number; high: number; medium: number; low: number;
  expectedExits30: number | null; absentStreak: number; newJoinerRisk: number;
  exits30: number; exitsPrev30: number; exits90: number; earlyExitSharePct: number | null;
  monthlyExits: Array<{ month: string; exits: number }>;
  byProcess: Array<{ process: string; headcount: number; highRisk: number; absentStreak: number }>;
  topRiskCount: number;
  calibrationNote: string | null;
}

export interface BacklogAggregate {
  pending: number; oldestDays: number; over3Days: number; over7Days: number;
}

export interface BacklogsData {
  regularization: BacklogAggregate & { escalated: number };
  leaveAging: BacklogAggregate & { staleOlderThanWindow: number };
}

export interface ProcessPnlRow {
  processId: string; processName: string; clientName: string | null;
  revenue: number; peopleCost: number; otherCost: number; ebitda: number;
  operatingProfit: number; opPct: number | null;
  status: "profitable" | "at-risk" | "loss-making";
  seatFillPct: number | null; mandatedSeats: number | null; activeHc: number;
  outstandingReceivable: number; revenueVsBudget: number | null;
}

export interface ProcessPnlData {
  period: string;
  totals: {
    revenue: number; totalCost: number; operatingProfit: number; opPct: number | null;
    loss: number; atRisk: number; profitable: number; noActivity: number; outstandingReceivable: number;
  };
  rows: ProcessPnlRow[];
}

export interface BranchOverview {
  branch: HeadBranch;
  date: string;
  status: "healthy" | "watch" | "critical" | "no_data";
  attention: Array<{ label: string; detail: string; severity: "critical" | "warning" }>;
  positives: Array<{ label: string; detail: string }>;
  people: SectionResult<unknown>;
  attendance: SectionResult<unknown>;
  hiring: SectionResult<unknown>;
  finance: SectionResult<unknown>;
  leaderboard: SectionResult<LeaderboardRow[]>;
  operations?: SectionResult<unknown>;
  quality?: SectionResult<unknown>;
  callmaster?: SectionResult<unknown>;
  attrition?: SectionResult<AttritionData>;
  backlogs?: SectionResult<BacklogsData>;
  processPnl?: SectionResult<ProcessPnlData>;
}

export interface BranchHeadHealthPayload {
  scope: { viaHomeFallback: boolean; orgWide: boolean; emptyReason: string | null };
  branches: Array<{
    branch: HeadBranch;
    overview: BranchOverview;
    score: { score: number; pillars: PillarScore[]; excluded: string[] } | null;
  }>;
  processes: ProcessGroups;
  processesError?: boolean;
  /** Across the selected branches (not per branch). */
  dataHealth?: SectionResult<DataHealth>;
  generatedAt: string;
}
