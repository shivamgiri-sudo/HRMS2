import { db } from "../db/mysql.js";
import type { RowDataPacket } from "mysql2";

export type ScopeLevel = "ORG_ALL" | "BRANCH_ALL" | "PROCESS_ALL" | "TEAM_ONLY" | "SELF_ONLY";

export type DashboardScope = {
  level: ScopeLevel;
  branchIds: string[];
  processIds: string[];
  userId: string;
};

const ADMIN_ROLES = ["super_admin", "admin", "ceo", "ho_hr", "ho_payroll", "ho_operations", "finance_head"];
const BRANCH_ROLES = ["branch_head", "branch_manager", "hr_branch"];
const PROCESS_ROLES = ["process_manager", "team_lead", "wfm_spoc", "qa_manager"];

export async function resolveDashboardScope(
  userId: string,
  role: string
): Promise<DashboardScope> {
  if (ADMIN_ROLES.includes(role)) {
    return { level: "ORG_ALL", branchIds: [], processIds: [], userId };
  }

  if (BRANCH_ROLES.includes(role)) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT branch_id FROM employee_branch_assignment WHERE user_id = ? AND is_active = 1
       UNION SELECT branch_id FROM employees WHERE auth_user_id = ? AND branch_id IS NOT NULL LIMIT 10`,
      [userId, userId]
    );
    const branchIds = rows.map((r) => r.branch_id).filter(Boolean);
    return { level: "BRANCH_ALL", branchIds, processIds: [], userId };
  }

  if (PROCESS_ROLES.includes(role)) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT process_id FROM employee_process_assignment WHERE user_id = ? AND is_active = 1
       UNION SELECT process_id FROM employees WHERE auth_user_id = ? AND process_id IS NOT NULL LIMIT 10`,
      [userId, userId]
    );
    const processIds = rows.map((r) => r.process_id).filter(Boolean);
    return { level: "PROCESS_ALL", branchIds: [], processIds, userId };
  }

  return { level: "SELF_ONLY", branchIds: [], processIds: [], userId };
}

export function buildScopeWhere(
  scope: DashboardScope,
  branchCol = "branch_id",
  processCol = "process_id"
): { sql: string; params: string[] } {
  if (scope.level === "ORG_ALL") return { sql: "1=1", params: [] };
  if (scope.level === "SELF_ONLY") return { sql: `employee_id = ?`, params: [scope.userId] };

  const parts: string[] = [];
  const params: string[] = [];

  if (scope.level === "BRANCH_ALL" && scope.branchIds.length > 0) {
    parts.push(`${branchCol} IN (${scope.branchIds.map(() => "?").join(",")})`);
    params.push(...scope.branchIds);
  }
  if (scope.level === "PROCESS_ALL" && scope.processIds.length > 0) {
    parts.push(`${processCol} IN (${scope.processIds.map(() => "?").join(",")})`);
    params.push(...scope.processIds);
  }

  return parts.length > 0 ? { sql: parts.join(" OR "), params } : { sql: "1=0", params: [] };
}
