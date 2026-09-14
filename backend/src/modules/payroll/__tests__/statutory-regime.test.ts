import { describe, expect, it } from "vitest";
import {
  ACT_2025_EFFECTIVE_FROM,
  quarterlyTdsFilingType,
  statutoryRegimeForDate,
  statutoryRegimeForFinancialYear,
  statutoryRegimeForPeriod,
} from "../statutory-regime.js";

/**
 * The Income-tax Act, 2025 replaced the 1961 Act on 1 April 2026, renaming the
 * sections and forms payroll has to reference. The rates were untouched.
 *
 * The rule under test is that the Act is chosen by the PERIOD, not by today's
 * date — an employer reissuing a FY 2025-26 certificate still owes a Form 16,
 * and relabelling it Form 130 because the calendar has moved on would be wrong.
 */

describe("statutory regime by period", () => {
  it("governs March 2026 by the 1961 Act", () => {
    const r = statutoryRegimeForPeriod("2026-03");
    expect(r.act).toBe("1961");
    expect(r.salaryTdsSection).toBe("192");
    expect(r.salaryCertificateForm).toBe("16");
    expect(r.quarterlyReturnForm).toBe("24Q");
    expect(r.rebateSection).toBe("87A");
  });

  it("governs April 2026 by the 2025 Act", () => {
    const r = statutoryRegimeForPeriod("2026-04");
    expect(r.act).toBe("2025");
    expect(r.salaryTdsSection).toBe("392");
    expect(r.otherTdsSection).toBe("393");
    expect(r.salaryCertificateForm).toBe("130");
    expect(r.quarterlyReturnForm).toBe("138");
    expect(r.rebateSection).toBe("157");
    expect(r.periodTerm).toBe("Tax Year");
  });

  it("switches exactly on the commencement date, not a day either side", () => {
    expect(statutoryRegimeForDate("2026-03-31").act).toBe("1961");
    expect(statutoryRegimeForDate(ACT_2025_EFFECTIVE_FROM).act).toBe("2025");
    expect(statutoryRegimeForDate("2026-04-01").act).toBe("2025");
  });

  it("keeps an old period on the old Act however late it is asked about", () => {
    // The reissue case: a Form 16 for FY 2025-26 is still a Form 16 in 2027.
    for (const period of ["2024-07", "2025-06", "2025-12", "2026-01"]) {
      expect(statutoryRegimeForPeriod(period).salaryCertificateForm).toBe("16");
    }
  });

  it("resolves by financial year start", () => {
    // FY 2025-26 begins 01-04-2025 — old Act. FY 2026-27 begins 01-04-2026 — new.
    expect(statutoryRegimeForFinancialYear(2025).act).toBe("1961");
    expect(statutoryRegimeForFinancialYear(2025).salaryCertificateForm).toBe("16");
    expect(statutoryRegimeForFinancialYear(2026).act).toBe("2025");
    expect(statutoryRegimeForFinancialYear(2026).salaryCertificateForm).toBe("130");
  });

  it("maps the period to the right stored filing type, keeping both valid", () => {
    // Historic rows must keep meaning what they meant when filed, so TDS_24Q is
    // not migrated away — it is simply no longer chosen for new periods.
    expect(quarterlyTdsFilingType("2026-03")).toBe("TDS_24Q");
    expect(quarterlyTdsFilingType("2026-04")).toBe("TDS_138");
    expect(quarterlyTdsFilingType("2027-01")).toBe("TDS_138");
  });

  it("rejects malformed input instead of guessing an Act", () => {
    expect(() => statutoryRegimeForPeriod("2026")).toThrow(/YYYY-MM/);
    expect(() => statutoryRegimeForPeriod("")).toThrow(/YYYY-MM/);
    expect(() => statutoryRegimeForDate("2026-04")).toThrow(/YYYY-MM-DD/);
    expect(() => statutoryRegimeForFinancialYear(26 as number)).toThrow(/four-digit/);
  });
});
