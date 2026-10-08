import type { NextFunction, Request, Response } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { buildEmployeeScopeCondition, canViewEmployee, resolveUserBusinessScope } from "../../shared/enterpriseScope.js";
import { resolveDashboardScope } from "../../shared/dashboardScope.js";
import { getUserRoleContext } from "../../shared/roleResolver.js";
import { isInReportingSpan } from "../../shared/reportingSpan.js";

/**
 * Branch scoping for the exit module (owner ruling 2026-10-01): hr, payroll_hr, branch roles and
 * reporting managers see / change only their own branch or assigned scope. Org-wide roles
 * (super_admin, admin, ceo, coo, cfo, payroll_head, finance_head, accounts_head, finance) are
 * unaffected - buildEmployeeScopeCondition / canViewEmployee return "everything" for them.
 */
export const EXIT_OUT_OF_SCOPE = "This exit request is outside your branch / assigned scope";

export type SqlScope = { sql: string; params: unknown[] };

/** `<alias>.id`-style predicate over an employees alias (default "e"). Fails closed (1=0) with no scope. */
export async function employeeScopeSql(user: { id: string }, a = "e"): Promise<SqlScope> {
  return buildEmployeeScopeCondition(await resolveUserBusinessScope(user), {
    employeeId: `${a}.id`, branchId: `${a}.branch_id`, processId: `${a}.process_id`, lobId: `${a}.lob_id`,
    departmentId: `${a}.department_id`, managerEmployeeId: `${a}.reporting_manager_id`,
  });
}

/** Same scope as a sub-select on an exit_request alias, for queries that do not join employees. */
export async function exitRequestScopeSql(user: { id: string }, er = "er"): Promise<SqlScope> {
  const s = await employeeScopeSql(user, "se");
  if (s.sql === "1=1") return s;
  return { sql: `${er}.employee_id IN (SELECT se.id FROM employees se WHERE ${s.sql})`, params: s.params };
}

/**
 * Row scope for non-HR roles (manager / it / wfm ...): the dashboard scope resolver. Unlike the old
 * `if (scoped.branchIds.length)` check this FAILS CLOSED - a team scope (employee ids only) or an
 * unresolvable scope used to leave the query unfiltered.
 */
export async function dashboardRowScopeSql(userId: string, a = "e"): Promise<SqlScope> {
  try {
    const roleContext = await getUserRoleContext(userId);
    const scoped = await resolveDashboardScope(userId, roleContext.primaryRole);
    if (scoped.level === "ORG_ALL") return { sql: "1=1", params: [] };
    const ors: string[] = [];
    const params: unknown[] = [];
    if (scoped.processIds.length && scoped.level === "PROCESS_ALL") {
      ors.push(`${a}.process_id IN (${scoped.processIds.map(() => "?").join(",")})`);
      params.push(...scoped.processIds);
    } else if (scoped.branchIds.length && (scoped.level === "BRANCH_ALL" || scoped.level === "CUSTOM_SCOPE")) {
      ors.push(`${a}.branch_id IN (${scoped.branchIds.map(() => "?").join(",")})`);
      params.push(...scoped.branchIds);
    }
    if (scoped.employeeIds.length) {
      ors.push(`${a}.id IN (${scoped.employeeIds.map(() => "?").join(",")})`);
      params.push(...scoped.employeeIds);
    }
    return ors.length ? { sql: `(${ors.join(" OR ")})`, params } : { sql: "1=0", params: [] };
  } catch {
    return { sql: "1=0", params: [] };
  }
}

/** canViewEmployee, plus the reporting span (a TL / AM may act on their team's exit). */
export async function canTouchExitEmployee(userId: string, employeeId: string): Promise<boolean> {
  if (await canViewEmployee({ id: userId }, employeeId)) return true;
  return isInReportingSpan(userId, employeeId);
}

/**
 * Route guard: `kind` says what the :param holds - an exit_request id or a full_final_calculation id.
 * Unknown ids fall through so the handler still returns its own 404.
 */
export function guardExitEmployee(param: string, kind: "exit" | "ff" = "exit") {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = (req as any).authUser?.id as string | undefined;
      if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
      const id = String(req.params[param] ?? "");
      if (!id || id === "my" || id === "me") return next();
      const sql = kind === "ff"
        ? "SELECT er.employee_id FROM full_final_calculation f JOIN exit_request er ON er.id = f.exit_request_id WHERE f.id = ? LIMIT 1"
        : "SELECT employee_id FROM exit_request WHERE id = ? LIMIT 1";
      const [rows] = await db.execute<RowDataPacket[]>(sql, [id]);
      const employeeId = (rows as RowDataPacket[])[0]?.employee_id;
      if (!employeeId) return next();
      if (await canTouchExitEmployee(userId, String(employeeId))) return next();
      return res.status(403).json({ success: false, message: `Forbidden: ${EXIT_OUT_OF_SCOPE}` });
    } catch (err) {
      return next(err);
    }
  };
}
