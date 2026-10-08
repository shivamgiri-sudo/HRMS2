import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { buildEmployeeScopeCondition, resolveUserBusinessScope } from "../../shared/enterpriseScope.js";
import { ORG_WIDE_EXEMPT_ROLES } from "../../shared/scopeAccess.js";

/**
 * Branch scoping helpers for tables keyed by branch_id (owner ruling 2026-10-01): hr, payroll_hr,
 * branch_head, managers and every other non-exempt role see / change only their own branch (their own
 * employee record's branch plus explicit branch / branch_process assignments). Org-wide roles
 * (super_admin, admin, ceo, coo, cfo, payroll_head, finance_head, accounts_head, finance) are unaffected.
 * Anything unresolvable FAILS CLOSED (no branch => `1=0`). A branch id that arrives from the browser
 * is not scope - it can only narrow what these helpers already allow.
 */
export type CallerBranchScope = { userId: string; orgWide: boolean; branchIds: string[]; employeeId: string | null };
export type SqlScope = { sql: string; params: unknown[] };

export async function resolveCallerBranchScope(user: { id: string }): Promise<CallerBranchScope> {
  const scope = await resolveUserBusinessScope(user);
  const orgWide = scope.roles.some((r) => (ORG_WIDE_EXEMPT_ROLES as readonly string[]).includes(r));
  const ids = new Set<string>();
  if (scope.branchId) ids.add(scope.branchId);
  for (const a of scope.assignments) {
    if ((a.scopeType === "branch" || a.scopeType === "branch_process") && a.branchId) ids.add(a.branchId);
  }
  return { userId: user.id, orgWide, branchIds: [...ids], employeeId: scope.employeeId };
}

export function branchPredicate(scope: CallerBranchScope, col: string): SqlScope {
  if (scope.orgWide) return { sql: "1=1", params: [] };
  if (!scope.branchIds.length) return { sql: "1=0", params: [] };
  return { sql: `${col} IN (${scope.branchIds.map(() => "?").join(",")})`, params: [...scope.branchIds] };
}

export function branchAllowed(scope: CallerBranchScope, branchId: string | null | undefined): boolean {
  if (scope.orgWide) return true;
  return Boolean(branchId && scope.branchIds.includes(String(branchId)));
}

/** Employee-row scope (self + assignments, hr limited to own branch) over an employees alias. */
export async function employeeRowScope(user: { id: string }, a = "e"): Promise<SqlScope> {
  return buildEmployeeScopeCondition(await resolveUserBusinessScope(user), {
    employeeId: `${a}.id`, branchId: `${a}.branch_id`, processId: `${a}.process_id`, lobId: `${a}.lob_id`,
    departmentId: `${a}.department_id`, managerEmployeeId: `${a}.reporting_manager_id`,
  });
}

/** The branch an employee belongs to (null when unknown). */
export async function employeeBranchId(employeeId: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>("SELECT branch_id FROM employees WHERE id = ? LIMIT 1", [employeeId]);
  const b = (rows as RowDataPacket[])[0]?.branch_id;
  return b ? String(b) : null;
}
