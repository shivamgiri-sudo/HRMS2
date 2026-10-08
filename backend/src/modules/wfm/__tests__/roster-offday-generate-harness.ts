/**
 * Shared harness for the zero-policy-unchanged proof: runs generateDraft() (auto-roster-synced)
 * against a SQL-keyed db mock and returns every write it made, uuid-normalised.
 *
 * It imports nothing that exists only after the off-day feature, so the SAME harness ran against
 * the pre-feature tree (ed9c6124) to produce __fixtures__/generate-draft-zero-policy.golden.json.
 */
import { vi } from "vitest";

export type Call = { sql: string; params: unknown[] };
export interface Scenario {
  policyRows?: Array<Record<string, unknown>>;
  employees?: Array<Record<string, unknown>>;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
export const norm = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(norm) : typeof v === "string" ? v.replace(UUID, "<uuid>") : v;

export const EMPLOYEES = [
  { id: "emp-A", employee_code: "E1", process_id: "proc-1", branch_id: "br-1", lob_id: "lob-1", full_name: "A" },
  { id: "emp-B", employee_code: "E2", process_id: "proc-1", branch_id: "br-1", lob_id: "lob-1", full_name: "B" },
  { id: "emp-C", employee_code: "E3", process_id: "proc-1", branch_id: "br-1", lob_id: "lob-2", full_name: "C" },
];

const TABLE_COLUMNS: Record<string, string[]> = {
  employees: ["id", "employee_code", "process_id", "branch_id", "full_name", "active_status", "lob_id"],
  week_off_preference: ["employee_id", "preferred_day", "approved"],
  process_master: ["process_name"],
  branch_master: ["branch_name"],
  wfm_roster_assignment: ["id", "employee_id", "plan_id", "roster_date", "is_week_off", "assignment_type"],
};
const TABLES = new Set(["employees", "week_off_preference", "process_master", "branch_master"]);

/** Build the db.execute implementation; every call is pushed onto `calls`. */
export function makeExecute(calls: Call[], scenario: Scenario = {}) {
  const employees = scenario.employees ?? EMPLOYEES;
  return vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const s = sql.replace(/\s+/g, " ").trim();
    const u = s.toUpperCase();
    if (u.includes("INFORMATION_SCHEMA.COLUMNS")) {
      const table = String(params[0] ?? (/TABLE_NAME = '([a-z_]+)'/.exec(s)?.[1] ?? ""));
      return [(TABLE_COLUMNS[table] ?? []).map((c) => ({ COLUMN_NAME: c })), []];
    }
    if (u.includes("INFORMATION_SCHEMA.TABLES")) return [TABLES.has(String(params[0])) ? [{ TABLE_NAME: params[0] }] : [], []];
    if (u.startsWith("SELECT * FROM WFM_ROSTER_PLAN WHERE")) {
      return [[{ id: "plan-1", process_id: "proc-1", branch_id: "br-1", from_date: "2026-08-31", to_date: "2026-09-06" }], []];
    }
    if (u.startsWith("SELECT * FROM WFM_ROSTER_PLAN_CONTROL")) return [[{ plan_id: "plan-1", approval_status: "draft", shrinkage_pct: 0 }], []];
    if (u.includes("FROM PROCESS_MASTER WHERE ID")) return [[{ name: "Proc One" }], []];
    if (u.includes("FROM BRANCH_MASTER WHERE ID")) return [[{ name: "Branch One" }], []];
    if (u.startsWith("SELECT WP.EMPLOYEE_ID, WP.PREFERRED_DAY")) return [[{ employee_id: "emp-A", preferred_day: 3 }], []];
    if (u.includes("FROM WFM_CLIENT_SLOT_REQUIREMENT")) return [[{ slot_start: "09:00", slot_end: "18:00", required_hc: 1, shrinkage_pct: 0 }], []];
    if (u.includes("FROM WFM_SLOT_REQUIREMENT")) return [[{ hc_floor: 0 }], []];
    if (u.startsWith("SELECT ID, EMPLOYEE_CODE") && u.includes("FROM EMPLOYEES") && !u.includes("WHERE PROCESS_ID = ? ")) {
      return [employees, []];
    }
    if (u.startsWith("SELECT ID, PROCESS_ID, LOB_ID, BRANCH_ID FROM EMPLOYEES")) return [employees, []];
    if (u.includes("FROM ROSTER_OFFDAY_POLICY")) return [scenario.policyRows ?? [], []];
    if (u.startsWith("SELECT 1 AS OK FROM ROSTER_OFFDAY_POLICY")) return [(scenario.policyRows ?? []).length ? [{ ok: 1 }] : [], []];
    return [[], []];
  });
}

/** Writes worth comparing: assignment / conflict statements, uuid-normalised, minus schema probes. */
export function writesOf(calls: Call[]) {
  return calls
    .filter((c) => /^(INSERT|UPDATE|DELETE)/i.test(c.sql.trim()) && /wfm_roster_assignment|wfm_roster_conflict_log/.test(c.sql))
    .map((c) => ({ sql: c.sql.replace(/\s+/g, " ").trim(), params: norm(c.params) }));
}
