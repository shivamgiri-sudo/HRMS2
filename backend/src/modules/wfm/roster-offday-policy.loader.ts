/**
 * Read-side helpers for roster_offday_policy shared by the CRUD service and by the roster
 * write paths (import preview, auto generation). Kept separate from the service so a write
 * path importing it does not pull in the HTTP/scope machinery.
 *
 * Every function degrades to "no policy" when the table is missing (migration 1850 not applied
 * yet) or the query fails, so the roster paths behave exactly as they did before this feature.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  parseWeekdays, toYmd, type EmployeeOffScope, type OffdayPolicy, type OffType,
} from "./roster-offday-resolver.js";

type Executor = { execute: (sql: string, params?: any[]) => Promise<any> };

const POLICY_COLUMNS =
  "p.id, p.process_id, p.lob_id, p.branch_id, p.off_type, p.fixed_weekdays, p.floating_offs_per_week, p.effective_from, p.effective_to";

/** DB row -> resolver shape. */
export function mapPolicyRow(r: Record<string, any>): OffdayPolicy {
  return {
    id: String(r.id),
    process_id: String(r.process_id),
    lob_id: r.lob_id ? String(r.lob_id) : null,
    branch_id: r.branch_id ? String(r.branch_id) : null,
    off_type: String(r.off_type) as OffType,
    fixed_weekdays: parseWeekdays(r.fixed_weekdays),
    floating_offs_per_week: r.floating_offs_per_week === null || r.floating_offs_per_week === undefined
      ? null : Number(r.floating_offs_per_week),
    effective_from: toYmd(r.effective_from),
    effective_to: r.effective_to ? toYmd(r.effective_to) : null,
  };
}

/** Active policies for the given processes (all effective ranges; the resolver filters by date). */
export async function loadActivePolicies(processIds: readonly string[], exec: Executor = db): Promise<OffdayPolicy[]> {
  const ids = [...new Set(processIds.filter(Boolean))];
  if (!ids.length) return [];
  try {
    const [rows] = await exec.execute(
      `SELECT ${POLICY_COLUMNS} FROM roster_offday_policy p
        WHERE p.active_status = 1 AND p.process_id IN (${ids.map(() => "?").join(",")})`,
      ids,
    ) as [RowDataPacket[], unknown];
    return (rows ?? []).map(mapPolicyRow);
  } catch (err) {
    console.error("[roster-offday] policy lookup unavailable; treating as no policy:", (err as Error)?.message);
    return [];
  }
}

/** True when at least one active policy row exists anywhere (cheap short-circuit for the roster paths). */
export async function anyActivePolicyExists(exec: Executor = db): Promise<boolean> {
  try {
    const [rows] = await exec.execute(`SELECT 1 AS ok FROM roster_offday_policy WHERE active_status = 1 LIMIT 1`) as [RowDataPacket[], unknown];
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

/** Employee id -> scope, for one process. Used by the generator, which already works per process. */
export async function loadProcessEmployeeScopes(processId: string, exec: Executor = db): Promise<Map<string, EmployeeOffScope>> {
  const out = new Map<string, EmployeeOffScope>();
  try {
    const [rows] = await exec.execute(
      `SELECT id, process_id, lob_id, branch_id FROM employees WHERE process_id = ?`, [processId],
    ) as [RowDataPacket[], unknown];
    for (const r of rows ?? []) {
      out.set(String(r.id), {
        processId: r.process_id ? String(r.process_id) : null,
        lobId: r.lob_id ? String(r.lob_id) : null,
        branchId: r.branch_id ? String(r.branch_id) : null,
      });
    }
  } catch (err) {
    console.error("[roster-offday] employee scope lookup failed:", (err as Error)?.message);
  }
  return out;
}
