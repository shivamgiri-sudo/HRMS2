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

const ORG_ALL_ROLES = new Set([
  "super_admin", "admin", "ceo", "coo", "management", "hr", "hr_admin",
  "payroll_hr", "payroll", "payroll_admin", "finance", "ho_hr", "ho_payroll",
  "ho_operations", "finance_head", "payroll_head", "compliance_head", "ho_it",
  "ho_wfm", "ho_rta",
]);

const BRANCH_ALL_ROLES = new Set([
  "branch_head", "bm", "branch_manager", "hr_branch", "branch_hr",
  "branch_finance", "branch_it", "payroll_branch",
]);

const PROCESS_ALL_ROLES = new Set([
  "manager", "process_manager", "assistant_manager", "team_leader", "team_lead",
  "tl", "wfm", "wfm_spoc", "rta", "qa_manager", "process_hr", "quality_analyst",
]);

const SELF_ONLY_ROLES = new Set(["employee", "agent", "trainee"]);

function unique(values: unknown[]): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

async function resolveEmployeeScope(userId: string): Promise<{ branchIds: string[]; processIds: string[] }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT branch_id, process_id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1`,
    [userId],
  ).catch(() => [[]] as any);
  const row = rows[0] as RowDataPacket | undefined;
  return { branchIds: unique([row?.branch_id]), processIds: unique([row?.process_id]) };
}

async function assignedBranches(userId: string): Promise<string[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT branch_id FROM employee_branch_assignment WHERE user_id = ? AND is_active = 1
     UNION
     SELECT branch_id FROM employees WHERE user_id = ? AND active_status = 1 AND branch_id IS NOT NULL`,
    [userId, userId],
  ).catch(() => [[]] as any);
  return unique(rows.map((row) => row.branch_id));
}

async function assignedProcesses(userId: string): Promise<{ processIds: string[]; branchIds: string[] }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT process_id FROM employee_process_assignment WHERE user_id = ? AND is_active = 1
     UNION
     SELECT process_id FROM employees WHERE user_id = ? AND active_status = 1 AND process_id IS NOT NULL`,
    [userId, userId],
  ).catch(() => [[]] as any);
  const processIds = unique(rows.map((row) => row.process_id));
  if (processIds.length === 0) return { processIds: [], branchIds: [] };

  const [branchRows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT branch_id FROM employees
      WHERE process_id IN (${processIds.map(() => "?").join(",")})
        AND branch_id IS NOT NULL AND active_status = 1`,
    processIds,
  ).catch(() => [[]] as any);
  return { processIds, branchIds: unique(branchRows.map((row) => row.branch_id)) };
}

export async function resolveDashboardScope(userId: string, _role: string): Promise<DashboardScope> {
  const context = await getUserRoleContext(userId);
  const effectiveRole = String(context.primaryRole ?? "employee").trim().toLowerCase();

  if (ORG_ALL_ROLES.has(effectiveRole)) {
    return { level: "ORG_ALL", branchIds: [], processIds: [], userId, role: effectiveRole };
  }

  if (BRANCH_ALL_ROLES.has(effectiveRole)) {
    const branchIds = await assignedBranches(userId);
    if (branchIds.length > 0) return { level: "BRANCH_ALL", branchIds, processIds: [], userId, role: effectiveRole };
    console.warn(`[dashboardScope] ${effectiveRole} has no branch assignment; denying organisation-wide access`);
    return { level: "SELF_ONLY", branchIds: [], processIds: [], userId, role: effectiveRole };
  }

  if (PROCESS_ALL_ROLES.has(effectiveRole)) {
    const assigned = await assignedProcesses(userId);
    if (assigned.processIds.length > 0) {
      return { level: "PROCESS_ALL", branchIds: assigned.branchIds, processIds: assigned.processIds, userId, role: effectiveRole };
    }
    const own = await resolveEmployeeScope(userId);
    if (own.processIds.length > 0) {
      return { level: "PROCESS_ALL", branchIds: own.branchIds, processIds: own.processIds, userId, role: effectiveRole };
    }
    console.warn(`[dashboardScope] ${effectiveRole} has no process assignment; using team-only scope`);
    return { level: "TEAM_ONLY", branchIds: own.branchIds, processIds: [], userId, role: effectiveRole };
  }

  if (SELF_ONLY_ROLES.has(effectiveRole)) {
    const own = await resolveEmployeeScope(userId);
    return { level: "SELF_ONLY", ...own, userId, role: effectiveRole };
  }

  const own = await resolveEmployeeScope(userId);
  return { level: "SELF_ONLY", ...own, userId, role: effectiveRole };
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
      `SELECT id FROM branch_master WHERE id = ? AND active_status = 1 LIMIT 1`, [branchId],
    ).catch(() => [[]] as any);
    if (rows.length === 0) return deny();
  }

  if (processId) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM process_master WHERE id = ? AND active_status = 1 LIMIT 1`, [processId],
    ).catch(() => [[]] as any);
    if (rows.length === 0) return deny();
  }

  if (scope.level === "BRANCH_ALL" && processId) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT 1 FROM employees
        WHERE process_id = ? AND branch_id IN (${scope.branchIds.map(() => "?").join(",")})
          AND active_status = 1 LIMIT 1`,
      [processId, ...scope.branchIds],
    ).catch(() => [[]] as any);
    if (rows.length === 0) return deny();
  }

  if (scope.level === "PROCESS_ALL" && branchId) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT 1 FROM employees
        WHERE branch_id = ? AND process_id IN (${scope.processIds.map(() => "?").join(",")})
          AND active_status = 1 LIMIT 1`,
      [branchId, ...scope.processIds],
    ).catch(() => [[]] as any);
    if (rows.length === 0) return deny();
  }

  if (branchId && processId) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT 1 FROM employees WHERE branch_id = ? AND process_id = ? AND active_status = 1 LIMIT 1`,
      [branchId, processId],
    ).catch(() => [[]] as any);
    if (rows.length === 0) return deny();
  }

  return { ...scope, level: "CUSTOM_SCOPE", branchIds: branchId ? [branchId] : [], processIds: processId ? [processId] : [] };
}

export function buildScopeWhere(
  scope: DashboardScope,
  branchCol = "branch_id",
  processCol = "process_id",
): { sql: string; params: string[] } {
  if (scope.level === "ORG_ALL") return { sql: "1=1", params: [] };

  if (scope.level === "BRANCH_ALL") {
    if (scope.branchIds.length === 0) return { sql: "1=0", params: [] };
    return { sql: `${branchCol} IN (${scope.branchIds.map(() => "?").join(",")})`, params: [...scope.branchIds] };
  }

  if (scope.level === "PROCESS_ALL") {
    // Branch filter lists use branch_master as the source. For process-scoped
    // users, expose only branches that actually contain their assigned processes.
    if (branchCol === "bm.id" && scope.branchIds.length > 0) {
      return { sql: `${branchCol} IN (${scope.branchIds.map(() => "?").join(",")})`, params: [...scope.branchIds] };
    }
    if (scope.processIds.length === 0) return { sql: "1=0", params: [] };
    return { sql: `${processCol} IN (${scope.processIds.map(() => "?").join(",")})`, params: [...scope.processIds] };
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
      sql: `(${alias}.reporting_manager_id IN (SELECT id FROM employees WHERE user_id = ?) OR ${alias}.manager_id IN (SELECT id FROM employees WHERE user_id = ?))`,
      params: [scope.userId, scope.userId],
    };
  }
  return buildScopeWhere(scope, `${alias}.branch_id`, `${alias}.process_id`);
}

export function scopeToSqlWhere(scope: DashboardScope, tableAlias = "e"): { sql: string; params: any[] } {
  return buildScopeWhereEmployees(scope, tableAlias);
}
