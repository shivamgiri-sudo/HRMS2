import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";

export type ScopeType =
  | "all"
  | "branch"
  | "process"
  | "branch_process"
  | "lob"
  | "department"
  | "team"
  | "self";

export interface AssignmentScope {
  id: string;
  role_key: string;
  scope_type: ScopeType | string;
  branch_id: string | null;
  process_id: string | null;
  lob_id: string | null;
  department_id: string | null;
  manager_employee_id: string | null;
}

export interface ScopeTarget {
  branchId?: string | null;
  processId?: string | null;
  lobId?: string | null;
  departmentId?: string | null;
  managerEmployeeId?: string | null;
  employeeId?: string | null;
}

export interface ScopeAliases {
  branchId?: string;
  processId?: string;
  lobId?: string;
  departmentId?: string;
  managerEmployeeId?: string;
  employeeId?: string;
}

export async function getUserRoleKeys(userId: string): Promise<string[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1",
    [userId]
  );
  return (rows as RowDataPacket[]).map((r: any) => String(r.role_key));
}

export async function hasAnyRole(userId: string, ...roles: string[]): Promise<boolean> {
  if (roles.length === 0) return false;
  const userRoles = await getUserRoleKeys(userId);
  if (userRoles.includes("super_admin")) return true;
  return roles.some((role) => userRoles.includes(role));
}

export async function getUserAssignmentScopes(
  userId: string,
  roles: string[] = []
): Promise<AssignmentScope[]> {
  const params: unknown[] = [userId];
  let roleFilter = "";
  if (roles.length > 0) {
    roleFilter = ` AND role_key IN (${roles.map(() => "?").join(",")})`;
    params.push(...roles);
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, role_key, scope_type, branch_id, process_id, lob_id, department_id, manager_employee_id
       FROM user_assignment_scope
      WHERE user_id = ?
        AND active_status = 1
        ${roleFilter}`,
    params
  );

  return rows as AssignmentScope[];
}

/**
 * Generic scoped access decision.
 *
 * Pattern:
 * - Keep role_key generic: wfm, qa, recruiter, process_manager, branch_head, etc.
 * - Restrict data through user_assignment_scope.
 * - Admin can bypass scope only when allowAdminBypass=true.
 * - CEO can be allowed read-only by passing ceo in allowedRoles and assigning scope_type=all.
 */
export async function hasScopedAccess(
  userId: string,
  allowedRoles: string[],
  target: ScopeTarget,
  options: { allowAdminBypass?: boolean; requireScopeForNonAdmin?: boolean } = {}
): Promise<boolean> {
  const allowAdminBypass = options.allowAdminBypass ?? false;
  const requireScopeForNonAdmin = options.requireScopeForNonAdmin ?? true;

  // super_admin bypasses all scope checks unconditionally
  if (await hasAnyRole(userId, "super_admin")) return true;
  if (allowAdminBypass && await hasAnyRole(userId, "admin")) return true;
  if (!(await hasAnyRole(userId, ...allowedRoles))) return false;

  const scopes = await getUserAssignmentScopes(userId, allowedRoles);

  if (scopes.length === 0) {
    return !requireScopeForNonAdmin;
  }

  for (const scope of scopes) {
    if (scope.scope_type === "all") return true;

    if (
      scope.scope_type === "branch" &&
      scope.branch_id &&
      target.branchId &&
      scope.branch_id === target.branchId
    ) return true;

    if (
      scope.scope_type === "process" &&
      scope.process_id &&
      target.processId &&
      scope.process_id === target.processId &&
      (!scope.branch_id || !target.branchId || scope.branch_id === target.branchId)
    ) return true;

    if (
      scope.scope_type === "branch_process" &&
      scope.branch_id &&
      scope.process_id &&
      target.branchId &&
      target.processId &&
      scope.branch_id === target.branchId &&
      scope.process_id === target.processId
    ) return true;

    if (
      scope.scope_type === "lob" &&
      scope.lob_id &&
      target.lobId &&
      scope.lob_id === target.lobId &&
      (!scope.branch_id || !target.branchId || scope.branch_id === target.branchId) &&
      (!scope.process_id || !target.processId || scope.process_id === target.processId)
    ) return true;

    if (
      scope.scope_type === "department" &&
      scope.department_id &&
      target.departmentId &&
      scope.department_id === target.departmentId
    ) return true;

    if (
      scope.scope_type === "team" &&
      scope.manager_employee_id &&
      target.managerEmployeeId &&
      scope.manager_employee_id === target.managerEmployeeId
    ) return true;

    if (
      scope.scope_type === "self" &&
      target.employeeId
    ) {
      const [empRows] = await db.execute<RowDataPacket[]>(
        "SELECT id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1",
        [userId]
      );
      const emp = (empRows as RowDataPacket[])[0] as any;
      if (emp?.id === target.employeeId) return true;
    }
  }

  return false;
}

/**
 * Build WHERE clause for list APIs.
 *
 * Usage:
 * const scoped = await buildScopeWhereClause(req.authUser!.id, ["wfm"], {
 *   branchId: "rp.branch_id",
 *   processId: "rp.process_id"
 * });
 * sql += ` AND (${scoped.sql})`;
 * params.push(...scoped.params);
 */
export async function buildScopeWhereClause(
  userId: string,
  allowedRoles: string[],
  aliases: ScopeAliases,
  options: { allowAdminBypass?: boolean; allowCeoAllRead?: boolean } = {}
): Promise<{ sql: string; params: unknown[] }> {
  const allowAdminBypass = options.allowAdminBypass ?? false;
  const allowCeoAllRead = options.allowCeoAllRead ?? false;

  // super_admin always sees everything
  if (await hasAnyRole(userId, "super_admin")) {
    return { sql: "1=1", params: [] };
  }

  if (allowAdminBypass && await hasAnyRole(userId, "admin")) {
    return { sql: "1=1", params: [] };
  }

  if (allowCeoAllRead && await hasAnyRole(userId, "ceo")) {
    return { sql: "1=1", params: [] };
  }

  if (!(await hasAnyRole(userId, ...allowedRoles))) {
    return { sql: "1=0", params: [] };
  }

  const scopes = await getUserAssignmentScopes(userId, allowedRoles);
  if (scopes.length === 0) {
    return { sql: "1=0", params: [] };
  }

  const ors: string[] = [];
  const params: unknown[] = [];

  for (const s of scopes) {
    if (s.scope_type === "all") {
      ors.push("1=1");
      continue;
    }

    if (s.scope_type === "branch" && s.branch_id && aliases.branchId) {
      ors.push(`${aliases.branchId} = ?`);
      params.push(s.branch_id);
      continue;
    }

    if (s.scope_type === "process" && s.process_id && aliases.processId) {
      const parts = [`${aliases.processId} = ?`];
      params.push(s.process_id);
      if (s.branch_id && aliases.branchId) {
        parts.push(`${aliases.branchId} = ?`);
        params.push(s.branch_id);
      }
      ors.push(`(${parts.join(" AND ")})`);
      continue;
    }

    if (s.scope_type === "branch_process" && s.branch_id && s.process_id && aliases.branchId && aliases.processId) {
      ors.push(`(${aliases.branchId} = ? AND ${aliases.processId} = ?)`);
      params.push(s.branch_id, s.process_id);
      continue;
    }

    if (s.scope_type === "lob" && s.lob_id && aliases.lobId) {
      const parts = [`${aliases.lobId} = ?`];
      params.push(s.lob_id);
      if (s.branch_id && aliases.branchId) {
        parts.push(`${aliases.branchId} = ?`);
        params.push(s.branch_id);
      }
      if (s.process_id && aliases.processId) {
        parts.push(`${aliases.processId} = ?`);
        params.push(s.process_id);
      }
      ors.push(`(${parts.join(" AND ")})`);
      continue;
    }

    if (s.scope_type === "department" && s.department_id && aliases.departmentId) {
      ors.push(`${aliases.departmentId} = ?`);
      params.push(s.department_id);
      continue;
    }

    if (s.scope_type === "team" && s.manager_employee_id && aliases.managerEmployeeId) {
      ors.push(`${aliases.managerEmployeeId} = ?`);
      params.push(s.manager_employee_id);
      continue;
    }
  }

  if (ors.length === 0) {
    return { sql: "1=0", params: [] };
  }

  return { sql: ors.join(" OR "), params };
}

export async function assertScopedAccessOrThrow(
  userId: string,
  allowedRoles: string[],
  target: ScopeTarget,
  message = "Forbidden: outside assigned scope"
): Promise<void> {
  const ok = await hasScopedAccess(userId, allowedRoles, target);
  if (!ok) {
    const err = new Error(message) as Error & { statusCode?: number };
    err.statusCode = 403;
    throw err;
  }
}

// ─── Custom Error Classes ─────────────────────────────────────────────────────

export class AccessDeniedError extends Error {
  statusCode = 403;
  constructor(message = "Forbidden") {
    super(message);
  }
}

export class BadRequestAccessError extends Error {
  statusCode = 400;
  constructor(message = "Bad request") {
    super(message);
  }
}

// ─── Roster-Specific Scope Helpers ────────────────────────────────────────────

export async function getRosterPlanScope(planId: string): Promise<ScopeTarget & { planStatus: string | null } | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT process_id, branch_id, plan_status
       FROM wfm_roster_plan
      WHERE id = ?
      LIMIT 1`,
    [planId]
  );
  const row = (rows as RowDataPacket[])[0] as Record<string, unknown>;
  if (!row) return null;
  return {
    processId: (row.process_id as string) ?? null,
    branchId: (row.branch_id as string) ?? null,
    planStatus: (row.plan_status as string) ?? null,
  };
}

export async function getRosterAssignmentScope(assignmentId: string): Promise<(ScopeTarget & { planStatus: string | null }) | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT rp.process_id, rp.branch_id, rp.plan_status
       FROM wfm_roster_assignment ra
       LEFT JOIN wfm_roster_plan rp ON rp.id = ra.plan_id
      WHERE ra.id = ?
      LIMIT 1`,
    [assignmentId]
  );
  const row = (rows as RowDataPacket[])[0] as Record<string, unknown>;
  if (!row) return null;
  return {
    processId: (row.process_id as string) ?? null,
    branchId: (row.branch_id as string) ?? null,
    planStatus: (row.plan_status as string) ?? null,
  };
}
