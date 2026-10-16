import type { SectionResult, ProcessPnlData, ProcessPnlRow, AttritionData, BacklogsData } from "../../../../../../backend/src/modules/branch-head-health/types";
import type { AttendanceData, FinanceData, HiringData, PeopleData } from "../panelTypes";

export const ok = <T,>(data: T): SectionResult<T> => ({ status: "ok", data, asOf: "2026-10-15" });
export const err = <T,>(message: string): SectionResult<T> => ({ status: "error", data: null, asOf: "2026-10-15", message });
export const emptySection = <T,>(): SectionResult<T> => ({ status: "empty", data: null, asOf: "2026-10-15" });

export const people: PeopleData = {
  totalActive: 120, joinedToday: 2, leftToday: 1, joinedMtd: 14, leftMtd: 6, upcomingExits: 4, exitsNotClosed: 3, mandateSeatsTotal: 130,
  byProcess: [
    { process: "Alpha Voice", active: 60, joinedMtd: 8, leftMtd: 3, mandateSeats: 50 },
    { process: "Beta Chat", active: 40, joinedMtd: 4, leftMtd: 2, mandateSeats: 0 },
    { process: "Gamma Back Office", active: 20, joinedMtd: 2, leftMtd: 1, mandateSeats: null },
  ],
  byLob: [{ lob: "Banking", active: 70 }, { lob: "Telecom", active: 50 }],
};
export const attendance: AttendanceData = {
  scheduled: 100, present: 88, absent: 8, onLeave: 4, shrinkagePct: 12, yetToStart: 3, totalLate: 12,
  bySlot: [{ process: "Alpha Voice", shift: "09:00-18:00", planned: 50, present: 45, absent: 5, late: 6 }],
  processWise: [{ process: "Alpha Voice", late: 9 }, { process: "Beta Chat", late: 3 }],
  previousDay: { shrinkagePct: 10, absent: 6, scheduled: 98 },
  weekOffWorked: 2,
};
export const hiring: HiringData = {
  openPositions: 4, inPipeline: 9, selected: 3, requested: 20, fulfilled: 12, pendingApproval: 1,
  batches: [{ process: "Alpha Voice", designation: "Telecaller", priority: "high", requested: 10, fulfilled: 4, openPositions: 6, inPipeline: 5, selected: 2, deliveryDate: "2026-10-25", daysToDelivery: 10, plannedBatch: "Batch A" }],
  offers: { last30: { offered: 40, joined: 28, notJoined: 12, conversionPct: 70 }, mtd: { offered: 15, joined: 9, notJoined: 6, conversionPct: 60 }, joiningNext7Days: 5 },
  ats: { walkins: 30, tokens: 28, tokensClosed: 20, selected: 8, rejected: 9, noShow: 3, clientRound: 2, hold: 1, otherClosed: 0, open: 8, noFeedback: 4, openQueueCompleted: 1, slaBreaches: 2, slaTotal: 28 },
  pendingActions: [{ type: "grn_pending", count: 3, label: "GRNs awaiting approval" }],
};
export const finance: FinanceData = {
  periodCode: "2026-10", revenueRunning: 6016216.8, totalCostRunning: 5200000, operatingProfit: 816216.8, opPct: 13.6, budgetUtilizationPct: 62.5,
  pnl: {
    periodCode: "2026-10", daysInMonth: 31, daysElapsed: 15, mode: "LIVE_MTD", revenueInvoice: 4000000, revenueAccrual: 1500000, revenueEstimated: 600000,
    creditNote: 83783.2, revenueRunning: 6016216.8, salaryRunning: 3900000, grnConsumed: 900000, grnReserved: 400000, totalCostRunning: 5200000,
    operatingProfit: 816216.8, opPct: 13.6, staffPaid: 110, estimatedCostCentres: 2, costCentres: 9, dataAvailable: true,
  },
  projection: { revenue: 12433000, cost: 10745000, operatingProfit: 1688000, opPct: 13.6, basis: "linear on days elapsed" },
  budget: { periodCode: "2026-10", totalBudget: 2000000, consumed: 800000, reserved: 450000, available: 750000, utilizationPct: 62.5, headerMissing: false, headerStatus: "active" },
  byHead: {
    top: [{ head: "Rent", budget: 500000, charged: 450000, pct: 90 }, { head: "Utilities", budget: 200000, charged: 260000, pct: 130 }],
    overBudget: [{ head: "Utilities", budget: 200000, charged: 260000, pct: 130 }],
  },
  grn: {
    raised: 12, approved: 7, pending: 5, oldestPendingDays: 6, pendingOver3Days: 2, totalRaisedAmount: 1200000,
    pendingByStage: [{ status: "pending_l1", stage: "Branch Head", count: 3, amountInclGst: 300000, oldestDays: 6 }],
    byType: [{ type: "vendor", label: "Vendor GRN", raised: 9, raisedInclGst: 1000000, raisedExGst: 850000, approved: 6, pending: 3, pendingInclGst: 300000 }],
    bridge: { raisedExGst: 1017000, awaitingApproval: 250000, earlierBudget: 10000, noBudgetLine: 5000, chargedThisMonth: 700000, fromEarlierMonths: 20000, budgetChargeTotal: 720000 },
    unbudgeted: { count: 1, amountExGst: 15000 },
  },
  tieOut: { budgetConsumed: 800000, budgetReserved: 450000, hrmsNoBudgetLine: 12000, hrmsOrdinary: 8000, imprestReservedNoCostCentre: 5000 },
  payrollReadiness: { cycleMonth: "2026-10", pendingRegularization: 4, pendingLeave: 2, pendingIncrements: 1, oldestIncrementDays: 3 },
};
const prow = (i: number, o: Partial<ProcessPnlRow> = {}): ProcessPnlRow => ({
  processId: `p${i}`, processName: `Process ${i}`, clientName: `Client ${i}`, revenue: 100000 * (i + 1), peopleCost: 50000, otherCost: 10000,
  ebitda: 1, operatingProfit: -50000 + i * 20000, opPct: -5 + i, status: i < 2 ? "loss-making" : i < 4 ? "at-risk" : "profitable",
  seatFillPct: 90, mandatedSeats: 20, activeHc: 18, outstandingReceivable: 12345, revenueVsBudget: null, ...o,
});
export const pnlRows = (n: number): ProcessPnlRow[] => Array.from({ length: n }, (_, i) => prow(i));
export const pnl = (n = 3): ProcessPnlData => {
  const rows = pnlRows(n);
  return {
    period: "2026-10",
    totals: {
      revenue: 9000000, totalCost: 8000000, operatingProfit: 1000000, opPct: 11.1,
      loss: rows.filter((r) => r.status === "loss-making").length, atRisk: rows.filter((r) => r.status === "at-risk").length,
      profitable: rows.filter((r) => r.status === "profitable").length, noActivity: 0, outstandingReceivable: 777000,
    },
    rows,
  };
};
export const attrition: AttritionData = {
  critical: 2, high: 5, medium: 9, low: 30, expectedExits30: 7, absentStreak: 4, newJoinerRisk: 3,
  exits30: 11, exitsPrev30: 9, exits90: 30, earlyExitSharePct: 35.5,
  monthlyExits: [{ month: "2026-08", exits: 8 }, { month: "2026-09", exits: 10 }],
  byProcess: [{ process: "Alpha Voice", headcount: 60, highRisk: 4, absentStreak: 2 }],
  topRiskCount: 7, calibrationNote: "Model calibrated on 12 months of exits",
};
export const backlogs: BacklogsData = {
  regularization: { pending: 14, oldestDays: 9, over3Days: 6, over7Days: 2, escalated: 1 },
  leaveAging: { pending: 5, oldestDays: 4, over3Days: 2, over7Days: 0, staleOlderThanWindow: 1 },
};
