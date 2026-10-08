import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * statutory_config carries is_active and effective_from, and every read of the
 * table ignored both. That is not a tidiness problem: a rate switched off still
 * fed payroll, and a rate seeded ahead of a Finance Act applied from the moment
 * it was saved rather than from the date it was given.
 *
 * The hazard in fixing it is the opposite mistake. Most rows in the live table
 * have effective_from = NULL — PF, ESIC, gratuity, the standard deduction — and
 * a bare `effective_from <= ?` excludes every one of them under SQL's
 * three-valued logic, which would block payroll rather than correct it. So the
 * NULL allowance is the part these tests pin down hardest.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

import { loadFlatStatutoryConfig } from "../statutory-config.loader.js";

/** The SQL and bound params of the most recent db.execute call. */
function lastCall(): { sql: string; params: unknown[] } {
  const [sql, params] = execute.mock.calls.at(-1) as [string, unknown[]];
  return { sql, params };
}

describe("loading statutory config in force for a period", () => {
  beforeEach(() => {
    execute.mockReset();
    execute.mockResolvedValue([[], []]);
  });

  it("never returns a row that has been switched off", async () => {
    await loadFlatStatutoryConfig("2026-07");
    expect(lastCall().sql).toContain("is_active = 1");
  });

  it("treats a NULL effective_from as always in effect", async () => {
    await loadFlatStatutoryConfig("2026-07");
    const { sql } = lastCall();
    // The explicit NULL branch is the whole point: without it, the ~15 rows in
    // the live table with no recorded start date silently vanish and payroll
    // reports every statutory key as missing.
    expect(sql).toContain("effective_from IS NULL OR effective_from <=");
  });

  it("resolves a period to its first day, not to today", async () => {
    await loadFlatStatutoryConfig("2026-07");
    // A rate taking effect mid-month did not govern the month already running.
    expect(lastCall().params).toEqual(["2026-07-01"]);
  });

  it("accepts a full date unchanged, as running-salary passes one", async () => {
    await loadFlatStatutoryConfig("2026-07-01");
    expect(lastCall().params).toEqual(["2026-07-01"]);
  });

  it("defers to the database's own date when no period is in context", async () => {
    await loadFlatStatutoryConfig();
    const { sql, params } = lastCall();
    // CURDATE() rather than a JS date: this process runs in whatever timezone
    // the host has, and the comparison must agree with the rest of the schema.
    expect(sql).toContain("CURDATE()");
    expect(params).toEqual([null]);
  });

  it("rejects a malformed period rather than quietly widening the query", async () => {
    // Falling back to "no filter" on bad input would reintroduce exactly the
    // behaviour this module exists to remove.
    await expect(loadFlatStatutoryConfig("July 2026")).rejects.toThrow(/YYYY-MM/);
    await expect(loadFlatStatutoryConfig("2026")).rejects.toThrow(/YYYY-MM/);
    expect(execute).not.toHaveBeenCalled();
  });

  it("lower-cases keys, because every caller looks them up that way", async () => {
    execute.mockResolvedValue([[
      { config_key: "PF_EMPLOYEE_PCT", config_value: "12.0000" },
      { config_key: "tds_cess_pct", config_value: "4.0000" },
    ], []]);

    const config = await loadFlatStatutoryConfig("2026-07");

    expect(config).toEqual({ pf_employee_pct: 12, tds_cess_pct: 4 });
  });

  it("drops a malformed value instead of letting NaN reach net pay", async () => {
    execute.mockResolvedValue([[
      { config_key: "tds_cess_pct", config_value: "not-a-number" },
      { config_key: "pf_employee_pct", config_value: "12.0000" },
    ], []]);

    const config = await loadFlatStatutoryConfig("2026-07");

    // Absent, not NaN: the TDS contract reports a missing key as a named gap a
    // finance user can act on, whereas NaN propagates silently into a payslip.
    expect("tds_cess_pct" in config).toBe(false);
    expect(config.pf_employee_pct).toBe(12);
  });

  it("returns an empty map rather than throwing when nothing is configured", async () => {
    // The caller's job is to refuse to compute and name the gap. An exception
    // here would read as an outage instead.
    await expect(loadFlatStatutoryConfig("2026-07")).resolves.toEqual({});
  });
});
