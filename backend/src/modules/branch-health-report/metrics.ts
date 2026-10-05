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
  /** Overdue / persistent problems the branch must act on now. Shown in red at the top of the email. */
  escalations: Escalation[];
  /** Keys that were red today, whether or not they reached the banner yet (e.g. shrinkage above 10% on day one). */
  trackedKeys: string[];
  positiveAchievements: PositiveAchievement[];
  overallStatus: "healthy" | "watch" | "critical";
}

export interface Escalation {
  /** Stable id used to count consecutive red days in the history table. */
  key: string;
  /** Consecutive days red including today; filled from history after the report is built. */
  days?: number;
  /** First day of the current red streak. */
  since?: string;
  label: string;
  detail: string;
  /** Who should act, shown as a tag. */
  owner: string;
}

// ─── thresholds ───────────────────────────────────────────────────────────────

const DELIVERY_SOON_DAYS = 7;
const OFFER_JOIN_WARN_PCT = 70;
const ATTRITION_WARN_PCT = 5;

/** Deadlines after which a still-open item is an escalation. */
const E = {
  budgetCreateByDay: 2,
  budgetApproveByDay: 5,
  paceAheadPts: 20,
  grnStaleDays: 5,
  approvalStaleDays: 10,
  offerJoinCriticalPct: 50,
  exitsOpen: 3,
};

const T = {
  budget: { warnPct: 80, criticalPct: 95 },
  shrinkage: { warnPct: 10, criticalPct: 20 },
  late: { warnCount: 5, criticalCount: 15 },
  sla: { warnPct: 20, criticalPct: 40 },
  grn: { manyPending: 5 },
  ats: { goodSelectionPct: 30 },
};

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

/** Month name and day-of-month of a YYYY-MM-DD report date. */
function shiftDays(d: string, by: number): string {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + by);
  return x.toISOString().slice(0, 10);
}

function monthDay(reportDate: string): { name: string; day: number; daysInMonth: number } {
  const y = Number(reportDate.slice(0, 4));
  const mo = Number(reportDate.slice(5, 7));
  return {
    name: `${MONTHS[mo - 1]} ${y}`,
    day: Number(reportDate.slice(8, 10)),
    daysInMonth: new Date(Date.UTC(y, mo, 0)).getUTCDate(),
  };
}

/**
 * Time-aware "this should already be done / has not moved" rules. Each one fires only when the
 * deadline for that item has passed, so a normal day produces none. Stateless: every rule reads
 * data that already carries its own age (month day, oldest-pending days, previous-day shrinkage).
 */
export function buildEscalations(raw: BranchHealthRawData, reportDate: string): Escalation[] {
  const out: Escalation[] = [];
  const { name: month, day, daysInMonth } = monthDay(reportDate);
  const monthPct = (day / daysInMonth) * 100;
  const add = (key: string, label: string, detail: string, owner: string) => out.push({ key, label, detail, owner });

  // Budget lifecycle: created by day 2, approved by day 5.
  if (raw.branchId) {
    if (raw.budgetHeader.missing && day >= E.budgetCreateByDay) {
      add("budget_missing", `${month} budget NOT CREATED — day ${day} of the month`,
        `It should exist by day ${E.budgetCreateByDay}. Without it every GRN this month is unbudgeted and nothing can be tracked against a limit`, "Branch Head");
    } else if (raw.budgetHeader.status === "draft" && day >= E.budgetCreateByDay) {
      add("budget_draft", `${month} budget still in DRAFT — day ${day}`, "Created but never submitted for approval", "Branch Head");
    } else if (
      raw.budgetHeader.status && raw.budgetHeader.status !== "finance_head_approved" &&
      raw.budgetHeader.status !== "draft" && day >= E.budgetApproveByDay
    ) {
      add("budget_unapproved", `${month} budget NOT APPROVED — day ${day}, status: ${raw.budgetHeader.status.replace(/_/g, " ")}`,
        `Should be fully approved by day ${E.budgetApproveByDay}`, "Finance Head");
    }
  }

  // Spend pace: money used well ahead of the calendar.
  if (raw.budget.totalBudget > 0 && day >= 5) {
    const usedPct = ((raw.budget.consumed + raw.budget.reserved) / raw.budget.totalBudget) * 100;
    if (usedPct >= monthPct + E.paceAheadPts && usedPct >= 50) {
      add("spend_pace", `Spending far ahead of the month: ${usedPct.toFixed(0)}% of budget used, ${monthPct.toFixed(0)}% of month gone`,
        `At this pace the budget runs out around day ${Math.max(day, Math.floor((day * 100) / usedPct))} of ${daysInMonth}`, "Branch Head");
    }
  }

  // Same bad state two days running.
  const sh = raw.shrinkage;
  const prev = raw.prevShrinkage;
  if (prev && sh.shrinkagePct >= T.shrinkage.warnPct && prev.shrinkagePct >= T.shrinkage.warnPct) {
    add("shrinkage_high", `Shrinkage above ${T.shrinkage.warnPct}% for 2 days running (${prev.shrinkagePct}% yesterday, ${sh.shrinkagePct}% today)`,
      "This is not a one-day blip — the cause has not been fixed", "Ops Manager");
  }

  // Aged approvals.
  const g = raw.grnStats;
  if (g.pending > 0 && g.oldestPendingDays >= E.grnStaleDays) {
    add("grn_stuck", `${g.pending} GRN${g.pending > 1 ? "s" : ""} stuck in approval — oldest ${g.oldestPendingDays} days`,
      "Vendors are waiting and the spend is not charged to any budget until approved", "Approvers");
  }
  if (day >= daysInMonth - 2 && g.pending > 0) {
    add("grn_month_end", `Month closes in ${daysInMonth - day} day${daysInMonth - day === 1 ? "" : "s"} with ${g.pending} GRN${g.pending > 1 ? "s" : ""} unapproved`,
      "Unapproved GRNs fall out of this month's P&L and budget", "Approvers");
  }
  if (raw.leaveAging.oldestDays >= E.approvalStaleDays || raw.regularization.oldestDays >= E.approvalStaleDays) {
    add("approvals_aged", `Leave / regularization requests waiting ${Math.max(raw.leaveAging.oldestDays, raw.regularization.oldestDays)}+ days`,
      `${raw.leaveAging.over7Days} leave and ${raw.regularization.over7Days} regularization requests are over 7 days old; payroll will be wrong if they stay open`, "Managers");
  }
  if (raw.regularization.escalated > 0) {
    add("reg_escalated", `${raw.regularization.escalated} regularization request${raw.regularization.escalated > 1 ? "s" : ""} already escalated and still open`, "Manager did not act before escalation", "Managers");
  }

  // Hiring delivery already missed.
  if (raw.openHiring.pastDeliveryRequisitions > 0 && raw.openHiring.pastDeliveryOpenPositions > 0) {
    add("hiring_past_delivery", `${raw.openHiring.pastDeliveryRequisitions} batch${raw.openHiring.pastDeliveryRequisitions > 1 ? "es" : ""} PAST delivery date, ${raw.openHiring.pastDeliveryOpenPositions} positions still unfilled`,
      "Client delivery date has gone; seats are empty", "Recruitment");
  }
  if (raw.offers.conversionPct != null && raw.offers.offered >= 5 && raw.offers.conversionPct < E.offerJoinCriticalPct) {
    add("offer_join_low", `Offer-to-join only ${raw.offers.conversionPct}% (${raw.offers.joined}/${raw.offers.offered}) in 30 days`,
      "More than half of the offers are being wasted", "Recruitment");
  }

  // Exits / absconding left open.
  if (raw.headcount.exitsNotClosed >= E.exitsOpen) {
    add("exits_open", `${raw.headcount.exitsNotClosed} exits not closed in the system`, "Clearance / F&F cannot start until the exit is closed", "HR");
  }
  const at = raw.attrition;
  if (at && at.absentStreak >= 5) {
    add("absent_streak", `${at.absentStreak} employees absent 3+ days in a row`, "Possible absconding — contact each one today and record the outcome", "Branch HR");
  }

  // Loss that has persisted long enough to be real.
  const pnl = raw.runningPnl;
  if (pnl.dataAvailable && pnl.opPct != null && pnl.opPct < 0 && day >= 10) {
    add("loss_making", `Branch is loss-making ${day} days into the month: ${pnl.opPct.toFixed(1)}% OP`,
      `Revenue ₹${fmt(pnl.revenueRunning)} vs cost ₹${fmt(pnl.totalCostRunning)}`, "Branch Head");
  }
  if (raw.budgetByHead.overBudget.length > 0) {
    add("heads_over", `${raw.budgetByHead.overBudget.length} budget head${raw.budgetByHead.overBudget.length > 1 ? "s" : ""} already OVER budget`,
      raw.budgetByHead.overBudget.map((h) => `${h.head} (${h.pct}%)`).join(" · "), "Branch Head");
  }
  if (raw.grnStats.unbudgeted.count > 0) {
    add("unbudgeted_spend", `₹${fmt(raw.grnStats.unbudgeted.amountExGst)} spent with no budget line (${raw.grnStats.unbudgeted.count} GRN${raw.grnStats.unbudgeted.count > 1 ? "s" : ""})`,
      "Spend on record but not covered by any approved budget", "Branch Head");
  }

  // Payroll readiness for the cycle month: every rule needs a calendar date that has passed.
  const pr = raw.payrollReadiness;
  const cal = pr?.calendar;
  if (pr && cal) {
    const [cy, cm] = pr.cycleMonth.split("-").map(Number);
    const cycleName = `${MONTHS[cm - 1]} ${cy}`;
    const passed = (d: string | null) => !!d && reportDate > d;
    const daysLate = (d: string) => Math.round((Date.parse(`${reportDate}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86400000);
    const cutoff = cal.attendanceCutoff;
    if (passed(cutoff) && ((pr.pendingRegularization ?? 0) > 0 || (pr.pendingLeave ?? 0) > 0)) {
      add("payroll_attendance_open", `${cycleName} attendance NOT CLOSED — cut-off was ${cutoff} (${daysLate(cutoff!)} day${daysLate(cutoff!) === 1 ? "" : "s"} ago)`,
        `${pr.pendingRegularization ?? 0} regularization and ${pr.pendingLeave ?? 0} leave request${(pr.pendingLeave ?? 0) === 1 ? "" : "s"} for ${cycleName} still undecided; payroll will be paid on incomplete attendance`, "Managers / Branch HR");
    }
    const incDeadline = cal.incentiveDeadline;
    if (passed(incDeadline) && pr.incentivesExpected && pr.incentiveState === "none") {
      add("payroll_incentive_missing", `${cycleName} incentives NOT UPLOADED — deadline was ${incDeadline}`,
        "This branch uploaded incentives in earlier months; staff will be paid without them unless uploaded and approved", "Branch Head / MIS");
    } else if (passed(incDeadline) && pr.incentiveState === "pending_approval") {
      add("payroll_incentive_unapproved", `${cycleName} incentives uploaded but NOT APPROVED — deadline was ${incDeadline}`,
        "Uploaded batch is waiting for approval; unapproved incentives are not paid", "Finance / Payroll Head");
    }
    const runDate = cal.payrollRunDate;
    if ((pr.pendingIncrements ?? 0) > 0 && runDate && reportDate >= shiftDays(runDate, -3)) {
      add("payroll_increments_pending", `${pr.pendingIncrements} salary increment${(pr.pendingIncrements ?? 0) > 1 ? "s" : ""} not approved — payroll runs ${runDate}`,
        `Oldest request is ${pr.oldestIncrementDays ?? 0} days old; an increment approved after the run misses ${cycleName} pay`, "Payroll Head");
    }
  }
  return out;
}

export function classifySignals(raw: BranchHealthRawData, reportDate: string = ""): {
  criticalPoints: CriticalPoint[];
  escalations: Escalation[];
  trackedKeys: string[];
  positiveAchievements: PositiveAchievement[];
  overallStatus: "healthy" | "watch" | "critical";
} {
  const escalations = reportDate ? buildEscalations(raw, reportDate) : [];
  const trackedKeys = [...new Set([
    ...escalations.map((e) => e.key),
    ...(raw.shrinkage.shrinkagePct >= T.shrinkage.warnPct ? ["shrinkage_high"] : []),
  ])];
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

  // Attrition & retention risk (same scoring as the AON & Attrition page)
  const at = raw.attrition;
  if (at) {
    if (at.critical > 0) {
      criticalPoints.push({ label: `${at.critical} ${at.critical === 1 ? "person is" : "people are"} at critical attrition risk`,
        detail: `${at.high} more at high risk; about ${at.expectedExits30 ?? "?"} exits expected in the next 30 days. ${at.calibrationNote ?? ""}`.trim(), severity: "warning" });
    }
    if (at.absentStreak >= 5) {
      const share = at.headcount ? (at.absentStreak / at.headcount) * 100 : 0;
      criticalPoints.push({ label: `${at.absentStreak} employees absent 3+ days in a row`,
        detail: `${share.toFixed(1)}% of the branch - possible absconding; contact them and record the outcome${share >= 25 ? ". This share is very large: also confirm attendance is being recorded" : ""}`,
        severity: share >= 15 ? "critical" : "warning" });
    }
    if (at.exits30 >= 5 && at.exitsPrev30 > 0 && at.exits30 >= at.exitsPrev30 * 1.5) {
      criticalPoints.push({ label: `Exits rising: ${at.exits30} in 30 days vs ${at.exitsPrev30} before`,
        detail: `${at.earlyExitSharePct ?? 0}% of the last 90 days' exits left within 90 days of joining`, severity: "warning" });
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

  const hasCritical =
    escalations.length > 0 || criticalPoints.some((p) => p.severity === "critical");
  const hasWarning = criticalPoints.some((p) => p.severity === "warning");
  const overallStatus: "healthy" | "watch" | "critical" = hasCritical
    ? "critical"
    : hasWarning
      ? "watch"
      : "healthy";

  return { criticalPoints, escalations, trackedKeys, positiveAchievements, overallStatus };
}

export function buildBranchHealthReport(
  branch: string,
  reportDate: string,
  raw: BranchHealthRawData,
): BranchHealthReport {
  const { criticalPoints, escalations, trackedKeys, positiveAchievements, overallStatus } =
    classifySignals(raw, reportDate);
  return {
    branch,
    reportDate,
    raw,
    criticalPoints,
    escalations,
    trackedKeys,
    positiveAchievements,
    overallStatus,
  };
}

function fmt(n: number): string {
  return n.toLocaleString("en-IN");
}
