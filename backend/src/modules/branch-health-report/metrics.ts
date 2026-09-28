/**
 * Branch Health Report — thresholds, signal classification and report-data model.
 */
import { CONSECUTIVE_ABSENCE_DAYS, type BranchHealthRawData } from "./query.js";

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

const DELIVERY_SOON_DAYS = 7;
const OFFER_JOIN_WARN_PCT = 70;
const ATTRITION_WARN_PCT = 5;

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
  const slaPct =
    raw.ats.slaTotal > 0
      ? Math.round((raw.ats.slaBreaches / raw.ats.slaTotal) * 100)
      : 0;
  if (slaPct >= T.sla.criticalPct) {
    criticalPoints.push({
      label: "ATS SLA critical",
      detail: `${slaPct}% of tokens waited more than 20 min before being called`,
      severity: "critical",
    });
  } else if (slaPct >= T.sla.warnPct) {
    criticalPoints.push({
      label: "ATS SLA warning",
      detail: `${slaPct}% of tokens waited more than 20 min`,
      severity: "warning",
    });
  }

  // Stale pending GRNs
  if (raw.grnStats.pendingOver3Days > 0) {
    criticalPoints.push({
      label: `${raw.grnStats.pendingOver3Days} GRN${raw.grnStats.pendingOver3Days > 1 ? "s" : ""} pending more than 3 days`,
      detail: `Oldest open GRN is ${raw.grnStats.oldestPendingDays} days old`,
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
  const selectionPct =
    raw.ats.walkins > 0
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

  // Open hiring (Job Requisition page): batches due soon that are still short
  const dueSoon = raw.openHiring.rows.filter(
    (r) => r.daysToDelivery <= DELIVERY_SOON_DAYS,
  );
  if (dueSoon.length > 0) {
    const short = dueSoon.reduce((n, r) => n + r.openPositions, 0);
    criticalPoints.push({
      label: `${dueSoon.length} batch${dueSoon.length > 1 ? "es" : ""} due within ${DELIVERY_SOON_DAYS} days, ${short} positions still open`,
      detail: dueSoon
        .map(
          (r) =>
            `${r.code} (${r.openPositions} open, ${r.inPipeline} in pipeline)`,
        )
        .join(" · "),
      severity: "warning",
    });
  }
  if (raw.openHiring.inPipeline > 0) {
    positiveAchievements.push({
      label: `${raw.openHiring.inPipeline} candidate${raw.openHiring.inPipeline > 1 ? "s" : ""} in the hiring pipeline`,
      detail: `${raw.openHiring.selected} selected · ${raw.openHiring.openPositions} positions open across ${raw.openHiring.upcomingRequisitions} upcoming batches`,
    });
  }

  // Running P&L snapshot
  const pnl = raw.runningPnl;
  if (pnl.dataAvailable && pnl.opPct != null) {
    if (pnl.opPct < 0) {
      criticalPoints.push({
        label: `Running operating loss: ${pnl.opPct.toFixed(1)}% OP`,
        detail: `Revenue ₹${fmt(pnl.revenueRunning)} vs cost ₹${fmt(pnl.totalCostRunning)} (salary + GRN) to date`,
        severity: "warning",
      });
    } else {
      positiveAchievements.push({
        label: `Running operating profit: ${pnl.opPct.toFixed(1)}% OP`,
        detail: `Revenue ₹${fmt(pnl.revenueRunning)} · Cost ₹${fmt(pnl.totalCostRunning)} to date`,
      });
    }
  }

  // Unbudgeted spend, backlogs, absence, conversion, attrition
  const unbudgeted = raw.grnStats.unbudgeted;
  if (unbudgeted.count > 0) {
    criticalPoints.push({
      label: `${unbudgeted.count} unbudgeted GRN${unbudgeted.count > 1 ? "s" : ""} (₹${fmt(unbudgeted.amountExGst)} ex-GST)`,
      detail:
        "Raised without a budget line — approval does not need one, so this spend is on record but no budget line covers it",
      severity: "warning",
    });
  }
  if (raw.budgetByHead.overBudget.length > 0) {
    criticalPoints.push({
      label: `${raw.budgetByHead.overBudget.length} head${raw.budgetByHead.overBudget.length > 1 ? "s" : ""} over budget`,
      detail: raw.budgetByHead.overBudget
        .map((h) => `${h.head} (${h.pct}%)`)
        .join(" · "),
      severity: "critical",
    });
  }
  if (raw.absence.total > 0) {
    criticalPoints.push({
      label: `${raw.absence.total} employee${raw.absence.total > 1 ? "s" : ""} absent ${CONSECUTIVE_ABSENCE_DAYS}+ days running`,
      detail: raw.absence.rows
        .slice(0, 5)
        .map((r) => `${r.name} (${r.manager})`)
        .join(" · "),
      severity: "warning",
    });
  }
  if (raw.leaveAging.over7Days > 0 || raw.regularization.over7Days > 0) {
    criticalPoints.push({
      label: "Approvals pending more than 7 days",
      detail: `${raw.leaveAging.over7Days} leave · ${raw.regularization.over7Days} regularization`,
      severity: "warning",
    });
  }
  if (
    raw.offers.conversionPct != null &&
    raw.offers.conversionPct < OFFER_JOIN_WARN_PCT
  ) {
    criticalPoints.push({
      label: `Offer-to-join only ${raw.offers.conversionPct}%`,
      detail: `${raw.offers.joined} of ${raw.offers.offered} offered candidates joined in the last 30 days`,
      severity: "warning",
    });
  }
  const hc = raw.headcount;
  const avgHc =
    (hc.totalActive + hc.leftMtd - hc.joinedMtd + hc.totalActive) / 2;
  const attritionPct = avgHc > 0 ? (hc.leftMtd / avgHc) * 100 : 0;
  if (attritionPct >= ATTRITION_WARN_PCT) {
    criticalPoints.push({
      label: `Attrition ${attritionPct.toFixed(1)}% this month`,
      detail: `${hc.leftMtd} left, ${hc.joinedMtd} joined (net ${hc.joinedMtd - hc.leftMtd}); ${hc.upcomingExits} more exits due in 30 days`,
      severity: "warning",
    });
  }

  if (raw.ats.open > 0) {
    criticalPoints.push({
      label: `${raw.ats.open} walk-in token${raw.ats.open > 1 ? "s" : ""} pending closure`,
      detail:
        raw.ats.openQueueCompleted > 0
          ? `${raw.ats.openQueueCompleted} marked completed in the queue with no interview outcome — candidate still waiting`
          : "No interview outcome recorded yet",
      severity: "warning",
    });
  }

  const hasCritical = criticalPoints.some((p) => p.severity === "critical");
  const hasWarning = criticalPoints.some((p) => p.severity === "warning");
  const overallStatus: "healthy" | "watch" | "critical" = hasCritical
    ? "critical"
    : hasWarning
      ? "watch"
      : "healthy";

  return { criticalPoints, positiveAchievements, overallStatus };
}

export function buildBranchHealthReport(
  branch: string,
  reportDate: string,
  raw: BranchHealthRawData,
): BranchHealthReport {
  const { criticalPoints, positiveAchievements, overallStatus } =
    classifySignals(raw);
  return {
    branch,
    reportDate,
    raw,
    criticalPoints,
    positiveAchievements,
    overallStatus,
  };
}

function fmt(n: number): string {
  return n.toLocaleString("en-IN");
}
