import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Point-in-time manager attribution.
 *
 * The behaviour under test is the one the whole feature exists for: an exit belongs to the
 * manager who held the team ON THE EXIT DATE, not to whoever the pointer names today. Without
 * it, a manager inheriting a team also inherits its entire past attrition, and the manager who
 * actually presided over those exits watches their record empty itself.
 *
 * The fallback matters just as much. Manager history does not exist yet on the live database
 * (reporting_manager_change_request, transfer_record and audit_log are all empty, and
 * kpi_daily_actual.team_leader_id_at_event is populated on 0 of 71,303 rows), so nearly
 * everything starts life as `assumed_current`. These tests pin that such rows are LABELLED
 * rather than quietly counted as fact.
 */

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: mocks.execute } }));

const MANAGER = "mgr-1";
const OTHER_MANAGER = "mgr-2";

/** Rows keyed by a fragment of the SQL that identifies the query. */
function routeQueries(handlers: Array<[RegExp, unknown[]]>, fallback: unknown[] = []) {
  mocks.execute.mockImplementation(async (sql: string) => {
    for (const [pattern, rows] of handlers) {
      if (pattern.test(sql)) return [rows];
    }
    return [fallback];
  });
}

const TABLE_PRESENT: [RegExp, unknown[]] = [/information_schema\.TABLES/, [{ n: 1 }]];
const TABLE_ABSENT: [RegExp, unknown[]] = [/information_schema\.TABLES/, [{ n: 0 }]];

const ONE_LEAVER = [{
  id: "emp-1", employee_code: "MAS001", full_name: "ASHA RANI",
  exit_date: "2026-06-15", tenure_days: 400,
}];

describe("attrition attribution", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { __resetHistoryProbe } = await import("../manager-attribution.service.js");
    __resetHistoryProbe();
  });

  it("DROPS an exit that history says belonged to a different manager", async () => {
    routeQueries([
      TABLE_PRESENT,
      [/COALESCE\(e\.date_of_exit/, ONE_LEAVER],
      // History covers the exit date...
      [/FROM employee_manager_history h\s+WHERE h\.employee_id = \?\s+AND h\.effective_from/, [{ 1: 1 }]],
      // ...but the manager on that date was somebody else, so the match query finds nothing.
      [/AND h\.manager_id = \?/, []],
      [/COUNT\(\*\) AS closing/, [{ closing: 5 }]],
    ]);

    const { getManagerAttrition } = await import("../manager-attribution.service.js");
    const out = await getManagerAttrition(MANAGER, 12);

    // This is the entire point of the feature: the exit is NOT on this manager's record.
    expect(out.exits_total).toBe(0);
    expect(out.leavers).toEqual([]);
  });

  it("KEEPS an exit that history confirms, and marks it observed", async () => {
    routeQueries([
      TABLE_PRESENT,
      [/COALESCE\(e\.date_of_exit/, ONE_LEAVER],
      [/AND h\.manager_id = \?/, [{ 1: 1 }]],
      [/FROM employee_manager_history h\s+WHERE h\.employee_id = \?\s+AND h\.effective_from/, [{ 1: 1 }]],
      [/COUNT\(\*\) AS closing/, [{ closing: 5 }]],
    ]);

    const { getManagerAttrition } = await import("../manager-attribution.service.js");
    const out = await getManagerAttrition(MANAGER, 12);

    expect(out.exits_total).toBe(1);
    expect(out.exits_observed).toBe(1);
    expect(out.exits_assumed).toBe(0);
    expect(out.leavers[0].attribution).toBe("observed");
    expect(out.mostly_assumed).toBe(false);
  });

  it("counts an exit as ASSUMED — never as observed — when history is silent", async () => {
    routeQueries([
      TABLE_ABSENT, // migration 1624 has not run
      [/COALESCE\(e\.date_of_exit/, ONE_LEAVER],
      [/COUNT\(\*\) AS closing/, [{ closing: 5 }]],
    ]);

    const { getManagerAttrition } = await import("../manager-attribution.service.js");
    const out = await getManagerAttrition(MANAGER, 12);

    expect(out.exits_total).toBe(1);
    expect(out.exits_observed).toBe(0);
    expect(out.exits_assumed).toBe(1);
    expect(out.leavers[0].attribution).toBe("assumed_current");
    // The flag the UI keys its disclosure banner off.
    expect(out.mostly_assumed).toBe(true);
  });

  it("annualises the rate on average headcount and reports the window", async () => {
    routeQueries([
      TABLE_ABSENT,
      [/COALESCE\(e\.date_of_exit/, [
        { id: "e1", employee_code: "A", full_name: "A", exit_date: "2026-06-01", tenure_days: 100 },
        { id: "e2", employee_code: "B", full_name: "B", exit_date: "2026-05-01", tenure_days: 200 },
      ]],
      [/COUNT\(\*\) AS closing/, [{ closing: 8 }]],
    ]);

    const { getManagerAttrition } = await import("../manager-attribution.service.js");
    const out = await getManagerAttrition(MANAGER, 6);

    // opening = closing + exits = 10; avg = 9; 2/9 over 6 months annualises to 44.4%.
    expect(out.opening_headcount).toBe(10);
    expect(out.closing_headcount).toBe(8);
    expect(out.attrition_rate_pct).toBeCloseTo(44.4, 1);
    expect(out.window_months).toBe(6);
  });

  it("groups exits by month for the trend", async () => {
    routeQueries([
      TABLE_ABSENT,
      [/COALESCE\(e\.date_of_exit/, [
        { id: "e1", employee_code: "A", full_name: "A", exit_date: "2026-06-01", tenure_days: 10 },
        { id: "e2", employee_code: "B", full_name: "B", exit_date: "2026-06-20", tenure_days: 20 },
        { id: "e3", employee_code: "C", full_name: "C", exit_date: "2026-05-04", tenure_days: 30 },
      ]],
      [/COUNT\(\*\) AS closing/, [{ closing: 4 }]],
    ]);

    const { getManagerAttrition } = await import("../manager-attribution.service.js");
    const out = await getManagerAttrition(MANAGER, 12);

    expect(out.by_month).toEqual([
      { month: "2026-05", exits: 1, observed: 0, assumed: 1 },
      { month: "2026-06", exits: 2, observed: 0, assumed: 2 },
    ]);
  });
});

describe("shrinkage attribution", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { __resetHistoryProbe } = await import("../manager-attribution.service.js");
    __resetHistoryProbe();
  });

  it("measures the team as it stood at the START of the window, from history", async () => {
    routeQueries([
      TABLE_PRESENT,
      [/SELECT DISTINCT h\.employee_id/, [{ employee_id: "emp-a" }, { employee_id: "emp-b" }]],
      [/FROM attendance_daily_record/, [
        { d: "2026-08-01", scheduled: 2, planned: 0, unplanned: 1, missing_punch: 0 },
        { d: "2026-08-02", scheduled: 2, planned: 1, unplanned: 0, missing_punch: 0 },
      ]],
    ]);

    const { getManagerShrinkage } = await import("../manager-attribution.service.js");
    const out = await getManagerShrinkage(MANAGER, 30);

    expect(out.attribution).toBe("observed");
    expect(out.scheduled_days).toBe(4);
    expect(out.unplanned_days).toBe(1);
    expect(out.planned_days).toBe(1);
    expect(out.unplanned_pct).toBe(25);
    expect(out.total_pct).toBe(50);
  });

  it("falls back to today's team and SAYS SO when history has nothing", async () => {
    routeQueries([
      TABLE_ABSENT,
      [/SELECT id FROM employees/, [{ id: "emp-a" }]],
      [/FROM attendance_daily_record/, [
        { d: "2026-08-01", scheduled: 1, planned: 0, unplanned: 0, missing_punch: 0 },
      ]],
    ]);

    const { getManagerShrinkage } = await import("../manager-attribution.service.js");
    const out = await getManagerShrinkage(MANAGER, 30);

    expect(out.attribution).toBe("assumed_current");
  });

  it("counts missing punch inside unplanned but reports it separately for coaching", async () => {
    routeQueries([
      TABLE_ABSENT,
      [/SELECT id FROM employees/, [{ id: "emp-a" }]],
      [/FROM attendance_daily_record/, [
        { d: "2026-08-01", scheduled: 10, planned: 0, unplanned: 4, missing_punch: 3 },
      ]],
    ]);

    const { getManagerShrinkage } = await import("../manager-attribution.service.js");
    const out = await getManagerShrinkage(MANAGER, 30);

    expect(out.unplanned_days).toBe(4);
    // Surfaced on its own so a device fault is not coached as absenteeism.
    expect(out.missing_punch_days).toBe(3);
    expect(out.unplanned_pct).toBe(40);
  });

  it("returns an empty summary rather than dividing by zero on an empty team", async () => {
    routeQueries([TABLE_ABSENT, [/SELECT id FROM employees/, []]]);

    const { getManagerShrinkage } = await import("../manager-attribution.service.js");
    const out = await getManagerShrinkage(MANAGER, 30);

    expect(out.scheduled_days).toBe(0);
    expect(out.total_pct).toBeNull();
    expect(out.by_day).toEqual([]);
  });
});

describe("recordManagerChange", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { __resetHistoryProbe } = await import("../manager-attribution.service.js");
    __resetHistoryProbe();
  });

  it("closes the open period before opening the new one, so no date has two managers", async () => {
    routeQueries([
      TABLE_PRESENT,
      // An open period exists with a DIFFERENT manager, so the change is real.
      [/SELECT manager_id, process_id, branch_id/, [{ manager_id: "mgr-old", process_id: "p1", branch_id: "b1" }]],
    ]);

    const { recordManagerChange } = await import("../manager-attribution.service.js");
    await recordManagerChange({ employeeId: "emp-1", newManagerId: OTHER_MANAGER, changedBy: "user-1" });

    const statements = mocks.execute.mock.calls.map(([sql]) => String(sql));
    const closeIdx = statements.findIndex((s) => /UPDATE employee_manager_history/.test(s));
    const insertIdx = statements.findIndex((s) => /INSERT INTO employee_manager_history/.test(s));

    expect(closeIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(closeIdx);
    expect(statements[closeIdx]).toMatch(/effective_to = DATE_SUB\(CURDATE\(\), INTERVAL 1 DAY\)/);
  });

  it("carries process and branch forward when only the manager is passed", async () => {
    routeQueries([
      TABLE_PRESENT,
      [/SELECT manager_id, process_id, branch_id/, [{ manager_id: "mgr-old", process_id: "proc-9", branch_id: "br-9" }]],
    ]);

    const { recordSupervisoryChange } = await import("../manager-attribution.service.js");
    await recordSupervisoryChange({ employeeId: "emp-1", managerId: OTHER_MANAGER, changedBy: null });

    const insert = mocks.execute.mock.calls.find(([sql]) => /INSERT INTO employee_manager_history/.test(String(sql)));
    // A caller that moved only the manager must not blank the process or branch.
    expect(insert![1]).toEqual(["emp-1", OTHER_MANAGER, "proc-9", "br-9", null, null]);
  });

  it("opens a period for a PROCESS move even when the manager is unchanged", async () => {
    routeQueries([
      TABLE_PRESENT,
      [/SELECT manager_id, process_id, branch_id/, [{ manager_id: "mgr-1", process_id: "proc-old", branch_id: "br-1" }]],
    ]);

    const { recordSupervisoryChange } = await import("../manager-attribution.service.js");
    await recordSupervisoryChange({ employeeId: "emp-1", processId: "proc-new", changedBy: null });

    const insert = mocks.execute.mock.calls.find(([sql]) => /INSERT INTO employee_manager_history/.test(String(sql)));
    expect(insert).toBeDefined();
    expect(insert![1]).toEqual(["emp-1", "mgr-1", "proc-new", "br-1", null, null]);
  });

  it("writes NOTHING when a save rewrites the same values", async () => {
    routeQueries([
      TABLE_PRESENT,
      [/SELECT manager_id, process_id, branch_id/, [{ manager_id: "mgr-1", process_id: "p1", branch_id: "b1" }]],
    ]);

    const { recordSupervisoryChange } = await import("../manager-attribution.service.js");
    await recordSupervisoryChange({ employeeId: "emp-1", managerId: "mgr-1", processId: "p1", branchId: "b1", changedBy: null });

    const wrote = mocks.execute.mock.calls.some(([sql]) => /INSERT INTO employee_manager_history/.test(String(sql)));
    // A no-op save must not litter the history with empty periods.
    expect(wrote).toBe(false);
  });

  it("never throws — a history write must not break the profile edit that triggered it", async () => {
    mocks.execute.mockImplementation(async (sql: string) => {
      if (/information_schema\.TABLES/.test(sql)) return [[{ n: 1 }]];
      throw new Error("deadlock");
    });

    const { recordManagerChange } = await import("../manager-attribution.service.js");
    await expect(
      recordManagerChange({ employeeId: "emp-1", newManagerId: OTHER_MANAGER, changedBy: null }),
    ).resolves.toBeUndefined();
  });

  it("does nothing when the history table has not been created yet", async () => {
    routeQueries([TABLE_ABSENT]);

    const { recordManagerChange } = await import("../manager-attribution.service.js");
    await recordManagerChange({ employeeId: "emp-1", newManagerId: OTHER_MANAGER, changedBy: null });

    const wrote = mocks.execute.mock.calls.some(([sql]) => /INSERT INTO employee_manager_history/.test(String(sql)));
    expect(wrote).toBe(false);
  });
});
