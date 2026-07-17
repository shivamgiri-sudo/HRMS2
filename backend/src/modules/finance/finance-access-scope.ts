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

export function hasGlobalFinanceScope(primaryRole?: string, userRoles?: string[]) {
  const roles = normalizedRoles(primaryRole, userRoles);
  return Array.from(roles).some((role) => GLOBAL_FINANCE_ROLES.has(role));
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
