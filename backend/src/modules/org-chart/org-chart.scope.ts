import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export type OrgChartScope = "my-chain" | "my-team" | "process" | "branch" | "company";

export interface ScopeResolution {
  scopeType: OrgChartScope;
  scopeId: string | null;
  scopeName: string;
  employeeCount: number;
  canExport: boolean;
  canSeeDataQuality: boolean;
}

export interface UserOrgContext {
  userId: string;
  employeeId: string | null;
  roles: string[];
  branchId: string | null;
  branchName: string | null;
  processId: string | null;
  processName: string | null;
  departmentId: string | null;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isHr: boolean;
  isCeo: boolean;
  isBranchHead: boolean;
  isProcessManager: boolean;
  isWfm: boolean;
  isTeamLeader: boolean;
  availableScopes: ScopeResolution[];
  defaultScope: OrgChartScope;
}

/**
 * Resolve user's org-chart context and available scopes.
 * This is the foundation for all org-chart access control.
 */
export async function resolveUserOrgContext(userId: string): Promise<UserOrgContext> {
  // Fetch user roles
  const [roleRows] = await db.execute<RowDataPacket[]>(
    "SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1",
    [userId]
  );
  const roles = (roleRows as { role_key: string }[]).map((r) => r.role_key);
  const roleSet = new Set(roles);

  const isSuperAdmin = roleSet.has("super_admin");
  const isAdmin = roleSet.has("admin");
  const isHr = roleSet.has("hr");
  const isCeo = roleSet.has("ceo");
  const isBranchHead = roleSet.has("branch_head");
  const isProcessManager = roleSet.has("process_manager") || roleSet.has("manager");
  const isWfm = roleSet.has("wfm") || roleSet.has("operations_manager");
  const isTeamLeader = roleSet.has("team_leader") || roleSet.has("tl") || roleSet.has("assistant_manager");

  // Fetch employee record
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.branch_id, e.process_id, e.department_id,
            b.branch_name, p.process_name
       FROM employees e
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
      WHERE e.user_id = ? AND e.active_status = 1
      LIMIT 1`,
    [userId]
  );
  const emp = (empRows as any[])[0];

  const employeeId = emp?.id ?? null;
  const branchId = emp?.branch_id ?? null;
  const branchName = emp?.branch_name ?? null;
  const processId = emp?.process_id ?? null;
  const processName = emp?.process_name ?? null;
  const departmentId = emp?.department_id ?? null;

  // Determine available scopes
  const availableScopes: ScopeResolution[] = [];

  // 1. my-chain (always available for employees)
  if (employeeId) {
    const chainCount = await getMyChainCount(employeeId);
    availableScopes.push({
      scopeType: "my-chain",
      scopeId: employeeId,
      scopeName: "My Reporting Chain",
      employeeCount: chainCount,
      canExport: false,
      canSeeDataQuality: false,
    });
  }

  // 2. my-team (available for team leaders / managers with direct reports)
  if (employeeId && (isTeamLeader || isProcessManager || isBranchHead)) {
    const teamCount = await getMyTeamCount(employeeId);
    if (teamCount > 0) {
      availableScopes.push({
        scopeType: "my-team",
        scopeId: employeeId,
        scopeName: "My Team",
        employeeCount: teamCount,
        canExport: false,
        canSeeDataQuality: false,
      });
    }
  }

  // 3. process (available for process_manager, wfm, or full-access roles)
  if (processId && (isProcessManager || isWfm || isSuperAdmin || isAdmin || isHr || isCeo)) {
    const processCount = await getScopeCount("process", processId);
    availableScopes.push({
      scopeType: "process",
      scopeId: processId,
      scopeName: processName ?? "Process",
      employeeCount: processCount,
      canExport: false,
      canSeeDataQuality: false,
    });
  }

  // 4. branch (available for branch_head or full-access roles)
  if (branchId && (isBranchHead || isSuperAdmin || isAdmin || isHr || isCeo)) {
    const branchCount = await getScopeCount("branch", branchId);
    availableScopes.push({
      scopeType: "branch",
      scopeId: branchId,
      scopeName: branchName ?? "Branch",
      employeeCount: branchCount,
      canExport: false,
      canSeeDataQuality: false,
    });
  }

  // 5. company (available for super_admin, admin, hr, ceo)
  if (isSuperAdmin || isAdmin || isHr || isCeo) {
    const companyCount = await getScopeCount("company", null);
    availableScopes.push({
      scopeType: "company",
      scopeId: null,
      scopeName: "Company-wide",
      employeeCount: companyCount,
      canExport: true,
      canSeeDataQuality: true,
    });
  }

  // Default scope: largest available scope
  let defaultScope: OrgChartScope = "my-chain";
  if (availableScopes.length > 0) {
    // Prefer: company > branch > process > my-team > my-chain
    const scopePriority: OrgChartScope[] = ["company", "branch", "process", "my-team", "my-chain"];
    for (const s of scopePriority) {
      if (availableScopes.some((sc) => sc.scopeType === s)) {
        defaultScope = s;
        break;
      }
    }
  }

  return {
    userId,
    employeeId,
    roles,
    branchId,
    branchName,
    processId,
    processName,
    departmentId,
    isSuperAdmin,
    isAdmin,
    isHr,
    isCeo,
    isBranchHead,
    isProcessManager,
    isWfm,
    isTeamLeader,
    availableScopes,
    defaultScope,
  };
}

/**
 * Count employees in "my-chain" scope (self + upward chain + direct reports).
 */
async function getMyChainCount(employeeId: string): Promise<number> {
  // Upward chain
  const upwardIds = await getManagerChain(employeeId);
  // Direct reports
  const [directRows] = await db.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS cnt FROM employees WHERE reporting_manager_id = ? AND active_status = 1",
    [employeeId]
  );
  const directCount = (directRows as any[])[0]?.cnt ?? 0;
  return upwardIds.length + 1 + directCount; // chain + self + direct reports
}

/**
 * Count employees in "my-team" scope (direct reports only).
 */
async function getMyTeamCount(employeeId: string): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS cnt FROM employees WHERE reporting_manager_id = ? AND active_status = 1",
    [employeeId]
  );
  return (rows as any[])[0]?.cnt ?? 0;
}

/**
 * Count employees in a given scope.
 */
async function getScopeCount(scopeType: string, scopeId: string | null): Promise<number> {
  if (scopeType === "company") {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS cnt FROM employees WHERE active_status = 1"
    );
    return (rows as any[])[0]?.cnt ?? 0;
  }
  if (scopeType === "branch") {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS cnt FROM employees WHERE branch_id = ? AND active_status = 1",
      [scopeId]
    );
    return (rows as any[])[0]?.cnt ?? 0;
  }
  if (scopeType === "process") {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS cnt FROM employees WHERE process_id = ? AND active_status = 1",
      [scopeId]
    );
    return (rows as any[])[0]?.cnt ?? 0;
  }
  return 0;
}

/**
 * Get upward manager chain for an employee (does not include self).
 */
export async function getManagerChain(employeeId: string): Promise<string[]> {
  const chain: string[] = [];
  const visited = new Set<string>();
  let currentId: string | null = employeeId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT reporting_manager_id FROM employees WHERE id = ? AND active_status = 1 LIMIT 1",
      [currentId]
    );
    const managerId = (rows as any[])[0]?.reporting_manager_id ?? null;
    if (managerId && managerId !== currentId) {
      chain.push(managerId);
      currentId = managerId;
    } else {
      break;
    }
    // Safety: max 20 levels to prevent infinite loop
    if (chain.length > 20) break;
  }
  return chain;
}

/**
 * Build WHERE clause for employee query based on scope.
 */
export function buildScopeWhereClause(
  ctx: UserOrgContext,
  requestedScope: OrgChartScope,
  filters: {
    branchId?: string;
    processId?: string;
    departmentId?: string;
    designationId?: string;
    status?: string;
  }
): { sql: string; params: unknown[] } {
  const wheres: string[] = [];
  const params: unknown[] = [];

  // Base: active employees only (unless status=all)
  if (filters.status === "inactive") {
    wheres.push("e.active_status = 0");
  } else if (filters.status === "all") {
    // No filter
  } else {
    wheres.push("e.active_status = 1");
  }

  // Scope enforcement
  if (requestedScope === "my-chain" && ctx.employeeId) {
    const chainIds = `SELECT id FROM employees WHERE id = ? UNION SELECT reporting_manager_id FROM employees WHERE id = ? UNION SELECT id FROM employees WHERE reporting_manager_id = ?`;
    wheres.push(`e.id IN (${chainIds})`);
    params.push(ctx.employeeId, ctx.employeeId, ctx.employeeId);
  } else if (requestedScope === "my-team" && ctx.employeeId) {
    wheres.push("(e.id = ? OR e.reporting_manager_id = ?)");
    params.push(ctx.employeeId, ctx.employeeId);
  } else if (requestedScope === "process") {
    if (filters.processId) {
      wheres.push("e.process_id = ?");
      params.push(filters.processId);
    } else if (ctx.processId) {
      wheres.push("e.process_id = ?");
      params.push(ctx.processId);
    }
  } else if (requestedScope === "branch") {
    if (filters.branchId) {
      wheres.push("e.branch_id = ?");
      params.push(filters.branchId);
    } else if (ctx.branchId) {
      wheres.push("e.branch_id = ?");
      params.push(ctx.branchId);
    }
  } else if (requestedScope === "company") {
    // No additional filter — all active employees
  }

  // Additional filters
  if (filters.branchId && requestedScope === "company") {
    wheres.push("e.branch_id = ?");
    params.push(filters.branchId);
  }
  if (filters.processId && ["company", "branch"].includes(requestedScope)) {
    wheres.push("e.process_id = ?");
    params.push(filters.processId);
  }
  if (filters.departmentId) {
    wheres.push("e.department_id = ?");
    params.push(filters.departmentId);
  }
  if (filters.designationId) {
    wheres.push("e.designation_id = ?");
    params.push(filters.designationId);
  }

  return {
    sql: wheres.length > 0 ? wheres.join(" AND ") : "1=1",
    params,
  };
}

/**
 * Verify that a user can access a given scope.
 */
export async function assertScopeAccess(
  userId: string,
  requestedScope: OrgChartScope
): Promise<UserOrgContext> {
  const ctx = await resolveUserOrgContext(userId);
  const allowed = ctx.availableScopes.some((s) => s.scopeType === requestedScope);
  if (!allowed) {
    const err = new Error(`Forbidden: scope '${requestedScope}' not available for this user`) as Error & {
      statusCode?: number;
    };
    err.statusCode = 403;
    throw err;
  }
  return ctx;
}
