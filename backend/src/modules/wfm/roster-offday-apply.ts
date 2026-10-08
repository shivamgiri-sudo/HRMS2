/**
 * Hooks that connect the roster write paths (import preview/commit, auto generation) to the
 * roster off-day policy and to the new wfm_roster_assignment.process_id / lob_id columns.
 *
 * Contract with the callers (all of it opt-in, nothing here may change existing behaviour):
 *   - With no active policy row, annotateImportPolicyWarnings adds nothing, loadPlanOffdayPolicy
 *     returns an inert object and markWeekOff is never called: output is identical to before.
 *   - Stamping only fills NULL process_id / lob_id (never overwrites) and never touches any other
 *     column, and is skipped when migration 1849 has not been applied.
 *   - Every function here is non-throwing: a failure is logged and the roster write goes on.
 *   - Import warnings are informational. They add a message to validation_messages but leave the
 *     row's validation_state alone, so they never turn a committable upload into a blocked one.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { rosterAssignmentColumns } from "./shift-scheduling.util.js";
import {
  anyActivePolicyExists, loadActivePolicies, loadProcessEmployeeScopes,
} from "./roster-offday-policy.loader.js";
import {
  WEEKDAY_NAMES, floatingOffsPerWeek, hasFixedPolicy, isFixedOffDate, pickPolicy, weekKey, weekOffColumns,
  weekdayLabel, weekdayOf, type EmployeeOffScope, type OffdayPolicy,
} from "./roster-offday-resolver.js";

type Executor = { execute: (sql: string, params?: any[]) => Promise<any> };

// ── process_id / lob_id stamping ─────────────────────────────────────────────

async function hasProcessLobColumns(exec: Executor): Promise<boolean> {
  const cols = await rosterAssignmentColumns(exec as any);
  return cols.has("process_id") && cols.has("lob_id");
}

/**
 * Fill NULL process_id / lob_id on the assignment rows matched by `whereSql` (an alias-`wra`
 * predicate) from the employee's own process and LOB; `fallbackProcessId` covers an employee with
 * no process of their own. Deliberately three plain UPDATEs and no COALESCE/IF across columns:
 * employees.process_id and wfm_roster_assignment.process_id may carry different collations, and
 * mixing them in one expression raises ER_CANT_AGGREGATE_2COLLATIONS. Assigning a column from a
 * column, or from a bound parameter, is collation-safe.
 */
export async function stampRows(whereSql: string, params: unknown[], fallbackProcessId: string | null, exec: Executor): Promise<void> {
  try {
    if (!(await hasProcessLobColumns(exec))) return;
    await exec.execute(
      `UPDATE wfm_roster_assignment wra JOIN employees e ON e.id = wra.employee_id
          SET wra.process_id = e.process_id
        WHERE ${whereSql} AND wra.process_id IS NULL AND e.process_id IS NOT NULL`,
      params,
    );
    if (fallbackProcessId) {
      await exec.execute(
        `UPDATE wfm_roster_assignment wra SET wra.process_id = ?
          WHERE ${whereSql} AND wra.process_id IS NULL`,
        [fallbackProcessId, ...params],
      );
    }
    await exec.execute(
      `UPDATE wfm_roster_assignment wra JOIN employees e ON e.id = wra.employee_id
          SET wra.lob_id = e.lob_id
        WHERE ${whereSql} AND wra.lob_id IS NULL AND e.lob_id IS NOT NULL`,
      params,
    );
  } catch (err) {
    console.error("[roster-offday] process/lob stamping skipped:", (err as Error)?.message);
  }
}

export const stampImportBatchRows = (batchId: number, fallbackProcessId: string | null, exec: Executor = db) =>
  stampRows("wra.import_batch_id = ?", [batchId], fallbackProcessId, exec);

export const stampPlanRows = (planId: string, processId: string | null, exec: Executor = db) =>
  stampRows("wra.plan_id = ?", [planId], processId, exec);

export const stampGenerationRunRows = (runId: string, processId: string | null, exec: Executor = db) =>
  stampRows("wra.generation_run_id = ?", [runId], processId, exec);

// ── week-off flag sync ───────────────────────────────────────────────────────

/**
 * Mark one roster row as a week-off with BOTH flags together (is_week_off + assignment_type),
 * through weekOffColumns so the two can never diverge. Used for policy-mandated fixed offs.
 */
export async function markWeekOff(employeeId: string, rosterDate: string, exec: Executor = db): Promise<void> {
  try {
    const cols = weekOffColumns(true);
    await exec.execute(
      `UPDATE wfm_roster_assignment SET is_week_off = ?, assignment_type = ? WHERE employee_id = ? AND roster_date = ?`,
      [cols.is_week_off, cols.assignment_type, employeeId, rosterDate],
    );
  } catch (err) {
    console.error("[roster-offday] week-off flag sync failed:", (err as Error)?.message);
  }
}

// ── auto generation ──────────────────────────────────────────────────────────

export interface PlanOffdayPolicy {
  /** False when the process has no active policy: callers then behave exactly as before. */
  readonly active: boolean;
  /** Policy-mandated off on this date (FIXED_DAY weekday). */
  isFixedOff(employeeId: string, date: string): boolean;
  /** A FIXED_DAY policy governs this employee/date, so the preference/default week-off must not add more. */
  isFixedGoverned(employeeId: string, date: string): boolean;
}

export const NO_PLAN_OFFDAY_POLICY: PlanOffdayPolicy = {
  active: false,
  isFixedOff: () => false,
  isFixedGoverned: () => false,
};

export async function loadPlanOffdayPolicy(processId: string | null, exec: Executor = db): Promise<PlanOffdayPolicy> {
  if (!processId) return NO_PLAN_OFFDAY_POLICY;
  try {
    const policies = await loadActivePolicies([processId], exec);
    if (!policies.length) return NO_PLAN_OFFDAY_POLICY;
    const scopes = await loadProcessEmployeeScopes(processId, exec);
    return {
      active: true,
      isFixedOff: (id, date) => { const s = scopes.get(id); return !!s && isFixedOffDate(policies, s, date); },
      isFixedGoverned: (id, date) => { const s = scopes.get(id); return !!s && hasFixedPolicy(policies, s, date); },
    };
  } catch (err) {
    console.error("[roster-offday] plan policy unavailable; generating without it:", (err as Error)?.message);
    return NO_PLAN_OFFDAY_POLICY;
  }
}

// ── import preview warnings ──────────────────────────────────────────────────

export interface ImportRowLike {
  employeeIdRaw: string;
  rosterDate: string;
  normalizedType: string;
  messages: string[];
  extraMetadata: Record<string, unknown>;
}

export interface EmployeeScopeByCode { get(code: string): EmployeeOffScope | undefined }

/**
 * Pure: one warning per import row that conflicts with the off-day policy, keyed by row index.
 *   - a working SHIFT on a policy fixed-off day;
 *   - a WEEK_OFF on a non-off day where a FIXED_DAY policy governs the LOB;
 *   - more week-offs in a Monday-Sunday week than a FLOATING policy allows (the surplus ones).
 * Only the rows in the upload are counted for FLOATING; offs already in the roster are not.
 */
export function computeImportPolicyWarnings(
  rows: readonly ImportRowLike[], scopes: EmployeeScopeByCode, policies: readonly OffdayPolicy[],
): Map<number, string> {
  const warnings = new Map<number, string>();
  const floatingOffs = new Map<string, Array<{ index: number; date: string }>>();
  rows.forEach((row, index) => {
    const scope = scopes.get(row.employeeIdRaw);
    if (!scope || !row.rosterDate) return;
    const policy = pickPolicy(policies, scope, row.rosterDate);
    if (!policy) return;
    const dow = weekdayOf(row.rosterDate);
    if (policy.off_type === "FIXED_DAY") {
      const fixed = policy.fixed_weekdays.includes(dow);
      if (fixed && row.normalizedType === "SHIFT") {
        warnings.set(index, `Off-day policy: ${WEEKDAY_NAMES[dow]} is a fixed weekly off for this LOB, but the row assigns a working shift`);
      } else if (!fixed && row.normalizedType === "WEEK_OFF") {
        warnings.set(index, `Off-day policy: ${WEEKDAY_NAMES[dow]} is not a fixed off day for this LOB (fixed off: ${weekdayLabel(policy.fixed_weekdays)}), but the row assigns a week-off`);
      }
      return;
    }
    if (row.normalizedType === "WEEK_OFF") {
      const key = `${row.employeeIdRaw}|${weekKey(row.rosterDate)}`;
      const list = floatingOffs.get(key) ?? [];
      list.push({ index, date: row.rosterDate });
      floatingOffs.set(key, list);
    }
  });
  for (const list of floatingOffs.values()) {
    const first = rows[list[0].index];
    const limit = floatingOffsPerWeek(policies, scopes.get(first.employeeIdRaw)!, first.rosterDate);
    if (limit === null || list.length <= limit) continue;
    [...list].sort((a, b) => a.date.localeCompare(b.date)).slice(limit).forEach(({ index }) => {
      warnings.set(index, `Off-day policy: this LOB allows ${limit} week-off(s) per week, but the upload has ${list.length} in this week`);
    });
  }
  return warnings;
}

/**
 * Preview hook: appends off-day policy warnings to import rows. Never changes validation_state,
 * so an upload that was committable stays committable. Returns how many rows were warned.
 */
export async function annotateImportPolicyWarnings(rows: ImportRowLike[], exec: Executor = db): Promise<number> {
  try {
    if (!rows.length || !(await anyActivePolicyExists(exec))) return 0;
    const codes = [...new Set(rows.map((r) => r.employeeIdRaw).filter(Boolean))];
    if (!codes.length) return 0;
    const [empRows] = await exec.execute(
      `SELECT employee_code, process_id, lob_id, branch_id FROM employees WHERE employee_code IN (${codes.map(() => "?").join(",")})`,
      codes,
    ) as [RowDataPacket[], unknown];
    const scopes = new Map<string, EmployeeOffScope>();
    for (const e of empRows ?? []) {
      scopes.set(String(e.employee_code), {
        processId: e.process_id ? String(e.process_id) : null,
        lobId: e.lob_id ? String(e.lob_id) : null,
        branchId: e.branch_id ? String(e.branch_id) : null,
      });
    }
    const processIds = [...new Set([...scopes.values()].map((s) => s.processId).filter((p): p is string => !!p))];
    const policies = await loadActivePolicies(processIds, exec);
    if (!policies.length) return 0;
    const warnings = computeImportPolicyWarnings(rows, scopes, policies);
    warnings.forEach((message, index) => {
      rows[index].messages.push(message);
      rows[index].extraMetadata.offdayPolicyWarning = "true";
    });
    return warnings.size;
  } catch (err) {
    console.error("[roster-offday] import policy check skipped:", (err as Error)?.message);
    return 0;
  }
}
