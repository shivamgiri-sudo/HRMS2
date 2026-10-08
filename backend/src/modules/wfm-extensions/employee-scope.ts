import { buildScopeWhereClause, ORG_WIDE_EXEMPT_ROLES, hasAnyRole } from "../../shared/scopeAccess.js";
import { resolveUserBusinessScope } from "../../shared/enterpriseScope.js";
import { scopePredicate } from "../wfm/branch-scope.js";

/**
 * Row scope for WFM-extension records keyed by employee (swaps, conflicts, coverage). Moved out of
 * wfm-ext.routes.ts unchanged so the roster-requests decide path resolves conflicts under the
 * same scope as POST /roster/conflicts/:id/resolve.
 */
export const WFM_SCOPE_ROLES = ["wfm", "process_manager", "branch_head", "manager", "assistant_manager", "tl", "hr", "operations_manager"];

export async function employeeScope(userId: string, aliases: { employee?: string } = {}) {
  const e = aliases.employee ?? "e";
  // Org-wide roles only (owner ruling 2026-10-01): hr / wfm are limited to their own branch / scope.
  if (await hasAnyRole(userId, ...ORG_WIDE_EXEMPT_ROLES)) return { sql: "1=1", params: [] as unknown[] };
  const own = scopePredicate(await resolveUserBusinessScope(userId), {
    branchId: `${e}.branch_id`, processId: `${e}.process_id`, employeeId: `${e}.id`, managerEmployeeId: `${e}.reporting_manager_id`,
  });
  const assigned = await buildScopeWhereClause(
    userId,
    WFM_SCOPE_ROLES,
    {
      branchId: `${e}.branch_id`,
      processId: `${e}.process_id`,
      departmentId: `${e}.department_id`,
      managerEmployeeId: `${e}.reporting_manager_id`,
      employeeId: `${e}.id`,
    },
    { allowAdminBypass: true, allowCeoAllRead: true },
  );
  if (assigned.sql === "1=0") return own;
  if (own.sql === "1=0") return assigned;
  return { sql: `(${own.sql}) OR (${assigned.sql})`, params: [...own.params, ...assigned.params] };
}
