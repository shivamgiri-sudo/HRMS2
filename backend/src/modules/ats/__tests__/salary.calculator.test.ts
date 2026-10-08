import { describe, it, expect } from "vitest";

import { calculateSalary } from "../salary.calculator";

describe("calculateSalary", () => {
  it("computes gross and net for Band D CTC 100000 non-metro", async () => {
    const r = await calculateSalary(100000, 40, 40, false);
    // gross = ctc - pf_employer - esic_employer - admin
    // monthly gross ~ 7692 (≤ 21000 → ESIC applies)
    expect(r.offered_ctc).toBeCloseTo(100000 / 12, 0);
    expect(r.gross).toBeGreaterThan(0);
    expect(r.basic).toBeGreaterThan(0);
    expect(r.net_in_hand).toBeGreaterThan(0);
    expect(r.net_in_hand).toBeLessThan(r.gross);
  });

  it("does not apply ESIC when monthly gross > 21000", async () => {
    const r = await calculateSalary(400000, 45, 40, false);
    // monthly gross ≈ 400000 / 12 = 33333 > 21000 → no ESIC
    expect(r.esic_employee).toBe(0);
    expect(r.esic_employer).toBe(0);
  });

  it("applies no PF wage ceiling, matching statutory_config.pf_wage_limit=999999 (full basic)", async () => {
    const r = await calculateSalary(1000000, 50, 50, false);
    // 12% of actual (uncapped) monthly basic -- previously wrongly capped at ₹1,800/month.
    expect(r.pf_employee).toBeCloseTo(r.basic * 0.12, 1);
    expect(r.pf_employee).toBeGreaterThan(1800);
  });

  it("all values stored as monthly (annual / 12)", async () => {
    const r = await calculateSalary(120000, 40, 40, false);
    // monthly ctc = 10000
    expect(r.offered_ctc).toBeCloseTo(120000 / 12, 0);
  });

  it("zeroes PF/ESIC and their admin charge when opted out, without reducing net by gratuity", async () => {
    const deducted = await calculateSalary(
      720000,
      40,
      40,
      false,
      undefined,
      true,
      true,
    );
    const optedOut = await calculateSalary(
      720000,
      40,
      40,
      false,
      undefined,
      false,
      false,
    );
    expect(optedOut.pf_employee).toBe(0);
    expect(optedOut.pf_employer).toBe(0);
    expect(optedOut.esic_employee).toBe(0);
    expect(optedOut.esic_employer).toBe(0);
    expect(optedOut.admin_charges).toBe(0);
    expect(deducted.admin_charges).toBeGreaterThan(0);
    // Opting out removes employer-side PF/admin cost from the CTC-to-gross
    // subtraction, so gross (and net) rise relative to the deducted case.
    expect(optedOut.gross).toBeGreaterThan(deducted.gross);
    expect(optedOut.net_in_hand).toBeGreaterThan(deducted.net_in_hand);
  });

  // Professional Tax removal (2026-09-11): PT was explicitly approved for full
  // removal from payroll company-wide, all states, go-forward only
  // (stakeholder-confirmed). calculateSalary no longer resolves PT by state --
  // it always returns 0, regardless of stateCode, which stays only as an
  // accepted-but-unused parameter for caller compatibility.
  it("no longer applies Professional Tax for any state (removed 2026-09-11)", async () => {
    const r = await calculateSalary(
      720000,
      40,
      40,
      false,
      undefined,
      true,
      true,
      "Delhi",
    );
    expect(r.professional_tax).toBe(0);
    expect(r.net_in_hand).toBeCloseTo(
      r.gross - r.pf_employee - r.esic_employee,
      1,
    );
  });

  // Same calculator as the Salary Package page (src/lib/salaryCalculator.ts calcFromCtc);
  // full parity grid lives in src/lib/__tests__/offerSalaryCalculatorParity.test.ts.
  it('matches the package page for monthly CTC 20,000 at 40/40 with PF and ESI, with no gratuity', async () => {
    const r = await calculateSalary(240000, 40, 40, false, undefined, true, true);
    expect(r).toMatchObject({
      offered_ctc: 20000, gross: 18441.68, basic: 7376.67, hra: 2950.67, conveyance: 1600,
      special_allowance: 5899.86, bonus: 614.48, pf_employee: 885.2, pf_employer: 885.2,
      esic_employee: 138.31, esic_employer: 599.35, admin_charges: 73.77, net_in_hand: 17418.17,
      gratuity: 0,
    });
  });

  it('keeps conveyance and bonus inside gross: an all-basic split carries neither (63694C)', async () => {
    // Band F CTC 13,250 resolves to basic = gross, HRA 0. Conveyance 1,600 and bonus 8.33% used to be
    // listed on top, so the components (13,947) exceeded the gross (11,398).
    const r = await calculateSalary(13250 * 12, 100, 0, false);
    expect(r.basic).toBeCloseTo(r.gross, 2);
    expect(r.conveyance).toBe(0);
    expect(r.bonus).toBe(0);
    const parts = r.basic + r.hra + r.conveyance + r.bonus + r.special_allowance + r.other_allowance + r.da;
    expect(Math.abs(parts - r.gross)).toBeLessThanOrEqual(1);
  });

  it('still carves conveyance and bonus out of gross when there is room', async () => {
    const r = await calculateSalary(240000, 40, 40, false);
    expect(r.conveyance).toBe(1600);
    expect(r.bonus).toBeGreaterThan(0);
    const parts = r.basic + r.hra + r.conveyance + r.bonus + r.special_allowance;
    expect(Math.abs(parts - r.gross)).toBeLessThanOrEqual(1);
  });
});
