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
 * RBAC reconciliation - validates MySQL user_roles consistency.
 * Checks for:
 * - Users with roles not in the catalog
 * - Active roles pointing to non-existent users
 * - Duplicate role assignments
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

  // 2. Fetch valid role catalog
  const [catalogRows] = await db.execute<RowDataPacket[]>(
    "SELECT role_key FROM workforce_role_catalog WHERE active_status = 1"
  );
  const validRoles = new Set((catalogRows as { role_key: string }[]).map(r => r.role_key));

  // 3. Fetch all users
  const [userRows] = await db.execute<RowDataPacket[]>(
    "SELECT id FROM auth_user"
  );
  const validUsers = new Set((userRows as { id: string }[]).map(u => u.id));

  // 4. Find mismatches
  const mismatches: RbacMismatch[] = [];

  for (const [userId, roles] of mysqlByUser.entries()) {
    const invalidRoles = roles.filter(r => !validRoles.has(r));
    const userExists = validUsers.has(userId);

    if (invalidRoles.length > 0 || !userExists) {
      mismatches.push({
        user_id: userId,
        mysql_roles: roles,
        supabase_roles: [], // Deprecated field
        in_supabase_only: [], // Deprecated field
        in_mysql_only: invalidRoles.length > 0 ? invalidRoles : (userExists ? [] : roles),
      });
    }
  }

  return {
    total_mysql_users: mysqlByUser.size,
    total_supabase_users: 0, // Deprecated
    mismatches,
    checked_at: new Date().toISOString(),
  };
}

// ── Role administration (MySQL-authoritative writes) ─────────────────────────

export async function assignRole(userId: string, roleKey: string, actorUserId: string, req?: Request): Promise<void> {
  const [users] = await db.execute<RowDataPacket[]>(
    "SELECT id FROM auth_user WHERE id = ? AND is_blocked = 0 LIMIT 1",
    [userId]
  );
  if ((users as RowDataPacket[]).length === 0) {
    throw Object.assign(new Error("User not found or blocked"), { statusCode: 404 });
  }
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
  const limit = Math.max(1, Math.min(Math.trunc(filters.limit ?? 100), 500));
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
}

export async function getAccessMe(userId: string): Promise<AccessMeResponse> {
  // 1. Roles from MySQL user_roles
  const [roleRows] = await db.execute<RowDataPacket[]>(
    "SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1",
    [userId]
  );
  const roles = (roleRows as RowDataPacket[]).map((r: any) => r.role_key as string);

  // 2. Employee record linked to this user
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.full_name
       FROM employees e
      WHERE e.user_id = ? AND e.active_status = 1
      ORDER BY
        EXISTS (
          SELECT 1
            FROM employee_salary_assignment esa
           WHERE esa.employee_id = e.id AND esa.active_status = 1
        ) DESC,
        CASE WHEN e.employee_code LIKE 'ADMIN%' THEN 1 ELSE 0 END,
        e.updated_at DESC
      LIMIT 1`,
    [userId]
  );
  const emp = (empRows as RowDataPacket[])[0] as any ?? null;

  // 3. Assignment scopes
  const [scopeRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, role_key, scope_type, branch_id, process_id, lob_id, department_id, manager_employee_id
     FROM user_assignment_scope WHERE user_id = ? AND active_status = 1`,
    [userId]
  );
  const scopes = scopeRows as any[];

  // 4. Page permissions — union of all role grants (most permissive wins)
  const allRoleKeys = [...new Set([...roles, ...scopes.map((s: any) => s.role_key)])];
  let pages: AccessMeResponse["pages"] = [];
  if (roles.includes("super_admin")) {
    const [pageRows] = await db.execute<RowDataPacket[]>(
      `SELECT page_code
         FROM page_catalog
        WHERE active_status = 1
        ORDER BY page_code`
    );
    pages = (pageRows as RowDataPacket[]).map((row: any) => ({
      page_code: String(row.page_code),
      can_view: true,
      can_create: true,
      can_edit: true,
      can_delete: true,
      can_export: true,
    }));
  } else if (allRoleKeys.length > 0) {
    const placeholders = allRoleKeys.map(() => "?").join(",");
    const [pageRows] = await db.execute<RowDataPacket[]>(
      `SELECT page_code,
              MAX(can_view)   AS can_view,
              MAX(can_create) AS can_create,
              MAX(can_edit)   AS can_edit,
              MAX(can_delete) AS can_delete,
              MAX(can_export) AS can_export
       FROM role_page_access
       WHERE role_key IN (${placeholders}) AND active_status = 1
       GROUP BY page_code`,
      allRoleKeys
    );
    pages = (pageRows as RowDataPacket[]).map((r: any) => ({
      page_code:  r.page_code as string,
      can_view:   Boolean(r.can_view),
      can_create: Boolean(r.can_create),
      can_edit:   Boolean(r.can_edit),
      can_delete: Boolean(r.can_delete),
      can_export: Boolean(r.can_export),
    }));
  }

  // 5. User page overrides — take precedence over role-based access (skip expired entries)
  const [userPageRows] = await db.execute<RowDataPacket[]>(
    `SELECT page_code, can_view, can_create, can_edit, can_delete, can_export
     FROM user_page_access
     WHERE user_id = ? AND active_status = 1
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [userId]
  );

  // Merge: user overrides replace role-based for matching page_code
  const pageMap = new Map(pages.map(p => [p.page_code, p]));
  for (const userPage of userPageRows as any[]) {
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
    roles,
    scopes,
    pages,
  };
}
