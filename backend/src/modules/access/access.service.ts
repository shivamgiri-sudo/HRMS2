import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import type { Request } from "express";
import { db } from "../../db/mysql.js";
import { supabaseAdmin } from "../../db/supabaseAdmin.js";
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

  // 2. Fetch all Supabase user_roles (UI visibility mirror)
  const { data: sbRows, error } = await supabaseAdmin
    .from("user_roles")
    .select("user_id, role")
    .order("user_id");

  if (error) throw Object.assign(new Error(`Supabase role fetch failed: ${error.message}`), { statusCode: 502 });

  const sbByUser = new Map<string, string[]>();
  for (const row of (sbRows ?? []) as { user_id: string; role: string }[]) {
    const existing = sbByUser.get(row.user_id) ?? [];
    existing.push(row.role);
    sbByUser.set(row.user_id, existing);
  }

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
