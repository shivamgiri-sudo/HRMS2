import type { RowDataPacket } from "mysql2";
import type { Response, NextFunction } from "express";
import { db } from "../db/mysql.js";
import type { AuthenticatedRequest } from "../middleware/authMiddleware.js";

/**
 * Resolve user_id → MySQL employee record.
 * Returns employee if active OR inactive with valid grace period.
 * Returns null if no employee mapped to this user or grace period expired.
 */
export async function getEmployeeForUser(userId: string): Promise<{ id: string; employee_code: string } | null> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.id, e.employee_code
         FROM employees e
        WHERE e.user_id = ?
          AND (e.active_status = 1 OR (e.active_status = 0 AND e.access_end_date >= CURDATE()))
        ORDER BY
          EXISTS (
            SELECT 1
              FROM employee_salary_assignment esa
             WHERE esa.employee_id = e.id AND esa.active_status = 1
          ) DESC,
          CASE WHEN e.employee_code LIKE 'ADMIN%' THEN 1 ELSE 0 END,
          e.updated_at DESC
        LIMIT 1`,
      [userId]
    );
    return (rows as RowDataPacket[])[0] as { id: string; employee_code: string } ?? null;
  } catch {
    // Fallback for when migration 215 (access_end_date column) hasn't run yet
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.id, e.employee_code
         FROM employees e
        WHERE e.user_id = ? AND e.active_status = 1
        ORDER BY
          EXISTS (
            SELECT 1
              FROM employee_salary_assignment esa
             WHERE esa.employee_id = e.id AND esa.active_status = 1
          ) DESC,
          CASE WHEN e.employee_code LIKE 'ADMIN%' THEN 1 ELSE 0 END,
          e.updated_at DESC
        LIMIT 1`,
      [userId]
    );
    return (rows as RowDataPacket[])[0] as { id: string; employee_code: string } ?? null;
  }
}

/**
 * Check if user holds any of the given roles in MySQL user_roles.
 */
export async function hasRole(userId: string, ...roles: string[]): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1",
    [userId]
  );
  const userRoles = (rows as { role_key: string }[]).map((r) => r.role_key);
  if (userRoles.includes("super_admin")) return true;
  return roles.some((r) => userRoles.includes(r));
}

/**
 * MySQL-authoritative scope check for process-owned workflows.
 *
 * `user_assignment_scope` is the source of truth for scoped roles such as
 * manager, assistant_manager and tl. A query/body process_id is never treated
 * as access permission without this check.
 *
 * Supported access entries:
 * - scope_type = 'all': role may access all processes.
 * - scope_type = 'process' or 'team': process_id must match; an optional
 *   branch restriction must also match when present on the scope record.
 * - scope_type = 'branch': caller must be operating inside that branch.
 */
export async function hasProcessScope(
  userId: string,
  processId: string,
  branchId: string | null | undefined,
  ...roles: string[]
): Promise<boolean> {
  if (!processId || roles.length === 0) return false;

  const placeholders = roles.map(() => "?").join(", ");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id
       FROM user_assignment_scope
      WHERE user_id = ?
        AND role_key IN (${placeholders})
        AND active_status = 1
        AND (
          scope_type = 'all'
          OR (
            scope_type IN ('process', 'team')
            AND process_id = ?
            AND (branch_id IS NULL OR branch_id = ?)
          )
          OR (
            scope_type = 'branch'
            AND branch_id IS NOT NULL
            AND branch_id = ?
          )
        )
      LIMIT 1`,
    [userId, ...roles, processId, branchId ?? null, branchId ?? null]
  );

  return rows.length > 0;
}

/**
 * Middleware: allow admin/hr to proceed for any employee.
 * Allow employee self-service only when :employeeId matches their own mapped employee record.
 * 403 otherwise.
 */
export function selfOrAdminHr(employeeIdParam = "id") {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.authUser!.id;
      const targetEmployeeId = req.params[employeeIdParam];

      if (await hasRole(userId, "admin", "hr")) return next();

      const emp = await getEmployeeForUser(userId);
      if (emp && emp.id === targetEmployeeId) return next();

      return res.status(403).json({ success: false, message: "Forbidden" });
    } catch (err) {
      return next(err);
    }
  };
}
