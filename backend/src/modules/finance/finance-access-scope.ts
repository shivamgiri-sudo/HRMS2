import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

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

export async function resolveFinanceBranchScope(input: {
  userId: string;
  primaryRole?: string;
  userRoles?: string[];
  requestedBranchId?: string | null;
}) {
  const requested = input.requestedBranchId?.trim() || undefined;
  if (hasGlobalFinanceScope(input.primaryRole, input.userRoles)) {
    return requested;
  }

  const assignedBranchId = await getUserBranchId(input.userId);
  if (requested && requested !== assignedBranchId) {
    throw new Error("You can only access finance records for your assigned branch");
  }
  return assignedBranchId;
}

export async function assertFinanceRecordBranch(input: {
  userId: string;
  primaryRole?: string;
  userRoles?: string[];
  recordBranchId: string | null | undefined;
}) {
  if (hasGlobalFinanceScope(input.primaryRole, input.userRoles)) return;
  const assignedBranchId = await getUserBranchId(input.userId);
  if (!input.recordBranchId || String(input.recordBranchId) !== assignedBranchId) {
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
