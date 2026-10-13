import { db } from "../../../db/mysql.js";

/** Active role keys of a user (same source requireRole falls back to). */
export async function callerRoleKeys(userId: string): Promise<string[]> {
  const [rows] = await db.execute<any[]>(`SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1`, [userId]);
  return (rows as Array<{ role_key: string }>).map((r) => r.role_key);
}

/**
 * Does the caller literally hold one of the roles the stage designates? (Stricter than requireRole on purpose: the popup shows
 * "pending ON ME", so super_admin / alias roles that merely PASS the endpoint guard are not enough.)
 */
export function roleMeets(roleKeys: readonly string[], ...allowed: string[]): boolean {
  // LITERAL match: the caller must hold one of the exact roles the stage names. No super_admin wildcard, no alias expansion.
  return allowed.some((r) => roleKeys.includes(r));
}

/** Age in whole days from a date-ish value; null when unparsable. */
export function ageDays(v: unknown, now = Date.now()): number | null {
  if (!v) return null;
  const t = new Date(String(v)).getTime();
  return Number.isNaN(t) ? null : Math.floor((now - t) / 86_400_000);
}
