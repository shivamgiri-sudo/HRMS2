/**
 * Which Income-tax Act governs a given payroll period, and the section and form
 * names that follow from it.
 *
 * The Income-tax Act, 2025 replaced the 1961 Act with effect from 1 April 2026.
 * The rates did not change — Budget 2026 left the new-regime slabs, the ₹75,000
 * standard deduction and the ₹12L nil-tax threshold alone — but the statutory
 * vocabulary did:
 *
 *   salary TDS            s.192   ->  s.392
 *   other TDS             s.194*  ->  s.393 (consolidated)
 *   salary TDS certificate Form 16 -> Form 130
 *   quarterly salary return Form 24Q -> Form 138
 *   rebate                s.87A   ->  s.157
 *   period concept        previous year / assessment year -> "tax year"
 *
 * This is deliberately resolved PER PERIOD rather than applied as a global
 * rename. An employer must still be able to reissue a certificate for FY
 * 2025-26, and that certificate is a Form 16 under the Act that governed it —
 * relabelling it Form 130 because today's date is later would be wrong. The
 * same reasoning as effective-dated rates: what a period is judged by is fixed
 * at the period, not at the moment you happen to ask.
 *
 * Rates live in statutory_config_version and are resolved separately; this
 * module carries only what the Act itself renamed, which is why it is pure and
 * needs no database.
 */

export type StatutoryActId = "1961" | "2025";

export interface StatutoryRegime {
  act: StatutoryActId;
  actName: string;
  /** First day this Act governs, ISO date. */
  effectiveFrom: string;
  /** Section under which salary TDS is deducted. */
  salaryTdsSection: string;
  /**
   * Section for non-salary TDS. Null under the 1961 Act, where the provisions
   * were scattered across 194C/194J/194H/194I and others rather than unified.
   */
  otherTdsSection: string | null;
  /** TDS certificate issued to the employee. */
  salaryCertificateForm: string;
  /** Quarterly TDS statement for salary payments. */
  quarterlyReturnForm: string;
  /** Rebate provision for the nil-tax threshold. */
  rebateSection: string;
  /** What a year is called, for user-facing labels. */
  periodTerm: string;
}

/** The 2025 Act commences on this date; periods before it stay on the 1961 Act. */
export const ACT_2025_EFFECTIVE_FROM = "2026-04-01";

const ACT_1961: StatutoryRegime = {
  act: "1961",
  actName: "Income-tax Act, 1961",
  effectiveFrom: "1962-04-01",
  salaryTdsSection: "192",
  otherTdsSection: null,
  salaryCertificateForm: "16",
  quarterlyReturnForm: "24Q",
  rebateSection: "87A",
  periodTerm: "Financial Year",
};

const ACT_2025: StatutoryRegime = {
  act: "2025",
  actName: "Income-tax Act, 2025",
  effectiveFrom: ACT_2025_EFFECTIVE_FROM,
  salaryTdsSection: "392",
  otherTdsSection: "393",
  salaryCertificateForm: "130",
  quarterlyReturnForm: "138",
  rebateSection: "157",
  periodTerm: "Tax Year",
};

function assertIsoDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be an ISO date (YYYY-MM-DD), received "${value}"`);
  }
}

/** Regime governing a specific date. */
export function statutoryRegimeForDate(isoDate: string): StatutoryRegime {
  assertIsoDate(isoDate, "date");
  // String comparison is safe and exact for zero-padded ISO dates, and avoids
  // the timezone shift a Date round-trip would introduce at the boundary.
  return isoDate >= ACT_2025_EFFECTIVE_FROM ? ACT_2025 : ACT_1961;
}

/**
 * Regime governing a payroll period (YYYY-MM).
 *
 * Judged on the FIRST day of the period: March 2026 is governed throughout by
 * the 1961 Act even though it is paid in April, because the income relates to
 * March.
 */
export function statutoryRegimeForPeriod(period: string): StatutoryRegime {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw new Error(`A payroll period (YYYY-MM) is required, received "${period}"`);
  }
  return statutoryRegimeForDate(`${period}-01`);
}

/**
 * Regime governing an Indian financial year given its starting calendar year —
 * financialYearStart 2026 means FY 2026-27, which begins 1 April 2026.
 */
export function statutoryRegimeForFinancialYear(financialYearStart: number): StatutoryRegime {
  if (!Number.isInteger(financialYearStart) || financialYearStart < 1900 || financialYearStart > 2999) {
    throw new Error(`A four-digit financial year start is required, received "${financialYearStart}"`);
  }
  return statutoryRegimeForDate(`${financialYearStart}-04-01`);
}

/**
 * Filing type key for the quarterly salary TDS statement in a period.
 *
 * statutory_filing_record stores TDS_24Q for periods under the 1961 Act and
 * TDS_138 from the 2025 Act onward. Both remain valid values — historic rows
 * must keep meaning what they meant when they were filed.
 */
export function quarterlyTdsFilingType(period: string): "TDS_24Q" | "TDS_138" {
  return statutoryRegimeForPeriod(period).act === "2025" ? "TDS_138" : "TDS_24Q";
}
