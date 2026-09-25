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
import { getStatement } from "../process-pnl/pnl-statement.service.js";
import { notDialDeskProcessSql } from "../../shared/ownCompanyCostCentre.js";
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

export interface GrnStats {
  raised: number;
  approved: number;
  pending: number;
  totalRaisedAmount: number;
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
      AND status <> 'draft'
      AND DATE(created_at) >= ?`,
    [...GRN_APPROVED_STATUSES, branchId, monthStart],
  );
  const r = rows[0] as any;
  return {
    raised: Number(r?.raised ?? 0),
    approved: Number(r?.approved ?? 0),
    pending: await countPendingGrns(branchId),
    totalRaisedAmount: Number(r?.total_amount ?? 0),
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
}

export async function fetchLateStats(
  branchId: string,
  today: string,
): Promise<LateStats> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(pm.process_name, 'Unassigned') AS process, COUNT(*) AS cnt
       FROM attendance_daily_record adr
       JOIN employees e ON e.id = adr.employee_id
       LEFT JOIN process_master pm ON pm.id = e.process_id
      WHERE adr.record_date = ?
        AND e.branch_id = ?
        AND adr.late_mark = 1
        AND e.active_status = 1
      GROUP BY pm.process_name
      ORDER BY cnt DESC`,
    [today, branchId],
  );
  const processWise = (rows as any[]).map((r) => ({
    process: String(r.process),
    count: Number(r.cnt),
  }));
  return {
    totalLate: processWise.reduce((s, r) => s + r.count, 0),
    processWise,
  };
}

// ─── 6. Shrinkage — roster-based with attendance fallback ────────────────────
//
// PRIMARY: employees on a published wfm_roster_assignment for today (non-week-off)
//   scheduled = roster entries where is_week_off = 0
//   absent    = scheduled with no attendance record OR status IN ('absent','unreconciled')
//   on_leave  = scheduled with status IN ('approved_leave','half_day_leave','leave','wfh')
//   shrinkage = absent / scheduled * 100
//
// FALLBACK: when no published roster exists for the branch today, count from
//   attendance_daily_record (previous behaviour).

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
  byShift: { shift: string; planned: number; present: number; absent: number }[];
}

export interface OpenHiringStats {
  activePipeline: number;
  byStage: { stage: string; count: number }[];
}

export interface RunningPnlStats {
  periodCode: string;
  /** Recognised revenue as the P&L statement books it (system revenue, before manual adjustments). */
  revenueRecognized: number;
  revenueInvoiced: number;
  /** Contracted (planned-seat) revenue for the period — the projection the branch is working to. */
  revenueProjected: number;
  /** Direct cost: agent + DSC + BMC salaries. */
  directCost: number;
  /** Indirect cost: consumed + committed GRN spend allocated to the branch. */
  indirectCost: number;
  totalCost: number;
  operatingProfit: number;
  opPct: number | null;
  /** Share of active headcount whose salary is in the cost — below 100 the profit is overstated. */
  peopleCostCoveragePct: number | null;
  revenueBasis: string;
  /** Month still open and revenue not yet invoiced: revenue is a full-month estimate while cost accrues to costAsOf. */
  revenueIsEstimate: boolean;
  /** Date (YYYY-MM-DD) up to which salary cost has been accrued. */
  costAsOf: string | null;
  dataAvailable: boolean;
}

const LEAVE_STATUSES = new Set(["leave_approved", "approved_leave", "half_day_leave", "leave"]);
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
 */
export async function fetchShrinkage(
  branchId: string,
  today: string,
): Promise<ShrinkageStats> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ra.assignment_type, ra.is_week_off,
            COALESCE(ra.shift_start_time, st.start_time) AS shift_start,
            COALESCE(ra.shift_end_time, st.end_time)     AS shift_end,
            adr.clock_in_time, adr.attendance_status
       FROM wfm_roster_assignment ra
       JOIN employees e ON e.id = ra.employee_id AND e.branch_id = ? AND e.active_status = 1
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
  const shifts = new Map<string, { planned: number; present: number; absent: number }>();

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
    if (!punched && !isShiftDueYet(r.shift_start ? String(r.shift_start) : null, today)) {
      yetToStart += 1;
      continue;
    }
    scheduled += 1;
    const key =
      r.shift_start || r.shift_end
        ? `${hhmm(r.shift_start)}–${hhmm(r.shift_end)}`
        : "No shift time on roster";
    const bucket = shifts.get(key) ?? { planned: 0, present: 0, absent: 0 };
    bucket.planned += 1;
    if (punched) {
      present += 1;
      bucket.present += 1;
    } else {
      absent += 1;
      bucket.absent += 1;
    }
    shifts.set(key, bucket);
  }

  const byShift = [...shifts.entries()]
    .map(([shift, v]) => ({ shift, ...v }))
    .sort((a, b) => a.shift.localeCompare(b.shift));

  return {
    scheduled,
    present,
    absent,
    onLeave,
    shrinkagePct: scheduled > 0 ? Math.round((absent / scheduled) * 100) : 0,
    rosterBased: (rows as any[]).length > 0,
    yetToStart,
    weekOffWorked,
    byShift,
  };
}

// ─── 7. Headcount movements ───────────────────────────────────────────────────

export interface HeadcountMovement {
  joinedToday: number;
  leftToday: number;
  joinedNames: string[];
  leftNames: string[];
  totalActive: number;
}

export async function fetchHeadcountMovement(
  branchId: string,
  today: string,
): Promise<HeadcountMovement> {
  const [joinRows] = await db.execute<RowDataPacket[]>(
    `SELECT CONCAT(first_name, ' ', COALESCE(last_name, '')) AS name
       FROM employees
      WHERE branch_id = ? AND date_of_joining = ? AND active_status = 1`,
    [branchId, today],
  );

  const [exitRows] = await db.execute<RowDataPacket[]>(
    `SELECT CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS name
       FROM exit_request er
       JOIN employees e ON e.id = er.employee_id
      WHERE e.branch_id = ?
        AND COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed) = ?`,
    [branchId, today],
  );

  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM employees WHERE branch_id = ? AND active_status = 1`,
    [branchId],
  );

  const joinedNames = (joinRows as any[]).map((r) => String(r.name).trim());
  const leftNames = (exitRows as any[]).map((r) => String(r.name).trim());
  return {
    joinedToday: joinedNames.length,
    leftToday: leftNames.length,
    joinedNames,
    leftNames,
    totalActive: Number((countRows[0] as any)?.cnt ?? 0),
  };
}

// ─── 8. Process performance (ops + quality from kpi_entry) ───────────────────

export interface ProcessKpiMetric {
  name: string;
  unit: string;
  actual: number;
  target: number;
  lowerIsBetter: boolean;
  attainmentPct: number;
}

export interface ProcessPerformance {
  process: string;
  metrics: ProcessKpiMetric[];
  opsScore: number | null;
  qualityScore: number | null;
  status: "healthy" | "watch" | "critical";
}

const KPI_LOOKBACK_DAYS = 14;
const KPI_HEALTHY_PCT = 90;
const KPI_WATCH_PCT = 70;

/** Attainment % of an average actual against its target, capped at 120 like the KPI module. */
function kpiAttainmentPct(
  actual: number,
  target: number,
  lowerIsBetter: boolean,
): number | null {
  if (!Number.isFinite(actual) || !Number.isFinite(target) || target <= 0)
    return null;
  if (lowerIsBetter && actual <= 0) return 120;
  const pct = lowerIsBetter ? (target / actual) * 100 : (actual / target) * 100;
  return Math.min(120, Math.max(0, pct));
}

function meanRounded(values: number[]): number | null {
  return values.length
    ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
    : null;
}

/**
 * Process performance comes straight from the KPI module: kpi_daily_actual (per-employee
 * daily actuals) against the process target in kpi_process_config. Per process and metric the
 * last KPI_LOOKBACK_DAYS of actuals are averaged and compared with the latest effective target.
 * "Quality" = quality-family metrics; "KPI attainment" = every other targeted metric.
 */
export async function fetchProcessPerformance(
  branchId: string,
  today: string,
): Promise<ProcessPerformance[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT pm.process_name AS process,
            mm.metric_name,
            mm.unit,
            mm.direction,
            mm.family,
            mm.category,
            AVG(d.actual_value) AS avg_actual,
            (SELECT c.target_value FROM kpi_process_config c
              WHERE c.process_id = d.process_id_at_event AND c.metric_id = d.metric_id
                AND c.effective_from <= ?
              ORDER BY c.effective_from DESC LIMIT 1) AS target
       FROM kpi_daily_actual d
       JOIN kpi_metric_master mm ON mm.id = d.metric_id
       JOIN process_master pm ON pm.id = d.process_id_at_event
       LEFT JOIN branch_master bm ON bm.id = pm.branch_id
      WHERE d.branch_id_at_event = ?
        AND ${notDialDeskProcessSql("pm", "bm")}
        AND d.score_date BETWEEN DATE_SUB(?, INTERVAL ${KPI_LOOKBACK_DAYS} DAY) AND ?
        AND d.actual_value IS NOT NULL
      GROUP BY pm.process_name, d.process_id_at_event, d.metric_id,
               mm.metric_name, mm.unit, mm.direction, mm.family, mm.category
      ORDER BY pm.process_name`,
    [today, branchId, today, today],
  );

  const byProcess = new Map<
    string,
    { ops: number[]; quality: number[]; metrics: ProcessKpiMetric[] }
  >();
  for (const r of rows as any[]) {
    if (r.target == null) continue;
    const pct = kpiAttainmentPct(
      Number(r.avg_actual),
      Number(r.target),
      r.direction === "lower_is_better",
    );
    if (pct == null) continue;
    const name = String(r.process);
    const bucket = byProcess.get(name) ?? { ops: [], quality: [], metrics: [] };
    const isQuality =
      String(r.family).toLowerCase() === "quality" ||
      String(r.category).toLowerCase() === "quality";
    (isQuality ? bucket.quality : bucket.ops).push(pct);
    bucket.metrics.push({
      name: String(r.metric_name),
      unit: String(r.unit ?? ""),
      actual: Number(r.avg_actual),
      target: Number(r.target),
      lowerIsBetter: r.direction === "lower_is_better",
      attainmentPct: Math.round(pct),
    });
    byProcess.set(name, bucket);
  }

  return [...byProcess.entries()].map(([process, b]) => {
    const opsScore = meanRounded(b.ops);
    const qualityScore = meanRounded(b.quality);
    const scores = [opsScore, qualityScore].filter(
      (x): x is number => x != null,
    );
    const worst = scores.length ? Math.min(...scores) : null;
    const status: ProcessPerformance["status"] =
      worst == null || worst < KPI_WATCH_PCT
        ? worst == null
          ? "watch"
          : "critical"
        : worst >= KPI_HEALTHY_PCT
          ? "healthy"
          : "watch";
    const metrics = [...b.metrics].sort((x, y) => x.attainmentPct - y.attainmentPct);
    return { process, metrics, opsScore, qualityScore, status };
  });
}

// ─── 9. Open Hiring Pipeline ──────────────────────────────────────────────────

export async function fetchOpenHiring(
  branchName: string,
): Promise<OpenHiringStats> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COALESCE(NULLIF(TRIM(current_status), ''), 'Unknown') AS stage,
       COUNT(*)                                               AS cnt
     FROM ats_recruiter_hiring_activity
    WHERE LOWER(branch_name) = LOWER(?)
      AND activity_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      AND NULLIF(TRIM(current_status), '') IS NOT NULL
      AND current_status NOT IN ('Joined','Rejected','Walk-in Completed')
    GROUP BY stage
    ORDER BY cnt DESC`,
    [branchName],
  );
  const byStage = (rows as any[]).map((r) => ({
    stage: String(r.stage),
    count: Number(r.cnt),
  }));
  return {
    activePipeline: byStage.reduce((s, r) => s + r.count, 0),
    byStage,
  };
}

// ─── 10. Running P&L Snapshot ─────────────────────────────────────────────────

/**
 * Branch P&L for the month, taken from the same statement engine the P&L page renders
 * (getStatement, viewBy=branch) so the email and the app can never quote different numbers.
 */
export async function fetchRunningPnl(
  branchId: string,
  today: string,
): Promise<RunningPnlStats> {
  const period = today.slice(0, 7); // YYYY-MM
  const empty: RunningPnlStats = {
    periodCode: period,
    revenueRecognized: 0,
    revenueInvoiced: 0,
    revenueProjected: 0,
    directCost: 0,
    indirectCost: 0,
    totalCost: 0,
    operatingProfit: 0,
    opPct: null,
    peopleCostCoveragePct: null,
    revenueBasis: "",
    revenueIsEstimate: false,
    costAsOf: null,
    dataAvailable: false,
  };
  const statement: any = await getStatement({ period, branchId }, "branch");
  const column = statement.columns?.[0];
  if (!column) return empty;
  const value = (key: string): number => {
    const row = statement.rows.find((r: any) => r.componentKey === key);
    return Number(row?.values?.[column.id] ?? 0) || 0;
  };
  const revenueRecognized = value("recognized_revenue");
  const totalCost = value("total_cost");
  return {
    periodCode: period,
    revenueRecognized,
    revenueInvoiced: value("invoiced_revenue"),
    revenueProjected: value("planned_revenue"),
    directCost: value("dc_total"),
    indirectCost: value("total_idc"),
    totalCost,
    operatingProfit: value("operating_profit"),
    opPct: revenueRecognized > 0 ? value("operating_profit_pct") : null,
    peopleCostCoveragePct: column.peopleCostCoveragePct ?? null,
    revenueBasis: String(statement.revenueBasis ?? ""),
    revenueIsEstimate:
      Boolean(statement.periodOpen) && statement.revenueBasis !== "invoiced",
    costAsOf: statement.peopleCostAsOf
      ? new Date(statement.peopleCostAsOf).toISOString().slice(0, 10)
      : null,
    dataAvailable: revenueRecognized > 0 || totalCost > 0,
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
  headcount: HeadcountMovement;
  processPerformance: ProcessPerformance[];
  openHiring: OpenHiringStats;
  runningPnl: RunningPnlStats;
  pendingActions: PendingAction[];
}

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
      grnStats: { raised: 0, approved: 0, pending: 0, totalRaisedAmount: 0 },
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
      lateStats: { totalLate: 0, processWise: [] },
      shrinkage: {
        scheduled: 0,
        present: 0,
        absent: 0,
        onLeave: 0,
        shrinkagePct: 0,
        rosterBased: false,
        yetToStart: 0,
        weekOffWorked: 0,
        byShift: [],
      },
      headcount: {
        joinedToday: 0,
        leftToday: 0,
        joinedNames: [],
        leftNames: [],
        totalActive: 0,
      },
      processPerformance: [],
      openHiring: { activePipeline: 0, byStage: [] },
      runningPnl: {
        periodCode: today.slice(0, 7),
        revenueRecognized: 0,
        revenueInvoiced: 0,
        revenueProjected: 0,
        directCost: 0,
        indirectCost: 0,
        totalCost: 0,
        operatingProfit: 0,
        opPct: null,
        peopleCostCoveragePct: null,
        revenueBasis: "",
        revenueIsEstimate: false,
        costAsOf: null,
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
    headcount,
    processPerformance,
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
    fetchHeadcountMovement(branchId, today),
    fetchProcessPerformance(branchId, today),
    fetchOpenHiring(branchName),
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
    headcount,
    processPerformance,
    openHiring,
    runningPnl,
    pendingActions,
  };
}
