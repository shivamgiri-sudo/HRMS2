/**
 * Branch Health Report — data layer. Read-only.
 *
 * Each function is scoped to a single branch by branch_id (looked up via branch_name once and
 * passed through). All amounts in ₹. Dates are IST strings (the db session timezone is IST).
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

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

export async function fetchBudgetSummary(branchId: string, today: string): Promise<BudgetSummary> {
  const ym = today.slice(0, 7); // YYYY-MM — period_code is in this format
  // Most recent approved/active budget for this branch's current financial year period
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT h.period_code,
            h.gross_budget_amount                               AS total_budget,
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
  if (!r) return { periodCode: null, totalBudget: 0, consumed: 0, reserved: 0, available: 0, utilizationPct: 0 };
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

// ─── 2. GRN Stats ────────────────────────────────────────────────────────────

export interface GrnStats {
  raised: number;
  approved: number;
  pending: number;
  totalRaisedAmount: number;
}

const GRN_APPROVED_STATUSES = [
  "approved", "finance_head_approved", "pending_accounts_payment",
  "payment_scheduled", "partially_paid", "paid",
];
const GRN_PENDING_STATUSES = [
  "submitted", "branch_head_approved", "accounts_head_approved",
  "returned_to_branch_head", "returned_to_raiser",
];

export async function fetchGrnStats(branchId: string, today: string): Promise<GrnStats> {
  const monthStart = today.slice(0, 7) + "-01";
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*)                                                           AS raised,
       SUM(status IN (${GRN_APPROVED_STATUSES.map(() => "?").join(",")})) AS approved,
       SUM(status IN (${GRN_PENDING_STATUSES.map(() => "?").join(",")}))  AS pending,
       COALESCE(SUM(amount_with_tax), 0)                                  AS total_amount
     FROM grn_request
    WHERE branch_id = ?
      AND DATE(created_at) >= ?`,
    [...GRN_APPROVED_STATUSES, ...GRN_PENDING_STATUSES, branchId, monthStart],
  );
  const r = rows[0] as any;
  return {
    raised: Number(r?.raised ?? 0),
    approved: Number(r?.approved ?? 0),
    pending: Number(r?.pending ?? 0),
    totalRaisedAmount: Number(r?.total_amount ?? 0),
  };
}

// ─── 3. GRN List (latest 15) ─────────────────────────────────────────────────

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

export async function fetchAtsStats(branchName: string, today: string): Promise<AtsStats> {
  // Walk-ins: candidates registered today (queue tokens arriving today)
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

  // Walkins also include token-only registrations (no queue row)
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

export async function fetchLateStats(branchId: string, today: string): Promise<LateStats> {
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

// ─── 6. Shrinkage ─────────────────────────────────────────────────────────────

export interface ShrinkageStats {
  scheduled: number;
  present: number;
  absent: number;
  onLeave: number;
  shrinkagePct: number;
}

export async function fetchShrinkage(branchId: string, today: string): Promise<ShrinkageStats> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*)                                                             AS scheduled,
       SUM(adr.attendance_status IN ('present','half_day'))                AS present,
       SUM(adr.attendance_status IN ('absent','unreconciled'))             AS absent,
       SUM(adr.attendance_status IN ('approved_leave','half_day_leave',
                                     'leave','wfh'))                       AS on_leave
     FROM attendance_daily_record adr
     JOIN employees e ON e.id = adr.employee_id
    WHERE adr.record_date = ?
      AND e.branch_id = ?
      AND e.active_status = 1`,
    [today, branchId],
  );
  const r = rows[0] as any;
  const scheduled = Number(r?.scheduled ?? 0);
  const absent = Number(r?.absent ?? 0);
  return {
    scheduled,
    present: Number(r?.present ?? 0),
    absent,
    onLeave: Number(r?.on_leave ?? 0),
    shrinkagePct: scheduled > 0 ? Math.round((absent / scheduled) * 100) : 0,
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

export async function fetchHeadcountMovement(branchId: string, today: string): Promise<HeadcountMovement> {
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

// ─── 8. Process performance (ops + quality) ───────────────────────────────────

export interface ProcessPerformance {
  process: string;
  opsScore: number | null;
  qualityScore: number | null;
  status: "healthy" | "watch" | "critical";
}

export async function fetchProcessPerformance(branchId: string, today: string): Promise<ProcessPerformance[]> {
  // Guard: skip entirely if kpi_entry is not yet created (avoids noisy ER_NO_SUCH_TABLE pool logs)
  const [tableCheck] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_entry' LIMIT 1`,
  );
  if (!(tableCheck as any[]).length) return [];

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT pm.process_name AS process,
            AVG(CASE WHEN LOWER(kd.kpi_category) IN ('ops','operations') THEN ke.score END)   AS ops_score,
            AVG(CASE WHEN LOWER(kd.kpi_category) IN ('quality','qa','qc') THEN ke.score END) AS quality_score
       FROM kpi_entry ke
       JOIN kpi_definition kd ON kd.id = ke.kpi_id
       JOIN process_master pm ON pm.id = ke.process_id
       JOIN employees e ON e.process_id = pm.id AND e.branch_id = ? AND e.active_status = 1
      WHERE ke.entry_date BETWEEN DATE_SUB(?, INTERVAL 7 DAY) AND ?
      GROUP BY pm.process_name
      ORDER BY pm.process_name`,
    [branchId, today, today],
  );

  return (rows as any[]).map((r) => {
    const opsScore = r.ops_score != null ? Math.round(Number(r.ops_score)) : null;
    const qualityScore = r.quality_score != null ? Math.round(Number(r.quality_score)) : null;
    const minScore = [opsScore, qualityScore].filter((s): s is number => s != null);
    const worst = minScore.length ? Math.min(...minScore) : null;
    const status: ProcessPerformance["status"] =
      worst == null ? "watch" : worst >= 80 ? "healthy" : worst >= 60 ? "watch" : "critical";
    return { process: String(r.process), opsScore, qualityScore, status };
  });
}

// ─── 9. Pending actions ───────────────────────────────────────────────────────

export interface PendingAction {
  type: string;
  count: number;
  label: string;
}

export async function fetchPendingActions(branchId: string): Promise<PendingAction[]> {
  const results: PendingAction[] = [];

  const [grnRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM grn_request
      WHERE branch_id = ? AND status IN (${GRN_PENDING_STATUSES.map(() => "?").join(",")})`,
    [branchId, ...GRN_PENDING_STATUSES],
  );
  const pendingGrns = Number((grnRows[0] as any)?.cnt ?? 0);
  if (pendingGrns > 0) results.push({ type: "grn_pending", count: pendingGrns, label: "GRNs awaiting approval" });

  const [leaveRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt
       FROM leave_request lr
       JOIN employees e ON e.id = lr.employee_id
      WHERE e.branch_id = ? AND lr.status = 'pending'`,
    [branchId],
  );
  const pendingLeaves = Number((leaveRows[0] as any)?.cnt ?? 0);
  if (pendingLeaves > 0) results.push({ type: "leave_pending", count: pendingLeaves, label: "Leave requests pending" });

  const [exitRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt
       FROM exit_request er
       JOIN employees e ON e.id = er.employee_id
      WHERE e.branch_id = ? AND er.status IN ('pending','clearance_in_progress')`,
    [branchId],
  );
  const pendingExits = Number((exitRows[0] as any)?.cnt ?? 0);
  if (pendingExits > 0) results.push({ type: "exit_pending", count: pendingExits, label: "Exit clearances pending" });

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
  pendingActions: PendingAction[];
}

export async function fetchAllBranchHealthData(branchName: string, today: string): Promise<BranchHealthRawData> {
  const branchId = await branchIdFor(branchName);
  if (!branchId) {
    return {
      branchId: null,
      budget: { periodCode: null, totalBudget: 0, consumed: 0, reserved: 0, available: 0, utilizationPct: 0 },
      grnStats: { raised: 0, approved: 0, pending: 0, totalRaisedAmount: 0 },
      recentGrns: [],
      ats: { walkins: 0, tokens: 0, tokensClosed: 0, selected: 0, rejected: 0, noShow: 0, slaBreaches: 0, slaTotal: 0 },
      lateStats: { totalLate: 0, processWise: [] },
      shrinkage: { scheduled: 0, present: 0, absent: 0, onLeave: 0, shrinkagePct: 0 },
      headcount: { joinedToday: 0, leftToday: 0, joinedNames: [], leftNames: [], totalActive: 0 },
      processPerformance: [],
      pendingActions: [],
    };
  }

  const [budget, grnStats, recentGrns, ats, lateStats, shrinkage, headcount, processPerformance, pendingActions] =
    await Promise.all([
      fetchBudgetSummary(branchId, today),
      fetchGrnStats(branchId, today),
      fetchRecentGrns(branchId),
      fetchAtsStats(branchName, today),
      fetchLateStats(branchId, today),
      fetchShrinkage(branchId, today),
      fetchHeadcountMovement(branchId, today),
      fetchProcessPerformance(branchId, today),
      fetchPendingActions(branchId),
    ]);

  return { branchId, budget, grnStats, recentGrns, ats, lateStats, shrinkage, headcount, processPerformance, pendingActions };
}
