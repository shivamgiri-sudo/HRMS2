import type { HeadBranch } from "./scope.js";
import type { PillarScore } from "./score.js";
import type { ProcessGroups } from "./processes.js";

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
  dataHealth?: SectionResult<unknown>;
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
  generatedAt: string;
}
