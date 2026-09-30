/**
 * Actor-name resolution for roster audit data.
 *
 * roster_decision_audit.override_by, roster_generation_run.triggered_by and roster_change_log.changed_by
 * all store req.authUser.id (an auth_user.id) — NOT employees.id — so joining them to employees.id
 * (as the routes used to) resolved almost every actor to "System". employees.user_id links the two;
 * legacy rows that stored an employee id are matched too.
 */
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';

export interface ActorInfo { name: string; code: string | null }

export async function resolveActors(ids: Array<string | null | undefined>): Promise<Map<string, ActorInfo>> {
  const unique = [...new Set(ids.filter((v): v is string => typeof v === 'string' && v.length > 0))];
  const out = new Map<string, ActorInfo>();
  if (unique.length === 0) return out;
  const ph = unique.map(() => '?').join(',');
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, user_id, full_name, employee_code
       FROM employees
      WHERE user_id IN (${ph}) OR id IN (${ph})
      ORDER BY active_status DESC`,
    [...unique, ...unique],
  );
  for (const r of rows) {
    const info: ActorInfo = { name: r.full_name ?? 'Unknown user', code: r.employee_code ?? null };
    // Rows are ordered active-first, so the first hit per key wins.
    if (r.user_id && !out.has(r.user_id)) out.set(r.user_id, info);
    if (r.id && !out.has(r.id)) out.set(r.id, info);
  }
  return out;
}

/** Display name for an actor id: null id => System, unresolved id => Unknown user. */
export function actorName(map: Map<string, ActorInfo>, id: string | null | undefined): string {
  if (!id) return 'System';
  return map.get(id)?.name ?? 'Unknown user';
}
