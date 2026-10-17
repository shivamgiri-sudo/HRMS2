/** Shapes of the enriched overview sections (built field by field in backend overview.ts). */
export interface PersonRef { name: string; code?: string; process?: string }
export interface AbsenceData {
  /** All flagged people; rows are capped at 10 as in the email. */
  total: number;
  /** Consecutive rostered working days with no punch that earn a flag (3). */
  days: number | string;
  rows: Array<{ name: string; code: string; process: string; manager: string }>;
}
export interface PeopleData {
  totalActive: number; joinedToday: number; leftToday: number; joinedMtd: number; leftMtd: number;
  upcomingExits: number; exitsNotClosed: number; mandateSeatsTotal: number | null;
  /** Net headcount change this month (joinedMtd - leftMtd). */
  netMtd: number;
  /** Left MTD / average headcount * 100, one decimal; null when the average is 0. */
  attritionMtdPct: number | null;
  /** Today's joiners / leavers, max 30 each (use joinedToday / leftToday for the true count). */
  joinedNames: PersonRef[];
  leftNames: PersonRef[];
  /** Consecutive absence (email section 7); null when the source is unavailable. */
  absence: AbsenceData | null;
  byProcess: Array<{
    process: string; active: number; joinedMtd: number; leftMtd: number; mandateSeats: number | null;
    joinedToday: number; leftToday: number; netMtd: number; attritionMtdPct: number | null;
    /** active - mandateSeats; null without a mandate. */
    mandateGap: number | null;
    /** Active headcount of the process split by line of business, largest first; sums to active. */
    lobs?: Array<{ lob: string; active: number }>;
  }>;
  byLob: Array<{ lob: string; active: number }>;
}
export interface AttendanceData {
  scheduled: number; present: number; absent: number; onLeave: number; shrinkagePct: number;
  yetToStart: number; totalLate: number;
  bySlot: Array<{ process: string; shift: string; planned: number; present: number; absent: number; late: number }>;
  processWise: Array<{ process: string; late: number }>;
  previousDay: { shrinkagePct: number; absent: number; scheduled: number } | null;
  weekOffWorked: number;
  /** Always the four bands in order; shift grouping identical to the email (shifts.ts). */
  bands: Array<{ band: "Morning" | "Afternoon" | "Evening" | "Night"; planned: number; absent: number; late: number }>;
  /** Late-marked people with no planned shift today, so late adds up to the headline. */
  lateNotOnRoster: number;
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
  /** Email "Pending actions" rows: grn_pending, leave_pending, regularization_pending, exit_pending (+ any other raw type). */
  pendingActions: Array<{
    type: string; count: number; label: string;
    /** Email age text, e.g. "oldest 8d · 1 over 7d"; null when the source has no age. */
    age: string | null; oldestDays: number | null; over3Days: number | null; over7Days: number | null;
  }>;
}
export interface HeadRow { head: string; budget: number; charged: number; pct: number }
export interface RecentGrn {
  grnNo: string | null; vendor: string | null; head: string | null; subHead: string | null;
  amountInclGst: number; status: string; stageLabel: string;
  /** YYYY-MM-DD, "" when unknown. */
  raisedOn: string; ageDays: number;
}
export interface BudgetHistoryMonth {
  periodCode: string; headerStatus: string | null; declared: number; used: number;
  /** Budget after closure (closed heads count at what was used). Same number as `effective`. */
  effective: number; afterClosure: number; usedPct: number | null;
  headsTotal: number; headsClosed: number;
  openRows: Array<{ head: string; subHead: string; budget: number; used: number }>;
}
export interface OpenSubhead { periodCode: string; head: string; subhead: string; budgetHeld: number; spent: number }
export interface FinanceData {
  /** Email section 3: latest GRNs excluding drafts, max 15. No requester or phone is carried (the email has neither). */
  recentGrns: RecentGrn[];
  /** Previous months' budget progress and closure (email section 1). */
  history: BudgetHistoryMonth[];
  /** Still-open (not closed) sub-heads across those months, flattened. */
  openSubheads: OpenSubhead[];
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
