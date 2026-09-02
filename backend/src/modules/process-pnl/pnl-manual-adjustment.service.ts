import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { tableExists } from "../../shared/dbHelpers.js";
import { writeAuditLog } from "../../shared/auditLog.js";
import { refuse } from "./finance-error.js";

/**
 * Manual P&L Adjustments — Projected Revenue, Penalty, Reward.
 *
 * DESIGN (user-approved, 2026-09-01): a SEPARATE adjustment line, never blended into
 * system-calculated actuals. getAdjustedTotal() below folds only APPROVED rows into a distinct
 * "Adjusted Total" figure that a caller shows ALONGSIDE the pure system figure — it never mutates
 * or replaces recognizedRevenue/operatingProfit/ebit anywhere in canonicalPnlService,
 * bpoPnlAllocationOverlayService or bpoPnlService.
 *
 * Approval state machine mirrors reward-penalty.service.ts's cost_centre_reward_penalty entries
 * (draft/pending -> approved/rejected, single reviewer stage, reason required to reject) — the
 * closest existing analog to what this table needs: a single-stage, finance-adjacent maker-checker
 * entry, not budget-topup.service.ts's two-stage branch_head->finance_head chain (that shape exists
 * to gate an actual spend increase against a budget ceiling; a projected-revenue/penalty/reward
 * adjustment here has no budget ceiling to reconcile against). Route-level role gating in
 * process-pnl.routes.ts mirrors RP_APPROVE_ROLES (super_admin/finance_head/accounts_head) for the
 * same reason. Audit trail uses writeAuditLog (../../shared/auditLog.js), the same sink
 * reward-penalty.service.ts uses for this exact shape of entity — not
 * recordFinanceApprovalEvent, which is budget-topup/GRN's own two-stage-workflow sink.
 *
 * This is deliberately a NEW, separate table/service from cost_centre_reward_penalty — that
 * existing feature is cost-centre-scoped and IS blended directly into recognizedRevenue/EBITDA
 * once approved (see getRewardPenaltyForPeriod in bpo-pnl.service.ts). This one is process-scoped
 * and is never blended into the actual figures at all.
 */

export type AdjustmentType = "projected_revenue" | "penalty" | "reward";
export type AdjustmentStatus = "pending" | "approved" | "rejected";

export interface ManualAdjustment {
  id: string;
  process_id: string;
  process_name?: string;
  branch_id: string | null;
  branch_name?: string;
  period_code: string;
  adjustment_type: AdjustmentType;
  amount: number;
  reason: string;
  status: AdjustmentStatus;
  created_by: string;
  created_by_name?: string;
  created_at: string;
  approved_by: string | null;
  approved_by_name?: string;
  approved_at: string | null;
  rejection_reason: string | null;
  updated_at: string;
}

export interface CreateAdjustmentInput {
  processId: string;
  periodCode: string;
  adjustmentType: AdjustmentType;
  amount: number;
  reason: string;
}

export interface AdjustedTotal {
  processId: string;
  periodCode: string;
  /** Sum of approved projected_revenue entries. Informational only — NOT part of adjustedTotal
   *  below, since "projected" revenue is a forward-looking estimate, not a realised adjustment to
   *  the actual figure. Surfaced separately so a caller can show it without it silently entering
   *  the same total as penalty/reward. */
  approvedProjectedRevenue: number;
  /** Sum of approved reward entries — adds to revenue. */
  approvedRewards: number;
  /** Sum of approved penalty entries — subtracts from revenue. */
  approvedPenalties: number;
  /** systemRevenue + approvedRewards - approvedPenalties. Never includes projected_revenue. */
  adjustedTotal: number;
  systemRevenue: number;
  pendingCount: number;
}

const ADJUSTMENT_TYPES: AdjustmentType[] = ["projected_revenue", "penalty", "reward"];

function assertPeriod(periodCode: string) {
  if (!/^\d{4}-\d{2}$/.test(periodCode)) {
    throw refuse(400, "ADJUSTMENT_PERIOD_INVALID", "period_code must be in YYYY-MM format");
  }
}

export async function createManualAdjustment(
  input: CreateAdjustmentInput,
  actorId: string
): Promise<ManualAdjustment> {
  if (!(await tableExists("pnl_manual_adjustment"))) {
    throw refuse(503, "ADJUSTMENT_TABLE_MISSING", "pnl_manual_adjustment table not yet migrated (run sql/1645).");
  }
  if (!input.processId) throw refuse(400, "ADJUSTMENT_PROCESS_REQUIRED", "process_id is required");
  assertPeriod(input.periodCode);
  if (!ADJUSTMENT_TYPES.includes(input.adjustmentType)) {
    throw refuse(400, "ADJUSTMENT_TYPE_INVALID", "adjustment_type must be projected_revenue, penalty or reward");
  }
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw refuse(400, "ADJUSTMENT_AMOUNT_INVALID", "amount must be greater than zero");
  }
  if (!input.reason?.trim()) {
    throw refuse(400, "ADJUSTMENT_REASON_REQUIRED", "A reason is required — this money moves a P&L figure");
  }

  const [processRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, branch_id FROM process_master WHERE id = ?`,
    [input.processId]
  );
  const process = processRows[0];
  if (!process) throw refuse(404, "ADJUSTMENT_PROCESS_NOT_FOUND", "Process not found");

  const id = randomUUID();
  await db.execute(
    `INSERT INTO pnl_manual_adjustment
       (id, process_id, branch_id, period_code, adjustment_type, amount, reason, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [id, input.processId, process.branch_id ?? null, input.periodCode, input.adjustmentType,
      Math.round(amount * 100) / 100, input.reason.trim(), actorId]
  );

  await writeAuditLog({
    actor_user_id: actorId,
    action_type: "PNL_MANUAL_ADJUSTMENT_CREATE",
    module_key: "finance_pnl",
    entity_type: "pnl_manual_adjustment",
    entity_id: id,
    metadata: {
      processId: input.processId, periodCode: input.periodCode,
      adjustmentType: input.adjustmentType, amount,
    },
  });

  return getManualAdjustment(id);
}

export async function getManualAdjustment(id: string): Promise<ManualAdjustment> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT a.*, p.process_name, b.branch_name,
            CONCAT(cu.first_name, ' ', COALESCE(cu.last_name, '')) AS created_by_name,
            CONCAT(au.first_name, ' ', COALESCE(au.last_name, '')) AS approved_by_name
       FROM pnl_manual_adjustment a
       LEFT JOIN process_master p ON p.id = a.process_id
       LEFT JOIN branch_master b ON b.id = a.branch_id
       LEFT JOIN employees cu ON cu.id = a.created_by
       LEFT JOIN employees au ON au.id = a.approved_by
      WHERE a.id = ?`,
    [id]
  );
  if (!rows[0]) throw refuse(404, "ADJUSTMENT_NOT_FOUND", "Manual adjustment not found");
  return rows[0] as unknown as ManualAdjustment;
}

export async function listManualAdjustments(filters: {
  processId?: string;
  branchId?: string;
  periodCode?: string;
  status?: AdjustmentStatus;
}): Promise<ManualAdjustment[]> {
  if (!(await tableExists("pnl_manual_adjustment"))) return [];
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.processId) { where.push("a.process_id = ?"); params.push(filters.processId); }
  if (filters.branchId) { where.push("a.branch_id = ?"); params.push(filters.branchId); }
  if (filters.periodCode) { where.push("a.period_code = ?"); params.push(filters.periodCode); }
  if (filters.status) { where.push("a.status = ?"); params.push(filters.status); }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT a.*, p.process_name, b.branch_name,
            CONCAT(cu.first_name, ' ', COALESCE(cu.last_name, '')) AS created_by_name,
            CONCAT(au.first_name, ' ', COALESCE(au.last_name, '')) AS approved_by_name
       FROM pnl_manual_adjustment a
       LEFT JOIN process_master p ON p.id = a.process_id
       LEFT JOIN branch_master b ON b.id = a.branch_id
       LEFT JOIN employees cu ON cu.id = a.created_by
       LEFT JOIN employees au ON au.id = a.approved_by
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY a.created_at DESC`,
    params
  );
  return rows as unknown as ManualAdjustment[];
}

export async function reviewManualAdjustment(
  id: string,
  decision: "approve" | "reject",
  actorId: string,
  rejectionReason?: string
): Promise<ManualAdjustment> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM pnl_manual_adjustment WHERE id = ?`,
    [id]
  );
  const entry = rows[0];
  if (!entry) throw refuse(404, "ADJUSTMENT_NOT_FOUND", "Manual adjustment not found");

  // Maker-checker: the creator cannot approve/reject their own entry — same rule
  // budget-topup.service.ts enforces (P0P1-4), applied here for the same reason.
  if (String(entry.created_by) === actorId) {
    throw refuse(
      409, "ADJUSTMENT_MAKER_CHECKER",
      "You created this adjustment, so you cannot review it. A different reviewer must approve or reject it."
    );
  }
  if (String(entry.status) !== "pending") {
    throw refuse(409, "ADJUSTMENT_WRONG_STAGE", `Adjustment is already ${entry.status}`);
  }

  if (decision === "reject") {
    if (!rejectionReason?.trim()) {
      throw refuse(400, "ADJUSTMENT_REJECT_REASON_REQUIRED", "A reason is required to reject an adjustment");
    }
    await db.execute(
      `UPDATE pnl_manual_adjustment
          SET status = 'rejected', approved_by = ?, approved_at = NOW(), rejection_reason = ?
        WHERE id = ?`,
      [actorId, rejectionReason.trim(), id]
    );
    await writeAuditLog({
      actor_user_id: actorId,
      action_type: "PNL_MANUAL_ADJUSTMENT_REJECT",
      module_key: "finance_pnl",
      entity_type: "pnl_manual_adjustment",
      entity_id: id,
      metadata: { from: "pending", to: "rejected", reason: rejectionReason.trim() },
    });
    return getManualAdjustment(id);
  }

  await db.execute(
    `UPDATE pnl_manual_adjustment
        SET status = 'approved', approved_by = ?, approved_at = NOW()
      WHERE id = ?`,
    [actorId, id]
  );
  await writeAuditLog({
    actor_user_id: actorId,
    action_type: "PNL_MANUAL_ADJUSTMENT_APPROVE",
    module_key: "finance_pnl",
    entity_type: "pnl_manual_adjustment",
    entity_id: id,
    metadata: { from: "pending", to: "approved" },
  });
  return getManualAdjustment(id);
}

/**
 * Folds APPROVED adjustments only into an "Adjusted Total" alongside `systemRevenue` — the
 * caller's own already-computed canonical/statement revenue figure, passed in rather than
 * re-derived here so this never becomes a second, drifting revenue engine.
 *
 * Reward ADDS to revenue, penalty SUBTRACTS — both are revenue-side, per the approved design.
 * Projected revenue is reported separately (approvedProjectedRevenue) and does NOT enter
 * adjustedTotal: it is a forward estimate, not a realised adjustment to what already happened.
 */
export async function getAdjustedTotal(
  processId: string,
  periodCode: string,
  systemRevenue: number
): Promise<AdjustedTotal> {
  const base: AdjustedTotal = {
    processId, periodCode, approvedProjectedRevenue: 0, approvedRewards: 0,
    approvedPenalties: 0, adjustedTotal: systemRevenue, systemRevenue, pendingCount: 0,
  };
  if (!(await tableExists("pnl_manual_adjustment"))) return base;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT adjustment_type, status, SUM(amount) AS total, COUNT(*) AS cnt
       FROM pnl_manual_adjustment
      WHERE process_id = ? AND period_code = ?
      GROUP BY adjustment_type, status`,
    [processId, periodCode]
  );
  let approvedProjectedRevenue = 0;
  let approvedRewards = 0;
  let approvedPenalties = 0;
  let pendingCount = 0;
  for (const row of rows) {
    const total = Number(row.total ?? 0);
    if (String(row.status) === "pending") { pendingCount += Number(row.cnt ?? 0); continue; }
    if (String(row.status) !== "approved") continue;
    if (row.adjustment_type === "projected_revenue") approvedProjectedRevenue += total;
    else if (row.adjustment_type === "reward") approvedRewards += total;
    else if (row.adjustment_type === "penalty") approvedPenalties += total;
  }
  return {
    processId, periodCode, approvedProjectedRevenue, approvedRewards, approvedPenalties,
    adjustedTotal: systemRevenue + approvedRewards - approvedPenalties,
    systemRevenue, pendingCount,
  };
}

export interface ApprovedAdjustmentBucket {
  approvedProjectedRevenue: number;
  approvedRewards: number;
  approvedPenalties: number;
  pendingCount: number;
}

/**
 * Batched form of getAdjustedTotal(), one query for every process in a period instead of one
 * query per column — for pnl-statement.service.ts, which enriches many columns per statement and
 * must not turn "show the adjusted total" into an N+1 query storm.
 */
export async function getApprovedAdjustmentsByProcess(
  periodCode: string
): Promise<Map<string, ApprovedAdjustmentBucket>> {
  const out = new Map<string, ApprovedAdjustmentBucket>();
  if (!/^\d{4}-\d{2}$/.test(periodCode)) return out;
  if (!(await tableExists("pnl_manual_adjustment"))) return out;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT process_id, adjustment_type, status, SUM(amount) AS total, COUNT(*) AS cnt
       FROM pnl_manual_adjustment
      WHERE period_code = ?
      GROUP BY process_id, adjustment_type, status`,
    [periodCode]
  );
  for (const row of rows) {
    const key = String(row.process_id);
    const bucket = out.get(key) ?? {
      approvedProjectedRevenue: 0, approvedRewards: 0, approvedPenalties: 0, pendingCount: 0,
    };
    const total = Number(row.total ?? 0);
    if (String(row.status) === "pending") {
      bucket.pendingCount += Number(row.cnt ?? 0);
    } else if (String(row.status) === "approved") {
      if (row.adjustment_type === "projected_revenue") bucket.approvedProjectedRevenue += total;
      else if (row.adjustment_type === "reward") bucket.approvedRewards += total;
      else if (row.adjustment_type === "penalty") bucket.approvedPenalties += total;
    }
    out.set(key, bucket);
  }
  return out;
}

export const pnlManualAdjustmentService = {
  createManualAdjustment,
  getManualAdjustment,
  listManualAdjustments,
  reviewManualAdjustment,
  getAdjustedTotal,
  getApprovedAdjustmentsByProcess,
};
