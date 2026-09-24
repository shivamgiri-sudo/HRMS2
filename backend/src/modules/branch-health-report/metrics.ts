/**
 * Branch Health Report — thresholds, signal classification and report-data model.
 */
import type { BranchHealthRawData } from "./query.js";

export interface CriticalPoint {
  label: string;
  detail: string;
  severity: "critical" | "warning";
}

export interface PositiveAchievement {
  label: string;
  detail: string;
}

export interface BranchHealthReport {
  branch: string;
  reportDate: string;
  raw: BranchHealthRawData;
  criticalPoints: CriticalPoint[];
  positiveAchievements: PositiveAchievement[];
  overallStatus: "healthy" | "watch" | "critical";
}

// ─── thresholds ───────────────────────────────────────────────────────────────

const T = {
  budget: { warnPct: 80, criticalPct: 95 },
  shrinkage: { warnPct: 10, criticalPct: 20 },
  late: { warnCount: 5, criticalCount: 15 },
  sla: { warnPct: 20, criticalPct: 40 },
  grn: { manyPending: 5 },
  ats: { goodSelectionPct: 30 },
};

export function classifySignals(raw: BranchHealthRawData): {
  criticalPoints: CriticalPoint[];
  positiveAchievements: PositiveAchievement[];
  overallStatus: "healthy" | "watch" | "critical";
} {
  const criticalPoints: CriticalPoint[] = [];
  const positiveAchievements: PositiveAchievement[] = [];

  // Budget
  const budgetPct = raw.budget.utilizationPct;
  if (budgetPct >= T.budget.criticalPct) {
    criticalPoints.push({
      label: "Budget nearly exhausted",
      detail: `${budgetPct}% of monthly budget consumed — only ₹${fmt(raw.budget.available)} remaining`,
      severity: "critical",
    });
  } else if (budgetPct >= T.budget.warnPct) {
    criticalPoints.push({
      label: "High budget utilization",
      detail: `${budgetPct}% consumed — ₹${fmt(raw.budget.available)} remaining`,
      severity: "warning",
    });
  } else if (budgetPct < 50 && raw.budget.totalBudget > 0) {
    positiveAchievements.push({
      label: "Budget on track",
      detail: `Only ${budgetPct}% of budget consumed this period`,
    });
  }

  // Shrinkage
  if (raw.shrinkage.shrinkagePct >= T.shrinkage.criticalPct) {
    criticalPoints.push({
      label: "Critical shrinkage today",
      detail: `${raw.shrinkage.shrinkagePct}% absent (${raw.shrinkage.absent}/${raw.shrinkage.scheduled} scheduled)`,
      severity: "critical",
    });
  } else if (raw.shrinkage.shrinkagePct >= T.shrinkage.warnPct) {
    criticalPoints.push({
      label: "Elevated shrinkage",
      detail: `${raw.shrinkage.shrinkagePct}% absent today (${raw.shrinkage.absent}/${raw.shrinkage.scheduled})`,
      severity: "warning",
    });
  } else if (raw.shrinkage.scheduled > 0 && raw.shrinkage.shrinkagePct < 5) {
    positiveAchievements.push({
      label: "Excellent attendance",
      detail: `Only ${raw.shrinkage.shrinkagePct}% shrinkage — ${raw.shrinkage.present} present out of ${raw.shrinkage.scheduled} scheduled`,
    });
  }

  // Late comers
  if (raw.lateStats.totalLate >= T.late.criticalCount) {
    criticalPoints.push({
      label: "High late arrivals",
      detail: `${raw.lateStats.totalLate} employees arrived late today`,
      severity: "critical",
    });
  } else if (raw.lateStats.totalLate >= T.late.warnCount) {
    criticalPoints.push({
      label: "Late arrivals flagged",
      detail: `${raw.lateStats.totalLate} employees arrived late today`,
      severity: "warning",
    });
  } else if (raw.lateStats.totalLate === 0 && raw.shrinkage.scheduled > 0) {
    positiveAchievements.push({
      label: "Zero late arrivals",
      detail: "All employees arrived on time today",
    });
  }

  // SLA
  const slaPct = raw.ats.slaTotal > 0
    ? Math.round((raw.ats.slaBreaches / raw.ats.slaTotal) * 100)
    : 0;
  if (slaPct >= T.sla.criticalPct) {
    criticalPoints.push({
      label: "ATS SLA critical",
      detail: `${slaPct}% of candidates waited >30 min before being called`,
      severity: "critical",
    });
  } else if (slaPct >= T.sla.warnPct) {
    criticalPoints.push({
      label: "ATS SLA warning",
      detail: `${slaPct}% of candidates waited >30 min`,
      severity: "warning",
    });
  }

  // Pending GRNs
  if (raw.grnStats.pending >= T.grn.manyPending) {
    criticalPoints.push({
      label: "GRN approvals backlog",
      detail: `${raw.grnStats.pending} GRNs awaiting approval`,
      severity: "warning",
    });
  }

  // ATS selection
  const selectionPct = raw.ats.walkins > 0
    ? Math.round((raw.ats.selected / raw.ats.walkins) * 100)
    : 0;
  if (raw.ats.walkins >= 5 && selectionPct >= T.ats.goodSelectionPct) {
    positiveAchievements.push({
      label: "Strong hiring conversion",
      detail: `${selectionPct}% selection rate today (${raw.ats.selected}/${raw.ats.walkins} walk-ins)`,
    });
  }

  // New joiners
  if (raw.headcount.joinedToday > 0) {
    positiveAchievements.push({
      label: `${raw.headcount.joinedToday} new joiner${raw.headcount.joinedToday > 1 ? "s" : ""} today`,
      detail: raw.headcount.joinedNames.slice(0, 5).join(", "),
    });
  }

  // Process performance
  const criticalProcesses = raw.processPerformance.filter((p) => p.status === "critical");
  const healthyProcesses = raw.processPerformance.filter((p) => p.status === "healthy");
  if (criticalProcesses.length) {
    criticalPoints.push({
      label: "Process performance below threshold",
      detail: criticalProcesses.map((p) => p.process).join(", "),
      severity: "critical",
    });
  }
  if (healthyProcesses.length && criticalProcesses.length === 0) {
    positiveAchievements.push({
      label: "All processes performing well",
      detail: `${healthyProcesses.length} process${healthyProcesses.length > 1 ? "es" : ""} above 80% score`,
    });
  }

  const hasCritical = criticalPoints.some((p) => p.severity === "critical");
  const hasWarning = criticalPoints.some((p) => p.severity === "warning");
  const overallStatus: "healthy" | "watch" | "critical" =
    hasCritical ? "critical" : hasWarning ? "watch" : "healthy";

  return { criticalPoints, positiveAchievements, overallStatus };
}

export function buildBranchHealthReport(branch: string, reportDate: string, raw: BranchHealthRawData): BranchHealthReport {
  const { criticalPoints, positiveAchievements, overallStatus } = classifySignals(raw);
  return { branch, reportDate, raw, criticalPoints, positiveAchievements, overallStatus };
}

function fmt(n: number): string {
  return n.toLocaleString("en-IN");
}
