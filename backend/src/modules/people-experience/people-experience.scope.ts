import type { RowDataPacket } from "mysql2";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";

export type PeopleExperienceScopeKind = "global" | "branch" | "process" | "team" | "self";

export interface PeopleExperienceScope {
  kind: PeopleExperienceScopeKind;
  label: string;
  userId: string;
  employeeId: string | null;
  roles: string[];
  canSeeConfidentialGrievanceIdentity: boolean;
  canManageGrievances: boolean;
}

const GLOBAL_ROLES = new Set(["super_admin", "admin", "hr", "ceo"]);
const GRIEVANCE_MANAGER_ROLES = new Set(["super_admin", "admin", "hr", "grievance_officer"]);

async function getUserRoles(userId: string): Promise<string[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1",
    [userId]
  );
  return rows.map((row: any) => String(row.role_key));
}

function hasAny(roles: string[], allowed: Set<string>): boolean {
  return roles.some((role) => allowed.has(role));
}

export async function resolvePeopleExperienceScope(req: AuthenticatedRequest): Promise<PeopleExperienceScope> {
  const userId = req.authUser!.id;
  const roles = await getUserRoles(userId);
  const employee = await getEmployeeForUser(userId);
  const canSeeConfidentialGrievanceIdentity = hasAny(roles, GRIEVANCE_MANAGER_ROLES);
  const canManageGrievances = canSeeConfidentialGrievanceIdentity;

  if (hasAny(roles, GLOBAL_ROLES)) {
    return {
      kind: "global",
      label: "Global View",
      userId,
      employeeId: employee?.id ?? null,
      roles,
      canSeeConfidentialGrievanceIdentity,
      canManageGrievances,
    };
  }

  if (roles.includes("branch_head")) {
    return {
      kind: "branch",
      label: "Branch Scoped",
      userId,
      employeeId: employee?.id ?? null,
      roles,
      canSeeConfidentialGrievanceIdentity,
      canManageGrievances,
    };
  }

  if (roles.includes("process_manager") || roles.includes("manager")) {
    return {
      kind: "process",
      label: roles.includes("process_manager") ? "Process Scoped" : "My Team",
      userId,
      employeeId: employee?.id ?? null,
      roles,
      canSeeConfidentialGrievanceIdentity,
      canManageGrievances,
    };
  }

  if (roles.includes("team_leader") || roles.includes("tl")) {
    return {
      kind: "team",
      label: "My Team",
      userId,
      employeeId: employee?.id ?? null,
      roles,
      canSeeConfidentialGrievanceIdentity,
      canManageGrievances,
    };
  }

  return {
    kind: "self",
    label: "My Data",
    userId,
    employeeId: employee?.id ?? null,
    roles,
    canSeeConfidentialGrievanceIdentity,
    canManageGrievances,
  };
}

export function buildEmployeeScopeCondition(scope: PeopleExperienceScope, alias = "e"): { sql: string; params: unknown[] } {
  if (scope.kind === "global") return { sql: "1 = 1", params: [] };
  if (scope.kind === "self") {
    return scope.employeeId
      ? { sql: `${alias}.id = ?`, params: [scope.employeeId] }
      : { sql: "1 = 0", params: [] };
  }

  const params: unknown[] = [];
  const clauses: string[] = [];

  if (scope.employeeId && (scope.kind === "team" || scope.kind === "process")) {
    clauses.push(`${alias}.reporting_manager_id = ?`);
    params.push(scope.employeeId);
  }

  if (scope.kind === "branch") {
    clauses.push(
      `EXISTS (
        SELECT 1 FROM user_assignment_scope uas
        WHERE uas.user_id = ?
          AND uas.active_status = 1
          AND uas.role_key IN ('branch_head')
          AND (
            uas.scope_type = 'all'
            OR (uas.scope_type = 'branch' AND uas.branch_id = ${alias}.branch_id)
          )
      )`
    );
    params.push(scope.userId);
  }

  if (scope.kind === "process" || scope.kind === "team") {
    clauses.push(
      `EXISTS (
        SELECT 1 FROM user_assignment_scope uas
        WHERE uas.user_id = ?
          AND uas.active_status = 1
          AND uas.role_key IN ('process_manager','manager','team_leader','tl')
          AND (
            uas.scope_type = 'all'
            OR (
              uas.scope_type IN ('process','team')
              AND uas.process_id = ${alias}.process_id
              AND (uas.branch_id IS NULL OR uas.branch_id = ${alias}.branch_id)
            )
            OR (
              uas.scope_type = 'branch'
              AND uas.branch_id = ${alias}.branch_id
            )
          )
      )`
    );
    params.push(scope.userId);
  }

  return clauses.length > 0 ? { sql: `(${clauses.join(" OR ")})`, params } : { sql: "1 = 0", params: [] };
}

export async function canViewEngagementEmployee(req: AuthenticatedRequest, employeeId: string): Promise<boolean> {
  const scope = await resolvePeopleExperienceScope(req);
  const scoped = buildEmployeeScopeCondition(scope, "e");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id FROM employees e WHERE e.id = ? AND ${scoped.sql} LIMIT 1`,
    [employeeId, ...scoped.params]
  );
  return rows.length > 0;
}

export function canManageGrievance(scope: PeopleExperienceScope): boolean {
  return scope.canManageGrievances;
}

export async function canViewGrievance(req: AuthenticatedRequest, grievanceId: string): Promise<boolean> {
  const scope = await resolvePeopleExperienceScope(req);
  if (scope.canManageGrievances) return true;
  if (!scope.employeeId) return false;

  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT employee_id FROM grievance WHERE id = ? LIMIT 1",
    [grievanceId]
  );
  const row = rows[0] as any;
  return !!row && String(row.employee_id) === scope.employeeId;
}
