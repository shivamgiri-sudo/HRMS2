import { db } from "../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { getUserRoleContext } from "./roleResolver.js";

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
  "management",
  "ho_hr",
  "ho_payroll",
  "ho_operations",
  "finance_head",
  "payroll_head",
  "compliance_head",
  "ho_it",
  "ho_wfm",
  "ho_rta",
];

const BRANCH_ALL_ROLES = [
  "branch_head",
  "bm",
  "branch_manager",
  "hr_branch",
  "branch_hr",
  "branch_finance",
  "branch_it",
];

const PROCESS_ALL_ROLES = [
  "process_manager",
  "team_lead",
  "wfm_spoc",
  "qa_manager",
  "process_hr",
  "quality_analyst",
];

// team_lead is PROCESS_ALL when a process_id is assigned, TEAM_ONLY otherwise
const TEAM_LEAD_ROLE = "team_lead";

const SELF_ONLY_ROLES = ["employee", "agent", "trainee"];

export async function resolveDashboardScope(
  userId: string,
  role: string
): Promise<DashboardScope> {
  // Resolve role from DB for accuracy — JWT claim may be stale
  const ctx = await getUserRoleContext(userId);
  const effectiveRole = ctx.primaryRole;

  if (ORG_ALL_ROLES.includes(effectiveRole)) {
    return { level: "ORG_ALL", branchIds: [], processIds: [], userId, role: effectiveRole };
  }

  if (BRANCH_ALL_ROLES.includes(effectiveRole)) {
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
    // No branch assignments found — fall back to SELF_ONLY to prevent seeing all data
    if (branchIds.length === 0) {
      console.warn(`[dashboardScope] BRANCH_ALL role=${effectiveRole} userId=${userId} has no branch assignments — falling back to SELF_ONLY`);
      return { level: "SELF_ONLY", branchIds: [], processIds: [], userId, role: effectiveRole };
    }
    return { level: "BRANCH_ALL", branchIds, processIds: [], userId, role: effectiveRole };
  }

  if (PROCESS_ALL_ROLES.includes(effectiveRole) || effectiveRole === TEAM_LEAD_ROLE) {
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
    if (effectiveRole === TEAM_LEAD_ROLE && processIds.length === 0) {
      return { level: "TEAM_ONLY", branchIds: [], processIds: [], userId, role: effectiveRole };
    }

    // No process assignments found — fall back to SELF_ONLY to prevent seeing all data
    if (processIds.length === 0) {
      console.warn(`[dashboardScope] PROCESS_ALL role=${effectiveRole} userId=${userId} has no process assignments — falling back to SELF_ONLY`);
      return { level: "SELF_ONLY", branchIds: [], processIds: [], userId, role: effectiveRole };
    }

    return { level: "PROCESS_ALL", branchIds, processIds, userId, role: effectiveRole };
  }

  if (SELF_ONLY_ROLES.includes(effectiveRole)) {
    return { level: "SELF_ONLY", branchIds: [], processIds: [], userId, role: effectiveRole };
  }

  // Default fallback for any unrecognised role
  return { level: "SELF_ONLY", branchIds: [], processIds: [], userId, role: effectiveRole };
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
      // userId is auth_user_id — callers using this helper must ensure
      // their table has an auth_user_id column; use buildScopeWhereEmployees
      // for the employees table instead.
      return { sql: `auth_user_id = ?`, params: [scope.userId] };

    case "TEAM_ONLY":
      // Scope to the user's own team — treat as self until team_id wiring lands
      return { sql: `auth_user_id = ?`, params: [scope.userId] };

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

    case "CUSTOM_SCOPE": {
      const parts: string[] = [];
      const params: string[] = [];
      if (scope.branchIds.length > 0) {
        parts.push(`${branchCol} IN (${scope.branchIds.map(() => "?").join(",")})`);
        params.push(...scope.branchIds);
      }
      if (scope.processIds.length > 0) {
        parts.push(`${processCol} IN (${scope.processIds.map(() => "?").join(",")})`);
        params.push(...scope.processIds);
      }
      if (parts.length === 0) {
        console.warn(
          `[dashboardScope] CUSTOM_SCOPE has no branchIds or processIds for userId=${scope.userId} role=${scope.role} — denying all rows`
        );
        return { sql: "1=0", params: [] };
      }
      return { sql: `(${parts.join(" OR ")})`, params };
    }

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

    case "CUSTOM_SCOPE": {
      const parts: string[] = [];
      const params: string[] = [];
      if (scope.branchIds.length > 0) {
        parts.push(`e.branch_id IN (${scope.branchIds.map(() => "?").join(",")})`);
        params.push(...scope.branchIds);
      }
      if (scope.processIds.length > 0) {
        parts.push(`e.process_id IN (${scope.processIds.map(() => "?").join(",")})`);
        params.push(...scope.processIds);
      }
      if (parts.length === 0) {
        console.warn(
          `[dashboardScope] CUSTOM_SCOPE on employees table has no branchIds or processIds for userId=${scope.userId} role=${scope.role} — denying all rows`
        );
        return { sql: "1=0", params: [] };
      }
      return { sql: `(${parts.join(" OR ")})`, params };
    }

    default:
      return { sql: "1=0", params: [] };
  }
}

/**
 * Convenience helper: returns a {sql, params} WHERE fragment for any scope level,
 * using the supplied table alias prefix on column names.
 *
 * Use this when you want a single call that handles all scope levels correctly,
 * including the SELF_ONLY fix (auth_user_id, not employee_id).
 */
export function scopeToSqlWhere(
  scope: DashboardScope,
  tableAlias: string = "e"
): { sql: string; params: any[] } {
  if (scope.level === "ORG_ALL") {
    return { sql: "1=1", params: [] };
  }

  if (scope.level === "SELF_ONLY" || scope.level === "TEAM_ONLY") {
    return { sql: `${tableAlias}.auth_user_id = ?`, params: [scope.userId] };
  }

  if (scope.level === "BRANCH_ALL") {
    if (scope.branchIds.length === 0) return { sql: "1=0", params: [] };
    return {
      sql: `${tableAlias}.branch_id IN (${scope.branchIds.map(() => "?").join(",")})`,
      params: scope.branchIds,
    };
  }

  if (scope.level === "PROCESS_ALL") {
    if (scope.processIds.length === 0) return { sql: "1=0", params: [] };
    return {
      sql: `${tableAlias}.process_id IN (${scope.processIds.map(() => "?").join(",")})`,
      params: scope.processIds,
    };
  }

  if (scope.level === "CUSTOM_SCOPE") {
    const parts: string[] = [];
    const params: any[] = [];
    if (scope.branchIds.length > 0) {
      parts.push(
        `${tableAlias}.branch_id IN (${scope.branchIds.map(() => "?").join(",")})`
      );
      params.push(...scope.branchIds);
    }
    if (scope.processIds.length > 0) {
      parts.push(
        `${tableAlias}.process_id IN (${scope.processIds.map(() => "?").join(",")})`
      );
      params.push(...scope.processIds);
    }
    if (parts.length === 0) {
      console.warn(
        `[dashboardScope] scopeToSqlWhere CUSTOM_SCOPE has no branchIds or processIds for userId=${scope.userId} role=${scope.role} — denying all rows`
      );
      return { sql: "1=0", params: [] };
    }
    return { sql: `(${parts.join(" OR ")})`, params };
  }

  // Unknown scope level — deny all
  console.warn("[dashboardScope] scopeToSqlWhere unknown scope level:", scope.level, "— denying");
  return { sql: "1=0", params: [] };
}
