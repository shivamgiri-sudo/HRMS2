import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getUserAssignmentScopes } from "../../shared/scopeAccess.js";

const GLOBAL_FINANCE_ROLES = new Set([
  "super_admin",
  "admin",
  "finance",
  "finance_head",
  "accounts_head",
  "payroll_head",
  "hr_admin",
  "ceo",
  "coo",
]);

function normalizedRoles(primaryRole?: string, userRoles?: string[]) {
  return new Set(
    [primaryRole, ...(userRoles ?? [])]
      .filter((role): role is string => Boolean(role))
      .map((role) => role.toLowerCase())
  );
}

/**
 * Roles bound to exactly one branch.
 *
 * Holding one of these pins the user to their own branch even when they also hold a global
 * finance role, because the branch grant is the more specific statement of intent. The live
 * case this exists for is a branch admin who also carries the generic `admin` role: before
 * this rule, `admin` alone put them in GLOBAL_FINANCE_ROLES and they read every branch's
 * budget from the Branch Budget workspace.
 */
const BRANCH_BOUND_FINANCE_ROLES = new Set(["branch_admin"]);

/**
 * Global roles strong enough to survive a branch-bound role.
 *
 * These are the budget approval chain (BUDGET_REVIEW_ROLES in process-pnl.routes.ts) plus
 * company-wide finance and management: they must read every branch or the review workflow
 * stalls, and at least one live account holds branch_admin alongside finance_head for
 * exactly that reason. `admin` is deliberately absent — it is a generic grant, not a
 * statement that the holder reviews other branches' budgets.
 */
const OVERRIDING_GLOBAL_FINANCE_ROLES = new Set([
  "super_admin",
  "finance",
  "finance_head",
  "accounts_head",
  "payroll_head",
  "ceo",
  "coo",
  "hr_admin",
]);

export function hasGlobalFinanceScope(primaryRole?: string, userRoles?: string[]) {
  const roles = Array.from(normalizedRoles(primaryRole, userRoles));
  if (roles.some((role) => OVERRIDING_GLOBAL_FINANCE_ROLES.has(role))) return true;
  if (roles.some((role) => BRANCH_BOUND_FINANCE_ROLES.has(role))) return false;
  return roles.some((role) => GLOBAL_FINANCE_ROLES.has(role));
}

export async function getUserBranchId(userId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT branch_id
       FROM employees
      WHERE user_id = ?
        AND active_status = 1
        AND branch_id IS NOT NULL
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1`,
    [userId]
  );
  const branchId = rows[0]?.branch_id ? String(rows[0].branch_id) : null;
  if (!branchId) {
    throw new Error("Your user account is not mapped to an active employee branch");
  }
  return branchId;
}

/**
 * What branches a finance caller may see.
 *
 * A discriminated union rather than `string[] | undefined` on purpose. With a bare array the
 * empty case is catastrophically ambiguous: `IN ()` is a SQL syntax error, and the obvious
 * guard against it — `if (branchIds.length) applyFilter()` — silently turns "this user is
 * entitled to no branches" into "no filter", i.e. every branch. The union has no empty state
 * to get wrong, and `resolveFinanceBranchScopeSet` throws rather than ever constructing one.
 */
export type FinanceBranchScope =
  | { mode: "all" }
  | { mode: "branches"; branchIds: string[] };

/** Scope rows that carry a branch. `process`, `lob`, `department`, `team` and `self` do not. */
const BRANCH_BEARING_SCOPE_TYPES = new Set(["branch", "branch_process"]);

/**
 * Every branch a caller may read, as a set.
 *
 * Resolution order, and why each step is where it is:
 *
 *   1. A global finance role short-circuits to "all". The three role Sets above are NOT
 *      consulted differently here — same function, same precedence — so a branch_admin who
 *      also holds `admin` stays branch-bound exactly as before.
 *   2. Explicit grants in user_assignment_scope, which is the generic engine the rest of the
 *      app (employees, payroll, ATS, roster) already uses. Multiple rows are the intended
 *      design — the table has no unique key on (user_id, role_key) and the grant endpoint
 *      accumulates rows — so N branches need no new table. A `scope_type = 'all'` row is
 *      honoured as "all".
 *   3. Fall back to the employee's own branch when there are no grants. This is PERMANENT,
 *      not transitional: a user with an employee branch and no explicit grant should see
 *      their own branch, which is the behaviour every finance user has today. Removing it
 *      would lock out every branch user the moment this ships.
 *
 * A requested branch outside the resolved set throws rather than being quietly dropped —
 * a filter that silently disappears looks to the caller like data they are entitled to.
 */
export async function resolveFinanceBranchScopeSet(input: {
  userId: string;
  primaryRole?: string;
  userRoles?: string[];
  requestedBranchId?: string | null;
}): Promise<FinanceBranchScope> {
  const requested = input.requestedBranchId?.trim() || undefined;

  if (hasGlobalFinanceScope(input.primaryRole, input.userRoles)) {
    return requested ? { mode: "branches", branchIds: [requested] } : { mode: "all" };
  }

  const allowed = await resolveGrantedBranchIds(input.userId, input.primaryRole, input.userRoles);

  if (requested) {
    if (!allowed.includes(requested)) {
      throw new Error("You can only access finance records for your assigned branch");
    }
    return { mode: "branches", branchIds: [requested] };
  }
  return { mode: "branches", branchIds: allowed };
}

/**
 * The branches a non-global caller may read: their own employee branch, UNION any branch
 * explicitly granted in user_assignment_scope.
 *
 * Two rules here are load-bearing, and both exist to make this change strictly non-widening.
 *
 * 1. `scope_type = 'all'` IS DELIBERATELY IGNORED.
 *    user_assignment_scope has no module column — a scope row is global across the whole
 *    application — and 36 live rows carry scope_type='all', 9 of them alongside a branch_id.
 *    Those were granted so somebody could see every employee or every roster, not every
 *    branch's spend. Honouring 'all' here would silently hand finance-wide visibility to any
 *    branch user holding one, which is precisely the escalation
 *    finance-branch-bound-scope.test.ts exists to prevent. In finance, "all branches" comes
 *    from hasGlobalFinanceScope and from nowhere else; a grant may only ever ENUMERATE
 *    branches.
 *
 * 2. Grants are UNIONED with the employee branch, never substituted for it.
 *    A grant is an addition to what someone can already see. Replacing would mean a single
 *    grant row pointing at another branch silently removed access to their own — a
 *    regression dressed up as a feature.
 */
async function resolveGrantedBranchIds(
  userId: string,
  primaryRole?: string,
  userRoles?: string[],
): Promise<string[]> {
  const roles = Array.from(normalizedRoles(primaryRole, userRoles));

  let scopes: Awaited<ReturnType<typeof getUserAssignmentScopes>> = [];
  try {
    scopes = await getUserAssignmentScopes(userId, roles);
  } catch {
    // user_assignment_scope is optional infrastructure from finance's point of view. If the
    // query fails we fall through to the employee branch rather than denying outright, which
    // is the behaviour that existed before grants were consulted at all.
    scopes = [];
  }

  // A row only counts when it names a branch AND declares a branch-bearing scope_type.
  // Both checks matter: a `process`-scoped row may carry a branch_id that is context, not a
  // grant, and widening on it would hand out a branch nobody granted. 26 live rows are
  // process-scoped.
  const granted = scopes
    .filter((row) => BRANCH_BEARING_SCOPE_TYPES.has(String(row.scope_type)))
    .map((row) => (row.branch_id ? String(row.branch_id) : ""))
    .filter(Boolean);

  if (granted.length === 0) {
    // No grants: behave exactly as before, including the "not mapped to an active employee
    // branch" error when there is no employee row either.
    return [await getUserBranchId(userId)];
  }

  let employeeBranchId: string | null = null;
  try {
    employeeBranchId = await getUserBranchId(userId);
  } catch {
    // An explicit grant is enough on its own — a finance user granted three branches need not
    // also be an active employee with a branch of their own.
    employeeBranchId = null;
  }

  return Array.from(new Set(employeeBranchId ? [employeeBranchId, ...granted] : granted));
}

/**
 * A `branch_id IN (?, ?)` fragment for a resolved scope.
 *
 * `column` is always a code-controlled alias literal such as "g.branch_id" — never anything
 * derived from a request — and the ids themselves are bound, so this cannot be injected into.
 */
export function financeBranchFilter(
  scope: FinanceBranchScope,
  column: string,
): { sql: string; params: string[] } {
  if (scope.mode === "all") return { sql: "1=1", params: [] };
  const placeholders = scope.branchIds.map(() => "?").join(", ");
  return { sql: `${column} IN (${placeholders})`, params: [...scope.branchIds] };
}

/**
 * Single-branch adapter over resolveFinanceBranchScopeSet, kept so the ~25 existing call
 * sites compile and behave identically while they are migrated one router at a time.
 *
 * For every caller who resolves to "all" or to exactly one branch — which is everyone until
 * a multi-branch grant is actually issued — this returns precisely what it always returned.
 * A genuinely multi-branch caller throws, and that direction matters: the failure is a denial
 * with a readable message, never a silent widening to every branch. Delete this once no
 * importer remains.
 */
export async function resolveFinanceBranchScope(input: {
  userId: string;
  primaryRole?: string;
  userRoles?: string[];
  requestedBranchId?: string | null;
}): Promise<string | undefined> {
  const scope = await resolveFinanceBranchScopeSet(input);
  if (scope.mode === "all") return undefined;
  if (scope.branchIds.length === 1) return scope.branchIds[0];
  throw new Error(
    "This finance screen does not support multi-branch access yet; select a single branch",
  );
}

export async function assertFinanceRecordBranch(input: {
  userId: string;
  primaryRole?: string;
  userRoles?: string[];
  recordBranchId: string | null | undefined;
}) {
  const scope = await resolveFinanceBranchScopeSet({
    userId: input.userId,
    primaryRole: input.primaryRole,
    userRoles: input.userRoles,
    // Deliberately not forwarding a requested branch: this asks "may they touch THIS record",
    // which is answered by the full set, not by whatever branch the query string named.
    requestedBranchId: undefined,
  });
  if (scope.mode === "all") return;

  // A record with no branch reads as a denial, never as unrestricted. getMeterBranchId and
  // getCostCentreBranchId return null for a missing or unmapped record.
  const recordBranchId = input.recordBranchId ? String(input.recordBranchId) : null;
  if (!recordBranchId || !scope.branchIds.includes(recordBranchId)) {
    throw new Error("You cannot access a finance record from another branch");
  }
}

/**
 * Roles whose finance view is limited to a single PROCESS, not merely a branch.
 *
 * A process manager runs one process inside a branch that may hold several. Branch scoping alone
 * would show them every process their branch runs, including other managers' cost and revenue.
 */
const PROCESS_SCOPED_ROLES = new Set(["process_manager"]);

async function getUserProcessId(userId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT process_id
       FROM employees
      WHERE user_id = ?
        AND active_status = 1
        AND process_id IS NOT NULL
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1`,
    [userId],
  );
  const processId = rows[0]?.process_id ? String(rows[0].process_id) : null;
  if (!processId) {
    throw new Error("Your user account is not mapped to an active employee process");
  }
  return processId;
}

/**
 * The process a finance read must be confined to, or undefined when the caller may see all.
 *
 * Mirrors resolveFinanceBranchScope exactly, including its refusal: asking for someone else's
 * process is an error rather than a silently ignored parameter, because a filter that is quietly
 * dropped looks like data the user is entitled to.
 */
export async function resolveFinanceProcessScope(input: {
  userId: string;
  primaryRole?: string;
  userRoles?: string[];
  requestedProcessId?: string | null;
}) {
  const requested = input.requestedProcessId?.trim() || undefined;
  if (hasGlobalFinanceScope(input.primaryRole, input.userRoles)) return requested;

  const roles = normalizedRoles(input.primaryRole, input.userRoles);
  const restricted = Array.from(roles).some((role) => PROCESS_SCOPED_ROLES.has(role));
  if (!restricted) return requested;

  const assignedProcessId = await getUserProcessId(input.userId);
  if (requested && requested !== assignedProcessId) {
    throw new Error("You can only access finance records for your assigned process");
  }
  return assignedProcessId;
}
