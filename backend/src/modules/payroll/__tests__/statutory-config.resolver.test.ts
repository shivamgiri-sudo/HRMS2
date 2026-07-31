import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The behaviour under test is a statutory requirement, not a preference.
 *
 * TDS on salary is deducted at each employee's average rate for the year
 * (s.192), and what was deducted must later reconcile against Form 16 and the
 * quarterly 24Q. That is only possible if a past period can be recomputed at
 * the rates that were in force FOR THAT PERIOD. Under s.201(1A) a shortfall
 * carries interest — 1%/month for failure to deduct, 1.5%/month where deducted
 * and not deposited — and the liability sits with the employer, not the
 * employee.
 *
 * So: rates are selected by period, an unapproved version is never used, and a
 * missing version blocks rather than falling back to a constant.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

import {
  getStatutoryConfigForPeriod,
  checkTdsConfigForPeriod,
  REQUIRED_TDS_CONFIG_KEYS,
} from "../statutory-config.resolver.js";

/** Every required key, so a test can vary one thing at a time. */
function fullConfigRows(overrides: Record<string, number> = {}) {
  const base: Record<string, number> = {
    tds_slab_0_400000: 0,
    tds_slab_400001_800000: 5,
    tds_slab_800001_1200000: 10,
    tds_slab_1200001_1600000: 15,
    tds_slab_1600001_2000000: 20,
    tds_slab_2000001_2400000: 25,
    tds_slab_2400001_above: 30,
    tds_standard_deduction: 75000,
    tds_rebate_87a_limit: 1200000,
    tds_cess_pct: 4,
    ...overrides,
  };
  return Object.entries(base).map(([config_key, config_value]) => ({
    config_key,
    config_value: String(config_value),
  }));
}

describe("statutory config resolution by period", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("asks for the versions effective at the start of the period", async () => {
    execute.mockResolvedValue([fullConfigRows(), []]);

    await getStatutoryConfigForPeriod("2026-07");

    const [sql, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("statutory_config_version");
    // Both bounds are the period's first day: a version must have taken effect
    // by then, and must not have been closed off before it.
    expect(params).toEqual(["2026-07-01", "2026-07-01"]);
    // Unapproved rows are proposals and must never reach a computation.
    expect(sql).toContain("approved_at IS NOT NULL");
  });

  it("resolves a past period to the rates in force then, not the current ones", async () => {
    // The point of versioning: FY2025-26 asked for, FY2025-26 rates returned,
    // even though a newer version exists. Without this, a re-run of an earlier
    // month silently recomputes at today's rates and stops matching the 24Q
    // already filed for it.
    execute.mockResolvedValue([fullConfigRows({ tds_slab_400001_800000: 5 }), []]);

    const resolved = await getStatutoryConfigForPeriod("2025-06");

    const [, params] = execute.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(["2025-06-01", "2025-06-01"]);
    expect(resolved.values.tds_slab_400001_800000).toBe(5);
    expect(resolved.missing).toEqual([]);
    expect(resolved.source).toBe("versioned");
  });

  it("reports every missing key by name rather than substituting a default", async () => {
    const rows = fullConfigRows().filter(
      (r) => r.config_key !== "tds_slab_2400001_above" && r.config_key !== "tds_cess_pct",
    );
    execute.mockResolvedValue([rows, []]);

    const gate = await checkTdsConfigForPeriod("2026-07");

    expect(gate.configured).toBe(false);
    expect(gate.missing).toEqual(["tds_slab_2400001_above", "tds_cess_pct"]);
    // Named, so a finance user can act on it instead of reading a stack trace.
    expect(gate.reason).toMatch(/tds_slab_2400001_above/);
    expect(gate.reason).toMatch(/2026-07/);
  });

  it("blocks when the versioned table cannot be read at all", async () => {
    // Migration 1030 not applied yet. This must read as "not configured", never
    // as licence to fall back to hardcoded slabs.
    execute.mockRejectedValue(new Error("Table 'statutory_config_version' doesn't exist"));

    const gate = await checkTdsConfigForPeriod("2026-07");

    expect(gate.configured).toBe(false);
    expect(gate.missing).toEqual([...REQUIRED_TDS_CONFIG_KEYS]);
    expect(gate.values).toEqual({});
    expect(gate.reason).toMatch(/No approved statutory configuration/i);
  });

  it("blocks when nothing has been approved for the period", async () => {
    // Rows may exist for a LATER effective_from, or exist unapproved; either way
    // the query returns nothing for this period and payroll must not proceed.
    execute.mockResolvedValue([[], []]);

    const gate = await checkTdsConfigForPeriod("2026-07");

    expect(gate.configured).toBe(false);
    expect(gate.missing.length).toBe(REQUIRED_TDS_CONFIG_KEYS.length);
  });

  it("passes only when every required key has an approved effective version", async () => {
    execute.mockResolvedValue([fullConfigRows(), []]);

    const gate = await checkTdsConfigForPeriod("2026-07");

    expect(gate.configured).toBe(true);
    expect(gate.missing).toEqual([]);
    expect(gate.reason).toBeNull();
    expect(gate.values.tds_standard_deduction).toBe(75000);
  });

  it("rejects a malformed period instead of guessing one", async () => {
    await expect(getStatutoryConfigForPeriod("2026")).rejects.toThrow(/YYYY-MM/);
    await expect(getStatutoryConfigForPeriod("")).rejects.toThrow(/YYYY-MM/);
    expect(execute).not.toHaveBeenCalled();
  });
});
