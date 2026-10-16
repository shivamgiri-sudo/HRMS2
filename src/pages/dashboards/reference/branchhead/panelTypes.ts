import type { SectionResult } from "../../../../../backend/src/modules/branch-head-health/types";

/** Shapes of the enriched overview sections (built field by field in backend overview.ts). */
export interface PeopleData {
  totalActive: number; joinedToday: number; leftToday: number; joinedMtd: number; leftMtd: number;
  upcomingExits: number; exitsNotClosed: number; mandateSeatsTotal: number | null;
  byProcess: Array<{ process: string; active: number; joinedMtd: number; leftMtd: number; mandateSeats: number | null }>;
  byLob: Array<{ lob: string; active: number }>;
}
export interface AttendanceData {
  scheduled: number; present: number; absent: number; onLeave: number; shrinkagePct: number;
  yetToStart: number; totalLate: number;
  bySlot: Array<{ process: string; shift: string; planned: number; present: number; absent: number; late: number }>;
  processWise: Array<{ process: string; late: number }>;
  previousDay: { shrinkagePct: number; absent: number; scheduled: number } | null;
  weekOffWorked: number;
}
export interface OfferWindow { offered: number; joined: number; notJoined: number; conversionPct: number | null }
export interface HiringData {
  openPositions: number; inPipeline: number; selected: number; requested: number; fulfilled: number; pendingApproval: number;
  batches: Array<{
    process: string; designation: string; priority: string; requested: number; fulfilled: number; openPositions: number;
    inPipeline: number; selected: number; deliveryDate: string; daysToDelivery: number; plannedBatch: string | null;
  }>;
  offers: { last30: OfferWindow; mtd: OfferWindow; joiningNext7Days: number } | null;
  ats: {
    walkins: number; tokens: number; tokensClosed: number; selected: number; rejected: number; noShow: number;
    clientRound: number; hold: number; otherClosed: number; open: number; noFeedback: number;
    openQueueCompleted: number; slaBreaches: number; slaTotal: number;
  } | null;
  pendingActions: Array<{ type: string; count: number; label: string }>;
}
export interface HeadRow { head: string; budget: number; charged: number; pct: number }
export interface FinanceData {
  periodCode: string; revenueRunning: number; totalCostRunning: number; operatingProfit: number; opPct: number | null;
  budgetUtilizationPct: number;
  pnl: {
    periodCode: string; daysInMonth: number; daysElapsed: number; mode: string;
    revenueInvoice: number; revenueAccrual: number; revenueEstimated: number; creditNote: number; revenueRunning: number;
    salaryRunning: number; grnConsumed: number; grnReserved: number; totalCostRunning: number;
    operatingProfit: number; opPct: number | null; staffPaid: number; estimatedCostCentres: number; costCentres: number;
    dataAvailable: boolean;
  };
  projection: { revenue: number; cost: number; operatingProfit: number; opPct: number | null; basis: string } | null;
  budget: {
    periodCode: string | null; totalBudget: number; consumed: number; reserved: number; available: number;
    utilizationPct: number; headerMissing: boolean | null; headerStatus: string | null;
  };
  byHead: { top: HeadRow[]; overBudget: HeadRow[] };
  grn: {
    raised: number; approved: number; pending: number; oldestPendingDays: number; pendingOver3Days: number; totalRaisedAmount: number;
    pendingByStage: Array<{ status: string; stage: string; count: number; amountInclGst: number; oldestDays: number }>;
    byType: Array<{ type: string; label: string; raised: number; raisedInclGst: number; raisedExGst: number; approved: number; pending: number; pendingInclGst: number }>;
    bridge: {
      raisedExGst: number; awaitingApproval: number; earlierBudget: number; noBudgetLine: number;
      chargedThisMonth: number; fromEarlierMonths: number; budgetChargeTotal: number;
    };
    unbudgeted: { count: number; amountExGst: number };
  } | null;
  tieOut: {
    budgetConsumed: number; budgetReserved: number; hrmsNoBudgetLine: number; hrmsOrdinary: number; imprestReservedNoCostCentre: number;
  } | null;
  payrollReadiness: {
    cycleMonth: string; pendingRegularization: number | null; pendingLeave: number | null; pendingIncrements: number | null;
    oldestIncrementDays: number | null;
  } | null;
}

/** The overview types these sections as `unknown`; panels narrow them here in one place. */
export const asData = <T,>(s: SectionResult<unknown> | undefined): { section: SectionResult<unknown>; data: T | null } | null =>
  s ? { section: s, data: s.status === "ok" ? (s.data as T | null) : null } : null;
