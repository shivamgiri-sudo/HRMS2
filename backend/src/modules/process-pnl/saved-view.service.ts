import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

// Structurally identical to the Executor interfaces used across this session's other
// process-pnl services — same dependency-injection pattern for testability.
interface Executor {
  execute<T extends RowDataPacket[] = RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, unknown]>;
}

/**
 * Branch Budget foundation (PR 9): per-user saved grid-matrix views. No prior "saved view"
 * concept exists anywhere in this app — every operation here is scoped to the requesting user's
 * own user_id, never exposing or accepting another user's saved views.
 */

export interface SavedViewRecord {
  id: string;
  userId: string;
  moduleKey: string;
  viewName: string;
  config: unknown;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

function toRecord(row: RowDataPacket): SavedViewRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    moduleKey: String(row.module_key),
    viewName: String(row.view_name),
    config: typeof row.config_json === "string" ? JSON.parse(row.config_json) : row.config_json,
    isDefault: Number(row.is_default) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function listSavedViews(
  userId: string,
  moduleKey: string,
  executor: Executor = db
): Promise<SavedViewRecord[]> {
  const [rows] = await executor.execute<RowDataPacket[]>(
    `SELECT * FROM finance_saved_view WHERE user_id = ? AND module_key = ? ORDER BY view_name`,
    [userId, moduleKey]
  );
  return rows.map(toRecord);
}

export async function createSavedView(
  userId: string,
  moduleKey: string,
  viewName: string,
  config: unknown,
  executor: Executor = db
): Promise<SavedViewRecord> {
  if (!moduleKey?.trim()) throw new Error("Module key is required");
  if (!viewName?.trim()) throw new Error("View name is required");

  const [existing] = await executor.execute<RowDataPacket[]>(
    `SELECT id FROM finance_saved_view WHERE user_id = ? AND module_key = ? AND view_name = ? LIMIT 1`,
    [userId, moduleKey, viewName.trim()]
  );
  if (existing[0]) {
    throw new Error(`A saved view named "${viewName.trim()}" already exists for this module — choose a different name or delete the existing one first`);
  }

  const id = randomUUID();
  await executor.execute(
    `INSERT INTO finance_saved_view (id, user_id, module_key, view_name, config_json, is_default)
     VALUES (?,?,?,?,?,0)`,
    [id, userId, moduleKey, viewName.trim(), JSON.stringify(config ?? {})]
  );
  const [rows] = await executor.execute<RowDataPacket[]>(`SELECT * FROM finance_saved_view WHERE id = ? LIMIT 1`, [id]);
  return toRecord(rows[0]);
}

export async function deleteSavedView(id: string, userId: string, executor: Executor = db): Promise<void> {
  const [rows] = await executor.execute<RowDataPacket[]>(
    `SELECT id FROM finance_saved_view WHERE id = ? AND user_id = ? LIMIT 1`,
    [id, userId]
  );
  if (!rows[0]) {
    throw new Error("Saved view was not found — it may belong to a different user or may already be deleted");
  }
  await executor.execute(`DELETE FROM finance_saved_view WHERE id = ? AND user_id = ?`, [id, userId]);
}

export const savedViewService = {
  listSavedViews,
  createSavedView,
  deleteSavedView,
};
