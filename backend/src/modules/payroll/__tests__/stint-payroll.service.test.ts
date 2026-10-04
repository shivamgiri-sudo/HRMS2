import { describe, it, expect, vi } from "vitest";

// The service imports the shared pool as its default executor; every test passes its own fake, so the
// real pool must never be touched.
vi.mock("../../../db/mysql.js", () => ({
  db: { execute: vi.fn(async () => { throw new Error("real db must not be used"); }) },
}));

import { isStintPayrollEnabled, loadStintScopes, STINT_PAYROLL_FLAG_KEY } from "../stint-payroll.service.js";

type Row = Record<string, unknown>;

/** Fake executor: answers by SQL substring and records every call. */
function fakeExec(answer: (sql: string, params: unknown[]) => Row[]) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  return {
    calls,
    async execute(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      return [answer(sql, params), []] as unknown as [never, unknown];
    },
  };
}

const flagExec = (rows: Row[]) =>
  fakeExec((sql) => (sql.includes("payroll_config_flags") ? rows : []));

describe("isStintPayrollEnabled", () => {
  it("reads the global row of the rejoin flag", async () => {
    const exec = flagExec([{ config_value: "true" }]);
    await isStintPayrollEnabled(exec);
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0]!.sql).toContain("branch_id IS NULL AND process_id IS NULL");
    expect(exec.calls[0]!.params).toEqual([STINT_PAYROLL_FLAG_KEY]);
    expect(STINT_PAYROLL_FLAG_KEY).toBe("rejoin_stint_payroll_enabled");
  });

  it("a missing row is OFF", async () => {
    expect(await isStintPayrollEnabled(flagExec([]))).toBe(false);
  });

  it("'true' is ON, case and whitespace tolerant", async () => {
    expect(await isStintPayrollEnabled(flagExec([{ config_value: "true" }]))).toBe(true);
    expect(await isStintPayrollEnabled(flagExec([{ config_value: "TRUE " }]))).toBe(true);
  });

  it("anything else is OFF", async () => {
    expect(await isStintPayrollEnabled(flagExec([{ config_value: "false" }]))).toBe(false);
    expect(await isStintPayrollEnabled(flagExec([{ config_value: "yes" }]))).toBe(false);
    expect(await isStintPayrollEnabled(flagExec([{ config_value: null }]))).toBe(false);
  });

  it("a read error is OFF (fails closed)", async () => {
    const throwing = { execute: async () => { throw new Error("ER_NO_SUCH_TABLE"); } };
    expect(await isStintPayrollEnabled(throwing as never)).toBe(false);
  });
});

const SEP_START = "2026-09-01";
const SEP_END = "2026-09-30";

const stintRows: Row[] = [
  // rejoiner: Sep 1-10 then Sep 20 onward
  { employee_id: "rejoiner", start_date: "2024-01-15", end_date: "2026-09-10" },
  { employee_id: "rejoiner", start_date: "2026-09-20", end_date: null },
  // gapper: left in June, rejoins mid October -> September is wholly inside the gap
  { employee_id: "gapper", start_date: "2026-01-01", end_date: "2026-06-30" },
  { employee_id: "gapper", start_date: "2026-10-15", end_date: null },
];

const stintExec = () =>
  fakeExec((sql, params) =>
    sql.includes("employment_stint") ? stintRows.filter((r) => params.includes(r.employee_id)) : [],
  );

describe("loadStintScopes", () => {
  it("an empty id list does no query", async () => {
    const exec = stintExec();
    const out = await loadStintScopes([], SEP_START, SEP_END, new Map(), new Map(), exec);
    expect(out.size).toBe(0);
    expect(exec.calls).toHaveLength(0);
  });

  it("only employees with stint rows are in the map", async () => {
    const exec = stintExec();
    const out = await loadStintScopes(["plain", "rejoiner"], SEP_START, SEP_END, new Map(), new Map(), exec);
    expect([...out.keys()]).toEqual(["rejoiner"]);
    expect(out.has("plain")).toBe(false);
  });

  it("summarises the September gap month: 21 employed days, 3 Sundays", async () => {
    const out = await loadStintScopes(["rejoiner"], SEP_START, SEP_END, new Map(), new Map(), stintExec());
    const s = out.get("rejoiner")!;
    expect(s.employedDays).toBe(21);
    expect(s.sundays).toBe(3);
    expect(s.ranges).toEqual([
      { from: "2026-09-01", to: "2026-09-10" },
      { from: "2026-09-20", to: "2026-09-30" },
    ]);
    expect(s.stints).toHaveLength(2);
  });

  it("a rejoiner whose month is wholly inside the gap IS in the map, with 0 employed days", async () => {
    const out = await loadStintScopes(["gapper"], SEP_START, SEP_END, new Map(), new Map(), stintExec());
    expect(out.has("gapper")).toBe(true);
    expect(out.get("gapper")!.employedDays).toBe(0);
    expect(out.get("gapper")!.ranges).toEqual([]);
  });

  it("honours salary_start_date", async () => {
    const out = await loadStintScopes(
      ["rejoiner"], SEP_START, SEP_END, new Map([["rejoiner", "2026-09-05"]]), new Map(), stintExec());
    expect(out.get("rejoiner")!.employedDays).toBe(6 + 11);
  });

  it("caps the open stint at the resolved Last Working Day (a rejoiner who resigns again)", async () => {
    // employed Sep 1-10 and Sep 20-25 (LWD 25th): 10 + 6 = 16 days; Sundays 6 and 20 (27 is after LWD)
    const out = await loadStintScopes(
      ["rejoiner"], SEP_START, SEP_END, new Map(), new Map([["rejoiner", "2026-09-25"]]), stintExec());
    expect(out.get("rejoiner")!.employedDays).toBe(16);
    expect(out.get("rejoiner")!.sundays).toBe(2);
    expect(out.get("rejoiner")!.ranges.at(-1)).toEqual({ from: "2026-09-20", to: "2026-09-25" });
  });

  it("an end date after the month (or none) leaves the month untouched", async () => {
    const out = await loadStintScopes(
      ["rejoiner"], SEP_START, SEP_END, new Map(), new Map([["rejoiner", "2026-11-30"]]), stintExec());
    expect(out.get("rejoiner")!.employedDays).toBe(21);
  });

  it("binds every id, never interpolates them, and orders by stint", async () => {
    const exec = stintExec();
    await loadStintScopes(["a", "b", "rejoiner"], SEP_START, SEP_END, new Map(), new Map(), exec);
    expect(exec.calls).toHaveLength(1);
    expect(exec.calls[0]!.params).toEqual(["a", "b", "rejoiner"]);
    expect(exec.calls[0]!.sql).toContain("IN (?,?,?)");
    expect(exec.calls[0]!.sql).not.toContain("rejoiner");
    expect(exec.calls[0]!.sql).toContain("ORDER BY employee_id, stint_no");
  });

  it("chunks a large population and still binds every id exactly once", async () => {
    const exec = stintExec();
    const ids = Array.from({ length: 2500 }, (_, i) => `e${i}`).concat("rejoiner");
    const out = await loadStintScopes(ids, SEP_START, SEP_END, new Map(), new Map(), exec);
    expect(exec.calls.length).toBeGreaterThan(1);
    expect(exec.calls.flatMap((c) => c.params)).toEqual(ids);
    expect(out.get("rejoiner")!.employedDays).toBe(21);
  });
});
