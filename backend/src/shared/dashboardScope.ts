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

type AssignmentScopeRow = RowDataPacket & {
  role_key?: string | null;
  scope_type?: string | null;
  branch_id?: string | null;
  process_id?: string | null;
  manager_employee_id?: string | null;
};

const ORG_ALL_ROLES = new Set([
  "super_admin", "admin", "ceo", "coo", "management", "ho_hr", "hr_admin", "hr",
  "ho_payroll", "payroll_head", "finance_head", "accounts_head", "payroll_admin",
  "payroll_hr", "payroll", "finance", "ho_operations", "operations_head", "ho_wfm",
  "ho_rta", "compliance_head", "ho_it",
]);

const BRANCH_ALL_ROLES = new Set([
  "branch_head", "bm", "branch_manager", "branch_hr", "hr_branch", "branch_finance",
  "payroll_branch", "branch_it",
]);

const PROCESS_OR_TEAM_ROLES = new Set([
  "process_manager", "manager", "assistant_manager", "team_leader", "team_lead", "tl",
  "wfm", "wfm_spoc", "rta", "process_hr", "qa_manager", "quality_analyst",
]);

const SELF_ONLY_ROLES = new Set(["employee", "agent", "trainee"]);

function unique(values: unknown[]): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

async function loadAssignmentScopes(userId: string, roleKeys: readonly string[]): Promise<AssignmentScopeRow[]> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT role_key, scope_type, branch_id, process_id, manager_employee_id
         FROM user_assignment_scope
        WHERE user_id = ? AND active_status = 1`,
      [userId],
    );
    const allowedRoles = new Set(roleKeys.map((role) => String(role).trim().toLowerCase()));
    return (rows as AssignmentScopeRow[]).filter((row) => {
      const role = String(row.role_key ?? "").trim().toLowerCase();
      return !role || allowedRoles.has(role);
    });
  } catch {
    return [];
  }
}

async function resolveEmployeeScope(userId: string): Promise<{
  employeeId: string | null;
  branchIds: string[];
  processIds: string[];
}> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, branch_id, process_id
       FROM employees
      WHERE user_id = ? AND active_status = 1
      ORDER BY updated_at DESC
      LIMIT 1`,
    [userId],
  ).catch(() => [[]] as any);

  const row = rows[0] as RowDataPacket | undefined;
  return {
    employeeId: row?.id ? String(row.id) : null,
    branchIds: unique([row?.branch_id]),
    processIds: unique([row?.process_id]),
  };
}

async function branchesForProcesses(processIds: readonly string[]): Promise<string[]> {
  if (processIds.length === 0) return [];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT branch_id
       FROM employees
      WHERE process_id IN (${processIds.map(() => "?").join(",")})
        AND branch_id IS NOT NULL
        AND active_status = 1`,
    [...processIds],
  ).catch(() => [[]] as any);
  return unique(rows.map((row) => row.branch_id));
}

export async function resolveDashboardScope(userId: string, _role: string): Promise<DashboardScope> {
  const context = await getUserRoleContext(userId);
  const effectiveRole = context.primaryRole;

  if (ORG_ALL_ROLES.has(effectiveRole)) {
    return { level: "ORG_ALL", branchIds: [], processIds: [], userId, role: effectiveRole };
  }

  const [assignments, employee] = await Promise.all([
    loadAssignmentScopes(userId, context.roleKeys),
    resolveEmployeeScope(userId),
  ]);

  const hasAllScope = assignments.some((row) => String(row.scope_type ?? "").toLowerCase() === "all");
  if (hasAllScope && !SELF_ONLY_ROLES.has(effectiveRole)) {
    return { level: "ORG_ALL", branchIds: [], processIds: [], userId, role: effectiveRole };
  }

  const processIds = unique([
    ...assignments.map((row) => row.process_id),
    ...employee.processIds,
  ]);
  const assignmentBranchIds = unique(assignments.map((row) => row.branch_id));
  const derivedBranchIds = await branchesForProcesses(processIds);
  const branchIds = unique([
    ...assignmentBranchIds,
    ...employee.branchIds,
    ...derivedBranchIds,
  ]);
  const hasManagerScope = assignments.some((row) => Boolean(row.manager_employee_id));

  if (BRANCH_ALL_ROLES.has(effectiveRole)) {
    if (branchIds.length > 0) {
      return { level: "BRANCH_ALL", branchIds, processIds: [], userId, role: effectiveRole };
    }
    console.warn(`[dashboardScope] ${effectiveRole} has no active branch assignment; using self-only scope`);
    return { level: "SELF_ONLY", branchIds: employee.branchIds, processIds: employee.processIds, userId, role: effectiveRole };
  }

  if (PROCESS_OR_TEAM_ROLES.has(effectiveRole)) {
    if (processIds.length > 0) {
      return { level: "PROCESS_ALL", branchIds, processIds, userId, role: effectiveRole };
    }
    if (branchIds.length > 0) {
      return { level: "BRANCH_ALL", branchIds, processIds: [], userId, role: effectiveRole };
    }
    if (hasManagerScope || employee.employeeId) {
      return { level: "TEAM_ONLY", branchIds: [], processIds: [], userId, role: effectiveRole };
    }
    return { level: "SELF_ONLY", branchIds: [], processIds: [], userId, role: effectiveRole };
  }

  return {
    level: "SELF_ONLY",
    branchIds: employee.branchIds,
    processIds: employee.processIds,
    userId,
    role: effectiveRole,
  };
}

export async function narrowDashboardScope(
  scope: DashboardScope,
  requestedBranchId?: string | null,
  requestedProcessId?: string | null,
): Promise<DashboardScope> {
  const branchId = String(requestedBranchId ?? "").trim();
  const processId = String(requestedProcessId ?? "").trim();
  if (!branchId && !processId) return scope;
  if (scope.level === "SELF_ONLY" || scope.level === "TEAM_ONLY") return scope;

  const deny = (): DashboardScope => ({ ...scope, level: "CUSTOM_SCOPE", branchIds: [], processIds: [] });

  if (scope.level === "BRANCH_ALL" && branchId && !scope.branchIds.includes(branchId)) return deny();
  if (scope.level === "PROCESS_ALL" && processId && !scope.processIds.includes(processId)) return deny();

  if (branchId) {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM branch_master WHERE id = ? AND active_status = 1 LIMIT 1",
      [branchId],
    ).catch(() => [[]] as any);
    if (rows.length === 0) return deny();
  }

  if (processId) {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM process_master WHERE id = ? AND active_status = 1 LIMIT 1",
      [processId],
    ).catch(() => [[]] as any);
    if (rows.length === 0) return deny();
  }

  if (scope.level === "BRANCH_ALL" && processId) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT 1 FROM employees
        WHERE process_id = ?
          AND branch_id IN (${scope.branchIds.map(() => "?").join(",")})
          AND active_status = 1 LIMIT 1`,
      [processId, ...scope.branchIds],
    ).catch(() => [[]] as any);
    if (rows.length === 0) return deny();
  }

  if (scope.level === "PROCESS_ALL" && branchId) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT 1 FROM employees
        WHERE branch_id = ?
          AND process_id IN (${scope.processIds.map(() => "?").join(",")})
          AND active_status = 1 LIMIT 1`,
      [branchId, ...scope.processIds],
    ).catch(() => [[]] as any);
    if (rows.length === 0) return deny();
  }

  if (branchId && processId) {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT 1 FROM employees WHERE branch_id = ? AND process_id = ? AND active_status = 1 LIMIT 1",
      [branchId, processId],
    ).catch(() => [[]] as any);
    if (rows.length === 0) return deny();
  }

  return {
    ...scope,
    level: "CUSTOM_SCOPE",
    branchIds: branchId ? [branchId] : [],
    processIds: processId ? [processId] : [],
  };
}

export function buildScopeWhere(
  scope: DashboardScope,
  branchCol = "branch_id",
  processCol = "process_id",
): { sql: string; params: string[] } {
  if (scope.level === "ORG_ALL") return { sql: "1=1", params: [] };

  if (scope.level === "BRANCH_ALL") {
    if (scope.branchIds.length === 0) return { sql: "1=0", params: [] };
    return {
      sql: `${branchCol} IN (${scope.branchIds.map(() => "?").join(",")})`,
      params: [...scope.branchIds],
    };
  }

  if (scope.level === "PROCESS_ALL") {
    if (branchCol === "bm.id" && scope.branchIds.length > 0) {
      return {
        sql: `${branchCol} IN (${scope.branchIds.map(() => "?").join(",")})`,
        params: [...scope.branchIds],
      };
    }
    if (scope.processIds.length === 0) return { sql: "1=0", params: [] };
    return {
      sql: `${processCol} IN (${scope.processIds.map(() => "?").join(",")})`,
      params: [...scope.processIds],
    };
  }

  if (scope.level === "CUSTOM_SCOPE") {
    const conditions: string[] = [];
    const params: string[] = [];
    if (scope.branchIds.length > 0) {
      conditions.push(`${branchCol} IN (${scope.branchIds.map(() => "?").join(",")})`);
      params.push(...scope.branchIds);
    }
    if (scope.processIds.length > 0) {
      conditions.push(`${processCol} IN (${scope.processIds.map(() => "?").join(",")})`);
      params.push(...scope.processIds);
    }
    return conditions.length > 0 ? { sql: conditions.join(" AND "), params } : { sql: "1=0", params: [] };
  }

  return { sql: "1=0", params: [] };
}

export function buildScopeWhereEmployees(scope: DashboardScope, alias = "e"): { sql: string; params: string[] } {
  if (scope.level === "ORG_ALL") return { sql: "1=1", params: [] };
  if (scope.level === "SELF_ONLY") return { sql: `${alias}.user_id = ?`, params: [scope.userId] };
  if (scope.level === "TEAM_ONLY") {
    return {
      sql: `(${alias}.reporting_manager_id IN (SELECT id FROM employees WHERE user_id = ?)
             OR ${alias}.manager_id IN (SELECT id FROM employees WHERE user_id = ?))`,
      params: [scope.userId, scope.userId],
    };
  }
  return buildScopeWhere(scope, `${alias}.branch_id`, `${alias}.process_id`);
}

export function scopeToSqlWhere(scope: DashboardScope, tableAlias = "e"): { sql: string; params: any[] } {
  return buildScopeWhereEmployees(scope, tableAlias);
}
