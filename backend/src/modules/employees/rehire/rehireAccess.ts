import type { RowDataPacket } from "mysql2";
import type { SqlExecutor } from "./rehireFacts.js";

/**
 * A reporting manager may raise or look up a rejoin only for someone who reported to them.
 * `employees.reporting_manager_id` points at the manager's employees.id; the caller is a users.id,
 * so the join goes through employees.user_id.
 */
export async function isFormerReport(db: SqlExecutor, employeeId: string, userId: string): Promise<boolean> {
  const [rows] = await db.execute<(RowDataPacket & { is_manager: number })[]>(
    `SELECT COUNT(*) AS is_manager FROM employees e
       JOIN employees m ON m.id = e.reporting_manager_id
      WHERE e.id = ? AND m.user_id = ?`,
    [employeeId, userId],
  );
  return Number(rows[0]?.is_manager) > 0;
}
