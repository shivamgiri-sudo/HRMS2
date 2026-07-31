/**
 * Indian financial year helpers.
 *
 * The FY runs 1 April – 31 March, so on 31-Jul-2026 the current FY is 2026-2027.
 *
 * CEO UAT 31-Jul-2026 reported /payroll/tax-declaration defaulting to FY 2025-2026,
 * i.e. the prior year — users would file declarations against the wrong FY. The
 * cause was a hardcoded `useState("2025-2026")` against a fixed literal array, with
 * no date arithmetic anywhere. No FY helper existed in the codebase, so one lives
 * here rather than being inlined again.
 *
 * All calculations are done in IST (UTC+05:30) so a user in another timezone, or a
 * server running UTC, cannot roll the year over early or late around 1 April.
 */

const IST_OFFSET_MINUTES = 5 * 60 + 30;
/** Month index for April in JS Date terms (0 = January). */
const FY_START_MONTH_INDEX = 3;

/** Now, shifted into IST so getMonth()/getFullYear() read as Indian local time. */
function istNow(reference?: Date): Date {
  const base = reference ?? new Date();
  return new Date(base.getTime() + (IST_OFFSET_MINUTES + base.getTimezoneOffset()) * 60_000);
}

/** Calendar year in which the current financial year began. */
export function financialYearStart(reference?: Date): number {
  const ist = istNow(reference);
  return ist.getMonth() >= FY_START_MONTH_INDEX ? ist.getFullYear() : ist.getFullYear() - 1;
}

/** Current financial year as "YYYY-YYYY", e.g. "2026-2027" on 31-Jul-2026. */
export function currentFinancialYear(reference?: Date): string {
  const start = financialYearStart(reference);
  return `${start}-${start + 1}`;
}

/** Short form, e.g. "2026-27". */
export function currentFinancialYearShort(reference?: Date): string {
  const start = financialYearStart(reference);
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/**
 * Selectable financial years, newest first — the current FY plus `back` previous
 * ones and `forward` future ones. Generated rather than hardcoded so the list
 * cannot silently expire, which is what the tax-declaration page's fixed
 * ["2024-2025","2025-2026","2026-2027"] array would have done after 31-Mar-2027.
 */
export function financialYearOptions(back = 2, forward = 0, reference?: Date): string[] {
  const start = financialYearStart(reference);
  const years: string[] = [];
  for (let offset = forward; offset >= -back; offset -= 1) {
    const y = start + offset;
    years.push(`${y}-${y + 1}`);
  }
  return years;
}
