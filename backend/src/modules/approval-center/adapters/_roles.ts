import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";

/** Active role keys for a user (same source requireRole falls back to). */
export async function callerRoleKeys(userId: string): Promise<string[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1`,
    [userId],
  );
  return (rows as RowDataPacket[]).map((r) => String(r.role_key));
}

/**
 * Literal role check: the caller must hold one of `allowed` exactly. Unlike requireRole, super_admin is not a wildcard and
 * roles are not alias-expanded, so an adapter lists only items the caller is DESIGNATED for.
 */
export async function callerHasRole(userId: string, ...allowed: string[]): Promise<boolean> {
  // LITERAL match (no super_admin wildcard, no alias expansion): "pending ON ME" needs the exact stage role.
  const mine = await callerRoleKeys(userId);
  return allowed.some((r) => mine.includes(r));
}
