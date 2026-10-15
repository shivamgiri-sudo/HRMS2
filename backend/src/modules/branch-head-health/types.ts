import type { HeadBranch } from "./scope.js";

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
  status: "healthy" | "watch" | "critical";
  attention: Array<{ label: string; detail: string; severity: "critical" | "warning" }>;
  positives: Array<{ label: string; detail: string }>;
  people: SectionResult<unknown>;
  attendance: SectionResult<unknown>;
  hiring: SectionResult<unknown>;
  finance: SectionResult<unknown>;
  leaderboard: SectionResult<LeaderboardRow[]>;
}
