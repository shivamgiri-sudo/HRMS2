/**
 * Branch Health Report — data layer. Read-only.
 *
 * Each function is scoped to a single branch by branch_id (looked up via branch_name once and
 * passed through). All amounts in ₹. Dates are IST strings (the db session timezone is IST).
 *
 * GRN queries are scoped to HRMS-raised GRNs: no db_bill source id and not a system-user backfill
 * row (created_by 00000000-…, e.g. the "db_bill backfill 2026-27" load) — no legacy or migrated data.
 * Shrinkage is roster-based (wfm_roster_assignment shift timings vs attendance_daily_record).
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getPnlReconciliation } from "../process-pnl/pnl-reconciliation.service.js";
import { readGrnSpend } from "../process-pnl/pnl-actuals.service.js";
import { getBranchActivityByBranch } from "../ats/branch-activity-report/index.js";
import { isShiftDueYet } from "../wfm/shift-due.util.js";

// ─── shared helpers ──────────────────────────────────────────────────────────

async function branchIdFor(branchName: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM branch_master WHERE branch_name = ? OR branch_code = ? LIMIT 1`,
    [branchName, branchName],
  );
  return (rows[0] as any)?.id ?? null;
}

// ─── 1. Budget vs Consumption ────────────────────────────────────────────────

export interface BudgetSummary {
  periodCode: string | null;
  totalBudget: number;
  consumed: number;
  reserved: number;
  available: number;
  utilizationPct: number;
}

export async function fetchBudgetSummary(
  branchId: string,
  today: string,
): Promise<BudgetSummary> {
  const ym = today.slice(0, 7); // YYYY-MM — period_code is in this format
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT h.period_code,
            h.pnl_budget_amount                                 AS total_budget,
            COALESCE(SUM(l.consumed_amount), 0)                AS consumed,
            COALESCE(SUM(l.reserved_amount), 0)                AS reserved
       FROM finance_budget_header h
       LEFT JOIN finance_budget_line l ON l.budget_id = h.id
      WHERE h.branch_id = ?
        AND h.period_code = ?
        AND h.status NOT IN ('draft')
      GROUP BY h.id
      ORDER BY FIELD(h.status,'finance_head_approved','branch_head_approved','submitted','revision_required') DESC,
               h.created_at DESC
      LIMIT 1`,
    [branchId, ym],
  );
  const r = rows[0] as any;
  if (!r)
    return {
      periodCode: null,
      totalBudget: 0,
      consumed: 0,
      reserved: 0,
      available: 0,
      utilizationPct: 0,
    };
  const total = Number(r.total_budget ?? 0);
  const consumed = Number(r.consumed ?? 0);
  const reserved = Number(r.reserved ?? 0);
  return {
    periodCode: r.period_code ?? null,
    totalBudget: total,
    consumed,
    reserved,
    available: Math.max(0, total - consumed - reserved),
    utilizationPct: total > 0 ? Math.round((consumed / total) * 100) : 0,
  };
}

// ─── 2. GRN Stats (HRMS-raised only) ──────────────────────────────────────────

/**
 * Ex-GST tie-out between this month's GRN activity and the budget in section 1, so the two
 * sections reconcile line by line instead of quoting unrelated totals.
 */
export interface GrnBridge {
  /** GRNs raised this month (not draft / cancelled / rejected), ex-GST cost. */
  raisedExGst: number;
  /** Submitted or returned — no budget reservation exists yet. */
  awaitingApproval: number;
  /** Approved but charged to an earlier month's budget line. */
  earlierBudget: number;
  /** Raised without a budget line (unbudgeted): Finance Head has to attach one before approving. */
  noBudgetLine: number;
  /** Raised this month AND charged to this month's budget (consumed + reserved). */
  chargedThisMonth: number;
  /** Raised in earlier months but charged to this month's budget. */
  fromEarlierMonths: number;
  /** Section 1: consumed + reserved on this month's budget lines. */
  budgetChargeTotal: number;
}

export interface GrnStats {
  raised: number;
  approved: number;
  /** Open GRNs awaiting approval, all-time. */
  pending: number;
  /** Oldest open GRN, in days since it was raised. */
  oldestPendingDays: number;
  pendingOver3Days: number;
  /** Gross value incl. GST of the GRNs raised this month. */
  totalRaisedAmount: number;
  bridge: GrnBridge;
  unbudgeted: UnbudgetedGrns;
  /** The open GRNs (same population as `pending`) split by the stage they are stuck at. */
  pendingByStage: GrnPendingStage[];
  /** Vendor vs imprest split: raised this month, plus the open pending backlog per type. */
  byType: GrnTypeSplit[];
}

export interface GrnPendingStage {
  status: string;
  /** Who has to act next. */
  stage: string;
  count: number;
  amountInclGst: number;
  oldestDays: number;
}

export interface GrnTypeSplit {
  type: string;
  label: string;
  raised: number;
  raisedInclGst: number;
  raisedExGst: number;
  approved: number;
  /** Open GRNs awaiting approval, all-time (the same backlog as `pending`). */
  pending: number;
  pendingInclGst: number;
}

/**
 * HRMS-raised GRNs with a cost-centre split that has no budget line. The system allows raising
 * these by design (Head/Sub-head with no approved budget line; the split falls back to the
 * cost centre) and blocks Finance Head approval until a real budget line is attached
 * (grn-smart.service review / link-budget). This is the live list of that exposure.
 */
export interface UnbudgetedGrns {
  count: number;
  amountExGst: number;
  rows: {
    grnNumber: string | null;
    head: string;
    amountExGst: number;
    status: string;
    raisedOn: string;
  }[];
}

const GRN_APPROVED_STATUSES = [
  "approved",
  "finance_head_approved",
  "pending_accounts_payment",
  "payment_scheduled",
  "partially_paid",
  "paid",
];
const GRN_PENDING_STATUSES = [
  "submitted",
  "branch_head_approved",
  "accounts_head_approved",
  "returned_to_branch_head",
  "returned_to_raiser",
];

/** Open HRMS-raised GRNs awaiting approval, all-time. The one definition behind both the GRN
 *  summary and the Pending Actions section so the two can never disagree. */
export async function countPendingGrns(branchId: string): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM grn_request
      WHERE branch_id = ?
        AND bill_source_id IS NULL AND COALESCE(created_by, '') NOT LIKE '00000000-%'
        AND status IN (${GRN_PENDING_STATUSES.map(() => "?").join(",")})`,
    [branchId, ...GRN_PENDING_STATUSES],
  );
  return Number((rows[0] as any)?.cnt ?? 0);
}

const GRN_AWAITING_STATUSES = [
  "submitted",
  "returned_to_branch_head",
  "returned_to_raiser",
];
const GRN_NOT_RAISED_STATUSES = ["draft", "cancelled", "rejected"];
const PENDING_STALE_DAYS = 3;

// Paise rounding between GRN cost and budget-line cost, summed over many rows.
const BRIDGE_ROUNDING_TOLERANCE = 10;

async function fetchGrnBridge(
  branchId: string,
  today: string,
): Promise<GrnBridge> {
  const period = today.slice(0, 7);
  const monthStart = period + "-01";
  // Cost is the budget engine's basis: P&L cost where set, else the ex-GST amount.
  const cost = `COALESCE(NULLIF(g.pnl_cost_amount, 0), g.amount_without_tax, 0)`;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT CASE
              WHEN g.status IN (${GRN_AWAITING_STATUSES.map(() => "?").join(",")}) THEN 'awaiting'
              WHEN l.id IS NULL THEN 'no_line'
              WHEN h.period_code = ? THEN 'this_month'
              ELSE 'earlier_budget'
            END AS bucket,
            COALESCE(SUM(${cost}), 0) AS amount
       FROM grn_request g
       LEFT JOIN finance_budget_line l ON l.id = g.budget_line_id
       LEFT JOIN finance_budget_header h ON h.id = l.budget_id
      WHERE g.branch_id = ?
        AND g.bill_source_id IS NULL AND COALESCE(g.created_by, '') NOT LIKE '00000000-%'
        AND DATE(g.created_at) >= ?
        AND g.status NOT IN (${GRN_NOT_RAISED_STATUSES.map(() => "?").join(",")})
      GROUP BY bucket`,
    [
      ...GRN_AWAITING_STATUSES,
      period,
      branchId,
      monthStart,
      ...GRN_NOT_RAISED_STATUSES,
    ],
  );
  const by = new Map<string, number>(
    (rows as any[]).map((r) => [String(r.bucket), Number(r.amount)]),
  );
  const [budgetRows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(l.consumed_amount + l.reserved_amount), 0) AS charge
       FROM finance_budget_line l
       JOIN finance_budget_header h ON h.id = l.budget_id
      WHERE h.branch_id = ? AND h.period_code = ? AND h.status NOT IN ('draft')`,
    [branchId, period],
  );
  const budgetChargeTotal = Number((budgetRows[0] as any)?.charge ?? 0);
  const chargedThisMonth = by.get("this_month") ?? 0;
  const awaitingApproval = by.get("awaiting") ?? 0;
  const earlierBudget = by.get("earlier_budget") ?? 0;
  const noBudgetLine = by.get("no_line") ?? 0;
  return {
    raisedExGst:
      chargedThisMonth + awaitingApproval + earlierBudget + noBudgetLine,
    awaitingApproval,
    earlierBudget,
    noBudgetLine,
    chargedThisMonth,
    fromEarlierMonths:
      Math.abs(budgetChargeTotal - chargedThisMonth) < BRIDGE_ROUNDING_TOLERANCE
        ? 0
        : budgetChargeTotal - chargedThisMonth,
    budgetChargeTotal,
  };
}

async function fetchUnbudgeted(branchId: string): Promise<UnbudgetedGrns> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT g.grn_number, g.head, g.sub_head, g.status,
            DATE_FORMAT(g.created_at, '%d/%m/%Y') AS raised_on,
            COALESCE(SUM(a.amount_without_tax), 0) AS amount
       FROM grn_request g
       JOIN grn_cost_allocation a ON a.grn_request_id = g.id AND a.budget_line_id IS NULL
      WHERE g.branch_id = ?
        AND g.bill_source_id IS NULL AND COALESCE(g.created_by, '') NOT LIKE '00000000-%'
        AND g.status NOT IN (${GRN_NOT_RAISED_STATUSES.map(() => "?").join(",")})
      GROUP BY g.id, g.grn_number, g.head, g.sub_head, g.status, g.created_at
      ORDER BY g.created_at DESC`,
    [branchId, ...GRN_NOT_RAISED_STATUSES],
  );
  const all = rows as any[];
  return {
    count: all.length,
    amountExGst: all.reduce((sum, r) => sum + Number(r.amount), 0),
    rows: all.slice(0, 5).map((r) => ({
      grnNumber: r.grn_number ?? null,
      head: [r.head, r.sub_head].filter(Boolean).join(" › ") || "—",
      amountExGst: Number(r.amount),
      status: String(r.status),
      raisedOn: String(r.raised_on),
    })),
  };
}

const GRN_STAGE_LABELS: Record<string, string> = {
  submitted: "With Branch Head (submitted)",
  branch_head_approved: "With Accounts Head (Branch Head approved)",
  accounts_head_approved: "With Finance Head (Accounts Head approved)",
  returned_to_branch_head: "Returned to Branch Head",
  returned_to_raiser: "Returned to raiser",
};
const GRN_TYPE_LABELS: Record<string, string> = {
  vendor: "Vendor GRN",
  imprest: "Imprest GRN",
};
const HRMS_GRN_SCOPE = `bill_source_id IS NULL AND COALESCE(created_by, '') NOT LIKE '00000000-%'`;

async function fetchGrnPendingByStage(
  branchId: string,
  today: string,
): Promise<GrnPendingStage[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT status, COUNT(*) AS cnt, COALESCE(SUM(amount_with_tax), 0) AS amt,
            COALESCE(MAX(DATEDIFF(?, DATE(created_at))), 0) AS oldest
       FROM grn_request
      WHERE branch_id = ? AND ${HRMS_GRN_SCOPE}
        AND status IN (${GRN_PENDING_STATUSES.map(() => "?").join(",")})
      GROUP BY status`,
    [today, branchId, ...GRN_PENDING_STATUSES],
  );
  return (rows as any[])
    .map((r) => ({
      status: String(r.status),
      stage: GRN_STAGE_LABELS[String(r.status)] ?? String(r.status),
      count: Number(r.cnt),
      amountInclGst: Number(r.amt),
      oldestDays: Number(r.oldest),
    }))
    .sort(
      (a, b) =>
        GRN_PENDING_STATUSES.indexOf(a.status) -
        GRN_PENDING_STATUSES.indexOf(b.status),
    );
}

async function fetchGrnByType(
  branchId: string,
  today: string,
): Promise<GrnTypeSplit[]> {
  const monthStart = today.slice(0, 7) + "-01";
  const [raised] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(grn_type, ''), 'other') AS type,
            COUNT(*) AS raised,
            COALESCE(SUM(amount_with_tax), 0) AS incl_gst,
            COALESCE(SUM(COALESCE(NULLIF(pnl_cost_amount, 0), amount_without_tax, 0)), 0) AS ex_gst,
            SUM(status IN (${GRN_APPROVED_STATUSES.map(() => "?").join(",")})) AS approved
       FROM grn_request
      WHERE branch_id = ? AND ${HRMS_GRN_SCOPE}
        AND status NOT IN (${GRN_NOT_RAISED_STATUSES.map(() => "?").join(",")})
        AND DATE(created_at) >= ?
      GROUP BY type`,
    [
      ...GRN_APPROVED_STATUSES,
      branchId,
      ...GRN_NOT_RAISED_STATUSES,
      monthStart,
    ],
  );
  const [pending] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(grn_type, ''), 'other') AS type, COUNT(*) AS cnt,
            COALESCE(SUM(amount_with_tax), 0) AS amt
       FROM grn_request
      WHERE branch_id = ? AND ${HRMS_GRN_SCOPE}
        AND status IN (${GRN_PENDING_STATUSES.map(() => "?").join(",")})
      GROUP BY type`,
    [branchId, ...GRN_PENDING_STATUSES],
  );
  const byType = new Map<string, GrnTypeSplit>();
  const row = (type: string): GrnTypeSplit => {
    const found = byType.get(type);
    if (found) return found;
    const fresh = {
      type,
      label: GRN_TYPE_LABELS[type] ?? `Other (${type})`,
      raised: 0,
      raisedInclGst: 0,
      raisedExGst: 0,
      approved: 0,
      pending: 0,
      pendingInclGst: 0,
    };
    byType.set(type, fresh);
    return fresh;
  };
  for (const r of raised as any[]) {
    const x = row(String(r.type));
    x.raised = Number(r.raised);
    x.raisedInclGst = Number(r.incl_gst);
    x.raisedExGst = Number(r.ex_gst);
    x.approved = Number(r.approved);
  }
  for (const r of pending as any[]) {
    const x = row(String(r.type));
    x.pending = Number(r.cnt);
    x.pendingInclGst = Number(r.amt);
  }
  const order = ["vendor", "imprest"];
  return [...byType.values()].sort(
    (a, b) =>
      (order.indexOf(a.type) === -1 ? 9 : order.indexOf(a.type)) -
      (order.indexOf(b.type) === -1 ? 9 : order.indexOf(b.type)),
  );
}

export async function fetchGrnStats(
  branchId: string,
  today: string,
): Promise<GrnStats> {
  const monthStart = today.slice(0, 7) + "-01";
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*)                                                           AS raised,
       SUM(status IN (${GRN_APPROVED_STATUSES.map(() => "?").join(",")})) AS approved,
       COALESCE(SUM(amount_with_tax), 0)                                  AS total_amount
     FROM grn_request
    WHERE branch_id = ?
      AND bill_source_id IS NULL AND COALESCE(created_by, '') NOT LIKE '00000000-%'
      AND status NOT IN (${GRN_NOT_RAISED_STATUSES.map(() => "?").join(",")})
      AND DATE(created_at) >= ?`,
    [
      ...GRN_APPROVED_STATUSES,
      branchId,
      ...GRN_NOT_RAISED_STATUSES,
      monthStart,
    ],
  );
  const [agingRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt,
            COALESCE(MAX(DATEDIFF(?, DATE(created_at))), 0) AS oldest,
            COALESCE(SUM(DATEDIFF(?, DATE(created_at)) > ${PENDING_STALE_DAYS}), 0) AS stale
       FROM grn_request
      WHERE branch_id = ?
        AND bill_source_id IS NULL AND COALESCE(created_by, '') NOT LIKE '00000000-%'
        AND status IN (${GRN_PENDING_STATUSES.map(() => "?").join(",")})`,
    [today, today, branchId, ...GRN_PENDING_STATUSES],
  );
  const r = rows[0] as any;
  const a = agingRows[0] as any;
  return {
    raised: Number(r?.raised ?? 0),
    approved: Number(r?.approved ?? 0),
    pending: Number(a?.cnt ?? 0),
    oldestPendingDays: Number(a?.oldest ?? 0),
    pendingOver3Days: Number(a?.stale ?? 0),
    totalRaisedAmount: Number(r?.total_amount ?? 0),
    bridge: await fetchGrnBridge(branchId, today),
    unbudgeted: await fetchUnbudgeted(branchId),
    pendingByStage: await fetchGrnPendingByStage(branchId, today),
    byType: await fetchGrnByType(branchId, today),
  };
}

// ─── 3. GRN List — latest 15 HRMS-raised GRNs ────────────────────────────────

export interface GrnRow {
  grnNumber: string | null;
  vendorName: string | null;
  head: string | null;
  subHead: string | null;
  amount: number;
  status: string;
  raisedOn: string;
  pendingWith: string | null;
}

export async function fetchRecentGrns(branchId: string): Promise<GrnRow[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT g.grn_number,
            g.vendor_name,
            g.head,
            g.sub_head,
            COALESCE(g.amount_with_tax, 0)           AS amount,
            g.status,
            DATE_FORMAT(g.created_at, '%d/%m/%Y')    AS raised_on
       FROM grn_request g
      WHERE g.branch_id = ?
        AND g.bill_source_id IS NULL AND COALESCE(g.created_by, '') NOT LIKE '00000000-%'
        AND g.status NOT IN ('draft', 'cancelled', 'rejected')
      ORDER BY g.created_at DESC
      LIMIT 15`,
    [branchId],
  );
  return (rows as any[]).map((r) => ({
    grnNumber: r.grn_number ?? null,
    vendorName: r.vendor_name ?? null,
    head: r.head ?? null,
    subHead: r.sub_head ?? null,
    amount: Number(r.amount ?? 0),
    status: String(r.status ?? ""),
    raisedOn: r.raised_on ?? "",
    pendingWith: null,
  }));
}

// ─── 4. ATS daily stats ───────────────────────────────────────────────────────

export interface AtsStats {
  walkins: number;
  tokens: number;
  tokensClosed: number;
  selected: number;
  rejected: number;
  noShow: number;
  /** Cleared internal rounds, waiting for the client's interview. */
  clientRound: number;
  hold: number;
  /** Interview form filed with a status that is none of the named outcomes. */
  otherClosed: number;
  /** Tokens with no interview outcome yet (closure pending). */
  open: number;
  /** Tokens with no interview feedback form filed (excludes no-show and walk-out). */
  noFeedback: number;
  /** …of which marked completed in the queue but the candidate is still waiting. */
  openQueueCompleted: number;
  slaBreaches: number;
  slaTotal: number;
}

const NO_ATS_ACTIVITY: AtsStats = {
  walkins: 0,
  tokens: 0,
  tokensClosed: 0,
  selected: 0,
  rejected: 0,
  noShow: 0,
  clientRound: 0,
  hold: 0,
  otherClosed: 0,
  open: 0,
  noFeedback: 0,
  openQueueCompleted: 0,
  slaBreaches: 0,
  slaTotal: 0,
};

/**
 * Today's walk-in queue for the branch, from the Recruitment Activity report's own engine (one
 * definition of walk-in, token, closed, selected, no-show and open for both emails). A token the
 * queue shows as "completed" with no interview form while the candidate is still Waiting is OPEN,
 * not closed. SLA is the report's SLA-1: token to interview call within 20 minutes.
 */
export async function fetchAtsStats(
  branchName: string,
  today: string,
): Promise<AtsStats> {
  const byBranch = await getBranchActivityByBranch(today);
  const s = byBranch.get(branchName.toLowerCase())?.overall.ftd;
  if (!s) return NO_ATS_ACTIVITY;
  return {
    walkins: s.walkins,
    tokens: s.tokens,
    tokensClosed: s.closed,
    selected: s.selected,
    rejected: s.rejected,
    noShow: s.noShow + s.walkout,
    clientRound: s.clientRound,
    hold: s.hold,
    otherClosed: s.otherClosed,
    open: s.open,
    noFeedback: s.noFeedback,
    openQueueCompleted: s.openQueueCompleted,
    slaBreaches: s.sla1.breached,
    slaTotal: s.sla1.met + s.sla1.breached,
  };
}

// ─── 5. Late comers ───────────────────────────────────────────────────────────

export interface LateStats {
  totalLate: number;
  processWise: { process: string; count: number }[];
  /** Late arrivals per process and reporting manager, so the manager can be followed up. */
  byManager: { process: string; manager: string; count: number }[];
}

export async function fetchLateStats(
  branchId: string,
  today: string,
): Promise<LateStats> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(pm.process_name, 'Unassigned')               AS process,
            COALESCE(NULLIF(TRIM(m.full_name), ''), 'Not mapped') AS manager,
            COUNT(*)                                               AS cnt
       FROM attendance_daily_record adr
       JOIN employees e ON e.id = adr.employee_id
       LEFT JOIN process_master pm ON pm.id = e.process_id
       LEFT JOIN employees m ON m.id = e.reporting_manager_id
      WHERE adr.record_date = ?
        AND e.branch_id = ?
        AND adr.late_mark = 1
        AND e.active_status = 1
      GROUP BY process, manager
      ORDER BY process, cnt DESC`,
    [today, branchId],
  );
  const byManager = (rows as any[]).map((r) => ({
    process: String(r.process),
    manager: String(r.manager),
    count: Number(r.cnt),
  }));
  const perProcess = new Map<string, number>();
  for (const r of byManager)
    perProcess.set(r.process, (perProcess.get(r.process) ?? 0) + r.count);
  const processWise = [...perProcess.entries()]
    .map(([process, count]) => ({ process, count }))
    .sort((a, b) => b.count - a.count);
  return {
    totalLate: byManager.reduce((sum, r) => sum + r.count, 0),
    processWise,
    byManager,
  };
}

// ─── 6. Shrinkage — uploaded roster shift timings vs first punch ─────────────
//
// See fetchShrinkage below for the exact rule (mirrors the WFM branch dashboard).

export interface ShrinkageStats {
  scheduled: number;
  present: number;
  absent: number;
  onLeave: number;
  shrinkagePct: number;
  rosterBased: boolean;
  /** Rostered to work but their shift has not reached start + grace yet, and no punch so far. */
  yetToStart: number;
  /** Rostered week-off but punched in anyway — informational, not in the shrinkage maths. */
  weekOffWorked: number;
  bySlot: {
    process: string;
    shift: string;
    planned: number;
    present: number;
    absent: number;
    late: number;
  }[];
}

export interface OpenRequisitionRow {
  code: string;
  designation: string;
  process: string;
  priority: string;
  requested: number;
  fulfilled: number;
  openPositions: number;
  inPipeline: number;
  selected: number;
  /** target_joining_date (YYYY-MM-DD) — the date the batch is due to be delivered / join. */
  deliveryDate: string;
  daysToDelivery: number;
  plannedBatch: string | null;
}

export interface OpenHiringStats {
  /** Approved requisitions whose delivery date is still ahead. */
  upcomingRequisitions: number;
  pendingApproval: number;
  requested: number;
  fulfilled: number;
  openPositions: number;
  inPipeline: number;
  selected: number;
  /** Older approved requisitions past their delivery date and still short — counted, not listed. */
  pastDeliveryRequisitions: number;
  pastDeliveryOpenPositions: number;
  rows: OpenRequisitionRow[];
}

export interface RunningPnlStats {
  periodCode: string;
  daysInMonth: number;
  daysElapsed: number;
  /** LIVE_MTD while the month is open, FINAL once closed. */
  mode: string;
  revenueInvoice: number;
  revenueAccrual: number;
  /** Seat rate x seats to date, used only for cost centres with no invoice or accrual. */
  revenueEstimated: number;
  creditNote: number;
  /** Recognised revenue to date = invoice + accrual + estimate - credit notes. */
  revenueRunning: number;
  /** Payroll cost to date from the P&L payroll source. */
  salaryRunning: number;
  /** GRN consumed, ex-GST, by accounting period (P&L basis; HRMS-raised GRNs only). */
  grnConsumed: number;
  /** GRN approved and reserved but not yet consumed, ex-GST. */
  grnReserved: number;
  totalCostRunning: number;
  operatingProfit: number;
  opPct: number | null;
  /** Staff whose salary is in the payroll figure. */
  staffPaid: number;
  estimatedCostCentres: number;
  costCentres: number;
  dataAvailable: boolean;
}

const LEAVE_STATUSES = new Set([
  "leave_approved",
  "approved_leave",
  "half_day_leave",
  "leave",
]);
const NON_WORKING_ASSIGNMENTS = new Set(["WEEK_OFF", "LEAVE", "HOLIDAY"]);

const hhmm = (t: unknown): string => String(t ?? "").slice(0, 5);

/**
 * Shrinkage = rostered people with no punch / rostered people whose shift is already due.
 * Same rule as the WFM branch dashboard (roster-intelligence.service.ts):
 *  - plan = the uploaded roster row for today: week-off, leave and holiday rows are not planned;
 *  - presence = a real punch (attendance_daily_record.clock_in_time), NOT attendance_status —
 *    dialler-sourced rows carry a provisional "absent" status although the person punched in;
 *  - a shift that has not reached start + grace is "yet to start", excluded until it is due;
 *  - approved leave (attendance side) is excluded from the plan like roster leave.
 * Shift timing comes from the roster row, falling back to the shift template.
 * Broken down by process and shift slot, with the late count of those who did punch in.
 */
export async function fetchShrinkage(
  branchId: string,
  today: string,
): Promise<ShrinkageStats> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ra.assignment_type, ra.is_week_off,
            COALESCE(ra.shift_start_time, st.start_time) AS shift_start,
            COALESCE(ra.shift_end_time, st.end_time)     AS shift_end,
            adr.clock_in_time, adr.attendance_status, adr.late_mark,
            COALESCE(pm.process_name, 'Unassigned')      AS process_name
       FROM wfm_roster_assignment ra
       JOIN employees e ON e.id = ra.employee_id AND e.branch_id = ? AND e.active_status = 1
       LEFT JOIN process_master pm ON pm.id = e.process_id
       LEFT JOIN wfm_shift_template st ON st.id = ra.shift_template_id
       LEFT JOIN attendance_daily_record adr
              ON adr.employee_id = ra.employee_id AND adr.record_date = ra.roster_date
      WHERE ra.roster_date = ?`,
    [branchId, today],
  );

  let scheduled = 0;
  let present = 0;
  let absent = 0;
  let onLeave = 0;
  let yetToStart = 0;
  let weekOffWorked = 0;
  const slots = new Map<
    string,
    {
      process: string;
      shift: string;
      planned: number;
      present: number;
      absent: number;
      late: number;
    }
  >();

  for (const r of rows as any[]) {
    const type = String(r.assignment_type ?? "").toUpperCase();
    const punched = r.clock_in_time != null;
    if (NON_WORKING_ASSIGNMENTS.has(type) || Number(r.is_week_off) === 1) {
      if (punched && type !== "LEAVE") weekOffWorked += 1;
      if (type === "LEAVE") onLeave += 1;
      continue;
    }
    if (LEAVE_STATUSES.has(String(r.attendance_status ?? ""))) {
      onLeave += 1;
      continue;
    }
    if (
      !punched &&
      !isShiftDueYet(r.shift_start ? String(r.shift_start) : null, today)
    ) {
      yetToStart += 1;
      continue;
    }
    scheduled += 1;
    const shift =
      r.shift_start || r.shift_end
        ? `${hhmm(r.shift_start)}–${hhmm(r.shift_end)}`
        : "No shift time on roster";
    const process = String(r.process_name);
    const key = `${process}|${shift}`;
    const bucket = slots.get(key) ?? {
      process,
      shift,
      planned: 0,
      present: 0,
      absent: 0,
      late: 0,
    };
    bucket.planned += 1;
    if (punched) {
      present += 1;
      bucket.present += 1;
      if (Number(r.late_mark) === 1) bucket.late += 1;
    } else {
      absent += 1;
      bucket.absent += 1;
    }
    slots.set(key, bucket);
  }

  const bySlot = [...slots.values()].sort(
    (a, b) =>
      a.process.localeCompare(b.process) || a.shift.localeCompare(b.shift),
  );

  return {
    scheduled,
    present,
    absent,
    onLeave,
    shrinkagePct: scheduled > 0 ? Math.round((absent / scheduled) * 100) : 0,
    rosterBased: (rows as any[]).length > 0,
    yetToStart,
    weekOffWorked,
    bySlot,
  };
}

// ─── 7. Headcount movements ───────────────────────────────────────────────────

export interface HeadcountProcessRow {
  process: string;
  active: number;
  joinedToday: number;
  joinedMtd: number;
  leftToday: number;
  leftMtd: number;
  /** Mandated seats for this process at this branch (workforce mandate); null when none is set. */
  mandateSeats: number | null;
  /** Where the mandate came from: the HRMS workforce mandate, or the db_bill seat history. */
  mandateSource: "workforce" | "db_bill" | null;
}

export interface HeadcountMovement {
  joinedToday: number;
  leftToday: number;
  joinedNames: string[];
  leftNames: string[];
  byProcess: HeadcountProcessRow[];
  joinedMtd: number;
  leftMtd: number;
  /** Leavers with a last working day in the next 30 days (exit requests still running). */
  upcomingExits: number;
  /** Exit requests whose last working day has passed but the employee is still active. */
  exitsNotClosed: number;
  /** Sum of the mandated seats of the processes that have one. */
  mandateSeatsTotal: number | null;
  totalActive: number;
}

const MIN_MATCH_LENGTH = 4;
const COMPANY_SUFFIX = /\b(private|pvt|limited|ltd|india|company|co)\b/g;

/** Same client spelled differently by HRMS and db_bill ("IDAM NATURAL WELLNESS PRIVATE LIMITED"). */
export function normalizeClientName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(COMPANY_SUFFIX, " ")
    .replace(/\s+/g, "");
}

/**
 * Fills the mandate for processes the HRMS workforce mandate does not cover from the latest
 * db_bill mandate-seat history (legacy billing), matched on client name. A billed client with no
 * process row here is left out: db_bill names the legal entity ("Locon Solutions" = Housing.com),
 * so adding it as its own line would count that mandate twice.
 */
async function applyBillingMandates(
  branchId: string,
  perProcess: Map<string, HeadcountProcessRow>,
  processMaster: { process_name: string; client_name: string | null }[],
): Promise<void> {
  const [history] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(h.client_name), ''), NULLIF(TRIM(h.process_name), '')) AS client,
            SUM(h.mandate_seats) AS seats
       FROM mandate_seat_history h
       JOIN branch_master b ON b.branch_name = h.branch_name
      WHERE b.id = ?
        AND h.period_month = (SELECT MAX(x.period_month) FROM mandate_seat_history x
                               WHERE x.branch_name = h.branch_name AND x.mandate_seats > 0)
      GROUP BY client
     HAVING seats > 0`,
    [branchId],
  );
  const clientOf = new Map<string, string>();
  for (const p of processMaster) {
    if (p.client_name)
      clientOf.set(p.process_name, normalizeClientName(p.client_name));
  }
  for (const h of history as any[]) {
    const key = normalizeClientName(String(h.client));
    if (!key) continue;
    const seats = Number(h.seats);
    const sameClient = (own: string) =>
      own.length >= MIN_MATCH_LENGTH &&
      (own.includes(key) || key.includes(own));
    const matches = [...perProcess.values()].filter(
      (r) =>
        sameClient(normalizeClientName(r.process)) ||
        sameClient(clientOf.get(r.process) ?? ""),
    );
    if (matches.length === 0) continue;
    if (matches.some((r) => r.mandateSource === "workforce")) continue;
    matches[0].mandateSeats = seats;
    matches[0].mandateSource = "db_bill";
  }
}

/**
 * Headcount by process with today's and the month's movement.
 *  - joined = date_of_joining;
 *  - left   = date_of_leaving or date_of_exit on the employee record, or a running exit
 *    request's last working day (confirmed, else proposed). Only inactive employees count as left;
 *    a running exit whose last working day has passed but who is still active is reported
 *    separately as exitsNotClosed;
 *  - active = active_status 1 today.
 */
export async function fetchHeadcountMovement(
  branchId: string,
  today: string,
): Promise<HeadcountMovement> {
  const monthStart = today.slice(0, 7) + "-01";
  const lastDay = `COALESCE(e.date_of_leaving, e.date_of_exit, er.lwd)`;
  const leaverBase = `FROM employees e
       LEFT JOIN process_master pm ON pm.id = e.process_id
       LEFT JOIN (SELECT employee_id,
                         MAX(COALESCE(last_working_day_confirmed, last_working_day_proposed)) AS lwd
                    FROM exit_request
                   WHERE status NOT IN ('revoked', 'rejected', 'cancelled')
                   GROUP BY employee_id) er ON er.employee_id = e.id
      WHERE e.branch_id = ?`;
  const [activeRows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(pm.process_name, 'Unassigned') AS process, COUNT(*) AS cnt
       FROM employees e LEFT JOIN process_master pm ON pm.id = e.process_id
      WHERE e.branch_id = ? AND e.active_status = 1
      GROUP BY process`,
    [branchId],
  );
  const [joinRows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(e.full_name), ''), e.first_name) AS name,
            COALESCE(pm.process_name, 'Unassigned')               AS process,
            e.date_of_joining = ?                                 AS is_today
       FROM employees e LEFT JOIN process_master pm ON pm.id = e.process_id
      WHERE e.branch_id = ? AND e.date_of_joining BETWEEN ? AND ?`,
    [today, branchId, monthStart, today],
  );
  const [leaveRows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT e.id,
            COALESCE(NULLIF(TRIM(e.full_name), ''), e.first_name) AS name,
            COALESCE(pm.process_name, 'Unassigned')               AS process,
            ${lastDay} = ?                                         AS is_today
       ${leaverBase}
        AND e.active_status = 0
        AND ${lastDay} BETWEEN ? AND ?`,
    [today, branchId, monthStart, today],
  );
  const [upcomingRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT e.id) AS cnt
       ${leaverBase}
        AND e.active_status = 1
        AND ${lastDay} > ? AND ${lastDay} <= DATE_ADD(?, INTERVAL 30 DAY)`,
    [branchId, today, today],
  );

  const [notClosedRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT e.id) AS cnt
       ${leaverBase}
        AND e.active_status = 1
        AND er.lwd < ?`,
    [branchId, today],
  );

  const perProcess = new Map<string, HeadcountProcessRow>();
  const row = (process: string): HeadcountProcessRow => {
    const found = perProcess.get(process);
    if (found) return found;
    const fresh: HeadcountProcessRow = {
      process,
      active: 0,
      joinedToday: 0,
      joinedMtd: 0,
      leftToday: 0,
      leftMtd: 0,
      mandateSeats: null,
      mandateSource: null,
    };
    perProcess.set(process, fresh);
    return fresh;
  };
  // Mandated seats per process: the workforce mandate in force today (Capacity Dashboard's source).
  const [mandateRows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(pm.process_name, 'Unassigned') AS process, SUM(wm.mandated_hc) AS seats
       FROM workforce_mandate wm
       LEFT JOIN process_master pm ON pm.id = wm.process_id
      WHERE wm.branch_id = ? AND wm.active_status = 1
        AND wm.effective_from <= ? AND (wm.effective_to IS NULL OR wm.effective_to >= ?)
      GROUP BY process`,
    [branchId, today, today],
  );
  for (const r of mandateRows as any[]) {
    const b = row(String(r.process));
    b.mandateSeats = Number(r.seats);
    b.mandateSource = "workforce";
  }
  let totalActive = 0;
  for (const r of activeRows as any[]) {
    row(String(r.process)).active = Number(r.cnt);
    totalActive += Number(r.cnt);
  }
  const joined = joinRows as any[];
  const left = leaveRows as any[];
  for (const r of joined) {
    const b = row(String(r.process));
    b.joinedMtd += 1;
    if (Number(r.is_today) === 1) b.joinedToday += 1;
  }
  for (const r of left) {
    const b = row(String(r.process));
    b.leftMtd += 1;
    if (Number(r.is_today) === 1) b.leftToday += 1;
  }
  const [processNames] = await db.execute<RowDataPacket[]>(
    `SELECT process_name, client_name FROM process_master WHERE branch_id = ?`,
    [branchId],
  );
  await applyBillingMandates(branchId, perProcess, processNames as any[]);
  const mandateSeatsTotal = [...perProcess.values()].reduce<number | null>(
    (sum, r) => (r.mandateSeats == null ? sum : (sum ?? 0) + r.mandateSeats),
    null,
  );
  const todayOnly = (list: any[]) =>
    list
      .filter((r) => Number(r.is_today) === 1)
      .map((r) => String(r.name).trim());
  return {
    joinedToday: todayOnly(joined).length,
    leftToday: todayOnly(left).length,
    joinedNames: todayOnly(joined),
    leftNames: todayOnly(left),
    byProcess: [...perProcess.values()].sort((a, b) => b.active - a.active),
    joinedMtd: joined.length,
    leftMtd: left.length,
    upcomingExits: Number((upcomingRows[0] as any)?.cnt ?? 0),
    exitsNotClosed: Number((notClosedRows[0] as any)?.cnt ?? 0),
    mandateSeatsTotal,
    totalActive,
  };
}

// ─── 9. Open Hiring — from the Job Requisition page ──────────────────────────

const MAX_REQUISITION_ROWS = 15;

/**
 * Batches coming up, from the Job Requisition page: approved requisitions still short of the
 * requested headcount whose delivery date (target_joining_date) has not passed
 * (job-requisition.service getOpenRequisitionsForBranch is the same base population). Open
 * positions = requested - fulfilled; candidates come from job_requisition_candidate — outcome
 * 'in_progress' is the live pipeline, 'selected' is offered. Requisitions already past their
 * delivery date are only counted, and requisitions awaiting approval only counted too.
 */
export async function fetchOpenHiring(
  branchName: string,
  today: string,
): Promise<OpenHiringStats> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT jr.requisition_code, jr.designation_name, jr.process_name, jr.priority,
            jr.requested_headcount, jr.fulfilled_headcount, jr.planned_batch_no,
            DATE_FORMAT(jr.target_joining_date, '%Y-%m-%d')   AS delivery_date,
            DATEDIFF(jr.target_joining_date, ?)               AS days_to_delivery,
            COALESCE(c.in_pipeline, 0)                        AS in_pipeline,
            COALESCE(c.selected, 0)                           AS selected
       FROM job_requisition jr
       LEFT JOIN (
         SELECT requisition_id,
                SUM(outcome = 'in_progress') AS in_pipeline,
                SUM(outcome = 'selected')    AS selected
           FROM job_requisition_candidate
          GROUP BY requisition_id
       ) c ON c.requisition_id = jr.id
      WHERE jr.branch_name = ?
        AND jr.active_status = 1
        AND jr.approval_status = 'approved'
        AND jr.fulfilled_headcount < jr.requested_headcount
        AND jr.target_joining_date >= ?
      ORDER BY jr.target_joining_date, FIELD(jr.priority, 'urgent', 'high', 'normal', 'low')`,
    [today, branchName, today],
  );
  const [pastRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt,
            COALESCE(SUM(requested_headcount - fulfilled_headcount), 0) AS open_positions
       FROM job_requisition
      WHERE branch_name = ? AND active_status = 1 AND approval_status = 'approved'
        AND fulfilled_headcount < requested_headcount
        AND (target_joining_date IS NULL OR target_joining_date < ?)`,
    [branchName, today],
  );
  const [pendingRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM job_requisition
      WHERE branch_name = ? AND active_status = 1 AND approval_status = 'pending_approval'`,
    [branchName],
  );

  const all: OpenRequisitionRow[] = (rows as any[]).map((r) => {
    const requested = Number(r.requested_headcount ?? 0);
    const fulfilled = Number(r.fulfilled_headcount ?? 0);
    return {
      code: String(r.requisition_code),
      designation: String(r.designation_name ?? ""),
      process: String(r.process_name ?? "—"),
      priority: String(r.priority ?? ""),
      requested,
      fulfilled,
      openPositions: requested - fulfilled,
      inPipeline: Number(r.in_pipeline ?? 0),
      selected: Number(r.selected ?? 0),
      deliveryDate: String(r.delivery_date),
      daysToDelivery: Number(r.days_to_delivery ?? 0),
      plannedBatch: r.planned_batch_no ? String(r.planned_batch_no) : null,
    };
  });
  const sum = (pick: (r: OpenRequisitionRow) => number) =>
    all.reduce((total, r) => total + pick(r), 0);
  return {
    upcomingRequisitions: all.length,
    pendingApproval: Number((pendingRows[0] as any)?.cnt ?? 0),
    requested: sum((r) => r.requested),
    fulfilled: sum((r) => r.fulfilled),
    openPositions: sum((r) => r.openPositions),
    inPipeline: sum((r) => r.inPipeline),
    selected: sum((r) => r.selected),
    pastDeliveryRequisitions: Number((pastRows[0] as any)?.cnt ?? 0),
    pastDeliveryOpenPositions: Number(
      (pastRows[0] as any)?.open_positions ?? 0,
    ),
    rows: all.slice(0, MAX_REQUISITION_ROWS),
  };
}

// ─── 10. Running P&L Snapshot ─────────────────────────────────────────────────

/**
 * Branch P&L for the month, taken from the same statement engine the P&L page renders
 * (getStatement, viewBy=branch) so the email and the app can never quote different numbers.
 */
/**
 * Running operating profit for the month, taken from the Live P&L (getPnlReconciliation, the
 * engine behind the P&L page's Live tab) so this email quotes the same number the app does:
 *   OP = recognised revenue to date - payroll to date - GRN (consumed + reserved, ex-GST).
 * Revenue is invoice + accrual, or a seat-rate x seats estimate to date for cost centres that
 * have neither yet; the estimate is only used while the month is open.
 */
export async function fetchRunningPnl(
  branchId: string,
  today: string,
): Promise<RunningPnlStats> {
  const period = today.slice(0, 7); // YYYY-MM
  const rec = await getPnlReconciliation(period, {
    branchIds: [branchId],
    asOfDate: today,
  });
  const branch = rec.branches.find((b) => b.branchId === branchId);
  const rows = rec.rows.filter((r) => r.branchId === branchId);
  const sum = (pick: (r: (typeof rows)[number]) => number) =>
    rows.reduce((total, r) => total + pick(r), 0);
  const revenueRunning = branch?.revenue ?? 0;
  const salaryRunning = branch?.payrollCost ?? 0;
  const grnConsumed = branch?.grnActual ?? 0;
  const grnReserved = branch?.grnEstimated ?? 0;
  return {
    periodCode: period,
    daysInMonth: rec.estimate.daysInMonth,
    daysElapsed: rec.estimate.daysElapsed,
    mode: rec.mode,
    revenueInvoice: sum((r) => r.revenueInvoice),
    revenueAccrual: sum((r) => r.revenueAccrual),
    revenueEstimated: sum((r) => r.revenueEstimated),
    creditNote: sum((r) => r.creditNote),
    revenueRunning,
    salaryRunning,
    grnConsumed,
    grnReserved,
    totalCostRunning: salaryRunning + grnConsumed + grnReserved,
    operatingProfit: branch?.operatingProfit ?? 0,
    opPct: branch?.marginPct ?? null,
    staffPaid: branch?.staffPaid ?? 0,
    estimatedCostCentres: rows.filter((r) => r.revenueBasis === "ESTIMATED")
      .length,
    costCentres: rows.length,
    dataAvailable:
      revenueRunning > 0 || salaryRunning > 0 || grnConsumed + grnReserved > 0,
  };
}

// ─── 12. Budget by head ──────────────────────────────────────────────────────

export interface BudgetHeadRow {
  head: string;
  budget: number;
  charged: number;
  pct: number;
}

const TOP_HEADS = 3;

/** Heads ranked by spend (consumed + reserved) against their approved budget, P&L cost basis. */
export async function fetchBudgetByHead(
  branchId: string,
  today: string,
): Promise<{ top: BudgetHeadRow[]; overBudget: BudgetHeadRow[] }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(l.head), ''), 'Unspecified')       AS head,
            COALESCE(SUM(l.pnl_cost_amount), 0)                       AS budget,
            COALESCE(SUM(l.consumed_amount + l.reserved_amount), 0)   AS charged
       FROM finance_budget_line l
       JOIN finance_budget_header h ON h.id = l.budget_id
      WHERE h.branch_id = ? AND h.period_code = ? AND h.status NOT IN ('draft')
      GROUP BY head
      HAVING charged > 0
      ORDER BY charged DESC`,
    [branchId, today.slice(0, 7)],
  );
  const all: BudgetHeadRow[] = (rows as any[]).map((r) => {
    const budget = Number(r.budget);
    const charged = Number(r.charged);
    return {
      head: String(r.head),
      budget,
      charged,
      pct: budget > 0 ? Math.round((charged / budget) * 100) : 0,
    };
  });
  return {
    top: all.slice(0, TOP_HEADS),
    overBudget: all.filter((r) => r.budget > 0 && r.charged > r.budget),
  };
}

// ─── 13. Consecutive absence ─────────────────────────────────────────────────

export interface AbsenceFlag {
  name: string;
  code: string;
  process: string;
  manager: string;
}

/** Rostered working days with no punch in a row, ending yesterday, that earn a flag. */
export const CONSECUTIVE_ABSENCE_DAYS = 3;
const MAX_ABSENCE_ROWS = 10;

export async function fetchConsecutiveAbsence(
  branchId: string,
  today: string,
): Promise<{ total: number; rows: AbsenceFlag[] }> {
  const dayBefore = (n: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.employee_code, COALESCE(NULLIF(TRIM(e.full_name), ''), e.first_name) AS name,
            COALESCE(pm.process_name, 'Unassigned')                               AS process,
            COALESCE(NULLIF(TRIM(m.full_name), ''), 'Not mapped')                 AS manager
       FROM wfm_roster_assignment ra
       JOIN employees e ON e.id = ra.employee_id AND e.branch_id = ? AND e.active_status = 1
       LEFT JOIN process_master pm ON pm.id = e.process_id
       LEFT JOIN employees m ON m.id = e.reporting_manager_id
       LEFT JOIN attendance_daily_record a
              ON a.employee_id = ra.employee_id AND a.record_date = ra.roster_date
      WHERE ra.roster_date BETWEEN ? AND ?
        AND ra.is_week_off = 0
        AND UPPER(COALESCE(ra.assignment_type, '')) NOT IN ('WEEK_OFF', 'LEAVE', 'HOLIDAY')
        AND a.clock_in_time IS NULL
        AND COALESCE(a.attendance_status, '') NOT IN ('leave_approved', 'approved_leave', 'half_day_leave', 'leave')
      GROUP BY e.id, e.employee_code, e.full_name, e.first_name, pm.process_name, m.full_name
     HAVING COUNT(*) = ?
      ORDER BY process, name`,
    [
      branchId,
      dayBefore(CONSECUTIVE_ABSENCE_DAYS),
      dayBefore(1),
      CONSECUTIVE_ABSENCE_DAYS,
    ],
  );
  const all = (rows as any[]).map((r) => ({
    name: String(r.name),
    code: String(r.employee_code ?? ""),
    process: String(r.process),
    manager: String(r.manager),
  }));
  return { total: all.length, rows: all.slice(0, MAX_ABSENCE_ROWS) };
}

// ─── 14. Pending leave and regularization, by age ───────────────────────────

export interface AgedBacklog {
  pending: number;
  oldestDays: number;
  over3Days: number;
  over7Days: number;
}

const emptyBacklog = (r: any): AgedBacklog => ({
  pending: Number(r?.cnt ?? 0),
  oldestDays: Number(r?.oldest ?? 0),
  over3Days: Number(r?.over3 ?? 0),
  over7Days: Number(r?.over7 ?? 0),
});

/** Pending leave older than this is stale legacy data, counted apart instead of skewing the age. */
const LEAVE_WINDOW_DAYS = 90;

export interface LeaveAgingStats extends AgedBacklog {
  staleOlderThanWindow: number;
}

export async function fetchLeaveAging(
  branchId: string,
  today: string,
): Promise<LeaveAgingStats> {
  const applied = "DATE(COALESCE(lr.applied_at, lr.created_at))";
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(${applied} >= DATE_SUB(?, INTERVAL ${LEAVE_WINDOW_DAYS} DAY)), 0) AS cnt,
            COALESCE(MAX(CASE WHEN ${applied} >= DATE_SUB(?, INTERVAL ${LEAVE_WINDOW_DAYS} DAY) THEN DATEDIFF(?, ${applied}) END), 0) AS oldest,
            COALESCE(SUM(${applied} >= DATE_SUB(?, INTERVAL ${LEAVE_WINDOW_DAYS} DAY) AND DATEDIFF(?, ${applied}) > 3), 0) AS over3,
            COALESCE(SUM(${applied} >= DATE_SUB(?, INTERVAL ${LEAVE_WINDOW_DAYS} DAY) AND DATEDIFF(?, ${applied}) > 7), 0) AS over7,
            COALESCE(SUM(${applied} < DATE_SUB(?, INTERVAL ${LEAVE_WINDOW_DAYS} DAY)), 0) AS stale
       FROM leave_request lr
       JOIN employees e ON e.id = lr.employee_id
      WHERE e.branch_id = ? AND lr.status = 'pending'`,
    [today, today, today, today, today, today, today, today, branchId],
  );
  return {
    ...emptyBacklog(rows[0]),
    staleOlderThanWindow: Number((rows[0] as any)?.stale ?? 0),
  };
}

/** Regularization requests still awaiting a decision at any stage (pending, manager-approved, escalated). */
export async function fetchRegularizationBacklog(
  branchId: string,
  today: string,
): Promise<AgedBacklog & { escalated: number }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt,
            COALESCE(MAX(DATEDIFF(?, DATE(created_at))), 0) AS oldest,
            COALESCE(SUM(DATEDIFF(?, DATE(created_at)) > 3), 0) AS over3,
            COALESCE(SUM(DATEDIFF(?, DATE(created_at)) > 7), 0) AS over7,
            COALESCE(SUM(status = 'escalated'), 0) AS escalated
       FROM attendance_regularization
      WHERE branch_id = ? AND status IN ('pending', 'manager_approved', 'escalated')`,
    [today, today, today, branchId],
  );
  return {
    ...emptyBacklog(rows[0]),
    escalated: Number((rows[0] as any)?.escalated ?? 0),
  };
}

// ─── 15. Offer to join ───────────────────────────────────────────────────────

export interface OfferConversion {
  /** Approved offers whose joining date fell in the last OFFER_WINDOW_DAYS. */
  offered: number;
  joined: number;
  notJoined: number;
  conversionPct: number | null;
  /** Approved offers with a joining date in the next 7 days. */
  joiningNext7Days: number;
  /** The same measures for offers whose joining date falls in the month so far. */
  mtd: {
    offered: number;
    joined: number;
    notJoined: number;
    conversionPct: number | null;
  };
}

const OFFER_WINDOW_DAYS = 30;

export async function fetchOfferConversion(
  branchId: string,
  today: string,
): Promise<OfferConversion> {
  const monthStart = today.slice(0, 7) + "-01";
  const joinedFlag =
    "EXISTS (SELECT 1 FROM employees e WHERE e.candidate_id = o.candidate_id)";
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(o.date_of_joining BETWEEN DATE_SUB(?, INTERVAL ${OFFER_WINDOW_DAYS} DAY) AND ?), 0) AS offered,
            COALESCE(SUM(o.date_of_joining BETWEEN DATE_SUB(?, INTERVAL ${OFFER_WINDOW_DAYS} DAY) AND ? AND ${joinedFlag}), 0) AS joined,
            COALESCE(SUM(o.date_of_joining BETWEEN ? AND ?), 0) AS offered_mtd,
            COALESCE(SUM(o.date_of_joining BETWEEN ? AND ? AND ${joinedFlag}), 0) AS joined_mtd,
            COALESCE(SUM(o.date_of_joining > ? AND o.date_of_joining <= DATE_ADD(?, INTERVAL 7 DAY)), 0) AS next7
       FROM ats_employment_offer o
       JOIN ats_onboarding_request r ON r.id = o.onboarding_request_id
      WHERE r.branch_id = ? AND o.status = 'bh_approved'`,
    [
      today,
      today,
      today,
      today,
      monthStart,
      today,
      monthStart,
      today,
      today,
      today,
      branchId,
    ],
  );
  const r = rows[0] as any;
  const pctOf = (joined: number, offered: number) =>
    offered > 0 ? Math.round((joined / offered) * 100) : null;
  const offered = Number(r?.offered ?? 0);
  const joined = Number(r?.joined ?? 0);
  const offeredMtd = Number(r?.offered_mtd ?? 0);
  const joinedMtd = Number(r?.joined_mtd ?? 0);
  return {
    offered,
    joined,
    notJoined: offered - joined,
    conversionPct: pctOf(joined, offered),
    joiningNext7Days: Number(r?.next7 ?? 0),
    mtd: {
      offered: offeredMtd,
      joined: joinedMtd,
      notJoined: offeredMtd - joinedMtd,
      conversionPct: pctOf(joinedMtd, offeredMtd),
    },
  };
}

// ─── 10b. Why the P&L's GRN differs from the budget's ────────────────────────

export interface PnlGrnTieOut {
  budgetConsumed: number;
  budgetReserved: number;
  /** P&L consumed booked from HRMS allocations that are not on a budget line (system backfill). */
  hrmsNoBudgetLine: number;
  /** P&L consumed from HRMS GRNs that carry no allocation rows. */
  hrmsOrdinary: number;
  /** Budget reservations the P&L cannot read: imprest allocations carry no cost centre. */
  imprestReservedNoCostCentre: number;
}

/**
 * The Live P&L reads GRN spend by cost centre and accounting period (readGrnSpend, in three
 * legs) while the budget counts money against budget lines. This splits the P&L's consumed by
 * leg and finds the reserved amount it cannot see, so every difference is named.
 */
export async function fetchPnlGrnTieOut(
  branchId: string,
  today: string,
): Promise<PnlGrnTieOut> {
  const period = today.slice(0, 7);
  const [spend, budgetRows, imprestRows] = await Promise.all([
    readGrnSpend(period, "consumed", { withDetail: true }),
    db.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(l.consumed_amount), 0) AS consumed, COALESCE(SUM(l.reserved_amount), 0) AS reserved
         FROM finance_budget_line l JOIN finance_budget_header h ON h.id = l.budget_id
        WHERE h.branch_id = ? AND h.period_code = ? AND h.status NOT IN ('draft')`,
      [branchId, period],
    ),
    db.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(a.amount_without_tax), 0) AS amt
         FROM grn_cost_allocation a JOIN grn_request g ON g.id = a.grn_request_id
        WHERE g.branch_id = ? AND g.accounting_period = ? AND a.lifecycle_status = 'reserved'
          AND a.cost_centre_id IS NULL`,
      [branchId, period],
    ),
  ]);
  const mine = spend.filter((r) => r.branchId === branchId);
  const bySource = (source: string) =>
    mine
      .filter((r) => r.source === source)
      .reduce((sum, r) => sum + r.amount, 0);
  const budgetConsumed = Number((budgetRows[0][0] as any)?.consumed ?? 0);
  const allocation = bySource("app_allocation");
  return {
    budgetConsumed,
    budgetReserved: Number((budgetRows[0][0] as any)?.reserved ?? 0),
    hrmsNoBudgetLine: allocation - budgetConsumed,
    hrmsOrdinary: bySource("app_grn"),
    imprestReservedNoCostCentre: Number((imprestRows[0][0] as any)?.amt ?? 0),
  };
}

// ─── 11. Pending actions ─────────────────────────────────────────────────────

export interface PendingAction {
  type: string;
  count: number;
  label: string;
}

export async function fetchPendingActions(
  branchId: string,
): Promise<PendingAction[]> {
  const results: PendingAction[] = [];

  const pendingGrns = await countPendingGrns(branchId);
  if (pendingGrns > 0)
    results.push({
      type: "grn_pending",
      count: pendingGrns,
      label: "GRNs awaiting approval",
    });

  const [leaveRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt
       FROM leave_request lr
       JOIN employees e ON e.id = lr.employee_id
      WHERE e.branch_id = ? AND lr.status = 'pending'
        AND DATE(COALESCE(lr.applied_at, lr.created_at)) >= DATE_SUB(CURDATE(), INTERVAL ${LEAVE_WINDOW_DAYS} DAY)`,
    [branchId],
  );
  const pendingLeaves = Number((leaveRows[0] as any)?.cnt ?? 0);
  if (pendingLeaves > 0)
    results.push({
      type: "leave_pending",
      count: pendingLeaves,
      label: "Leave requests pending",
    });

  const [exitRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt
       FROM exit_request er
       JOIN employees e ON e.id = er.employee_id
      WHERE e.branch_id = ? AND er.status IN ('pending','clearance_in_progress')`,
    [branchId],
  );
  const pendingExits = Number((exitRows[0] as any)?.cnt ?? 0);
  if (pendingExits > 0)
    results.push({
      type: "exit_pending",
      count: pendingExits,
      label: "Exit clearances pending",
    });

  return results;
}

// ─── Orchestrated loader ──────────────────────────────────────────────────────

export interface BranchHealthRawData {
  branchId: string | null;
  budget: BudgetSummary;
  grnStats: GrnStats;
  recentGrns: GrnRow[];
  ats: AtsStats;
  lateStats: LateStats;
  shrinkage: ShrinkageStats;
  /** Same calculation for the previous day, for the day-on-day comparison. */
  prevShrinkage: ShrinkageStats | null;
  headcount: HeadcountMovement;
  openHiring: OpenHiringStats;
  runningPnl: RunningPnlStats;
  pendingActions: PendingAction[];
  budgetByHead: Awaited<ReturnType<typeof fetchBudgetByHead>>;
  absence: Awaited<ReturnType<typeof fetchConsecutiveAbsence>>;
  leaveAging: LeaveAgingStats;
  regularization: Awaited<ReturnType<typeof fetchRegularizationBacklog>>;
  offers: OfferConversion;
  pnlGrnTieOut: PnlGrnTieOut;
}

const previousDay = (date: string): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

export async function fetchAllBranchHealthData(
  branchName: string,
  today: string,
): Promise<BranchHealthRawData> {
  const branchId = await branchIdFor(branchName);
  if (!branchId) {
    return {
      branchId: null,
      budget: {
        periodCode: null,
        totalBudget: 0,
        consumed: 0,
        reserved: 0,
        available: 0,
        utilizationPct: 0,
      },
      grnStats: {
        raised: 0,
        approved: 0,
        pending: 0,
        oldestPendingDays: 0,
        pendingOver3Days: 0,
        totalRaisedAmount: 0,
        unbudgeted: { count: 0, amountExGst: 0, rows: [] },
        pendingByStage: [],
        byType: [],
        bridge: {
          raisedExGst: 0,
          awaitingApproval: 0,
          earlierBudget: 0,
          noBudgetLine: 0,
          chargedThisMonth: 0,
          fromEarlierMonths: 0,
          budgetChargeTotal: 0,
        },
      },
      recentGrns: [],
      ats: NO_ATS_ACTIVITY,
      lateStats: { totalLate: 0, processWise: [], byManager: [] },
      prevShrinkage: null,
      shrinkage: {
        scheduled: 0,
        present: 0,
        absent: 0,
        onLeave: 0,
        shrinkagePct: 0,
        rosterBased: false,
        yetToStart: 0,
        weekOffWorked: 0,
        bySlot: [],
      },
      headcount: {
        joinedToday: 0,
        leftToday: 0,
        joinedNames: [],
        leftNames: [],
        byProcess: [],
        joinedMtd: 0,
        leftMtd: 0,
        upcomingExits: 0,
        exitsNotClosed: 0,
        mandateSeatsTotal: null,
        totalActive: 0,
      },
      openHiring: {
        upcomingRequisitions: 0,
        pendingApproval: 0,
        requested: 0,
        fulfilled: 0,
        openPositions: 0,
        inPipeline: 0,
        selected: 0,
        pastDeliveryRequisitions: 0,
        pastDeliveryOpenPositions: 0,
        rows: [],
      },
      runningPnl: {
        periodCode: today.slice(0, 7),
        daysInMonth: 30,
        daysElapsed: 0,
        mode: "",
        revenueInvoice: 0,
        revenueAccrual: 0,
        revenueEstimated: 0,
        creditNote: 0,
        revenueRunning: 0,
        salaryRunning: 0,
        grnConsumed: 0,
        grnReserved: 0,
        totalCostRunning: 0,
        operatingProfit: 0,
        opPct: null,
        staffPaid: 0,
        estimatedCostCentres: 0,
        costCentres: 0,
        dataAvailable: false,
      },
      pendingActions: [],
      budgetByHead: { top: [], overBudget: [] },
      absence: { total: 0, rows: [] },
      leaveAging: {
        pending: 0,
        oldestDays: 0,
        over3Days: 0,
        over7Days: 0,
        staleOlderThanWindow: 0,
      },
      regularization: {
        pending: 0,
        oldestDays: 0,
        over3Days: 0,
        over7Days: 0,
        escalated: 0,
      },
      offers: {
        offered: 0,
        joined: 0,
        notJoined: 0,
        conversionPct: null,
        joiningNext7Days: 0,
        mtd: { offered: 0, joined: 0, notJoined: 0, conversionPct: null },
      },
      pnlGrnTieOut: {
        budgetConsumed: 0,
        budgetReserved: 0,
        hrmsNoBudgetLine: 0,
        hrmsOrdinary: 0,
        imprestReservedNoCostCentre: 0,
      },
    };
  }

  const [
    budget,
    grnStats,
    recentGrns,
    ats,
    lateStats,
    shrinkage,
    prevShrinkage,
    headcount,
    openHiring,
    runningPnl,
    pendingActions,
    budgetByHead,
    absence,
    leaveAging,
    regularization,
    offers,
    pnlGrnTieOut,
  ] = await Promise.all([
    fetchBudgetSummary(branchId, today),
    fetchGrnStats(branchId, today),
    fetchRecentGrns(branchId),
    fetchAtsStats(branchName, today),
    fetchLateStats(branchId, today),
    fetchShrinkage(branchId, today),
    fetchShrinkage(branchId, previousDay(today)).catch(() => null),
    fetchHeadcountMovement(branchId, today),
    fetchOpenHiring(branchName, today),
    fetchRunningPnl(branchId, today),
    fetchPendingActions(branchId),
    fetchBudgetByHead(branchId, today),
    fetchConsecutiveAbsence(branchId, today),
    fetchLeaveAging(branchId, today),
    fetchRegularizationBacklog(branchId, today),
    fetchOfferConversion(branchId, today),
    fetchPnlGrnTieOut(branchId, today),
  ]);

  return {
    branchId,
    budget,
    grnStats,
    recentGrns,
    ats,
    lateStats,
    shrinkage,
    prevShrinkage,
    headcount,
    openHiring,
    runningPnl,
    pendingActions,
    budgetByHead,
    absence,
    leaveAging,
    regularization,
    offers,
    pnlGrnTieOut,
  };
}
