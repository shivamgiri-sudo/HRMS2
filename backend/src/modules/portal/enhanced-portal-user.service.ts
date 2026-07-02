import { db } from "../../db/mysql.js";
import { randomUUID } from "crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

// Maps to: client_user table
export interface EnhancedPortalUser {
  id: string;
  email: string;
  name?: string;         // 'name' column in client_user
  full_name?: string;    // alias for name
  designation?: string;
  client_id: string;
  process_ids: string[];
  is_active: boolean;
  created_at: Date;
}

export interface UpdatePortalUserInput {
  full_name?: string;
  phone?: string;
  designation?: string;
  department?: string;
  access_level?: string;
  access_start_date?: string;
  access_end_date?: string;
  process_ids?: string[];
}

export async function getEnhancedPortalUser(userId: string): Promise<EnhancedPortalUser | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT *, name AS full_name FROM client_user WHERE id = ?",
    [userId]
  );
  if (rows.length === 0) return null;
  const row = rows[0] as any;
  return { ...row, process_ids: tryParseJson(row.process_ids, []) };
}

export async function listEnhancedPortalUsers(filters?: {
  client_id?: string;
  active_only?: boolean;
  access_level?: string;
  search?: string;
}): Promise<EnhancedPortalUser[]> {
  let query = "SELECT *, name AS full_name FROM client_user WHERE 1=1";
  const params: any[] = [];

  if (filters?.client_id) {
    query += " AND client_id = ?";
    params.push(filters.client_id);
  }

  if (filters?.active_only) {
    query += " AND is_active = 1";
  }

  if (filters?.search) {
    query += " AND (email LIKE ? OR name LIKE ? OR designation LIKE ?)";
    const searchPattern = `%${filters.search}%`;
    params.push(searchPattern, searchPattern, searchPattern);
  }

  query += " ORDER BY created_at DESC";

  const [rows] = await db.execute<RowDataPacket[]>(query, params);
  return (rows as any[]).map(r => ({ ...r, process_ids: tryParseJson(r.process_ids, []) }));
}

export async function updatePortalUser(
  userId: string,
  data: UpdatePortalUserInput
): Promise<void> {
  const updates: string[] = [];
  const params: any[] = [];

  // Map full_name → name column in client_user
  if (data.full_name !== undefined) {
    updates.push("name = ?");
    params.push(data.full_name);
  }
  if (data.designation !== undefined) {
    updates.push("designation = ?");
    params.push(data.designation);
  }
  if (data.process_ids !== undefined) {
    updates.push("process_ids = ?");
    params.push(JSON.stringify(data.process_ids));
  }

  if (updates.length === 0) return;

  params.push(userId);
  await db.execute(
    `UPDATE client_user SET ${updates.join(", ")} WHERE id = ?`,
    params
  );
}

export async function deactivatePortalUser(
  userId: string,
  _deactivatedBy: string,
  _reason?: string
): Promise<void> {
  await db.execute(
    "UPDATE client_user SET is_active = 0 WHERE id = ?",
    [userId]
  );
}

export async function reactivatePortalUser(userId: string): Promise<void> {
  await db.execute(
    "UPDATE client_user SET is_active = 1 WHERE id = ?",
    [userId]
  );
}

// ============================================================
// ACTIVITY TRACKING — uses portal_access_log
// ============================================================

export interface ActivityLogEntry {
  id: string;
  user_id: string;      // maps to client_user_id in portal_access_log
  action_type: string;  // stored as 'page' column
  ip_address?: string;
  created_at: Date;
}

export async function logPortalUserActivity(data: {
  user_id: string;
  action_type: string;
  resource_type?: string;
  resource_id?: string;
  ip_address?: string;
  user_agent?: string;
  request_method?: string;
  request_path?: string;
  response_status?: number;
  duration_ms?: number;
  metadata?: any;
}): Promise<void> {
  await db.execute(
    `INSERT INTO portal_access_log (id, client_user_id, page, ip_address)
     VALUES (?, ?, ?, ?)`,
    [
      randomUUID(),
      data.user_id,
      data.action_type,
      data.ip_address || null,
    ]
  );
}

export async function getPortalUserActivity(
  userId: string,
  limit: number = 100,
  actionType?: string
): Promise<ActivityLogEntry[]> {
  let query = `
    SELECT id, client_user_id AS user_id, page AS action_type, ip_address, created_at
    FROM portal_access_log
    WHERE client_user_id = ?
  `;
  const params: any[] = [userId];

  if (actionType) {
    query += " AND page = ?";
    params.push(actionType);
  }

  query += ` ORDER BY created_at DESC LIMIT ${Number(limit)}`;

  const [rows] = await db.execute<RowDataPacket[]>(query, params);
  return rows as ActivityLogEntry[];
}

export async function getRecentLogins(
  userId: string,
  limit: number = 20
): Promise<Array<{ login_time: Date; ip_address: string }>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT created_at as login_time, ip_address
     FROM portal_access_log
     WHERE client_user_id = ? AND page = 'LOGIN'
     ORDER BY created_at DESC
     LIMIT ?`,
    [userId, limit]
  );
  return rows as Array<{ login_time: Date; ip_address: string }>;
}

export async function updateLastLogin(
  userId: string,
  ipAddress: string
): Promise<void> {
  await logPortalUserActivity({ user_id: userId, action_type: 'LOGIN', ip_address: ipAddress });
}

// ============================================================
// PERMISSIONS MANAGEMENT — uses user_page_access
// ============================================================

export interface PortalUserPermission {
  id: string;
  user_id: string;
  permission_type: string;   // maps to page_code
  resource_scope: string;    // stored in notes
  resource_ids?: string[];
  granted_by: string;        // assigned_by
  granted_at: Date;          // assigned_at
  active_status: boolean;
}

export async function grantPermission(data: {
  user_id: string;
  permission_type: string;
  resource_scope: string;
  resource_ids?: string[];
  granted_by: string;
  expires_at?: Date;
}): Promise<void> {
  const notes = JSON.stringify({ scope: data.resource_scope, resource_ids: data.resource_ids });
  await db.execute(
    `INSERT INTO user_page_access (id, user_id, page_code, can_view, can_create, can_edit, can_delete, can_export, assigned_by, active_status, notes)
     VALUES (?, ?, ?, 1, 0, 0, 0, 0, ?, 1, ?)
     ON DUPLICATE KEY UPDATE
       assigned_by = VALUES(assigned_by),
       assigned_at = NOW(),
       active_status = 1,
       notes = VALUES(notes)`,
    [randomUUID(), data.user_id, data.permission_type, data.granted_by, notes]
  );
}

export async function revokePermission(
  userId: string,
  permissionType: string
): Promise<void> {
  await db.execute(
    `UPDATE user_page_access
     SET active_status = 0, revoked_by = 'system', revoked_at = NOW()
     WHERE user_id = ? AND page_code = ?`,
    [userId, permissionType]
  );
}

export async function getUserPermissions(userId: string): Promise<PortalUserPermission[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, user_id, page_code AS permission_type, notes AS resource_scope,
            assigned_by AS granted_by, assigned_at AS granted_at, active_status
     FROM user_page_access
     WHERE user_id = ? AND active_status = 1`,
    [userId]
  );
  return rows as PortalUserPermission[];
}

// ============================================================
// ANALYTICS
// ============================================================

export interface UserActivitySummary {
  user_id: string;
  email: string;
  full_name?: string;
  total_actions: number;
}

export async function getUserActivitySummary(
  clientId?: string,
  _days: number = 30
): Promise<UserActivitySummary[]> {
  let query = `
    SELECT
      cu.id as user_id,
      cu.email,
      cu.name AS full_name,
      COUNT(pal.id) as total_actions
    FROM client_user cu
    LEFT JOIN portal_access_log pal ON pal.client_user_id = cu.id
    WHERE cu.is_active = 1
  `;
  const params: any[] = [];

  if (clientId) {
    query += " AND cu.client_id = ?";
    params.push(clientId);
  }

  query += " GROUP BY cu.id, cu.email, cu.name ORDER BY total_actions DESC";

  const [rows] = await db.execute<RowDataPacket[]>(query, params);
  return rows as UserActivitySummary[];
}

function tryParseJson(val: any, fallback: any): any {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch { return fallback; }
}
