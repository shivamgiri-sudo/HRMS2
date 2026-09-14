/**
 * Which candidates a branch head is allowed to see.
 *
 * Two scoping models are live and they disagree:
 *
 *   /api/ats/branch-head-approval/pending  scopes on branch_head_assignments.branch_name
 *     (getPendingApprovals, branch-head-approval.service.ts:69-74)
 *   /api/ats/onboarding/pending-approval   scopes on user_assignment_scope.branch_id
 *     (buildScopeWhereClause, ats.onboarding.routes.ts:192-198)
 *
 * History spans both — a decision made on one screen has to remain visible from
 * the other. Scoping history by only one model would let a branch head approve a
 * candidate and then never find that record again. So the scope is the UNION of
 * both, and the branch predicate matches the same four candidate columns
 * getPendingApprovals matches, for the same reason: applied_for_branch holds
 * sometimes a branch id, sometimes a name, sometimes a code.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getUserRoleKeys, getUserAssignmentScopes } from "../../shared/scopeAccess.js";

/** Roles that see every branch. */
const UNRESTRICTED_ROLES = ["super_admin", "admin", "hr"];

export type BranchHeadScope = {
  unrestricted: boolean;
  /** employees.id for the signed-in user, falling back to the auth user id. */
  employeeId: string;
  /** Branch names from branch_head_assignments. */
  branchNames: string[];
  /** Branch ids from user_assignment_scope. */
  branchIds: string[];
};

/**
 * auth_user.id -> employees.id.
 *
 * Moved here from branch-head-approval.routes.ts:26-32 so there is one copy.
 * It matters more than it looks: ats.onboarding.routes.ts:208 passes the raw
 * auth user id into approveOffer, while branch-head-approval.routes.ts:59
 * resolves it first. getApprovalHistory joins employees on
 * bha.branch_head_id, so an unresolved id shows a blank approver name in
 * history.
 */
export async function resolveEmployeeIdForAuthUser(authUserId: string): Promise<string> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1`,
    [authUserId],
  );
  return rows[0]?.id ? String(rows[0].id) : authUserId;
}

export async function resolveBranchHeadScope(authUserId: string): Promise<BranchHeadScope> {
  const roles = await getUserRoleKeys(authUserId).catch(() => [] as string[]);
  const employeeId = await resolveEmployeeIdForAuthUser(authUserId);

  const [assignments] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT branch_name FROM branch_head_assignments
      WHERE branch_head_id = ? AND is_active = TRUE`,
    [employeeId],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);

  const scopes = await getUserAssignmentScopes(authUserId, ["branch_head"]).catch(() => []);
  const branchNames = assignments.map((r) => String(r.branch_name)).filter(Boolean);
  const branchIds = scopes.map((s) => String(s.branch_id ?? "")).filter(Boolean);

  // Grant unrestricted access only when the user has an admin/hr role AND has
  // no branch_head scope entries. A user who is both `hr` and `branch_head`
  // (e.g. a branch head who was also given HR access) should be scoped to their
  // branches, not shown all decisions in the system — which caused 30+ second
  // DB hangs via the COUNT query in listBranchHeadDecisions.
  if (branchNames.length === 0 && branchIds.length === 0
      && roles.some((r) => UNRESTRICTED_ROLES.includes(r))) {
    return { unrestricted: true, employeeId, branchNames: [], branchIds: [] };
  }

  return { unrestricted: false, employeeId, branchNames, branchIds };
}

/**
 * SQL fragment restricting candidates to a branch head's branches.
 *
 * `aliases.candidate` is the ats_candidate alias, `aliases.branch` an optional
 * branch_master alias already LEFT JOINed by the caller.
 *
 * With no branches assigned this returns `1 = 0` — the caller must render that
 * as "no branches assigned to you" rather than an ordinary empty list, or a
 * misconfigured branch head sees a blank screen with no explanation.
 */
export function buildCandidateBranchPredicate(
  scope: BranchHeadScope,
  aliases: { candidate: string; branch?: string },
): { sql: string; params: unknown[] } {
  if (scope.unrestricted) return { sql: "1 = 1", params: [] };

  const c = aliases.candidate;
  const b = aliases.branch;
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (scope.branchNames.length > 0) {
    const ph = scope.branchNames.map(() => "?").join(",");
    // The same four columns getPendingApprovals matches (service.ts:119-124).
    clauses.push(`${c}.applied_for_branch IN (${ph})`);
    params.push(...scope.branchNames);
    clauses.push(`${c}.branch_display_name IN (${ph})`);
    params.push(...scope.branchNames);
    if (b) {
      clauses.push(`${b}.branch_name IN (${ph})`);
      params.push(...scope.branchNames);
      clauses.push(`${b}.branch_code IN (${ph})`);
      params.push(...scope.branchNames);
    }
  }

  if (scope.branchIds.length > 0) {
    const ph = scope.branchIds.map(() => "?").join(",");
    clauses.push(`${c}.applied_for_branch IN (${ph})`);
    params.push(...scope.branchIds);
    if (b) {
      clauses.push(`${b}.id IN (${ph})`);
      params.push(...scope.branchIds);
    }
  }

  if (clauses.length === 0) return { sql: "1 = 0", params: [] };
  return { sql: `(${clauses.join(" OR ")})`, params };
}

/**
 * Throw 403 unless this user may see this candidate.
 *
 * /history/:candidateId has been live, role-guarded and completely unscoped —
 * any admin, manager or branch head could read any candidate's approval trail.
 * It was never called by the UI, so the gap never surfaced.
 */
export async function assertBranchHeadCanSeeCandidate(
  authUserId: string,
  candidateId: string,
): Promise<void> {
  const scope = await resolveBranchHeadScope(authUserId);
  if (scope.unrestricted) return;

  const pred = buildCandidateBranchPredicate(scope, { candidate: "c", branch: "bm" });
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM ats_candidate c
       LEFT JOIN branch_master bm
         ON bm.id = c.applied_for_branch
         OR bm.branch_name = c.applied_for_branch
         OR bm.branch_code = c.applied_for_branch
      WHERE c.id = ? AND ${pred.sql}
      LIMIT 1`,
    [candidateId, ...pred.params],
  );

  if (rows.length === 0) {
    throw Object.assign(
      new Error("This candidate is not in a branch assigned to you."),
      { statusCode: 403, code: "CANDIDATE_OUT_OF_SCOPE" },
    );
  }
}
