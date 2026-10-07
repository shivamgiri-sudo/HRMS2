import type { RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import {
  candidateBecameEmployee,
  getEmployeeMobileJoinMap,
} from "./analytics.unified.service.js";
import { createSwrCache } from "./dashboard.cache.js";
import { branchDisplay, reportingScope } from "./dashboard.scope.js";

/**
 * Who counts as "joined". ats_candidate.current_stage is not maintained after hiring (only a handful of rows reach
 * onboarded/converted), so the repo's canonical rule is: stage onboarded/converted/payroll_validated, OR an employee
 * with the same mobile whose date_of_joining is on/after the candidate's registration (candidateBecameEmployee).
 *
 * Doing that match in SQL takes ~60s on production, so it is computed once per cache cycle in Node from the shared
 * employee-mobile map, and the resulting id set is what every dashboard number and drill filter uses.
 */
export interface JoinedInfo {
  ids: string[];
  /** joined count per registration day + canonical branch, key `${YYYY-MM-DD}|${branch}` */
  byDayBranch: Map<string, number>;
}

const cache = createSwrCache<JoinedInfo>({
  freshMs: 10 * 60_000,
  staleMs: 60 * 60_000,
});

async function compute(): Promise<JoinedInfo> {
  const [map, [rows]] = await Promise.all([
    getEmployeeMobileJoinMap(),
    db.execute<RowDataPacket[]>(
      `SELECT c.id, DATE_FORMAT(c.created_at,'%Y-%m-%d') AS d, c.created_at AS created_at, c.mobile, c.current_stage,
              COALESCE(NULLIF(c.branch_display_name,''), NULLIF(c.applied_for_branch,''), 'Unspecified') AS b
       FROM ats_candidate c WHERE c.active_status = 1 AND ${reportingScope("c")}`,
    ),
  ]);
  const ids: string[] = [];
  const byDayBranch = new Map<string, number>();
  for (const r of rows) {
    if (
      !candidateBecameEmployee(
        {
          current_stage: r.current_stage,
          mobile: r.mobile,
          created_at: r.created_at,
        },
        map,
      )
    )
      continue;
    ids.push(String(r.id));
    const k = `${r.d}|${branchDisplay(r.b)}`;
    byDayBranch.set(k, (byDayBranch.get(k) ?? 0) + 1);
  }
  return { ids, byDayBranch };
}

export const getJoinedInfo = () => cache.get("joined", compute);

/** SQL predicate "this candidate joined" for `column` (e.g. "c.id" or "id"); a constant false when nobody has. */
export function joinedIdSql(
  column: string,
  ids: readonly string[],
): { sql: string; params: string[] } {
  return ids.length
    ? {
        sql: `${column} IN (${ids.map(() => "?").join(",")})`,
        params: [...ids],
      }
    : { sql: "1=0", params: [] };
}
