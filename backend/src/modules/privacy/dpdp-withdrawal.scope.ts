import type { RequestHandler } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { hasRole } from "../../shared/accessGuard.js";
import {
  buildEmployeeScopeCondition,
  canViewEmployee,
  resolveUserBusinessScope,
} from "../../shared/enterpriseScope.js";

/**
 * Branch scoping for the DPDP withdrawal admin queue (owner ruling 2026-10-01).
 * dpo (which also passes admin / super_admin via accessGuard's admin-superset rule) stays org-wide.
 * hr / compliance are limited to requests raised by employees inside their own branch / assignments.
 * A client ?branch_id= can only narrow this, never widen it.
 */
export type RequesterScope = { sql: string; params: unknown[] };

/** Returns null for org-wide callers, otherwise a SQL predicate over dcw.requester_id. */
export async function buildRequesterScope(user: { id: string }): Promise<RequesterScope | null> {
  if (await hasRole(user.id, "dpo")) return null;
  const cond = buildEmployeeScopeCondition(await resolveUserBusinessScope(user), {
    employeeId: "e.id", branchId: "e.branch_id", processId: "e.process_id", lobId: "e.lob_id",
    departmentId: "e.department_id", managerEmployeeId: "e.reporting_manager_id",
  });
  if (cond.sql === "1=1") return null;
  return {
    sql: `dcw.requester_id IN (SELECT e.user_id FROM employees e WHERE e.user_id IS NOT NULL AND (${cond.sql}))`,
    params: cond.params,
  };
}

/** Guard for every /dpdp-withdrawal/:id/* route: a non-org-wide caller may only touch in-scope requests (or their own). */
export const withdrawalScopeGuard: RequestHandler = async (req: any, res, next) => {
  try {
    const user = req.authUser;
    if (!user?.id) return next();
    if (await hasRole(user.id, "dpo")) return next();
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT requester_id FROM dpdp_consent_withdrawal WHERE id = ? LIMIT 1",
      [req.params.id]
    );
    const requesterId = (rows as RowDataPacket[])[0]?.requester_id;
    if (!requesterId) return next(); // unknown id: handler returns its own 404
    if (String(requesterId) === String(user.id)) return next();
    const [emp] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM employees WHERE user_id = ? ORDER BY active_status DESC LIMIT 1",
      [requesterId]
    );
    const employeeId = (emp as RowDataPacket[])[0]?.id;
    if (employeeId && (await canViewEmployee(user, String(employeeId)))) return next();
    return res.status(403).json({ success: false, message: "Forbidden: this request is outside your branch / assigned scope" });
  } catch (err) {
    return next(err);
  }
};
