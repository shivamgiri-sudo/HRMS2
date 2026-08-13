import type { RowDataPacket } from "mysql2";
import type { Response, NextFunction } from "express";
import { db } from "../db/mysql.js";
import type { AuthenticatedRequest } from "../middleware/authMiddleware.js";
import { memoizeForRequest } from "./requestContext.js";

/**
 * Resolve user_id → MySQL employee record.
 * Returns employee if active OR inactive with valid grace period.
 * Returns null if no employee mapped to this user or grace period expired.
 */
export async function getEmployeeForUser(userId: string): Promise<{ id: string; employee_code: string } | null> {
  // Memoised per request — several routes resolve the caller's employee record
  // more than once while serving a single call.
  return memoizeForRequest(`emp:${userId}`, () => resolveEmployeeForUser(userId));
}

async function resolveEmployeeForUser(userId: string): Promise<{ id: string; employee_code: string } | null> {
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
 * Check whether the user holds any requested role. Role assignments may come
 * from user_roles or from an active scoped assignment; both are authoritative
 * MySQL access records and must be evaluated together.
 */
export async function hasRole(userId: string, ...roles: string[]): Promise<boolean> {
  const normalizedRequested = new Set(roles.map((role) => String(role).trim().toLowerCase()));
  if (normalizedRequested.size === 0) return false;

  // Memoise the ROLE SET, not the boolean answer: a single request asks about
  // different role combinations, and they can all be served from one query.
  const userRoles = await memoizeForRequest(`roles:${userId}`, () => fetchUserRoles(userId));

  if (userRoles.includes("super_admin") || userRoles.includes("admin")) return true;
  return userRoles.some((role) => normalizedRequested.has(role));
}

/**
 * Demo-bypass-aware wrapper around hasRole.
 *
 * Same root cause as resolveDashboardScopeForRequest in shared/dashboardScope.ts, in a second
 * shape: hasRole answers purely from MySQL (fetchUserRoles below), and a demo-bypass identity
 * has no row in user_roles or user_assignment_scope. So every hasRole() question about a demo
 * session answers false, no matter which demo role signed in, and routes that branch on
 * "is this caller an admin?" send an admin down the ordinary-employee path. On
 * GET /api/helpdesk/tickets that produced a visible 403 "No employee record" for the demo
 * super_admin — the admin branch was skipped, then the employee branch found no employees row.
 *
 * The demo short-circuit is gated exactly as requireRole gates its own (isDemo AND
 * INTERNAL_DEMO_BYPASS === "true" AND NODE_ENV !== "production"), so it cannot widen access in
 * production even if a token ever carried isDemo. Within that gate it mirrors hasRole's own
 * rule on line 71 — super_admin and admin are true for any requested role — and otherwise
 * matches the session's single demo role against what was asked for.
 *
 * Purely additive: hasRole itself is untouched, so every existing caller and test is unaffected
 * unless it explicitly switches to this wrapper.
 */
export async function hasRoleForRequest(
  user: { id: string; role?: string; isDemo?: boolean } | undefined,
  ...roles: string[]
): Promise<boolean> {
  if (!user?.id) return false;

  if (user.isDemo === true && process.env.INTERNAL_DEMO_BYPASS === "true" && process.env.NODE_ENV !== "production") {
    const demoRole = String(user.role ?? "employee").trim().toLowerCase();
    if (demoRole === "super_admin" || demoRole === "admin") return true;
    return roles.map((role) => String(role).trim().toLowerCase()).includes(demoRole);
  }

  return hasRole(user.id, ...roles);
}

/**
 * All active role keys for a user, from user_roles plus scoped assignments.
 *
 * AUDIT NOTE (2026-08-13): this duplicates the first two sources
 * shared/roleResolver.ts's getUserRoleKeys() also reads, but not its later
 * fallbacks — notably the "employee" default it returns for an active,
 * mapped employee with no row in either table. So hasRole(userId, "employee")
 * here can answer false for a caller requireAuth (which uses roleResolver)
 * already treats as an employee. Confirmed fail-closed (false-deny), not a
 * privilege-escalation risk, so left as a documented follow-up rather than
 * merged into roleResolver.ts in this pass — see the note there for the full
 * list of independently-maintained role-resolution paths.
 */
async function fetchUserRoles(userId: string): Promise<string[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1
     UNION
     SELECT role_key FROM user_assignment_scope WHERE user_id = ? AND active_status = 1`,
    [userId, userId],
  ).catch(async () => db.execute<RowDataPacket[]>(
    "SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1",
    [userId],
  ));
  return (rows as { role_key: string }[])
    .map((row) => String(row.role_key ?? "").trim().toLowerCase())
    .filter(Boolean);
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
