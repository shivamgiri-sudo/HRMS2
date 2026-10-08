/**
 * Reporting-tree resolver for the Team Roster page.
 *
 * shared/dashboardScope.ts resolveTeamEmployeeIds does the same walk (reporting_manager_id AND the
 * legacy manager_id, transitive, cycle-safe, self excluded) but loads EVERY active employee on each
 * call and is not exported. This is the per-request equivalent: a level-by-level walk that only ever
 * reads the children of the current frontier, two indexed lookups per level (a single UNION, never
 * an OR across the two parent columns, which defeats both indexes).
 *
 *  - cycle-safe: a visited set, so A->B->A or any longer loop terminates and adds nobody twice;
 *  - a self-referencing row (reporting_manager_id = own id) is an edge to oneself: already visited;
 *  - inactive employees are neither members nor a path through to their own reports (same as
 *    dashboardScope, which builds the edge map from active rows only);
 *  - bounded: TEAM_MAX_DEPTH levels and TEAM_MAX_MEMBERS people, `truncated` says a bound was hit.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { placeholders, rowsOf, type SqlExecutor } from "./team-roster-types.js";

export const TEAM_MAX_DEPTH = 15;
export const TEAM_MAX_MEMBERS = 5000;
const FRONTIER_CHUNK = 500;

export interface TeamTree {
  /** Every active employee below the manager at any depth, manager excluded. */
  ids: string[];
  truncated: boolean;
  depth: number;
}

async function childrenOf(frontier: string[], exec: SqlExecutor): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < frontier.length; i += FRONTIER_CHUNK) {
    const chunk = frontier.slice(i, i + FRONTIER_CHUNK);
    const marks = placeholders(chunk.length);
    const result = await exec.execute(
      `SELECT id FROM employees WHERE active_status = 1 AND reporting_manager_id IN (${marks})
       UNION
       SELECT id FROM employees WHERE active_status = 1 AND manager_id IN (${marks})`,
      [...chunk, ...chunk],
    );
    for (const r of rowsOf<RowDataPacket>(result)) {
      const id = String(r.id ?? "").trim();
      if (id) out.push(id);
    }
  }
  return out;
}

export async function resolveTeamTree(
  managerEmployeeId: string,
  exec: SqlExecutor = db,
  limits: { maxDepth?: number; maxMembers?: number } = {},
): Promise<TeamTree> {
  const maxDepth = limits.maxDepth ?? TEAM_MAX_DEPTH;
  const maxMembers = limits.maxMembers ?? TEAM_MAX_MEMBERS;
  const visited = new Set<string>([managerEmployeeId]);
  const ids: string[] = [];
  let frontier = [managerEmployeeId];
  let depth = 0;
  let truncated = false;

  while (frontier.length > 0) {
    if (depth >= maxDepth) {
      truncated = true;
      break;
    }
    const next: string[] = [];
    for (const id of await childrenOf(frontier, exec)) {
      if (visited.has(id)) continue;
      visited.add(id);
      if (ids.length >= maxMembers) {
        truncated = true;
        continue;
      }
      ids.push(id);
      next.push(id);
    }
    if (next.length > 0) depth += 1;
    frontier = next;
  }
  return { ids, truncated, depth };
}

/** The signed-in user's own employee row, or null when the login is not linked to an employee. */
export async function resolveCallerEmployee(userId: string, exec: SqlExecutor = db) {
  const result = await exec.execute(
    `SELECT id, employee_code, full_name, first_name, last_name, branch_id, process_id,
            reporting_manager_id, manager_id, active_status
       FROM employees WHERE user_id = ? ORDER BY active_status DESC LIMIT 1`,
    [userId],
  );
  const row = rowsOf<RowDataPacket>(result)[0];
  if (!row) return null;
  const name = String(row.full_name || `${row.first_name ?? ""} ${row.last_name ?? ""}`).trim();
  return {
    id: String(row.id),
    code: row.employee_code ? String(row.employee_code) : null,
    name: name || String(row.employee_code ?? row.id),
    branchId: row.branch_id ? String(row.branch_id) : null,
    processId: row.process_id ? String(row.process_id) : null,
    reportingManagerId: row.reporting_manager_id ? String(row.reporting_manager_id) : row.manager_id ? String(row.manager_id) : null,
    active: Number(row.active_status) === 1,
  };
}

export type CallerEmployee = NonNullable<Awaited<ReturnType<typeof resolveCallerEmployee>>>;
