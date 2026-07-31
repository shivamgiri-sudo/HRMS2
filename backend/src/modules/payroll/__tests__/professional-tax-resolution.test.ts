import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Professional tax is levied by the STATE. There is no organisation-wide amount
 * that could be correct for an employee whose state is unknown.
 *
 * The engine used to fall back to a hardcoded 200 — a number nobody configured,
 * since statutory_config has never held a professional_tax key. Measured against
 * production, in the 2026-03 run alone that deducted ₹200 from 172 employees
 * whose branch had no state (₹34,400), while employees in Uttar Pradesh and
 * Delhi — states that levy no professional tax — correctly paid nothing.
 *
 * These tests pin both halves: the known-state path, which was always right and
 * must keep returning 0 for a no-PT state, and the unknown-state path, which
 * must now stop rather than invent a figure.
 *
 * They also pin the PF wage limit, for the opposite reason: 999999 in production
 * is deliberate — this employer contributes PF above the ₹15,000 statutory
 * ceiling — and "correcting" it to 15000 would cut every employee's PF and
 * change take-home pay.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute, getConnection: vi.fn() } }));

import { resolveProfessionalTax, buildStatutoryRow } from "../payrollCalculate.service.js";

describe("professional tax when the state is unknown", () => {
  beforeEach(() => execute.mockReset());

  it("refuses to compute rather than deducting an invented amount", async () => {
    await expect(resolveProfessionalTax("MAS1234", null, 30000)).rejects.toThrow(
      /Professional tax cannot be determined for MAS1234/,
    );
    // Never reaches the slab lookup — there is nothing to look up.
    expect(execute).not.toHaveBeenCalled();
  });

  it("names the employee and the fix, so the run is actionable", async () => {
    // A run that stops with "cannot compute" and no subject is not actionable;
    // this is the difference between a five-minute fix and an investigation.
    await expect(resolveProfessionalTax("MAS9999", "", 30000)).rejects.toThrow(/MAS9999/);
    await expect(resolveProfessionalTax("MAS9999", undefined, 30000)).rejects.toThrow(
      /branch has no state set/,
    );
  });

  it("does not fall back to 200", async () => {
    // The specific regression. 200 was never configuration — it was a literal.
    // Asserted as "rejects" rather than "does not return 200", because any
    // returned number here would be a guess whatever its value.
    const outcome = await resolveProfessionalTax("MAS1234", null, 30000).then(
      (value) => ({ resolved: true, value }),
      (err: Error) => ({ resolved: false, value: err.message }),
    );
    expect(outcome.resolved).toBe(false);
    expect(outcome.value).not.toBe(200);
  });
});

describe("professional tax when the state is known", () => {
  beforeEach(() => execute.mockReset());

  it("uses the state's slab amount", async () => {
    execute.mockResolvedValueOnce([[{ pt_amount: 200 }], []]);
    await expect(resolveProfessionalTax("MAS1234", "Gujarat", 30000)).resolves.toBe(200);
  });

  it("returns 0 for a state that levies no professional tax", async () => {
    // Uttar Pradesh and Delhi have no PT, and 780+ employees sit in UP. Zero
    // here is the correct answer, not a missing one.
    execute
      .mockResolvedValueOnce([[], []])   // no slab matches this income
      .mockResolvedValueOnce([[], []]);  // and the state has no slabs at all
    await expect(resolveProfessionalTax("MAS1234", "Uttar Pradesh", 30000)).resolves.toBe(0);
  });

  it("returns 0 when the state has slabs but the income is below the lowest", async () => {
    execute
      .mockResolvedValueOnce([[], []])          // no bracket for this income
      .mockResolvedValueOnce([[{ 1: 1 }], []]); // but the state does levy PT
    await expect(resolveProfessionalTax("MAS1234", "Maharashtra", 5000)).resolves.toBe(0);
  });
});

describe("PF and ESIC parameters", () => {
  it("keeps the PF wage limit from configuration, not the statutory ceiling", () => {
    // Production sets 999999: this employer contributes PF on wages above the
    // ₹15,000 EPF ceiling, which is permitted and deliberate. If this assertion
    // ever fails because someone hardcoded 15000, that change cuts every
    // employee's PF — it is not a correction.
    const row = buildStatutoryRow({ pf_wage_limit: 999999, pf_employee_pct: 12 });
    expect(row.pf_wage_limit).toBe(999999);
  });

  it("carries PF and ESIC rates through from configuration", () => {
    const row = buildStatutoryRow({
      pf_employee_pct: 12, esic_employee_pct: 0.75, esic_employer_pct: 3.25,
      esic_wage_limit: 21000, pf_wage_limit: 999999,
    });
    expect(row).toMatchObject({
      pf_employee_pct: 12, esic_employee_pct: 0.75,
      esic_employer_pct: 3.25, esic_wage_limit: 21000,
    });
  });

  it("no longer carries a professional-tax default", () => {
    // The field remains on the row for compatibility, but it is not a fallback
    // any more: nothing reads it, and 0 rather than 200 makes that visible.
    expect(buildStatutoryRow({}).professional_tax).toBe(0);
  });
});
