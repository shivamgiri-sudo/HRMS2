/**
 * Off-day policy hook for the two bulk-upload roster writers (roster-assignment-bulk and
 * shift-roster-bulk). Called once per written (employee, date) set, inside the caller's
 * transaction, after the INSERTs: stamps NULL process_id / lob_id and forces is_week_off +
 * assignment_type together where a FIXED_DAY policy mandates an off. Non-throwing; with no active
 * policy nothing beyond the (schema-guarded, NULL-only) stamping runs.
 */
import { db } from "../../db/mysql.js";
import { anyActivePolicyExists, loadActivePolicies } from "./roster-offday-policy.loader.js";
import { isFixedOffDate, toYmd, type EmployeeOffScope } from "./roster-offday-resolver.js";
import { markWeekOff, stampRows } from "./roster-offday-apply.js";

type Executor = { execute: (sql: string, params?: any[]) => Promise<any> };
export interface WrittenRosterCell { employeeId: string; rosterDate: string }
const CHUNK = 200;

export async function finalizeBulkRosterRows(cells: readonly WrittenRosterCell[], exec: Executor = db): Promise<void> {
  if (!cells.length) return;
  try {
    for (let i = 0; i < cells.length; i += CHUNK) {
      const part = cells.slice(i, i + CHUNK);
      await stampRows(
        `(wra.employee_id, wra.roster_date) IN (${part.map(() => "(?,?)").join(",")})`,
        part.flatMap((c) => [c.employeeId, c.rosterDate]), null, exec,
      );
    }
    if (!(await anyActivePolicyExists(exec))) return;
    const ids = [...new Set(cells.map((c) => c.employeeId))];
    const [emps] = await exec.execute(
      `SELECT id, process_id, lob_id, branch_id FROM employees WHERE id IN (${ids.map(() => "?").join(",")})`, ids,
    );
    const scopes = new Map<string, EmployeeOffScope>();
    for (const e of (emps ?? []) as any[]) {
      scopes.set(String(e.id), {
        processId: e.process_id ? String(e.process_id) : null,
        lobId: e.lob_id ? String(e.lob_id) : null,
        branchId: e.branch_id ? String(e.branch_id) : null,
      });
    }
    const processIds = [...new Set([...scopes.values()].map((s) => s.processId).filter((p): p is string => !!p))];
    const policies = await loadActivePolicies(processIds, exec);
    if (!policies.length) return;
    for (const c of cells) {
      const scope = scopes.get(c.employeeId);
      const date = toYmd(c.rosterDate);
      if (scope && isFixedOffDate(policies, scope, date)) await markWeekOff(c.employeeId, date, exec);
    }
  } catch (err) {
    console.error("[roster-offday] bulk finalize skipped:", (err as Error)?.message);
  }
}
