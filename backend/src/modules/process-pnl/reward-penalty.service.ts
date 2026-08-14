import { v4 as uuidv4 } from "uuid";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { tableExists } from "../../shared/dbHelpers.js";
import { writeAuditLog } from "../../shared/auditLog.js";

export interface RewardPenaltyEntry {
  id: string;
  cost_centre_id: string;
  cost_centre_name?: string;
  period_code: string;
  entry_type: "reward" | "penalty";
  description: string;
  amount_inr: number;
  client_reference: string | null;
  approval_status: "draft" | "approved" | "rejected";
  submitted_by: string;
  submitted_by_name?: string;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateRewardPenaltyPayload {
  cost_centre_id: string;
  period_code: string;
  entry_type: "reward" | "penalty";
  description: string;
  amount_inr: number;
  client_reference?: string | null;
}

export interface RewardPenaltySummary {
  cost_centre_id: string;
  cost_centre_name: string;
  total_rewards: number;
  total_penalties: number;
  net_impact: number;
}

export async function listRewardPenalty(
  periodCode: string,
  costCentreId?: string
): Promise<RewardPenaltyEntry[]> {
  if (!periodCode) return [];
  if (!(await tableExists("cost_centre_reward_penalty"))) return [];

  const where = ["rp.period_code = ?"];
  const params: unknown[] = [periodCode];
  if (costCentreId) {
    where.push("rp.cost_centre_id = ?");
    params.push(costCentreId);
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT rp.*,
            ccm.cost_centre_name,
            CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS submitted_by_name
       FROM cost_centre_reward_penalty rp
       LEFT JOIN cost_centre_master ccm ON ccm.id = rp.cost_centre_id
       LEFT JOIN employees e ON e.id = rp.submitted_by
      WHERE ${where.join(" AND ")}
      ORDER BY rp.created_at DESC`,
    params
  );
  return rows as RewardPenaltyEntry[];
}

export async function createRewardPenaltyEntry(
  payload: CreateRewardPenaltyPayload,
  submittedBy: string
): Promise<RewardPenaltyEntry> {
  if (!(await tableExists("cost_centre_reward_penalty"))) {
    throw new Error("cost_centre_reward_penalty table not yet migrated");
  }
  if (!payload.period_code || !/^\d{4}-\d{2}$/.test(payload.period_code)) {
    throw new Error("Invalid period_code; expected YYYY-MM");
  }
  if (!payload.cost_centre_id) throw new Error("cost_centre_id is required");
  if (!payload.description?.trim()) throw new Error("description is required");
  if (!payload.amount_inr || payload.amount_inr <= 0) throw new Error("amount_inr must be > 0");
  if (!["reward", "penalty"].includes(payload.entry_type)) throw new Error("entry_type must be reward or penalty");

  const id = uuidv4();
  await db.execute<ResultSetHeader>(
    `INSERT INTO cost_centre_reward_penalty
       (id, cost_centre_id, period_code, entry_type, description, amount_inr,
        client_reference, approval_status, submitted_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
    [
      id,
      payload.cost_centre_id,
      payload.period_code,
      payload.entry_type,
      payload.description.trim(),
      payload.amount_inr,
      payload.client_reference ?? null,
      submittedBy,
    ]
  );

  await writeAuditLog({
    actor_user_id: submittedBy,
    action_type: "REWARD_PENALTY_CREATE",
    module_key: "finance_pnl",
    entity_type: "cost_centre_reward_penalty",
    entity_id: id,
    metadata: { entry_type: payload.entry_type, period_code: payload.period_code, amount_inr: payload.amount_inr },
  });

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM cost_centre_reward_penalty WHERE id = ?`,
    [id]
  );
  return rows[0] as RewardPenaltyEntry;
}

export async function approveRewardPenaltyEntry(
  id: string,
  approvedBy: string
): Promise<{ ok: boolean; error?: string }> {
  if (!(await tableExists("cost_centre_reward_penalty"))) return { ok: false, error: "table missing" };

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM cost_centre_reward_penalty WHERE id = ?`,
    [id]
  );
  if (!rows.length) return { ok: false, error: "Entry not found" };
  const entry = rows[0];
  if (entry.approval_status !== "draft") {
    return { ok: false, error: `Entry is already ${entry.approval_status}` };
  }

  await db.execute(
    `UPDATE cost_centre_reward_penalty
        SET approval_status = 'approved', approved_by = ?, approved_at = NOW()
      WHERE id = ?`,
    [approvedBy, id]
  );

  await writeAuditLog({
    actor_user_id: approvedBy,
    action_type: "REWARD_PENALTY_APPROVE",
    module_key: "finance_pnl",
    entity_type: "cost_centre_reward_penalty",
    entity_id: id,
    metadata: { from: "draft", to: "approved" },
  });

  return { ok: true };
}

export async function rejectRewardPenaltyEntry(
  id: string,
  rejectedBy: string,
  reason: string
): Promise<{ ok: boolean; error?: string }> {
  if (!(await tableExists("cost_centre_reward_penalty"))) return { ok: false, error: "table missing" };
  if (!reason?.trim()) return { ok: false, error: "rejection_reason is required" };

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM cost_centre_reward_penalty WHERE id = ?`,
    [id]
  );
  if (!rows.length) return { ok: false, error: "Entry not found" };
  const entry = rows[0];
  if (entry.approval_status !== "draft") {
    return { ok: false, error: `Entry is already ${entry.approval_status}` };
  }

  await db.execute(
    `UPDATE cost_centre_reward_penalty
        SET approval_status = 'rejected', approved_by = ?, approved_at = NOW(),
            rejection_reason = ?
      WHERE id = ?`,
    [rejectedBy, reason.trim(), id]
  );

  await writeAuditLog({
    actor_user_id: rejectedBy,
    action_type: "REWARD_PENALTY_REJECT",
    module_key: "finance_pnl",
    entity_type: "cost_centre_reward_penalty",
    entity_id: id,
    metadata: { from: "draft", to: "rejected", reason: reason.trim() },
  });

  return { ok: true };
}

export async function getRewardPenaltySummary(periodCode: string): Promise<RewardPenaltySummary[]> {
  if (!periodCode) return [];
  if (!(await tableExists("cost_centre_reward_penalty"))) return [];

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT rp.cost_centre_id,
            COALESCE(ccm.cost_centre_name, rp.cost_centre_id) AS cost_centre_name,
            SUM(CASE WHEN rp.entry_type = 'reward' THEN rp.amount_inr ELSE 0 END) AS total_rewards,
            SUM(CASE WHEN rp.entry_type = 'penalty' THEN rp.amount_inr ELSE 0 END) AS total_penalties,
            SUM(CASE WHEN rp.entry_type = 'reward' THEN rp.amount_inr ELSE -rp.amount_inr END) AS net_impact
       FROM cost_centre_reward_penalty rp
       LEFT JOIN cost_centre_master ccm ON ccm.id = rp.cost_centre_id
      WHERE rp.period_code = ? AND rp.approval_status = 'approved'
      GROUP BY rp.cost_centre_id, ccm.cost_centre_name
      ORDER BY net_impact DESC`,
    [periodCode]
  );
  return rows as RewardPenaltySummary[];
}
