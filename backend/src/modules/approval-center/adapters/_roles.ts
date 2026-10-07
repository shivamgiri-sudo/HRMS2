import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import { expandRoles, normalizeRoleInputs } from "../../../platform/policy/index.js";

/** Active role keys for a user (same source requireRole falls back to). */
export async function callerRoleKeys(userId: string): Promise<string[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1`,
    [userId],
  );
  return (rows as RowDataPacket[]).map((r) => String(r.role_key));
}

/**
 * Mirrors requireRole(...allowed): super_admin passes everything, otherwise the caller's roles and the
 * allowed roles are both alias-expanded and must intersect. Used so an adapter only lists items the
 * module's decide endpoint will accept from this caller (several list endpoints are wider than decide).
 */
export async function callerHasRole(userId: string, ...allowed: string[]): Promise<boolean> {
  const mine = normalizeRoleInputs(await callerRoleKeys(userId));
  if (mine.includes("super_admin")) return true;
  const have = expandRoles(mine);
  return expandRoles(normalizeRoleInputs(allowed)).some((r) => have.includes(r));
}
