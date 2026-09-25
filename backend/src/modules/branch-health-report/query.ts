/**
 * Branch Health Report — data layer. Read-only.
 *
 * Each function is scoped to a single branch by branch_id (looked up via branch_name once and
 * passed through). All amounts in ₹. Dates are IST strings (the db session timezone is IST).
 *
 * GRN queries filter to bill_source_id IS NULL — HRMS-raised GRNs only, no db_bill migration data.
 * Shrinkage is roster-based (wfm_roster_assignment shift timings vs attendance_daily_record).
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getPnlReconciliation } from "../process-pnl/pnl-reconciliation.service.js";
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

// ─── 2. GRN Stats (HRMS-raised only — bill_source_id IS NULL) ────────────────

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
  /** Approved with no budget line (e.g. paid reimbursements). */
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
        AND bill_source_id IS NULL
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
        AND g.bill_source_id IS NULL
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
    // Sub-rupee differences are rounding between GRN and budget-line cost, not a real gap.
    fromEarlierMonths:
      Math.abs(budgetChargeTotal - chargedThisMonth) < 1
        ? 0
        : budgetChargeTotal - chargedThisMonth,
    budgetChargeTotal,
  };
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
      AND bill_source_id IS NULL
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
        AND bill_source_id IS NULL
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
        AND g.bill_source_id IS NULL
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
  slaBreaches: number;
  slaTotal: number;
}

export async function fetchAtsStats(
  branchName: string,
  today: string,
): Promise<AtsStats> {
  const [tokenRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*)                                                                                    AS tokens,
       SUM(qt.queue_status NOT IN ('waiting','calling') OR qt.queue_status IS NULL)              AS closed,
       SUM(LOWER(COALESCE(s.final_decision, c.final_decision, c.status,''))
           IN ('selected','offered','joined','offer_extended','offer_accepted'))                  AS selected,
       SUM(LOWER(COALESCE(s.final_decision, c.final_decision, c.status,''))
           IN ('rejected','rejected_by_hr','not_suitable','not_selected'))                        AS rejected,
       SUM(LOWER(COALESCE(s.final_decision, c.final_decision, c.status,''))
           IN ('no_show','absent','no show','no-show'))                                            AS no_show,
       SUM(qt.called_at IS NOT NULL AND
           TIMESTAMPDIFF(MINUTE, qt.arrival_time, qt.called_at) > 30)                             AS sla_breaches,
       SUM(qt.called_at IS NOT NULL)                                                              AS sla_total
     FROM ats_queue_token qt
     JOIN ats_candidate c ON c.id = qt.candidate_id
     LEFT JOIN ats_interview_submission s ON s.candidate_id = c.id
       AND s.submitted_at >= DATE_SUB(qt.arrival_time, INTERVAL 1 MINUTE)
       AND NOT EXISTS (SELECT 1 FROM ats_queue_token nx
                        WHERE nx.candidate_id = qt.candidate_id
                          AND nx.arrival_time > qt.arrival_time AND nx.arrival_time <= s.submitted_at)
    WHERE DATE(qt.arrival_time) = ?
      AND (
        LOWER(COALESCE(qt.branch_name,'')) = LOWER(?)
        OR LOWER(COALESCE(c.branch_display_name,'')) = LOWER(?)
        OR LOWER(COALESCE(c.applied_for_branch,'')) = LOWER(?)
      )
      AND c.record_type = 'candidate'`,
    [today, branchName, branchName, branchName],
  );

  const [walkinRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT c.id) AS walkins
       FROM ats_candidate c
      WHERE DATE(c.created_date) = ?
        AND (
          LOWER(COALESCE(c.branch_display_name,'')) = LOWER(?)
          OR LOWER(COALESCE(c.applied_for_branch,'')) = LOWER(?)
        )
        AND c.record_type = 'candidate'`,
    [today, branchName, branchName],
  );

  const t = tokenRows[0] as any;
  const w = walkinRows[0] as any;
  return {
    walkins: Math.max(Number(w?.walkins ?? 0), Number(t?.tokens ?? 0)),
    tokens: Number(t?.tokens ?? 0),
    tokensClosed: Number(t?.closed ?? 0),
    selected: Number(t?.selected ?? 0),
    rejected: Number(t?.rejected ?? 0),
    noShow: Number(t?.no_show ?? 0),
    slaBreaches: Number(t?.sla_breaches ?? 0),
    slaTotal: Number(t?.sla_total ?? 0),
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
  /** GRN consumed, ex-GST, by accounting period (P&L basis — includes legacy-system bills). */
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

export interface HeadcountMovement {
  joinedToday: number;
  leftToday: number;
  joinedNames: string[];
  leftNames: string[];
  byProcess: { process: string; joined: number; left: number }[];
  joinedMtd: number;
  leftMtd: number;
  totalActive: number;
}

export async function fetchHeadcountMovement(
  branchId: string,
  today: string,
): Promise<HeadcountMovement> {
  const [joinRows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(NULLIF(TRIM(e.full_name), ''), e.first_name) AS name,
            COALESCE(pm.process_name, 'Unassigned')               AS process
       FROM employees e
       LEFT JOIN process_master pm ON pm.id = e.process_id
      WHERE e.branch_id = ? AND e.date_of_joining = ?`,
    [branchId, today],
  );

  // A leaver is anyone whose last working day is today — from the employee record
  // (date_of_leaving / date_of_exit) or an exit request. They are inactive by now, so no
  // active_status filter.
  const [exitRows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT e.id,
            COALESCE(NULLIF(TRIM(e.full_name), ''), e.first_name) AS name,
            COALESCE(pm.process_name, 'Unassigned')               AS process
       FROM employees e
       LEFT JOIN process_master pm ON pm.id = e.process_id
       LEFT JOIN exit_request er ON er.employee_id = e.id
      WHERE e.branch_id = ?
        AND (e.date_of_leaving = ?
             OR e.date_of_exit = ?
             OR COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed) = ?)`,
    [branchId, today, today, today],
  );

  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM employees WHERE branch_id = ? AND active_status = 1`,
    [branchId],
  );
  const monthStart = today.slice(0, 7) + "-01";
  const [mtdRows] = await db.execute<RowDataPacket[]>(
    `SELECT SUM(date_of_joining BETWEEN ? AND ?)                        AS joined_mtd,
            SUM(COALESCE(date_of_leaving, date_of_exit) BETWEEN ? AND ?) AS left_mtd
       FROM employees WHERE branch_id = ?`,
    [monthStart, today, monthStart, today, branchId],
  );

  const joined = joinRows as any[];
  const left = exitRows as any[];
  const perProcess = new Map<string, { joined: number; left: number }>();
  for (const r of joined) {
    const b = perProcess.get(r.process) ?? { joined: 0, left: 0 };
    b.joined += 1;
    perProcess.set(r.process, b);
  }
  for (const r of left) {
    const b = perProcess.get(r.process) ?? { joined: 0, left: 0 };
    b.left += 1;
    perProcess.set(r.process, b);
  }
  return {
    joinedToday: joined.length,
    leftToday: left.length,
    joinedNames: joined.map((r) => String(r.name).trim()),
    leftNames: left.map((r) => String(r.name).trim()),
    byProcess: [...perProcess.entries()]
      .map(([process, v]) => ({ process, ...v }))
      .sort((a, b) => b.joined + b.left - (a.joined + a.left)),
    joinedMtd: Number((mtdRows[0] as any)?.joined_mtd ?? 0),
    leftMtd: Number((mtdRows[0] as any)?.left_mtd ?? 0),
    totalActive: Number((countRows[0] as any)?.cnt ?? 0),
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
      WHERE e.branch_id = ? AND lr.status = 'pending'`,
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
      ats: {
        walkins: 0,
        tokens: 0,
        tokensClosed: 0,
        selected: 0,
        rejected: 0,
        noShow: 0,
        slaBreaches: 0,
        slaTotal: 0,
      },
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
  };
}
