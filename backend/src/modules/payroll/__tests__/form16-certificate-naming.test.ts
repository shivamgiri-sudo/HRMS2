import { describe, expect, it } from "vitest";
import { statutoryRegimeForFinancialYear } from "../statutory-regime.js";

/**
 * The salary TDS certificate endpoint (/payroll/form16-data/:runId/:employeeId)
 * derives the financial year from the run month and now reports which Act
 * governs it, so a client renders the right form name instead of a hardcoded
 * "Form 16".
 *
 * This pins the derivation the route performs — run month to financial-year
 * start to certificate form — because that mapping is where the mistake would
 * be. Getting it wrong means either issuing a Form 130 for a year that predates
 * the 2025 Act, or reprinting an old year under a form number that did not
 * exist when it was deducted.
 */

/** Exactly the derivation in the route: Jan–Mar belong to the FY that began last April. */
function financialYearStartFor(runMonth: string): number {
  const [year, month] = runMonth.split("-").map(Number);
  return month >= 4 ? year : year - 1;
}

describe("salary TDS certificate naming follows the year it covers", () => {
  it("maps a run month to the financial year that contains it", () => {
    expect(financialYearStartFor("2026-04")).toBe(2026); // Apr 2026 -> FY 2026-27
    expect(financialYearStartFor("2026-12")).toBe(2026);
    expect(financialYearStartFor("2027-03")).toBe(2026); // Mar 2027 still FY 2026-27
    expect(financialYearStartFor("2026-03")).toBe(2025); // Mar 2026 -> FY 2025-26
    expect(financialYearStartFor("2026-01")).toBe(2025);
  });

  it("issues Form 130 for FY 2026-27, the first year under the 2025 Act", () => {
    const regime = statutoryRegimeForFinancialYear(financialYearStartFor("2026-04"));
    expect(regime.act).toBe("2025");
    expect(regime.salaryCertificateForm).toBe("130");
    expect(regime.salaryTdsSection).toBe("392");
    expect(regime.quarterlyReturnForm).toBe("138");
  });

  it("still issues Form 16 for FY 2025-26, including a March 2026 run", () => {
    // The reissue case. March 2026 salary is paid in April 2026, after the new
    // Act commenced — but the income belongs to FY 2025-26 and its certificate
    // is a Form 16. Deriving from the payment date instead of the covered year
    // would silently relabel it.
    const regime = statutoryRegimeForFinancialYear(financialYearStartFor("2026-03"));
    expect(regime.act).toBe("1961");
    expect(regime.salaryCertificateForm).toBe("16");
    expect(regime.salaryTdsSection).toBe("192");
  });

  it("keeps every earlier year on Form 16 no matter how late it is reprinted", () => {
    for (const runMonth of ["2023-07", "2024-11", "2025-04", "2025-12"]) {
      const regime = statutoryRegimeForFinancialYear(financialYearStartFor(runMonth));
      expect(regime.salaryCertificateForm).toBe("16");
    }
  });

  it("changes form exactly at the FY boundary, not mid-year", () => {
    // FY 2025-26 runs Apr 2025 to Mar 2026 on Form 16; FY 2026-27 starts on 130.
    expect(
      statutoryRegimeForFinancialYear(financialYearStartFor("2026-03")).salaryCertificateForm,
    ).toBe("16");
    expect(
      statutoryRegimeForFinancialYear(financialYearStartFor("2026-04")).salaryCertificateForm,
    ).toBe("130");
  });
});
