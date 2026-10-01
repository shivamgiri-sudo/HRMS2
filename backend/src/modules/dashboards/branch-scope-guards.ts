import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  buildEmployeeScopeCondition,
  canViewEmployee,
  resolveUserBusinessScope,
  type EnterpriseUser,
} from "../../shared/enterpriseScope.js";

/**
 * Owner ruling 2026-10-01: every non-org-wide role is limited to its own branch / assigned scope.
 * A role gate says who may open a page; these helpers say whose records they may see. Shared by the
 * per-employee endpoints of the dashboard-family modules (skill-roadmap, kpi, lms, goals, ...).
 */

export const OUTSIDE_SCOPE_MESSAGE = "Forbidden: this employee is outside your branch / assigned scope";

/**
 * By-id guard: org-wide roles, self, anyone inside the caller's branch / assignments (canViewEmployee)
 * and - because a reporting line is stricter than a branch - the employee's direct reporting manager.
 * Fails closed when the employee does not exist.
 */
export async function canAccessEmployeeRecord(user: EnterpriseUser, employeeId: string): Promise<boolean> {
  const id = String(employeeId ?? "").trim();
  if (!id) return false;
  if (await canViewEmployee(user, id)) return true;
  const scope = await resolveUserBusinessScope(user);
  if (!scope.employeeId) return false;
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT 1 AS ok FROM employees WHERE id = ? AND reporting_manager_id = ? LIMIT 1",
    [id, scope.employeeId],
  );
  return (rows as RowDataPacket[]).length > 0;
}

/**
 * List guard: returns `null` for org-wide callers (leave the SQL untouched) or a predicate
 * (`sql` is already parenthesised) to AND onto the query. `employeeAlias` is the alias of the
 * `employees` table in the caller's query.
 */
export async function employeeListScope(
  user: EnterpriseUser,
  employeeAlias = "e",
): Promise<{ sql: string; params: unknown[] } | null> {
  const scope = await resolveUserBusinessScope(user);
  const cond = buildEmployeeScopeCondition(scope, {
    employeeId: `${employeeAlias}.id`,
    branchId: `${employeeAlias}.branch_id`,
    processId: `${employeeAlias}.process_id`,
  });
  if (cond.sql === "1=1") return null;
  let sql = cond.sql;
  const params = [...cond.params];
  if (scope.employeeId) {
    sql = `${sql} OR ${employeeAlias}.reporting_manager_id = ?`;
    params.push(scope.employeeId);
  }
  return { sql: `(${sql})`, params };
}

/**
 * Same as employeeListScope but for tables that only carry an employee id column (no join to
 * `employees`): returns `<column> IN (SELECT e.id FROM employees e WHERE <scope>)`, or null for
 * org-wide callers.
 */
export async function employeeIdInScope(
  user: EnterpriseUser,
  column: string,
): Promise<{ sql: string; params: unknown[] } | null> {
  const pred = await employeeListScope(user, "e");
  if (!pred) return null;
  return { sql: `${column} IN (SELECT e.id FROM employees e WHERE ${pred.sql})`, params: pred.params };
}

/**
 * Express middleware factory: stores the caller's employee-scope predicate (alias `alias`; null for org-wide roles)
 * on `req.employeeScope` for handlers that build their own SQL. Fails closed (403) without an authenticated user.
 */
export function attachEmployeeScope(alias = "e") {
  return async (req: any, res: any, next: (err?: unknown) => void) => {
    try {
      if (!req.authUser?.id) return res.status(403).json({ success: false, message: "Forbidden: no resolvable scope" });
      req.employeeScope = await employeeListScope(req.authUser, alias);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
