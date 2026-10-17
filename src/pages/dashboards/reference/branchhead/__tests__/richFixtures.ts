import type { BranchHeadHealthPayload, BranchOverview, AttritionData, BacklogsData } from "../../../../../../backend/src/modules/branch-head-health/types";
import type { AttendanceData, FinanceData, HiringData, PeopleData, RecentGrn } from "../panelTypes";
import { ok, pnl, procRow } from "./fixtures";

/**
 * A realistic, fully populated branch (every emailed-report field carries values) for layout tests and the
 * local visual harness. Values are invented but internally consistent (sums, MTD vs today, stages).
 */
const PROCS = ["Alpha Voice", "Beta Chat", "Gamma Back Office", "Delta Collections", "Epsilon Sales", "Zeta Support"];

export const richPeople: PeopleData = {
  totalActive: 412, joinedToday: 4, leftToday: 2, joinedMtd: 38, leftMtd: 17, upcomingExits: 9, exitsNotClosed: 5, mandateSeatsTotal: 440,
  netMtd: 21, attritionMtdPct: 4.2,
  joinedNames: [{ name: "Priya Sharma" }, { name: "Rahul Verma" }, { name: "Sneha Iyer" }, { name: "Arjun Mehta" }],
  leftNames: [{ name: "Kiran Patil" }, { name: "Meera Joshi" }],
  absence: {
    total: 14, days: 3,
    rows: [
      { name: "Asha Rao", code: "MAS41001", process: "Alpha Voice", manager: "Vikram Nair" },
      { name: "Imran Khan", code: "MAS41002", process: "Beta Chat", manager: "Not mapped" },
      { name: "Pooja Das", code: "MAS41019", process: "Delta Collections", manager: "Sunil Rao" },
      { name: "Rohit Sen", code: "MAS41033", process: "Alpha Voice", manager: "Vikram Nair" },
      { name: "Farah Ali", code: "MAS41047", process: "Epsilon Sales", manager: "Neha Kapoor" },
      { name: "Dev Malhotra", code: "MAS41052", process: "Zeta Support", manager: "Anil Gupta" },
    ],
  },
  byProcess: [
    { process: "Alpha Voice", active: 128, joinedMtd: 12, leftMtd: 5, mandateSeats: 130, joinedToday: 2, leftToday: 1, netMtd: 7, attritionMtdPct: 3.9, mandateGap: -2 },
    { process: "Beta Chat", active: 86, joinedMtd: 8, leftMtd: 4, mandateSeats: 80, joinedToday: 1, leftToday: 0, netMtd: 4, attritionMtdPct: 4.7, mandateGap: 6 },
    { process: "Delta Collections", active: 74, joinedMtd: 9, leftMtd: 5, mandateSeats: 90, joinedToday: 1, leftToday: 1, netMtd: 4, attritionMtdPct: 6.9, mandateGap: -16 },
    { process: "Epsilon Sales", active: 58, joinedMtd: 6, leftMtd: 2, mandateSeats: 60, joinedToday: 0, leftToday: 0, netMtd: 4, attritionMtdPct: 3.5, mandateGap: -2 },
    { process: "Zeta Support", active: 40, joinedMtd: 3, leftMtd: 1, mandateSeats: 40, joinedToday: 0, leftToday: 0, netMtd: 2, attritionMtdPct: 2.5, mandateGap: 0 },
    { process: "Gamma Back Office", active: 26, joinedMtd: 0, leftMtd: 0, mandateSeats: null, joinedToday: 0, leftToday: 0, netMtd: 0, attritionMtdPct: 0, mandateGap: null },
  ],
  byLob: [{ lob: "Banking", active: 202 }, { lob: "Telecom", active: 124 }, { lob: "Retail", active: 60 }, { lob: "Insurance", active: 26 }],
};

const SHIFTS = ["07:00-16:00", "10:00-19:00", "14:00-23:00", "22:00-07:00"];
export const richAttendance: AttendanceData = {
  scheduled: 380, present: 331, absent: 31, onLeave: 18, shrinkagePct: 12.9, yetToStart: 14, totalLate: 37,
  bySlot: PROCS.flatMap((p, i) => SHIFTS.slice(0, 2 + (i % 3)).map((shift, j) => {
    const planned = 30 - i * 3 - j * 4;
    const absent = 1 + ((i + j) % 4);
    return { process: p, shift, planned, present: planned - absent - (j % 2), absent, late: (i * 2 + j) % 5 };
  })),
  processWise: [{ process: "Alpha Voice", late: 11 }, { process: "Delta Collections", late: 8 }, { process: "Beta Chat", late: 7 }, { process: "Epsilon Sales", late: 3 }, { process: "Zeta Support", late: 2 }],
  previousDay: { shrinkagePct: 11.2, absent: 27, scheduled: 376 },
  weekOffWorked: 6,
  bands: [
    { band: "Morning", planned: 168, absent: 13, late: 16 }, { band: "Afternoon", planned: 112, absent: 9, late: 10 },
    { band: "Evening", planned: 64, absent: 6, late: 4 }, { band: "Night", planned: 36, absent: 3, late: 1 },
  ],
  lateNotOnRoster: 6,
};

export const richHiring: HiringData = {
  openPositions: 46, inPipeline: 58, selected: 21, requested: 120, fulfilled: 74, pendingApproval: 3,
  batches: [
    { process: "Alpha Voice", designation: "Telecaller", priority: "high", requested: 30, fulfilled: 18, openPositions: 12, inPipeline: 15, selected: 6, deliveryDate: "2026-10-25", daysToDelivery: 10, plannedBatch: "AV-B14" },
    { process: "Delta Collections", designation: "Collection Agent", priority: "high", requested: 25, fulfilled: 9, openPositions: 16, inPipeline: 11, selected: 5, deliveryDate: "2026-10-22", daysToDelivery: 7, plannedBatch: "DC-B09" },
    { process: "Beta Chat", designation: "Chat Executive", priority: "medium", requested: 20, fulfilled: 14, openPositions: 6, inPipeline: 10, selected: 4, deliveryDate: "2026-11-02", daysToDelivery: 18, plannedBatch: null },
    { process: "Epsilon Sales", designation: "Sales Associate", priority: "low", requested: 15, fulfilled: 7, openPositions: 8, inPipeline: 12, selected: 3, deliveryDate: "2026-11-10", daysToDelivery: 26, plannedBatch: "ES-B03" },
    { process: "Zeta Support", designation: "Team Leader", priority: "medium", requested: 4, fulfilled: 0, openPositions: 4, inPipeline: 10, selected: 3, deliveryDate: "2026-10-30", daysToDelivery: 15, plannedBatch: null },
  ],
  offers: { last30: { offered: 64, joined: 45, notJoined: 19, conversionPct: 70.3 }, mtd: { offered: 31, joined: 20, notJoined: 11, conversionPct: 64.5 }, joiningNext7Days: 9 },
  ats: { walkins: 52, tokens: 48, tokensClosed: 35, selected: 14, rejected: 12, noShow: 5, clientRound: 4, hold: 3, otherClosed: 2, open: 8, noFeedback: 6, openQueueCompleted: 2, slaBreaches: 4, slaTotal: 48 },
  pendingActions: [
    { type: "grn_pending", count: 7, label: "GRNs awaiting approval", age: "oldest 9d · 4 over 3d", oldestDays: 9, over3Days: 4, over7Days: 1 },
    { type: "leave_pending", count: 12, label: "Leave requests pending", age: "oldest 5d · 3 over 3d", oldestDays: 5, over3Days: 3, over7Days: 0 },
    { type: "regularization_pending", count: 23, label: "Attendance regularizations pending", age: "oldest 11d · 5 over 7d · 2 escalated", oldestDays: 11, over3Days: 9, over7Days: 5 },
    { type: "exit_pending", count: 4, label: "Exit clearances pending", age: null, oldestDays: null, over3Days: null, over7Days: null },
  ],
};

const VENDORS = ["Sai Facility Services", "Bharat Telecom", "Quick Print Co", "Metro Security", "Cool Air HVAC", null];
const HEADS: Array<[string, string | null]> = [["Housekeeping", "Consumables"], ["Telecom", "Leased line"], ["Printing", null], ["Security", "Guards"], ["Repairs", "AC service"], ["Rent", "Office"]];
const STAGES: Array<[string, string]> = [["submitted", "Submitted"], ["pending_l1", "Branch Head"], ["pending_l2", "Finance"], ["approved", "Approved"], ["approved", "Approved"]];
export const richRecentGrns: RecentGrn[] = Array.from({ length: 15 }, (_, i) => ({
  grnNo: `GRN-2210-${String(60 - i).padStart(4, "0")}`, vendor: VENDORS[i % VENDORS.length], head: HEADS[i % HEADS.length][0], subHead: HEADS[i % HEADS.length][1],
  amountInclGst: 12000 + ((i * 37919) % 410000), status: STAGES[i % STAGES.length][0], stageLabel: STAGES[i % STAGES.length][1],
  raisedOn: `2026-10-${String(15 - Math.floor(i / 2)).padStart(2, "0")}`, ageDays: Math.floor(i / 2),
}));

export const richFinance: FinanceData = {
  recentGrns: richRecentGrns,
  history: [
    { periodCode: "2026-07", headerStatus: "closed", declared: 1900000, used: 1720000, effective: 1720000, afterClosure: 1720000, usedPct: 90.5, headsTotal: 12, headsClosed: 12, openRows: [] },
    { periodCode: "2026-08", headerStatus: "closed", declared: 1950000, used: 1810000, effective: 1835000, afterClosure: 1835000, usedPct: 92.8, headsTotal: 13, headsClosed: 12, openRows: [{ head: "Repairs", subHead: "AC service", budget: 60000, used: 35000 }] },
    { periodCode: "2026-09", headerStatus: "active", declared: 2000000, used: 1650000, effective: 1760000, afterClosure: 1760000, usedPct: 82.5, headsTotal: 14, headsClosed: 10,
      openRows: [{ head: "Rent", subHead: "Office", budget: 400000, used: 380000 }, { head: "Telecom", subHead: "Leased line", budget: 90000, used: 42000 }, { head: "Housekeeping", subHead: "Consumables", budget: 70000, used: 66000 }] },
  ],
  openSubheads: [
    { periodCode: "2026-08", head: "Repairs", subhead: "AC service", budgetHeld: 60000, spent: 35000 },
    { periodCode: "2026-09", head: "Rent", subhead: "Office", budgetHeld: 400000, spent: 380000 },
    { periodCode: "2026-09", head: "Telecom", subhead: "Leased line", budgetHeld: 90000, spent: 42000 },
    { periodCode: "2026-09", head: "Housekeeping", subhead: "Consumables", budgetHeld: 70000, spent: 66000 },
  ],
  periodCode: "2026-10", revenueRunning: 6016216.8, totalCostRunning: 5200000, operatingProfit: 816216.8, opPct: 13.6, budgetUtilizationPct: 62.5,
  pnl: {
    periodCode: "2026-10", daysInMonth: 31, daysElapsed: 15, mode: "LIVE_MTD", revenueInvoice: 4000000, revenueAccrual: 1500000, revenueEstimated: 600000,
    creditNote: 83783.2, revenueRunning: 6016216.8, salaryRunning: 3900000, grnConsumed: 900000, grnReserved: 400000, totalCostRunning: 5200000,
    operatingProfit: 816216.8, opPct: 13.6, staffPaid: 398, estimatedCostCentres: 2, costCentres: 9, dataAvailable: true,
  },
  projection: { revenue: 12433000, cost: 10745000, operatingProfit: 1688000, opPct: 13.6, basis: "linear on days elapsed" },
  budget: { periodCode: "2026-10", totalBudget: 2000000, consumed: 800000, reserved: 450000, available: 750000, utilizationPct: 62.5, headerMissing: false, headerStatus: "active" },
  byHead: {
    top: [
      { head: "Rent", budget: 500000, charged: 450000, pct: 90 }, { head: "Utilities", budget: 200000, charged: 260000, pct: 130 },
      { head: "Housekeeping", budget: 180000, charged: 121000, pct: 67.2 }, { head: "Telecom", budget: 150000, charged: 98000, pct: 65.3 },
      { head: "Security", budget: 140000, charged: 70000, pct: 50 }, { head: "Repairs", budget: 90000, charged: 104000, pct: 115.6 },
    ],
    overBudget: [{ head: "Utilities", budget: 200000, charged: 260000, pct: 130 }, { head: "Repairs", budget: 90000, charged: 104000, pct: 115.6 }],
  },
  grn: {
    raised: 42, approved: 31, pending: 11, oldestPendingDays: 9, pendingOver3Days: 4, totalRaisedAmount: 2350000,
    pendingByStage: [
      { status: "submitted", stage: "Submitted", count: 3, amountInclGst: 84000, oldestDays: 2 },
      { status: "pending_l1", stage: "Branch Head", count: 5, amountInclGst: 310000, oldestDays: 9 },
      { status: "pending_l2", stage: "Finance", count: 3, amountInclGst: 145000, oldestDays: 6 },
    ],
    byType: [
      { type: "vendor", label: "Vendor GRN", raised: 30, raisedInclGst: 1900000, raisedExGst: 1610000, approved: 23, pending: 7, pendingInclGst: 390000 },
      { type: "imprest", label: "Imprest", raised: 9, raisedInclGst: 310000, raisedExGst: 262000, approved: 6, pending: 3, pendingInclGst: 120000 },
      { type: "service", label: "Service GRN", raised: 3, raisedInclGst: 140000, raisedExGst: 118000, approved: 2, pending: 1, pendingInclGst: 29000 },
    ],
    bridge: { raisedExGst: 1990000, awaitingApproval: 460000, earlierBudget: 60000, noBudgetLine: 25000, chargedThisMonth: 1380000, fromEarlierMonths: 65000, budgetChargeTotal: 1445000 },
    unbudgeted: { count: 2, amountExGst: 25000 },
  },
  tieOut: { budgetConsumed: 800000, budgetReserved: 450000, hrmsNoBudgetLine: 12000, hrmsOrdinary: 8000, imprestReservedNoCostCentre: 5000 },
  payrollReadiness: { cycleMonth: "2026-10", pendingRegularization: 23, pendingLeave: 12, pendingIncrements: 3, oldestIncrementDays: 14 },
};

export const richAttrition: AttritionData = {
  critical: 6, high: 14, medium: 41, low: 351, expectedExits30: 13, absentStreak: 9, newJoinerRisk: 7,
  exits30: 19, exitsPrev30: 15, exits90: 52, earlyExitSharePct: 36.8,
  monthlyExits: [{ month: "2026-05", exits: 14 }, { month: "2026-06", exits: 17 }, { month: "2026-07", exits: 12 }, { month: "2026-08", exits: 18 }, { month: "2026-09", exits: 16 }, { month: "2026-10", exits: 9 }],
  byProcess: [
    { process: "Alpha Voice", headcount: 128, highRisk: 7, absentStreak: 3 }, { process: "Delta Collections", headcount: 74, highRisk: 6, absentStreak: 3 },
    { process: "Beta Chat", headcount: 86, highRisk: 4, absentStreak: 2 }, { process: "Epsilon Sales", headcount: 58, highRisk: 2, absentStreak: 1 },
    { process: "Zeta Support", headcount: 40, highRisk: 1, absentStreak: 0 },
  ],
  topRiskCount: 20,
  topRisk: [
    { code: "MAS42001", name: "Neha Singh", process: "Alpha Voice", aonDays: 45, score: 91, tier: "CRITICAL", reasons: ["Absent 3 days running", "New joiner", "Low attendance"], absentStreak: 3 },
    { code: "MAS42002", name: "Ravi Das", process: "Delta Collections", aonDays: 62, score: 87, tier: "CRITICAL", reasons: ["Late 6 times", "Low attendance"], absentStreak: 2 },
    { code: "MAS42003", name: "Kavya Nair", process: "Beta Chat", aonDays: 120, score: 82, tier: "CRITICAL", reasons: ["Resignation hint", "Salary hold"], absentStreak: 0 },
    { code: "MAS42004", name: "Aman Gill", process: "Alpha Voice", aonDays: 33, score: 78, tier: "HIGH", reasons: ["New joiner"], absentStreak: 1 },
    { code: "MAS42005", name: "Sara Thomas", process: null, aonDays: 210, score: 74, tier: "HIGH", reasons: [], absentStreak: 0 },
    { code: "MAS42006", name: "Vivek Rao", process: "Epsilon Sales", aonDays: 88, score: 71, tier: "HIGH", reasons: ["Late 4 times"], absentStreak: 0 },
  ],
  calibrationNote: "Scores are calibrated on the last 12 months of exits; a high score is a prompt to talk, not a prediction.",
};

export const richBacklogs: BacklogsData = {
  regularization: { pending: 23, oldestDays: 11, over3Days: 9, over7Days: 5, escalated: 2 },
  leaveAging: { pending: 12, oldestDays: 5, over3Days: 3, over7Days: 0, staleOlderThanWindow: 1 },
};

export const richOverview = (o: Partial<BranchOverview> = {}): BranchOverview => ({
  branch: { branchId: "b1", branchCode: "KOL", branchName: "Kolkata - Salt Lake" }, date: "2026-10-15", status: "watch",
  attention: [
    { label: "Shrinkage above 12%", detail: "12.9% of scheduled staff are out today (31 absent, 18 on leave)", severity: "warning" },
    { label: "Utilities over budget", detail: "₹2,60,000 charged against ₹2,00,000 (130%)", severity: "critical" },
    { label: "4 GRNs pending more than 3 days", detail: "Oldest is 9 days old at the Branch Head stage", severity: "warning" },
    { label: "Consecutive absence", detail: "14 people absent 3+ rostered days without a punch", severity: "critical" },
    { label: "Delta Collections under mandate", detail: "74 active against 90 seats", severity: "warning" },
    { label: "Regularizations ageing", detail: "5 requests older than 7 days", severity: "warning" },
  ],
  positives: [
    { label: "Operating profit positive", detail: "13.6% OP month to date" },
    { label: "Offer conversion holding", detail: "70% of offers joined in the last 30 days" },
    { label: "Zeta Support at mandate", detail: "40 of 40 seats filled" },
  ],
  people: ok(richPeople), attendance: ok(richAttendance), hiring: ok(richHiring), finance: ok(richFinance),
  leaderboard: ok([{ manager: "Secret Manager", late: 9, shrinkagePct: null }, { manager: "M2", late: 7, shrinkagePct: null }, { manager: "M3", late: 5, shrinkagePct: null }, { manager: "M4", late: 3, shrinkagePct: null }]),
  attrition: ok(richAttrition), backlogs: ok(richBacklogs), processPnl: ok(pnl(7)),
  operations: ok(PROCS.slice(0, 5).map((p, i) => ({
    processCode: `P${i}`, processName: p, tier: "full", latestDate: "2026-10-14", stale: i === 4,
    metrics: { AHT: 280 + i * 22, INBOUND_SL_PCT: i === 2 ? null : 78 + i * 3, QA_QUALITY_PCT: 82 - i * 2.5, FUNNEL_SALE_PCT: i === 4 ? 6.4 : null },
  }))),
  quality: ok(PROCS.slice(0, 4).map((p, i) => ({ processCode: `P${i}`, processName: p, tier: "full", QA_QUALITY_PCT: 72 + i * 4.5, latestDate: "2026-10-14", stale: i === 3 }))),
  callmaster: ok({
    kpis: ok({ inbound: { total: 1240, avg_quality: 84.2, fatal_score: 2.1, avg_cx: 79, avg_compliance: 91 }, outbound: { total: 410, conversion: 11.8, ob_quality: 77 } }),
    qualityTrend: ok([{ period: "2026-10-13", quality: 83, calls: 88, fatal: 1 }, { period: "2026-10-14", quality: 85, calls: 92, fatal: 0 }]),
    cx: ok({ params: { express_empathy: 88.5, active_listening: 81, resolution: 76.4 }, definitions: [{ key: "express_empathy", label: "Empathy expressed" }, { key: "active_listening", label: "Active listening" }] }),
    fatal: ok({ totalFatalCalls: 7, agentsWithFatals: 4, truncated: false }),
  }),
  ...o,
});

export const richPayload = (ov: BranchOverview = richOverview()): BranchHeadHealthPayload => ({
  scope: { viaHomeFallback: false, orgWide: false, emptyReason: null },
  branches: [{
    branch: ov.branch, overview: ov,
    score: { score: 68, pillars: [
      { key: "attendance", weight: 25, score: 71 }, { key: "people", weight: 20, score: 78 }, { key: "finance", weight: 20, score: 64 },
      { key: "hiring", weight: 15, score: 69 }, { key: "compliance", weight: 10, score: 52 }, { key: "quality", weight: 10, score: 74 },
    ], excluded: [] },
  }],
  processes: { active: PROCS.map((p, i) => procRow({ processId: `p-${i}`, processCode: `P${i}`, processName: p, headcount: 40 + i * 10, mandatedSeats: 50 })), unmapped: [] },
  dataHealth: ok({ unmappedProcesses: 1, costCentresWithoutProcess: 2, overMandate: [{ costCentre: "CC-KOL-07", seats: 80, headcount: 86 }], staleProcesses: 1 }),
  generatedAt: "2026-10-15T05:00:00Z",
});
