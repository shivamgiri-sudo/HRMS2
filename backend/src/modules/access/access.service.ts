import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import type { Request } from "express";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

export interface RbacMismatch {
  user_id: string;
  mysql_roles: string[];
  supabase_roles: string[];
  in_supabase_only: string[];
  in_mysql_only: string[];
}

export interface ReconciliationReport {
  total_mysql_users: number;
  total_supabase_users: number;
  mismatches: RbacMismatch[];
  checked_at: string;
}

/**
 * Read-only RBAC reconciliation.
 * Compares MySQL user_roles (backend authority) against Supabase user_roles (UI mirror).
 * No writes, no auto-fix, no backfill, no permission elevation.
 */
export async function getRbacReconciliation(): Promise<ReconciliationReport> {
  // 1. Fetch all active MySQL user_roles
  const [mysqlRows] = await db.execute<RowDataPacket[]>(
    "SELECT user_id, role_key FROM user_roles WHERE active_status = 1 ORDER BY user_id"
  );

  const mysqlByUser = new Map<string, string[]>();
  for (const row of mysqlRows as { user_id: string; role_key: string }[]) {
    const existing = mysqlByUser.get(row.user_id) ?? [];
    existing.push(row.role_key);
    mysqlByUser.set(row.user_id, existing);
  }

  // 2. Supabase removed — reconciliation compares MySQL vs MySQL (single source of truth).
  // Returns empty mismatch list since there is only one authoritative store.
  const sbByUser = new Map<string, string[]>();

  // 3. Union of all user_ids
  const allUsers = new Set([...mysqlByUser.keys(), ...sbByUser.keys()]);

  const mismatches: RbacMismatch[] = [];

  for (const userId of allUsers) {
    const mysqlRoles = mysqlByUser.get(userId) ?? [];
    const sbRoles = sbByUser.get(userId) ?? [];

    const inSbOnly = sbRoles.filter((r) => !mysqlRoles.includes(r));
    const inMysqlOnly = mysqlRoles.filter((r) => !sbRoles.includes(r));

    if (inSbOnly.length > 0 || inMysqlOnly.length > 0) {
      mismatches.push({
        user_id: userId,
        mysql_roles: mysqlRoles,
        supabase_roles: sbRoles,
        in_supabase_only: inSbOnly,
        in_mysql_only: inMysqlOnly,
      });
    }
  }

  return {
    total_mysql_users: mysqlByUser.size,
    total_supabase_users: sbByUser.size,
    mismatches,
    checked_at: new Date().toISOString(),
  };
}

// ── Role administration (MySQL-authoritative writes) ─────────────────────────

export async function assignRole(userId: string, roleKey: string, actorUserId: string, req?: Request): Promise<void> {
  const [catalog] = await db.execute<RowDataPacket[]>(
    "SELECT role_key FROM workforce_role_catalog WHERE role_key = ? AND active_status = 1 LIMIT 1",
    [roleKey]
  );
  if ((catalog as RowDataPacket[]).length === 0) {
    throw Object.assign(new Error(`Role not in catalog: ${roleKey}`), { statusCode: 400 });
  }
  await db.execute(
    "INSERT INTO user_roles (id, user_id, role_key, active_status) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE active_status = 1",
    [randomUUID(), userId, roleKey]
  );
  await logSensitiveAction({ actor_user_id: actorUserId, action_type: "ROLE_ASSIGNED", module_key: "ACCESS_CONTROL", entity_type: "user", entity_id: userId, change_summary: { role_key: roleKey }, req });
}

export async function revokeRole(userId: string, roleKey: string, actorUserId: string, req?: Request): Promise<void> {
  await db.execute(
    "UPDATE user_roles SET active_status = 0 WHERE user_id = ? AND role_key = ?",
    [userId, roleKey]
  );
  await logSensitiveAction({ actor_user_id: actorUserId, action_type: "ROLE_REVOKED", module_key: "ACCESS_CONTROL", entity_type: "user", entity_id: userId, change_summary: { role_key: roleKey }, req });
}

export async function getUserRoles(userId: string): Promise<{ role_key: string; role_name: string }[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ur.role_key, wrc.role_name FROM user_roles ur
     JOIN workforce_role_catalog wrc ON wrc.role_key = ur.role_key
     WHERE ur.user_id = ? AND ur.active_status = 1 ORDER BY ur.role_key`,
    [userId]
  );
  return rows as { role_key: string; role_name: string }[];
}

export async function listRoleCatalog() {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT role_key, role_name, description FROM workforce_role_catalog WHERE active_status = 1 ORDER BY role_key"
  );
  return rows as RowDataPacket[];
}

// ── Sensitive action log query (admin only) ───────────────────────────────────

export async function querySensitiveActionLog(filters: {
  actor_user_id?: string; module_key?: string; action_type?: string;
  entity_type?: string; entity_id?: string; limit?: number;
}) {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (filters.actor_user_id) { conds.push("actor_user_id = ?"); params.push(filters.actor_user_id); }
  if (filters.module_key)    { conds.push("module_key = ?");    params.push(filters.module_key); }
  if (filters.action_type)   { conds.push("action_type = ?");   params.push(filters.action_type); }
  if (filters.entity_type)   { conds.push("entity_type = ?");   params.push(filters.entity_type); }
  if (filters.entity_id)     { conds.push("entity_id = ?");     params.push(filters.entity_id); }
  const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
  const limit = Math.min(filters.limit ?? 100, 500);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, actor_user_id, action_type, module_key, entity_type, entity_id, ip_address, change_summary, acted_at
     FROM sensitive_action_log ${where} ORDER BY acted_at DESC LIMIT ${limit}`,
    params
  );
  return rows as RowDataPacket[];
}

// ── /api/access/me — single source of truth for frontend RBAC ────────────────

export interface AccessMeResponse {
  userId: string;
  email: string | undefined;
  employeeId: string | null;
  employeeCode: string | null;
  employeeName: string | null;
  employee: {
    id: string;
    employee_code: string;
    first_name: string;
    last_name: string | null;
    full_name: string | null;
  } | null;
  roles: string[];
  scopes: Array<{
    id: string; role_key: string; scope_type: string;
    branch_id: string | null; process_id: string | null;
    lob_id: string | null; department_id: string | null;
    manager_employee_id: string | null;
  }>;
  pages: Array<{
    page_code: string; can_view: boolean; can_create: boolean;
    can_edit: boolean; can_delete: boolean; can_export: boolean;
  }>;
  disabledPageCodes: string[];
}

export async function getAccessMe(userId: string): Promise<AccessMeResponse> {
  type RoleRow = RowDataPacket & { role_key?: string | null };
  type EmployeeRow = RowDataPacket & {
    id: string;
    employee_code: string;
    first_name: string;
    last_name: string | null;
    full_name: string | null;
  };
  type ScopeRow = RowDataPacket & {
    id: string;
    role_key: string | null;
    scope_type: string;
    branch_id: string | null;
    process_id: string | null;
    lob_id: string | null;
    department_id: string | null;
    manager_employee_id: string | null;
  };
  type DisabledPageRow = RowDataPacket & { page_code: string };
  type PageRow = RowDataPacket & {
    page_code: string;
    can_view: number | boolean;
    can_create: number | boolean;
    can_edit: number | boolean;
    can_delete: number | boolean;
    can_export: number | boolean;
  };

  // 1. Roles from MySQL user_roles
  const [roleRows] = await db.execute<RowDataPacket[]>(
    "SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1",
    [userId]
  );
  const roles = (roleRows as RoleRow[]).map((r) => String(r.role_key ?? ""));

  // 2. Employee record linked to this user
  const [empRows] = await db.execute<RowDataPacket[]>(
    "SELECT id, employee_code, first_name, last_name, full_name FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1",
    [userId]
  );
  const emp = (empRows as EmployeeRow[])[0] ?? null;

  // 3. Assignment scopes
  const [scopeRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, role_key, scope_type, branch_id, process_id, lob_id, department_id, manager_employee_id
     FROM user_assignment_scope WHERE user_id = ? AND active_status = 1`,
    [userId]
  );
  const scopes = (scopeRows as ScopeRow[])
    .filter((scope) => Boolean(scope.role_key))
    .map((scope) => ({
    id: scope.id,
    role_key: scope.role_key ?? "",
    scope_type: scope.scope_type,
    branch_id: scope.branch_id,
    process_id: scope.process_id,
    lob_id: scope.lob_id,
    department_id: scope.department_id,
    manager_employee_id: scope.manager_employee_id,
  }));

  const [disabledRows] = await db.execute<RowDataPacket[]>(
    "SELECT page_code FROM page_catalog WHERE active_status = 0"
  );
  const disabledPageCodes = (disabledRows as DisabledPageRow[]).map((row) => String(row.page_code));

  // 4. Page permissions - union of all role grants (most permissive wins).
  // page_catalog.active_status is the global compliance kill-switch:
  // disabled pages are hidden even if a role or direct user assignment grants access.
  const allRoleKeys = [...new Set([...roles, ...scopes.map((s) => s.role_key ?? "")])].filter(Boolean);
  let pages: AccessMeResponse["pages"] = [];
  if (allRoleKeys.length > 0) {
    const placeholders = allRoleKeys.map(() => "?").join(",");
    const [pageRows] = await db.execute<RowDataPacket[]>(
      `SELECT rpa.page_code,
              MAX(rpa.can_view)   AS can_view,
              MAX(rpa.can_create) AS can_create,
              MAX(rpa.can_edit)   AS can_edit,
              MAX(rpa.can_delete) AS can_delete,
              MAX(rpa.can_export) AS can_export
       FROM role_page_access rpa
       LEFT JOIN page_catalog pc ON pc.page_code = rpa.page_code
       WHERE rpa.role_key IN (${placeholders})
         AND rpa.active_status = 1
         AND COALESCE(pc.active_status, 1) = 1
       GROUP BY rpa.page_code`,
      allRoleKeys
    );
    pages = (pageRows as PageRow[]).map((r) => ({
      page_code:  r.page_code as string,
      can_view:   Boolean(r.can_view),
      can_create: Boolean(r.can_create),
      can_edit:   Boolean(r.can_edit),
      can_delete: Boolean(r.can_delete),
      can_export: Boolean(r.can_export),
    }));
  }

  // 5. User page overrides — take precedence over role-based access
  const [userPageRows] = await db.execute<RowDataPacket[]>(
    `SELECT upa.page_code, upa.can_view, upa.can_create, upa.can_edit, upa.can_delete, upa.can_export
     FROM user_page_access upa
     LEFT JOIN page_catalog pc ON pc.page_code = upa.page_code
     WHERE upa.user_id = ?
       AND upa.active_status = 1
       AND COALESCE(pc.active_status, 1) = 1`,
    [userId]
  );

  // Merge: user overrides replace role-based for matching page_code
  const pageMap = new Map(pages.map(p => [p.page_code, p]));
  for (const userPage of userPageRows as PageRow[]) {
    pageMap.set(userPage.page_code, {
      page_code: userPage.page_code,
      can_view: Boolean(userPage.can_view),
      can_create: Boolean(userPage.can_create),
      can_edit: Boolean(userPage.can_edit),
      can_delete: Boolean(userPage.can_delete),
      can_export: Boolean(userPage.can_export),
    });
  }
  pages = Array.from(pageMap.values());

  return {
    userId,
    email: undefined, // email not stored in MySQL — caller knows it from auth
    employeeId:   emp?.id ?? null,
    employeeCode: emp?.employee_code ?? null,
    employeeName: emp?.full_name ?? null,
    employee: emp ? {
      id: emp.id,
      employee_code: emp.employee_code,
      first_name: emp.first_name,
      last_name: emp.last_name ?? null,
      full_name: emp.full_name ?? null,
    } : null,
    roles,
    scopes,
    pages,
    disabledPageCodes,
  };
}
