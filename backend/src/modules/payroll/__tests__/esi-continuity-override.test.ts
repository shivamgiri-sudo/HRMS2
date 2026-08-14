import { describe, expect, it } from "vitest";
import { payrollService } from "../payroll.service.js";
import type { NetSalaryParams } from "../payroll.types.js";

/**
 * HRMS2 delta-audit, 2026-08-14 (P0, statutory): the ESI Act (s.2(6A)/Reg 3)
 * requires that an employee covered at the start of a contribution period
 * (Apr-Sep or Oct-Mar) stay covered for the rest of it, even if a mid-period
 * raise pushes their gross over the wage ceiling.
 *
 * calculateNetSalary's gate was `!esicOptOut && gross <= esicWageLimit` — an
 * AND with no way to override the ceiling half once someone crossed it.
 * payrollCalculate.service.ts's "continuity" block set esicOptOut = false when
 * coverage was found, but esicOptOut was already false on every path that
 * reaches that code (it only runs when !esicOptOutDeclared) — a structural
 * no-op that never touched the ceiling check at all. An employee correctly
 * identified as "covered at period start" still lost ESI the month they
 * crossed the ceiling.
 *
 * esicContinuityOverride is the real signal, ORed into the ceiling check.
 * User-approved fix, this session (Section K item 3, Option A).
 */

const BASE: NetSalaryParams = {
  grossMonthlyCTC: 30000,
  workingDays: 30,
  lwpDays: 0,
  basicPct: 50,
  hraPct: 20,
  pfEmployeePct: 12,
  esicEmployeePct: 0.75,
  esicWageLimit: 21000,
  pfWageLimit: 15000,
};

describe("ESI mid-period continuity override", () => {
  it("drops ESI when gross crosses the ceiling and there is no continuity override (unchanged baseline behaviour)", () => {
    const result = payrollService.calculateNetSalary({
      ...BASE,
      grossMonthlyCTC: 25000, // > 21000 ceiling
      esicOptOut: false,
      esicContinuityOverride: false,
    });
    expect(result.esic_employee).toBe(0);
    expect(result.esic_employer).toBe(0);
  });

  it("keeps ESI applied when gross crosses the ceiling but continuity override is set (the fix)", () => {
    const result = payrollService.calculateNetSalary({
      ...BASE,
      grossMonthlyCTC: 25000, // > 21000 ceiling — would be dropped without the override
      esicOptOut: false,
      esicContinuityOverride: true,
    });
    expect(result.esic_employee).toBeGreaterThan(0);
    expect(result.esic_employer).toBeGreaterThan(0);
  });

  it("opt-out still wins over continuity — a declared opt-out is never overridden by coverage history", () => {
    const result = payrollService.calculateNetSalary({
      ...BASE,
      grossMonthlyCTC: 25000,
      esicOptOut: true,
      esicContinuityOverride: true,
    });
    expect(result.esic_employee).toBe(0);
    expect(result.esic_employer).toBe(0);
  });

  it("continuity override has no effect when gross is still under the ceiling (no behaviour change for the unaffected majority)", () => {
    const withOverride = payrollService.calculateNetSalary({
      ...BASE,
      grossMonthlyCTC: 18000, // already under 21000 ceiling
      esicOptOut: false,
      esicContinuityOverride: true,
    });
    const withoutOverride = payrollService.calculateNetSalary({
      ...BASE,
      grossMonthlyCTC: 18000,
      esicOptOut: false,
      esicContinuityOverride: false,
    });
    expect(withOverride.esic_employee).toBe(withoutOverride.esic_employee);
    expect(withOverride.esic_employer).toBe(withoutOverride.esic_employer);
    expect(withOverride.esic_employee).toBeGreaterThan(0);
  });

  it("defaults to false when omitted (no continuity override unless explicitly computed)", () => {
    const { esicContinuityOverride, ...withoutField } = {
      ...BASE,
      grossMonthlyCTC: 25000,
      esicOptOut: false,
      esicContinuityOverride: undefined,
    };
    const result = payrollService.calculateNetSalary(withoutField as NetSalaryParams);
    expect(result.esic_employee).toBe(0);
  });
});
