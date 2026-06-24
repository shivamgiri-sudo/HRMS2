import { db } from "../db/mysql.js";
import type { RowDataPacket } from "mysql2";

export type ScopeLevel =
  | "ORG_ALL"
  | "BRANCH_ALL"
  | "PROCESS_ALL"
  | "TEAM_ONLY"
  | "SELF_ONLY"
  | "CUSTOM_SCOPE";

export type DashboardScope = {
  level: ScopeLevel;
  branchIds: string[];
  processIds: string[];
  userId: string;
  role: string;
};

const ORG_ALL_ROLES = [
  "super_admin",
  "admin",
  "ceo",
  "ho_hr",
  "ho_payroll",
  "ho_operations",
  "finance_head",
  "management",
  "payroll_head",
  "compliance_head",
  "ho_it",
];

const BRANCH_ALL_ROLES = [
  "branch_head",
  "bm",
  "branch_manager",
  "hr_branch",
  "branch_hr",
  "branch_finance",
];

const PROCESS_ALL_ROLES = [
  "process_manager",
  "wfm_spoc",
  "qa_manager",
  "process_hr",
];

// team_lead is PROCESS_ALL when a process_id is assigned, TEAM_ONLY otherwise
const TEAM_LEAD_ROLE = "team_lead";

const SELF_ONLY_ROLES = ["employee", "agent", "trainee"];

export async function resolveDashboardScope(
  userId: string,
  role: string
): Promise<DashboardScope> {
  if (ORG_ALL_ROLES.includes(role)) {
    return { level: "ORG_ALL", branchIds: [], processIds: [], userId, role };
  }

  if (BRANCH_ALL_ROLES.includes(role)) {
    let branchIds: string[] = [];
    try {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT DISTINCT branch_id FROM employee_branch_assignment
          WHERE user_id = ? AND is_active = 1
         UNION
         SELECT branch_id FROM employees
          WHERE auth_user_id = ? AND branch_id IS NOT NULL
         LIMIT 10`,
        [userId, userId]
      );
      branchIds = rows.map((r) => String(r.branch_id)).filter(Boolean);
    } catch {
      // graceful fallback — no assignment rows yet
    }
    return { level: "BRANCH_ALL", branchIds, processIds: [], userId, role };
  }

  if (PROCESS_ALL_ROLES.includes(role) || role === TEAM_LEAD_ROLE) {
    let processIds: string[] = [];
    let branchIds: string[] = [];
    try {
      const [pRows] = await db.execute<RowDataPacket[]>(
        `SELECT DISTINCT process_id FROM employee_process_assignment
          WHERE user_id = ? AND is_active = 1
         UNION
         SELECT process_id FROM employees
          WHERE auth_user_id = ? AND process_id IS NOT NULL
         LIMIT 10`,
        [userId, userId]
      );
      processIds = pRows.map((r) => String(r.process_id)).filter(Boolean);

      if (processIds.length > 0) {
        // Also collect the branches those processes belong to
        const [bRows] = await db.execute<RowDataPacket[]>(
          `SELECT DISTINCT branch_id FROM employees
            WHERE auth_user_id = ? AND branch_id IS NOT NULL
           LIMIT 10`,
          [userId]
        );
        branchIds = bRows.map((r) => String(r.branch_id)).filter(Boolean);
      }
    } catch {
      // graceful fallback
    }

    // team_lead with no process_id resolves to TEAM_ONLY
    if (role === TEAM_LEAD_ROLE && processIds.length === 0) {
      return { level: "TEAM_ONLY", branchIds: [], processIds: [], userId, role };
    }

    return { level: "PROCESS_ALL", branchIds, processIds, userId, role };
  }

  if (SELF_ONLY_ROLES.includes(role)) {
    return { level: "SELF_ONLY", branchIds: [], processIds: [], userId, role };
  }

  // Default fallback for any unrecognised role
  return { level: "SELF_ONLY", branchIds: [], processIds: [], userId, role };
}

/**
 * Generic scope WHERE fragment — callers supply column names.
 * Returns { sql, params } for use in parameterised queries.
 */
export function buildScopeWhere(
  scope: DashboardScope,
  branchCol = "branch_id",
  processCol = "process_id"
): { sql: string; params: string[] } {
  switch (scope.level) {
    case "ORG_ALL":
      return { sql: "1=1", params: [] };

    case "SELF_ONLY":
      return { sql: `employee_id = ?`, params: [scope.userId] };

    case "TEAM_ONLY":
      // Scope to the user's own team — treat as self until team_id wiring lands
      return { sql: `employee_id = ?`, params: [scope.userId] };

    case "BRANCH_ALL": {
      if (scope.branchIds.length === 0) return { sql: "1=0", params: [] };
      const placeholders = scope.branchIds.map(() => "?").join(",");
      return {
        sql: `${branchCol} IN (${placeholders})`,
        params: [...scope.branchIds],
      };
    }

    case "PROCESS_ALL": {
      if (scope.processIds.length === 0) return { sql: "1=0", params: [] };
      const placeholders = scope.processIds.map(() => "?").join(",");
      return {
        sql: `${processCol} IN (${placeholders})`,
        params: [...scope.processIds],
      };
    }

    case "CUSTOM_SCOPE":
      console.warn(
        `[dashboardScope] CUSTOM_SCOPE encountered for userId=${scope.userId} role=${scope.role} — defaulting to 1=1`
      );
      return { sql: "1=1", params: [] };

    default:
      return { sql: "1=0", params: [] };
  }
}

/**
 * Scope WHERE fragment specific to the employees table (alias "e").
 * Returns { sql, params } ready for parameterised query insertion.
 */
export function buildScopeWhereEmployees(scope: DashboardScope): {
  sql: string;
  params: string[];
} {
  switch (scope.level) {
    case "ORG_ALL":
      return { sql: "1=1", params: [] };

    case "BRANCH_ALL": {
      if (scope.branchIds.length === 0) return { sql: "1=0", params: [] };
      const placeholders = scope.branchIds.map(() => "?").join(",");
      return {
        sql: `e.branch_id IN (${placeholders})`,
        params: [...scope.branchIds],
      };
    }

    case "PROCESS_ALL": {
      if (scope.processIds.length === 0) return { sql: "1=0", params: [] };
      const placeholders = scope.processIds.map(() => "?").join(",");
      return {
        sql: `e.process_id IN (${placeholders})`,
        params: [...scope.processIds],
      };
    }

    case "TEAM_ONLY":
      // Same as SELF_ONLY until team_id column is wired
      return { sql: `e.auth_user_id = ?`, params: [scope.userId] };

    case "SELF_ONLY":
      return { sql: `e.auth_user_id = ?`, params: [scope.userId] };

    case "CUSTOM_SCOPE":
      console.warn(
        `[dashboardScope] CUSTOM_SCOPE on employees table for userId=${scope.userId} role=${scope.role} — defaulting to 1=1`
      );
      return { sql: "1=1", params: [] };

    default:
      return { sql: "1=0", params: [] };
  }
}
