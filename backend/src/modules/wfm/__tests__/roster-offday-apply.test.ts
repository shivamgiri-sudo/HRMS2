import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeExecute, writesOf, type Call } from "./roster-offday-generate-harness.js";

const { holder, columns } = vi.hoisted(() => ({
  holder: { fn: null as any },
  columns: { value: new Set<string>() },
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...a: any[]) => holder.fn(...a), getConnection: vi.fn() } }));
vi.mock("../shift-scheduling.util.js", () => ({
  computeScheduledMinutes: vi.fn(() => 480),
  rosterAssignmentColumns: vi.fn(async () => columns.value),
  shiftMasterColumns: vi.fn(async () => new Set<string>()),
}));
vi.mock("../rest-policy.service.js", () => ({
  isRestPolicyFeatureActive: vi.fn(async () => false),
  hasAnyRestPolicyConfigured: vi.fn(async () => true),
  validateMinimumRest: vi.fn(), applyRestDecision: vi.fn(), logRestOverride: vi.fn(),
  withEmployeeRosterLock: vi.fn(),
}));
vi.mock("../../roster/roster-lock-guard.js", () => ({ checkEmployeeDateNotLocked: vi.fn(async () => ({ blocked: false })) }));
vi.mock("../../roster/weekoff-policy.service.js", () => ({ resolveWeekOffScopeDefault: vi.fn(async () => null) }));
vi.mock("../../roster/weekoff-rule.service.js", () => ({ loadWeekoffRules: vi.fn(async () => []) }));
vi.mock("../../work-inbox/work-inbox.triggers.js", () => ({ triggerRosterPublishPending: vi.fn(async () => undefined) }));

import {
  NO_PLAN_OFFDAY_POLICY, annotateImportPolicyWarnings, computeImportPolicyWarnings, loadPlanOffdayPolicy,
  markWeekOff, stampImportBatchRows, type ImportRowLike,
} from "../roster-offday-apply.js";
import { autoRosterSyncedService } from "../auto-roster-synced.service.js";
import type { EmployeeOffScope, OffdayPolicy } from "../roster-offday-resolver.js";

const scope: EmployeeOffScope = { processId: "proc-1", lobId: "lob-1", branchId: "br-1" };
const scopes = { get: (code: string) => (code === "E-NONE" ? undefined : code === "E-OTHER" ? { ...scope, lobId: "lob-9" } : scope) };
const fixedSunday: OffdayPolicy = {
  id: "p1", process_id: "proc-1", lob_id: "lob-1", branch_id: null, off_type: "FIXED_DAY", fixed_weekdays: [0],
  floating_offs_per_week: null, effective_from: "2026-01-01", effective_to: null,
};
const floating2: OffdayPolicy = { ...fixedSunday, id: "p2", off_type: "FLOATING", fixed_weekdays: [], floating_offs_per_week: 2 };
const row = (code: string, date: string, type: string): ImportRowLike => ({ employeeIdRaw: code, rosterDate: date, normalizedType: type, messages: [], extraMetadata: {} });

describe("computeImportPolicyWarnings", () => {
  it("warns on a working shift on a fixed-off day, and only there", () => {
    const rows = [row("E1", "2026-09-06", "SHIFT"), row("E1", "2026-09-07", "SHIFT"), row("E1", "2026-09-06", "WEEK_OFF")];
    const w = computeImportPolicyWarnings(rows, scopes, [fixedSunday]);
    expect([...w.keys()]).toEqual([0]);
    expect(w.get(0)).toMatch(/Sunday is a fixed weekly off.*working shift/);
  });
  it("warns on a week-off on a non-off day for a FIXED_DAY LOB", () => {
    const w = computeImportPolicyWarnings([row("E1", "2026-09-08", "WEEK_OFF")], scopes, [fixedSunday]);
    expect(w.get(0)).toMatch(/Tuesday is not a fixed off day.*fixed off: Sunday/);
  });
  it("warns on the surplus week-offs when a FLOATING LOB exceeds offs per week", () => {
    const rows = [row("E1", "2026-09-06", "WEEK_OFF"), row("E1", "2026-09-01", "WEEK_OFF"), row("E1", "2026-09-03", "WEEK_OFF"), row("E1", "2026-09-07", "WEEK_OFF")];
    const w = computeImportPolicyWarnings(rows, scopes, [floating2]);
    expect([...w.keys()].sort()).toEqual([0]); // week Mon 08-31..Sun 09-06 has 3 offs; the latest one is the surplus
    expect(w.get(0)).toMatch(/allows 2 week-off\(s\) per week, but the upload has 3/);
  });
  it("ignores unknown employees, other LOBs, non-shift/non-off types and no policy", () => {
    expect(computeImportPolicyWarnings([row("E-NONE", "2026-09-06", "SHIFT")], scopes, [fixedSunday]).size).toBe(0);
    expect(computeImportPolicyWarnings([row("E-OTHER", "2026-09-06", "SHIFT")], scopes, [fixedSunday]).size).toBe(0);
    expect(computeImportPolicyWarnings([row("E1", "2026-09-06", "LEAVE")], scopes, [fixedSunday]).size).toBe(0);
    expect(computeImportPolicyWarnings([row("E1", "2026-09-06", "SHIFT")], scopes, []).size).toBe(0);
  });
});

describe("annotateImportPolicyWarnings", () => {
  const calls: Call[] = [];
  beforeEach(() => { calls.length = 0; });

  it("with zero policy rows leaves rows byte-identical after ONE read-only query", async () => {
    holder.fn = makeExecute(calls, { policyRows: [] });
    const rows = [row("E1", "2026-09-06", "SHIFT")];
    const before = JSON.stringify(rows);
    expect(await annotateImportPolicyWarnings(rows)).toBe(0);
    expect(JSON.stringify(rows)).toBe(before);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/SELECT 1 AS ok FROM roster_offday_policy/);
  });

  it("with a policy appends a message and never changes validation_state", async () => {
    holder.fn = vi.fn(async (sql: string) => {
      const u = sql.toUpperCase();
      if (u.includes("SELECT 1 AS OK")) return [[{ ok: 1 }]];
      if (u.includes("FROM EMPLOYEES WHERE EMPLOYEE_CODE")) return [[{ employee_code: "E1", process_id: "proc-1", lob_id: "lob-1", branch_id: "br-1" }]];
      if (u.includes("FROM ROSTER_OFFDAY_POLICY")) return [[{ ...fixedSunday, fixed_weekdays: "0" }]];
      return [[]];
    });
    const rows: Array<ImportRowLike & { validationState: string }> = [{ ...row("E1", "2026-09-06", "SHIFT"), validationState: "VALID" }];
    expect(await annotateImportPolicyWarnings(rows)).toBe(1);
    expect(rows[0].validationState).toBe("VALID");
    expect(rows[0].messages[0]).toMatch(/^Off-day policy:/);
    expect(rows[0].extraMetadata.offdayPolicyWarning).toBe("true");
  });

  it("never throws: a failing lookup means no warnings", async () => {
    holder.fn = vi.fn(async () => { throw new Error("boom"); });
    expect(await annotateImportPolicyWarnings([row("E1", "2026-09-06", "SHIFT")])).toBe(0);
  });
});

describe("stamping and week-off flag sync", () => {
  it("skips entirely when migration 1849 columns are absent", async () => {
    columns.value = new Set(["id"]);
    const fn = vi.fn(async () => [[]]); holder.fn = fn;
    await stampImportBatchRows(7, null);
    expect(fn).not.toHaveBeenCalled();
  });

  it("fills only NULLs, never mixes collations in one expression, and never touches other columns", async () => {
    columns.value = new Set(["process_id", "lob_id"]);
    const fn = vi.fn(async () => [{ affectedRows: 0 }]); holder.fn = fn;
    await stampImportBatchRows(7, "proc-fallback");
    const sqls = fn.mock.calls.map((c: any[]) => String(c[0]).replace(/\s+/g, " "));
    expect(sqls).toHaveLength(3);
    for (const s of sqls) {
      expect(s).toMatch(/^UPDATE wfm_roster_assignment wra/);
      expect(s).toMatch(/wra\.import_batch_id = \?/);
      expect(s).toMatch(/wra\.(process_id|lob_id) IS NULL/);
      expect(s).not.toMatch(/COALESCE|IF\(/i);
      expect(s.replace(/SET wra\.(process_id|lob_id) = [^ ]+/, "")).not.toMatch(/ SET /);
    }
    expect(fn.mock.calls[1][1]).toEqual(["proc-fallback", 7]);
  });

  it("a stamping failure is logged, not thrown", async () => {
    columns.value = new Set(["process_id", "lob_id"]);
    holder.fn = vi.fn(async () => { throw new Error("lock wait"); });
    await expect(stampImportBatchRows(7, null)).resolves.toBeUndefined();
  });

  it("markWeekOff writes is_week_off and assignment_type in ONE statement", async () => {
    const fn = vi.fn(async () => [{ affectedRows: 1 }]); holder.fn = fn;
    await markWeekOff("emp-A", "2026-09-06");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(String(fn.mock.calls[0][0])).toMatch(/SET is_week_off = \?, assignment_type = \?/);
    expect(fn.mock.calls[0][1]).toEqual([1, "WEEK_OFF", "emp-A", "2026-09-06"]);
  });
});

describe("loadPlanOffdayPolicy", () => {
  it("is inert with no process or no policy rows", async () => {
    expect(await loadPlanOffdayPolicy(null)).toBe(NO_PLAN_OFFDAY_POLICY);
    holder.fn = makeExecute([], { policyRows: [] });
    expect(await loadPlanOffdayPolicy("proc-1")).toBe(NO_PLAN_OFFDAY_POLICY);
  });
});

describe("generateDraft with a FIXED_DAY policy (Sunday, LOB lob-1)", () => {
  it("gives the LOB its Sunday off with both flags, keeps them off shifts, and ignores their floating preference", async () => {
    columns.value = new Set(["process_id", "lob_id"]);
    const calls: Call[] = [];
    holder.fn = makeExecute(calls, { policyRows: [{ ...fixedSunday, fixed_weekdays: "0" }] });
    await autoRosterSyncedService.generateDraft("plan-1", "actor-1");
    const w = writesOf(calls);
    const inserts = w.filter((x) => x.sql.startsWith("INSERT INTO wfm_roster_assignment"));
    // Insert params: [id, employee_id, plan_id, roster_date, ...] for week-offs; [id, employee_id, shift_id, plan_id, roster_date, ...] for shifts.
    const offRows = inserts.filter((x) => x.sql.includes("'Week Off', 1"));
    expect(offRows.map((x) => [x.params[1], x.params[3]]).sort()).toEqual(
      [["emp-A", "2026-09-06"], ["emp-B", "2026-09-06"]],
    );
    // emp-A prefers Wednesday, but a FIXED_DAY policy governs the LOB, so no Wednesday off is added.
    expect(offRows.some((x) => x.params[3] === "2026-09-02")).toBe(false);
    // Nobody in lob-1 is rostered to a shift on the fixed-off day.
    const shiftsOnSunday = inserts.filter((x) => !x.sql.includes("'Week Off'") && x.params[4] === "2026-09-06");
    expect(shiftsOnSunday.map((x) => x.params[1])).not.toContain("emp-A");
    expect(shiftsOnSunday.map((x) => x.params[1])).not.toContain("emp-B");
    // Both flags are set together through the shared helper, once per fixed off.
    const flagSync = w.filter((x) => /SET is_week_off = \?, assignment_type = \?/.test(x.sql));
    expect(flagSync.map((x) => x.params)).toEqual([[1, "WEEK_OFF", "emp-A", "2026-09-06"], [1, "WEEK_OFF", "emp-B", "2026-09-06"]]);
    // Rows are stamped with process/LOB (NULL-only) once per plan.
    expect(calls.some((c) => /UPDATE wfm_roster_assignment wra JOIN employees e/.test(c.sql) && /wra\.plan_id = \?/.test(c.sql))).toBe(true);
  });
});
