import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Granular client-portal permissions, over portal_user_permissions.
 *
 * The table was declared by migration 509 and only created by 1118, so nothing has ever read or
 * written it. What governs portal access today is the processIds array carried in the token: a
 * client sees the processes they were issued, and that is the whole model.
 *
 * This adds a finer layer without replacing that one, and the distinction matters. A grant here
 * is additive and optional: a client user with no rows behaves exactly as they do today. Nothing
 * in this file narrows anyone's access, because a permission model that starts denying by default
 * the moment it ships would lock out every existing client - all of whom have zero rows.
 *
 * So enforcement is opt-in per endpoint. hasPermission() is the check an endpoint calls when it
 * wants to gate something finer than "which processes"; until an endpoint calls it, these grants
 * are recorded and manageable but govern nothing. That is deliberate, and it is the difference
 * between shipping a mechanism and silently changing who can see what.
 */

export interface PortalPermission {
  id: string;
  client_user_id: string;
  permission_type: string;
  resource_scope: string | null;
  resource_ids: string[] | null;
  granted_by: string;
  granted_at: string;
  expires_at: string | null;
  active_status: number;
}

function parseResourceIds(value: unknown): string[] | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(String);
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(String) : null;
  } catch {
    return null;
  }
}

export const portalPermissionsService = {
  async list(clientUserId?: string): Promise<PortalPermission[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, client_user_id, permission_type, resource_scope, resource_ids,
              granted_by, granted_at, expires_at, active_status
         FROM portal_user_permissions
        ${clientUserId ? "WHERE client_user_id = ?" : ""}
        ORDER BY granted_at DESC`,
      clientUserId ? [clientUserId] : []
    );
    return (rows as RowDataPacket[]).map((row) => ({
      ...(row as unknown as PortalPermission),
      resource_ids: parseResourceIds(row.resource_ids),
    }));
  },

  /*
   * Upserts on (client_user_id, permission_type, resource_scope), which is the table's unique key.
   * Re-granting the same permission must not stack duplicate rows, and re-granting something
   * previously revoked has to bring active_status back up - otherwise a revoke would be permanent
   * and the only way to restore it would be by hand.
   */
  async grant(input: {
    clientUserId: string;
    permissionType: string;
    resourceScope?: string | null;
    resourceIds?: string[] | null;
    grantedBy: string;
    expiresAt?: string | null;
  }): Promise<void> {
    await db.execute(
      `INSERT INTO portal_user_permissions
         (id, client_user_id, permission_type, resource_scope, resource_ids,
          granted_by, expires_at, active_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         resource_ids  = VALUES(resource_ids),
         granted_by    = VALUES(granted_by),
         granted_at    = NOW(),
         expires_at    = VALUES(expires_at),
         active_status = 1`,
      [
        randomUUID(),
        input.clientUserId,
        input.permissionType,
        input.resourceScope ?? null,
        input.resourceIds ? JSON.stringify(input.resourceIds) : null,
        input.grantedBy,
        input.expiresAt ?? null,
      ]
    );
  },

  /** Deactivates rather than deletes, so the grant history survives an audit. */
  async revoke(id: string): Promise<boolean> {
    const [result] = await db.execute(
      "UPDATE portal_user_permissions SET active_status = 0 WHERE id = ? AND active_status = 1",
      [id]
    );
    return (result as { affectedRows?: number }).affectedRows ? true : false;
  },

  /**
   * Whether a client user holds a live permission. Expiry is evaluated in SQL rather than in
   * JavaScript so it cannot drift with the host clock - the same class of bug that has bitten
   * date handling elsewhere in this codebase.
   *
   * resourceId is matched against the resource_ids JSON array when supplied. A grant with a NULL
   * resource_ids covers the whole scope, which is how "all processes" is expressed.
   */
  async hasPermission(
    clientUserId: string,
    permissionType: string,
    resourceId?: string
  ): Promise<boolean> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT 1
         FROM portal_user_permissions
        WHERE client_user_id = ?
          AND permission_type = ?
          AND active_status = 1
          AND (expires_at IS NULL OR expires_at > NOW())
          AND (
                ? IS NULL
             OR resource_ids IS NULL
             OR JSON_CONTAINS(resource_ids, JSON_QUOTE(?))
          )
        LIMIT 1`,
      [clientUserId, permissionType, resourceId ?? null, resourceId ?? ""]
    );
    return (rows as RowDataPacket[]).length > 0;
  },
};
