import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Professional Tax — full removal, 2026-09-11 (stakeholder-confirmed, company-wide,
 * all states, go-forward only).
 *
 * This file used to pin the state-aware PT resolution logic: a known-PT-state slab
 * lookup, a no-PT-state returning 0, and an unknown/unconfigured state refusing to
 * guess (rather than falling back to a hardcoded 200 — the historical regression
 * this suite originally existed to prevent; see git history for the pre-removal
 * version of these tests, which is preserved there for that context).
 *
 * PT has now been withdrawn from payroll entirely, for every employee regardless of
 * state, effective for runs computed from 2026-09-11 onward. Already-finalised /
 * historical runs are NOT rewritten — this only changes what future computation
 * produces. resolveProfessionalTax() and buildStatutoryRow() keep their exact
 * signatures (and buildStatutoryRow still carries a professional_tax field) purely
 * so every existing caller keeps compiling; neither does a state lookup any more.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute, getConnection: vi.fn() },
}));

import {
  resolveProfessionalTax, buildStatutoryRow, getPtFromSlab,
  isProfessionalTaxActiveForMonth, PT_REMOVED_FROM_MONTH,
} from "../payrollCalculate.service.js";

describe("professional tax is no longer resolved or applied (removed 2026-09-11)", () => {
  beforeEach(() => execute.mockReset());

  it("resolves to 0 for a state that used to levy professional tax", async () => {
    await expect(
      resolveProfessionalTax("MAS1234", "Gujarat", 30000),
    ).resolves.toBe(0);
    // No slab lookup happens any more -- there is nothing left to look up.
    expect(execute).not.toHaveBeenCalled();
  });

  it("resolves to 0 for a state that never levied professional tax", async () => {
    await expect(
      resolveProfessionalTax("MAS1234", "Uttar Pradesh", 30000),
    ).resolves.toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it("resolves to 0 for an unknown/unconfigured state instead of refusing", async () => {
    // Previously this threw ("cannot be determined") to avoid inventing a figure --
    // with PT gone entirely, 0 is not a guess, it is the removed value, so there is
    // nothing left to block the run on.
    await expect(resolveProfessionalTax("MAS9999", null, 30000)).resolves.toBe(
      0,
    );
    await expect(
      resolveProfessionalTax("MAS9999", undefined, 30000),
    ).resolves.toBe(0);
    await expect(resolveProfessionalTax("MAS9999", "", 30000)).resolves.toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it("never falls back to the old hardcoded 200 default", async () => {
    const outcome = await resolveProfessionalTax("MAS1234", null, 30000);
    expect(outcome).toBe(0);
    expect(outcome).not.toBe(200);
  });

  it("is state-independent: a known-exempt state and a known-levying state resolve identically", async () => {
    const delhi = await resolveProfessionalTax("MAS1", "DELHI", 30000);
    const gujarat = await resolveProfessionalTax("MAS2", "  Gujarat  ", 30000);
    expect(delhi).toBe(0);
    expect(gujarat).toBe(0);
  });
});

describe("PF and ESIC parameters", () => {
  it("keeps the PF wage limit from configuration, not the statutory ceiling", () => {
    // Production sets 999999: this employer contributes PF on wages above the
    // ₹15,000 EPF ceiling, which is permitted and deliberate. If this assertion
    // ever fails because someone hardcoded 15000, that change cuts every
    // employee's PF — it is not a correction. Unrelated to PT removal; kept as-is.
    const row = buildStatutoryRow({
      pf_wage_limit: 999999,
      pf_employee_pct: 12,
    });
    expect(row.pf_wage_limit).toBe(999999);
  });

  it("carries PF and ESIC rates through from configuration", () => {
    const row = buildStatutoryRow({
      pf_employee_pct: 12,
      esic_employee_pct: 0.75,
      esic_employer_pct: 3.25,
      esic_wage_limit: 21000,
      pf_wage_limit: 999999,
    });
    expect(row).toMatchObject({
      pf_employee_pct: 12,
      esic_employee_pct: 0.75,
      esic_employer_pct: 3.25,
      esic_wage_limit: 21000,
    });
  });

  it("no longer carries a professional-tax default -- the field is inert, always 0", () => {
    // The field remains on the row for compatibility (some caller may still read
    // it), but it is not a fallback any more: nothing computes a nonzero value for
    // it, and passing one in explicitly is ignored too -- PT is off, full stop.
    expect(buildStatutoryRow({}).professional_tax).toBe(0);
    expect(buildStatutoryRow({ professional_tax: 200 }).professional_tax).toBe(
      0,
    );
  });
});

describe("professional tax stays in force for months BEFORE the removal month", () => {
  // MAS60236, 2026-08: db_bill deducts 200; a recalculation under the always-zero rule dropped it.
  beforeEach(() => execute.mockReset());

  it("removal starts with September 2026 payroll", () => {
    expect(PT_REMOVED_FROM_MONTH).toBe("2026-09");
    expect(isProfessionalTaxActiveForMonth("2026-08")).toBe(true);
    expect(isProfessionalTaxActiveForMonth("2026-08-01")).toBe(true);
    expect(isProfessionalTaxActiveForMonth("2025-12")).toBe(true);
    expect(isProfessionalTaxActiveForMonth("2026-09")).toBe(false);
    expect(isProfessionalTaxActiveForMonth("2026-09-30")).toBe(false);
    expect(isProfessionalTaxActiveForMonth("2027-01")).toBe(false);
    expect(isProfessionalTaxActiveForMonth(undefined)).toBe(false);
  });

  it("resolves a Gujarat slab for 2026-08", async () => {
    execute.mockResolvedValueOnce([[{ pt_amount: 200 }]]);
    await expect(resolveProfessionalTax("MAS60236", "Gujarat", 59140, "2026-08")).resolves.toBe(200);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("a state with no PT law is 0 for an earlier month", async () => {
    execute.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]]);
    await expect(resolveProfessionalTax("MAS1", "Uttar Pradesh", 30000, "2026-08")).resolves.toBe(0);
  });

  it("an earlier month with no branch state still refuses to guess", async () => {
    await expect(resolveProfessionalTax("MAS9", null, 30000, "2026-08")).rejects.toThrow(/no state set/);
    expect(execute).not.toHaveBeenCalled();
  });

  it("2026-09 and later never read the slab table", async () => {
    await expect(resolveProfessionalTax("MAS60236", "Gujarat", 59140, "2026-09")).resolves.toBe(0);
    await expect(getPtFromSlab("Gujarat", 59140, "2026-10")).resolves.toBe(0);
    await expect(getPtFromSlab("Gujarat", 59140)).resolves.toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });
});
