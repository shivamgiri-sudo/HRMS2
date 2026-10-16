import type { DrillTarget, MetricDrillId } from "../drill";

/** A plain in-app route (must exist in navConfig; a test checks). */
export interface DrillLink { href: string; label: string }

export const DRILL_LINKS = {
  processPnl: { href: "/finance/process-pnl", label: "Process P&L" },
  branchBudget: { href: "/finance/branch-budget", label: "Branch Budget" },
  grn: { href: "/finance/grn", label: "GRN" },
  roster: { href: "/wfm/roster-command-center", label: "Roster Command Center" },
  attendanceIntegrity: { href: "/wfm/attendance-integrity", label: "Attendance integrity" },
  ats: { href: "/ats/command-center", label: "ATS" },
  aon: { href: "/workforce/aon-analytics", label: "AON and Attrition" },
  processOps: { href: "/process-operations", label: "Process Operations" },
  callMaster: { href: "/call-master", label: "Call Master" },
} as const satisfies Record<string, DrillLink>;

type Key = keyof typeof DRILL_LINKS;

const BY_METRIC: Record<MetricDrillId, Key[]> = {
  shrinkage: ["roster", "attendanceIntegrity"],
  late: ["roster", "attendanceIntegrity"],
  attendance: ["roster", "attendanceIntegrity"],
  headcount: ["roster", "aon"],
  attrition: ["aon"],
  profit: ["processPnl", "branchBudget"],
  finance: ["processPnl", "branchBudget", "grn"],
  pnl: ["processPnl", "branchBudget"],
  budget: ["branchBudget", "grn"],
  grn: ["grn", "branchBudget"],
  openings: ["ats"],
  hiring: ["ats"],
  backlog: ["attendanceIntegrity"],
  ops: ["processOps", "callMaster"],
};

const PROCESS: Key[] = ["processPnl", "roster", "processOps"];

/** The related pages for a drawer view. */
export function linksFor(target: DrillTarget): DrillLink[] {
  const keys = target.kind === "process" ? PROCESS : BY_METRIC[target.id] ?? [];
  return keys.map((k) => DRILL_LINKS[k]);
}
