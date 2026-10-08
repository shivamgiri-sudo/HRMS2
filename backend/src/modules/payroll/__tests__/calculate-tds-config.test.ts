import { describe, expect, it } from "vitest";
import { calculateTds } from "../payrollCalculate.service.js";
import { REQUIRED_TDS_CONFIG_KEYS } from "../statutory-regime.js";

/**
 * calculateTds no longer carries fallback slab rates.
 *
 * The removed literals were not wrong — they matched the Finance Act 2025
 * bands, which Budget 2026 left unchanged. The problem is that constants go
 * stale invisibly: once a Finance Act moves a band, code carrying `?? 5` keeps
 * deducting last year's rate and nothing reports it. Under-deduction is the
 * employer's liability, carrying interest under s.201(1A) — s.392 of the 2025
 * Act from 1 April 2026.
 *
 * Two things must hold. A configured system must compute EXACTLY what it did
 * before, so removing the fallbacks changed no one's pay. An unconfigured one
 * must refuse, and must not report the refusal as zero tax due.
 */

/** The approved FY 2025-26 / FY 2026-27 values, unchanged by Budget 2026. */
const APPROVED_CONFIG: Record<string, number> = {
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
};

describe("calculateTds with approved configuration", () => {
  it("reports a computed status and no missing keys", () => {
    const r = calculateTds(1500000, APPROVED_CONFIG);
    expect(r.status).toBe("computed");
    expect(r.missing_config_keys).toEqual([]);
  });

  it("still applies the 87A rebate at and below the nil-tax threshold", () => {
    // Total income ≤ ₹12L is nil-tax; this is the rule most employees sit under.
    expect(calculateTds(1200000, APPROVED_CONFIG).tds_annual).toBe(0);
    expect(calculateTds(900000, APPROVED_CONFIG).tds_annual).toBe(0);
    expect(calculateTds(0, APPROVED_CONFIG).tds_annual).toBe(0);
  });

  it("computes the same figures the hardcoded slabs produced", () => {
    // Regression lock. ₹15L gross: taxable after ₹75,000 standard deduction is
    // ₹14.25L. 4-8L @5% = 20,000; 8-12L @10% = 40,000; 12L-14.25L @15% = 33,750.
    // Total 93,750, plus 4% cess = 97,500.
    const r = calculateTds(1500000, APPROVED_CONFIG);
    expect(r.tds_annual).toBe(97500);
    expect(r.tds_monthly).toBe(8125);

    // ₹25L gross: taxable ₹24.25L. 20,000 + 40,000 + 60,000 (12-16L @15%)
    // + 80,000 (16-20L @20%) + 100,000 (20-24L @25%) + 7,500 (24-24.25L @30%)
    // = 307,500, plus 4% cess = 319,800.
    const high = calculateTds(2500000, APPROVED_CONFIG);
    expect(high.tds_annual).toBe(319800);
  });

  it("derives the effective rate from the computed tax", () => {
    const r = calculateTds(1500000, APPROVED_CONFIG);
    expect(r.effective_rate).toBe(6.5); // 97,500 / 15,00,000
  });
});

describe("calculateTds without approved configuration", () => {
  it("refuses rather than substituting a rate", () => {
    const r = calculateTds(1500000, {});
    expect(r.status).toBe("pending_configuration");
    expect(r.tds_annual).toBe(0);
    expect(r.tds_monthly).toBe(0);
    // Zeros here mean "no approved rate", not "no tax due" — the status is what
    // distinguishes them, which is why callers must read it.
    expect(r.missing_config_keys).toEqual([...REQUIRED_TDS_CONFIG_KEYS]);
  });

  it("names exactly which keys are absent", () => {
    const partial = { ...APPROVED_CONFIG };
    delete partial.tds_slab_2400001_above;
    delete partial.tds_cess_pct;

    const r = calculateTds(2500000, partial);

    expect(r.status).toBe("pending_configuration");
    expect(r.missing_config_keys).toEqual(["tds_slab_2400001_above", "tds_cess_pct"]);
  });

  it("treats a non-numeric or null value as missing, not as zero", () => {
    // A NULL config_value must never be read as a 0% slab — that would silently
    // deduct nothing for that band and look like a valid computation.
    const broken = { ...APPROVED_CONFIG, tds_slab_1200001_1600000: null as unknown as number };
    const r = calculateTds(1500000, broken);
    expect(r.status).toBe("pending_configuration");
    expect(r.missing_config_keys).toEqual(["tds_slab_1200001_1600000"]);
  });

  it("refuses even when the income would have been below the rebate anyway", () => {
    // Tempting to shortcut, but the answer would be "nil tax" for a reason the
    // system cannot actually justify. Configuration first, then arithmetic.
    const r = calculateTds(500000, {});
    expect(r.status).toBe("pending_configuration");
  });
});
