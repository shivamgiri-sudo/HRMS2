import { db } from "../../db/mysql.js";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";

export interface SpocConfig {
  id: number;
  branch_id: string;
  primary_spoc_user_id: string;
  backup_spoc_user_id: string | null;
  effective_from: string;
  effective_to: string | null;
  is_active: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/**
 * Returns the active SPOC config for a branch on a given date.
 * Returns null when no config is found (final approval should be blocked).
 */
export async function getActiveSPOCForBranch(
  branchId: string,
  onDate: string, // YYYY-MM-DD
): Promise<{ primaryId: string; backupId: string | null } | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT primary_spoc_user_id, backup_spoc_user_id
       FROM branch_wfm_spoc_config
      WHERE branch_id = ?
        AND is_active = 1
        AND effective_from <= ?
        AND (effective_to IS NULL OR effective_to >= ?)
      ORDER BY effective_from DESC
      LIMIT 1`,
    [branchId, onDate, onDate],
  );
  if (!rows.length) return null;
  const row = rows[0] as any;
  return {
    primaryId: row.primary_spoc_user_id as string,
    backupId: row.backup_spoc_user_id ?? null,
  };
}

/**
 * Returns true if userId is the primary or backup SPOC for branchId on onDate.
 */
export async function isSPOCForBranch(
  userId: string,
  branchId: string,
  onDate: string,
): Promise<boolean> {
  const spoc = await getActiveSPOCForBranch(branchId, onDate);
  if (!spoc) return false;
  return userId === spoc.primaryId || (spoc.backupId !== null && userId === spoc.backupId);
}

export async function listSPOCConfigs(branchId?: string): Promise<SpocConfig[]> {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (branchId) { conds.push("c.branch_id = ?"); params.push(branchId); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.*,
            b.branch_name,
            CONCAT(ep.first_name,' ',COALESCE(ep.last_name,'')) AS primary_spoc_name,
            CONCAT(eb.first_name,' ',COALESCE(eb.last_name,'')) AS backup_spoc_name
       FROM branch_wfm_spoc_config c
       JOIN branch_master b ON b.id = c.branch_id
       JOIN employees ep ON ep.id = c.primary_spoc_user_id
       LEFT JOIN employees eb ON eb.id = c.backup_spoc_user_id
       ${where}
       ORDER BY c.branch_id, c.effective_from DESC`,
    params,
  );
  return rows as SpocConfig[];
}

export async function createSPOCConfig(
  data: {
    branch_id: string;
    primary_spoc_user_id: string;
    backup_spoc_user_id?: string | null;
    effective_from: string;
    effective_to?: string | null;
  },
  createdBy: string,
): Promise<number> {
  const [result] = await db.execute<ResultSetHeader>(
    `INSERT INTO branch_wfm_spoc_config
       (branch_id, primary_spoc_user_id, backup_spoc_user_id, effective_from, effective_to, is_active, created_by)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
    [
      data.branch_id,
      data.primary_spoc_user_id,
      data.backup_spoc_user_id ?? null,
      data.effective_from,
      data.effective_to ?? null,
      createdBy,
    ],
  );
  return result.insertId;
}

export async function updateSPOCConfig(
  id: number,
  data: Partial<{
    primary_spoc_user_id: string;
    backup_spoc_user_id: string | null;
    effective_from: string;
    effective_to: string | null;
    is_active: number;
  }>,
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (data.primary_spoc_user_id !== undefined) { sets.push("primary_spoc_user_id = ?"); params.push(data.primary_spoc_user_id); }
  if ("backup_spoc_user_id" in data) { sets.push("backup_spoc_user_id = ?"); params.push(data.backup_spoc_user_id ?? null); }
  if (data.effective_from) { sets.push("effective_from = ?"); params.push(data.effective_from); }
  if ("effective_to" in data) { sets.push("effective_to = ?"); params.push(data.effective_to ?? null); }
  if (data.is_active !== undefined) { sets.push("is_active = ?"); params.push(data.is_active); }
  if (!sets.length) return;
  params.push(id);
  await db.execute(`UPDATE branch_wfm_spoc_config SET ${sets.join(", ")} WHERE id = ?`, params);
}
