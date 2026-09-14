import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * taxEngineService must not carry hardcoded tax slabs.
 *
 * getConfig and getSlabs each fell back to in-code constants when
 * payroll_tax_fy_config / payroll_tax_slab_master held no row for the financial
 * year and regime. The removed literals were not wrong on the day they were
 * written — but constants go stale invisibly: once a Finance Act moves a band,
 * code carrying them keeps deducting last year's rate and nothing reports it.
 * Under-deduction is the employer's liability under s.201(1A), with interest, and
 * it surfaces through the tax department rather than through payroll.
 *
 * The old-regime fallback had already drifted: it carried the pre-2023 bands
 * (250k / 500k / 1000k), which do not match what payroll_tax_slab_master actually
 * holds, so that path could tax an old-regime employee on bands nobody approved.
 *
 * This mirrors the rule calculate-tds-config.test.ts already pins for
 * calculateTds, so both TDS routes now refuse rather than guess.
 *
 * Verified against production before shipping: FY2025-26 and FY2026-27 are seeded
 * for both regimes (13/8 and 14/8 slab rows), so nothing in use throws. FY2027-28
 * is not seeded, which is precisely the case this is meant to catch loudly in
 * April 2027 instead of silently applying 2025 bands.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

import { taxEngineService } from "../taxEngine.service.js";

const SOURCE = readFileSync(
  resolve(process.cwd(), "src/modules/payroll-compliance/taxEngine.service.ts"),
  "utf8",
);

describe("configured financial years still resolve from the database", () => {
  beforeEach(() => execute.mockReset());

  it("returns the approved FY config row unchanged", async () => {
    execute.mockResolvedValueOnce([[{ standard_deduction: 75000, rebate_limit: 1200000, rebate_max_amount: 60000, cess_pct: 4 }]]);

    const cfg = await taxEngineService.getConfig("2026-27", "new");

    expect(cfg.standard_deduction).toBe(75000);
  });

  it("returns the approved slab rows unchanged", async () => {
    execute.mockResolvedValueOnce([[
      { slab_from: 0, slab_to: 400000, rate_pct: 0 },
      { slab_from: 400000, slab_to: 800000, rate_pct: 5 },
    ]]);

    const slabs = await taxEngineService.getSlabs("2026-27", "new");

    expect(slabs).toHaveLength(2);
  });
});

describe("an unconfigured financial year refuses instead of guessing", () => {
  beforeEach(() => execute.mockReset());

  for (const regime of ["new", "old"] as const) {
    it(`getConfig throws for an unseeded FY on the ${regime} regime`, async () => {
      execute.mockResolvedValueOnce([[]]);

      await expect(taxEngineService.getConfig("2027-28", regime)).rejects.toThrow(
        /No approved tax configuration for financial year 2027-28/,
      );
    });

    it(`getSlabs throws for an unseeded FY on the ${regime} regime`, async () => {
      execute.mockResolvedValueOnce([[]]);

      await expect(taxEngineService.getSlabs("2027-28", regime)).rejects.toThrow(
        /No approved tax slabs for financial year 2027-28/,
      );
    });
  }

  it("names what to seed, so the failure is actionable rather than just loud", async () => {
    execute.mockResolvedValueOnce([[]]);
    await expect(taxEngineService.getConfig("2027-28", "new")).rejects.toThrow(
      /payroll_tax_fy_config/,
    );
  });
});

describe("no tax rate survives as a code constant", () => {
  it("the slab boundaries that used to be hardcoded are gone from the source", () => {
    // The exact literals removed. Their reappearance means someone reinstated a
    // fallback table, which is the defect this exists to prevent.
    for (const literal of ["slab_to: 400000", "slab_to: 250000", "slab_to: 1000000", "rate_pct: 30"]) {
      expect(SOURCE, `hardcoded slab literal is back: ${literal}`).not.toContain(literal);
    }
  });

  it("the standard-deduction and rebate constants are gone too", () => {
    for (const literal of ["standard_deduction: 75000", "standard_deduction: 50000", "rebate_limit: 1200000"]) {
      expect(SOURCE, `hardcoded FY constant is back: ${literal}`).not.toContain(literal);
    }
  });
});
