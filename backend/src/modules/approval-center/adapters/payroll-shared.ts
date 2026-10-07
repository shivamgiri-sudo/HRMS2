import { db } from "../../../db/mysql.js";
import { expandRoles, normalizeRoleInputs } from "../../../platform/policy/index.js";

/** Active role keys of a user (same source requireRole falls back to). */
export async function callerRoleKeys(userId: string): Promise<string[]> {
  const [rows] = await db.execute<any[]>(`SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1`, [userId]);
  return (rows as Array<{ role_key: string }>).map((r) => r.role_key);
}

/**
 * Mirrors middleware/requireRole.ts: super_admin passes, otherwise the alias-expanded role sets must intersect.
 * Use it to pre-filter list rows on a role the decide endpoint demands (admin is NOT a wildcard here, matching requireRole).
 */
export function roleMeets(roleKeys: readonly string[], ...allowed: string[]): boolean {
  const mine = normalizeRoleInputs(roleKeys);
  if (mine.includes("super_admin" as never)) return true;
  const want = expandRoles(normalizeRoleInputs(allowed));
  const have = expandRoles(mine);
  return want.some((r) => have.includes(r));
}

/** Age in whole days from a date-ish value; null when unparsable. */
export function ageDays(v: unknown, now = Date.now()): number | null {
  if (!v) return null;
  const t = new Date(String(v)).getTime();
  return Number.isNaN(t) ? null : Math.floor((now - t) / 86_400_000);
}
