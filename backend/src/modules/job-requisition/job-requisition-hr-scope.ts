/**
 * Branch scope for the HR team on requisition expiry decisions and their alerts.
 *
 * An HR user sees, decides and is notified about requisitions of their OWN branch only. Head-office HR
 * (hr_head, ho_hr), admin, super_admin, ceo and anyone with an "all" assignment scope stay org-wide.
 * A branch-level HR user is tied to a branch by an assignment scope row or, failing that, by the branch
 * on their own employee record. An HR user with neither sees nothing rather than everything.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getUserRoleKeys } from "../../shared/scopeAccess.js";

/** HR roles that work across every branch. */
export const ORG_WIDE_HR_ROLES = ["hr_head", "ho_hr"] as const;
/** Non-HR roles that are org-wide by definition. */
const ORG_WIDE_ROLES = ["super_admin", "admin", "ceo"] as const;

export interface HrBranchScope {
  orgWide: boolean;
  branchIds: string[];
  branchNames: string[];
}

export const ORG_WIDE: HrBranchScope = {
  orgWide: true,
  branchIds: [],
  branchNames: [],
};

/** Pure: is this set of role keys org-wide for requisition decisions? */
export function isOrgWideRoleSet(roleKeys: string[]): boolean {
  return roleKeys.some(
    (r) =>
      (ORG_WIDE_ROLES as readonly string[]).includes(r) ||
      (ORG_WIDE_HR_ROLES as readonly string[]).includes(r),
  );
}

/**
 * SQL condition restricting job_requisition rows to a branch scope. Matches on branch_id and also on the
 * branch name, because some requisitions carry only the name.
 */
export function requisitionBranchCondition(
  scope: HrBranchScope,
  alias = "jr",
): { sql: string; params: string[] } {
  if (scope.orgWide) return { sql: "1=1", params: [] };
  const parts: string[] = [];
  const params: string[] = [];
  if (scope.branchIds.length > 0) {
    parts.push(
      `${alias}.branch_id IN (${scope.branchIds.map(() => "?").join(",")})`,
    );
    params.push(...scope.branchIds);
  }
  if (scope.branchNames.length > 0) {
    parts.push(
      `${alias}.branch_name IN (${scope.branchNames.map(() => "?").join(",")})`,
    );
    params.push(...scope.branchNames);
  }
  return parts.length > 0
    ? { sql: `(${parts.join(" OR ")})`, params }
    : { sql: "1=0", params: [] };
}

/** True when a requisition (by branch id and/or name) falls inside the scope. Pure. */
export function branchInScope(
  scope: HrBranchScope,
  branchId: string | null,
  branchName: string | null,
): boolean {
  if (scope.orgWide) return true;
  if (branchId && scope.branchIds.includes(branchId)) return true;
  return Boolean(branchName && scope.branchNames.includes(branchName));
}

/** The caller's branch scope: org-wide for head office / admin, otherwise their assigned or home branch(es). */
export async function resolveHrBranchScope(
  userId: string,
): Promise<HrBranchScope> {
  const roleKeys = await getUserRoleKeys(userId);
  if (isOrgWideRoleSet(roleKeys)) return ORG_WIDE;

  const [scopeRows] = await db.execute<RowDataPacket[]>(
    `SELECT scope_type, branch_id FROM user_assignment_scope WHERE user_id = ? AND active_status = 1`,
    [userId],
  );
  if (scopeRows.some((r) => r.scope_type === "all")) return ORG_WIDE;

  const branchIds = new Set<string>();
  for (const row of scopeRows) {
    if (
      (row.scope_type === "branch" || row.scope_type === "branch_process") &&
      row.branch_id
    )
      branchIds.add(String(row.branch_id));
  }
  const [homeRows] = await db.execute<RowDataPacket[]>(
    `SELECT branch_id FROM employees WHERE user_id = ? AND active_status = 1 AND branch_id IS NOT NULL`,
    [userId],
  );
  for (const row of homeRows) branchIds.add(String(row.branch_id));
  if (branchIds.size === 0)
    return { orgWide: false, branchIds: [], branchNames: [] };

  const ids = [...branchIds];
  const [branchRows] = await db.execute<RowDataPacket[]>(
    `SELECT branch_name, branch_code FROM branch_master WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
  const names = new Set<string>();
  for (const row of branchRows) {
    if (row.branch_name) names.add(String(row.branch_name));
    if (row.branch_code) names.add(String(row.branch_code));
  }
  return { orgWide: false, branchIds: ids, branchNames: [...names] };
}
