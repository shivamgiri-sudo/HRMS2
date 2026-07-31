/**
 * Indian financial-year helper.
 *
 * CEO UAT 31-Jul-2026: /payroll/tax-declaration defaulted to FY 2025-2026 while the
 * current FY was 2026-2027, so users would file declarations against the wrong year.
 * The page hardcoded `useState("2025-2026")` and a fixed
 * ["2024-2025","2025-2026","2026-2027"] option list — no date arithmetic at all, and
 * an option list that would have run out after 31-Mar-2027.
 *
 * The boundary cases below are the ones that matter: a hardcoded default is only
 * ever wrong for part of the year, so a test pinned to "today" would pass by luck.
 */

import { describe, expect, it } from "vitest";
import {
  currentFinancialYear,
  currentFinancialYearShort,
  financialYearOptions,
  financialYearStart,
} from "@/lib/financialYear";

/** A UTC instant corresponding to the given IST wall-clock time. */
const ist = (y: number, m: number, d: number, hh = 12, mm = 0) =>
  new Date(Date.UTC(y, m - 1, d, hh, mm) - (5 * 60 + 30) * 60_000);

describe("financialYearStart", () => {
  it("rolls over on 1 April, not 1 January", () => {
    expect(financialYearStart(ist(2026, 3, 31, 23, 59))).toBe(2025);
    expect(financialYearStart(ist(2026, 4, 1, 0, 1))).toBe(2026);
  });

  it("treats January to March as the prior year's FY", () => {
    expect(financialYearStart(ist(2027, 1, 15))).toBe(2026);
    expect(financialYearStart(ist(2027, 3, 31))).toBe(2026);
  });

  it("computes the boundary in IST, not the host timezone", () => {
    // 2026-04-01 00:30 IST is 2026-03-31 19:00 UTC. A UTC-based implementation
    // would report the previous FY for the first 5.5 hours of every 1 April.
    expect(financialYearStart(ist(2026, 4, 1, 0, 30))).toBe(2026);
    // And 2026-03-31 23:30 IST is 2026-03-31 18:00 UTC — still the old FY.
    expect(financialYearStart(ist(2026, 3, 31, 23, 30))).toBe(2025);
  });
});

describe("currentFinancialYear", () => {
  it("returns the FY the UAT expected on the date it was run", () => {
    // 31-Jul-2026 — the page showed 2025-2026.
    expect(currentFinancialYear(ist(2026, 7, 31))).toBe("2026-2027");
  });

  it("formats the short form", () => {
    expect(currentFinancialYearShort(ist(2026, 7, 31))).toBe("2026-27");
    expect(currentFinancialYearShort(ist(2029, 12, 1))).toBe("2029-30");
  });
});

describe("financialYearOptions", () => {
  it("puts the current FY first so a default of options[0] is correct", () => {
    expect(financialYearOptions(2, 0, ist(2026, 7, 31))[0]).toBe("2026-2027");
  });

  it("includes the requested history and nothing further ahead", () => {
    expect(financialYearOptions(2, 0, ist(2026, 7, 31))).toEqual([
      "2026-2027",
      "2025-2026",
      "2024-2025",
    ]);
  });

  it("can look forward when asked", () => {
    expect(financialYearOptions(1, 1, ist(2026, 7, 31))).toEqual([
      "2027-2028",
      "2026-2027",
      "2025-2026",
    ]);
  });

  it("keeps generating past the date the old hardcoded list ran out", () => {
    // The replaced literal ended at 2026-2027 and would have offered no valid
    // option from 1 April 2027 onwards.
    expect(financialYearOptions(2, 0, ist(2027, 4, 1))).toContain("2027-2028");
    expect(financialYearOptions(2, 0, ist(2031, 9, 9))).toContain("2031-2032");
  });
});
