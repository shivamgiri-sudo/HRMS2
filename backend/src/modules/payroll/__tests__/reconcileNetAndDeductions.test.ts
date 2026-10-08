/**
 * A payroll line's stored gross/deductions/net must always satisfy
 * `net = gross - deductions`.
 *
 * Before this fix, calculatePayrollRunScoped clamped only the final net pay
 * to 0 (`Math.max(0, calc.net_salary + holidayWorkExtraPayout - advanceRecovery
 * - loanEmi - miscDeductions)`) without correspondingly reducing
 * total_deductions, which was carried through unclamped. Whenever statutory
 * plus other deductions exceeded gross pay, the stored salary_prep_line row
 * had gross_salary - total_deductions !== net_salary — e.g. gross=20000,
 * total_deductions=23000, net=0 instead of net=0 with deductions capped at
 * 20000. Payslips/reports recomputing the difference would misreport by the
 * amount deductions overshot gross.
 */
import { describe, it, expect } from "vitest";
import { reconcileNetAndDeductions } from "../payrollCalculate.service.js";

describe("reconcileNetAndDeductions", () => {
  it("passes through unchanged when deductions don't exceed gross", () => {
    const { totalDeductions, netSalary } = reconcileNetAndDeductions(20000, 8000);
    expect(totalDeductions).toBe(8000);
    expect(netSalary).toBe(12000);
    expect(totalDeductions + netSalary).toBe(20000);
  });

  it("caps deductions at gross instead of letting net go negative with deductions unclamped", () => {
    // The exact failure scenario: gross 20000, raw deductions 23000.
    const { totalDeductions, netSalary } = reconcileNetAndDeductions(20000, 23000);
    expect(netSalary).toBe(0);
    expect(totalDeductions).toBe(20000); // not 23000
    // The invariant the whole fix exists to guarantee:
    expect(Math.round((totalDeductions + netSalary) * 100) / 100).toBe(20000);
  });

  it("holds the gross = deductions + net invariant across a range of inputs, including deductions > gross", () => {
    const cases: Array<[number, number]> = [
      [50000, 12000],
      [50000, 50000],
      [50000, 50001],
      [1000, 5000],
      [0, 0],
      [0, 100],
    ];
    for (const [gross, rawDeductions] of cases) {
      const { totalDeductions, netSalary } = reconcileNetAndDeductions(gross, rawDeductions);
      expect(netSalary, `net should never be negative for gross=${gross}, raw=${rawDeductions}`).toBeGreaterThanOrEqual(0);
      expect(
        Math.round((totalDeductions + netSalary) * 100) / 100,
        `gross=${gross}, raw=${rawDeductions} should reconcile`
      ).toBe(gross);
    }
  });

  it("rounds to 2 decimal places", () => {
    const { totalDeductions, netSalary } = reconcileNetAndDeductions(10000.005, 3333.333);
    expect(totalDeductions).toBe(3333.33);
    expect(netSalary).toBe(6666.67);
  });
});
