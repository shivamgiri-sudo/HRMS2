import { db } from "../../db/mysql.js";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { randomUUID } from "crypto";

export interface PlanningRuleInput {
  process_id: string;
  branch_id?: string | null;
  workload_type: string;
  effective_from: string;
  effective_to?: string | null;
  // all other fields are optional — wide table, only relevant columns used
  [key: string]: unknown;
}

const ALLOWED_COLUMNS = new Set([
  "branch_id", "workload_type", "effective_from", "effective_to",
  "aht_seconds", "productivity_per_hour", "shrinkage_pct", "occupancy_target_pct",
  "sla_target_pct", "sla_minutes", "service_level_target_pct", "answer_time_seconds",
  "abandonment_target_pct", "campaign_target_type", "target_attempts", "target_contacts",
  "target_sales", "connect_rate_pct", "contact_rate_pct", "conversion_rate_pct",
  "dialer_mode", "dials_per_agent_hour", "retry_attempts", "chat_concurrency",
  "avg_chat_duration_seconds", "first_response_sla_seconds", "emails_per_agent_hour",
  "email_sla_hours", "backlog_clearance_hours", "cases_per_agent_hour", "tat_hours",
  "quality_recheck_pct", "audit_sample_pct", "audits_per_qa_hour", "is_active", "notes",
  "updated_by",
]);

export const planningRuleService = {

  async list(processId: string, branchId?: string): Promise<RowDataPacket[]> {
    const params: unknown[] = [processId];
    let branchWhere = "";
    if (branchId) { branchWhere = " AND (branch_id = ? OR branch_id IS NULL)"; params.push(branchId); }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT r.*, pm.process_name, pm.workload_type AS process_workload_type
         FROM wfm_process_planning_rule r
         JOIN process_master pm ON pm.id = r.process_id
        WHERE r.process_id = ?${branchWhere} AND r.is_active = 1
        ORDER BY r.workload_type, r.effective_from DESC`,
      params
    );
    return rows;
  },

  async getActive(processId: string, workloadType: string, forDate: string): Promise<RowDataPacket | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM wfm_process_planning_rule
        WHERE process_id = ? AND workload_type = ? AND is_active = 1
          AND effective_from <= ?
          AND (effective_to IS NULL OR effective_to >= ?)
        ORDER BY effective_from DESC LIMIT 1`,
      [processId, workloadType, forDate, forDate]
    );
    return rows[0] ?? null;
  },

  async create(input: PlanningRuleInput, userId: string): Promise<RowDataPacket> {
    const { process_id, workload_type, effective_from } = input;
    if (!process_id || !workload_type || !effective_from) {
      throw new Error("process_id, workload_type and effective_from are required");
    }

    // Deactivate any previous open-ended rule for the same process/type
    await db.execute(
      `UPDATE wfm_process_planning_rule
          SET effective_to = DATE_SUB(?, INTERVAL 1 DAY), updated_by = ?
        WHERE process_id = ? AND workload_type = ? AND effective_to IS NULL AND is_active = 1`,
      [effective_from, userId, process_id, workload_type]
    );

    const id = randomUUID();
    const cols = ["id", "process_id", "workload_type", "effective_from", "created_by"];
    const vals: unknown[] = [id, process_id, workload_type, effective_from, userId];

    for (const [k, v] of Object.entries(input)) {
      if (ALLOWED_COLUMNS.has(k) && v !== undefined) { cols.push(k); vals.push(v); }
    }

    const placeholders = vals.map(() => "?").join(", ");
    await db.execute(
      `INSERT INTO wfm_process_planning_rule (${cols.join(", ")}) VALUES (${placeholders})`,
      vals
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM wfm_process_planning_rule WHERE id = ? LIMIT 1", [id]
    );
    return rows[0];
  },

  async update(id: string, changes: Record<string, unknown>, userId: string): Promise<RowDataPacket> {
    const sets: string[] = ["updated_by = ?"];
    const vals: unknown[] = [userId];

    for (const [k, v] of Object.entries(changes)) {
      if (ALLOWED_COLUMNS.has(k) && v !== undefined) { sets.push(`${k} = ?`); vals.push(v); }
    }
    vals.push(id);

    await db.execute(
      `UPDATE wfm_process_planning_rule SET ${sets.join(", ")} WHERE id = ?`,
      vals
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM wfm_process_planning_rule WHERE id = ? LIMIT 1", [id]
    );
    if (!rows[0]) throw new Error("Planning rule not found");
    return rows[0];
  },

  async deactivate(id: string, userId: string): Promise<void> {
    const [result] = await db.execute<ResultSetHeader>(
      "UPDATE wfm_process_planning_rule SET is_active = 0, updated_by = ? WHERE id = ?",
      [userId, id]
    );
    if (!result.affectedRows) throw new Error("Planning rule not found");
  },
};
