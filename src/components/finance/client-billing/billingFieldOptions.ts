/**
 * Closed value sets for the client-billing create forms.
 *
 * These three fields were free-text `<Input>`s in both CreateProformaSheet and
 * CreateCreditNoteSheet. That is not only a UX problem — each one silently corrupts data
 * when a typo lands:
 *
 * - `financeYear` is part of the bill-number scope key
 *   (`<state>|<company>|<financeYear>`, see client-billing-numbering.service.ts). A typo
 *   such as "2026-2027" or "26-27" opens a BRAND NEW numbering scope, so the bill counter
 *   restarts at 01 and re-issues a number a client already holds. It is also fed to
 *   `financeYear.slice(2)` to build the printed suffix, which turns "2026-27" into the
 *   correct "26-27" but "26-27" into "-27".
 * - `monthLabel` and `category` are pure reporting dimensions; a variant spelling
 *   silently splits a client's history across two buckets. The legacy data proves this
 *   is not hypothetical — 10,794 migrated invoices contain exactly one "March-16" among
 *   otherwise uniform `Mmm-YY` values, and categories include both a raw code leak
 *   (`first_bill`) and a casing typo (`PlatForm Charges`).
 *
 * Values below are the real domains observed in `client_invoice` / `client_credit_note`
 * on 2026-08-27, not invented. Legacy-only artefacts (`first_bill`, `PlatForm Charges`,
 * `Subscription-Tool`) are deliberately NOT offered for new documents — existing rows
 * carrying them still display and export exactly as stored, since this list only governs
 * what a user can newly pick.
 */

/** Categories offered for a NEW document. `Others` is the legacy default and stays first. */
export const BILLING_CATEGORY_OPTIONS = [
  "Subscription",
  "Non Subscription",
  "Talk Time",
  "Setup Cost",
  "One time cost",
  "Development Cost",
  "Topup",
  "Others",
] as const;

/**
 * Indian financial year runs April–March, so the FY a date belongs to starts in the
 * previous calendar year for Jan/Feb/Mar. Uses local date parts, never UTC — see
 * todayISO()'s note in CreateProformaSheet.
 */
export function currentFinanceYear(now: Date = new Date()): string {
  const year = now.getFullYear();
  const startYear = now.getMonth() >= 3 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/**
 * The current FY plus a few either side: back far enough to raise a genuinely late
 * invoice for a prior year, forward one for early next-year billing.
 */
export function financeYearOptions(now: Date = new Date()): string[] {
  const current = currentFinanceYear(now);
  const startYear = Number(current.slice(0, 4));
  const years: string[] = [];
  for (let offset = 1; offset >= -4; offset--) {
    const s = startYear + offset;
    years.push(`${s}-${String((s + 1) % 100).padStart(2, "0")}`);
  }
  return years;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The twelve `Mmm-YY` labels belonging to a finance year, in Apr→Mar order — the exact
 * format all 10,794 migrated rows use (one "March-16" outlier aside, which is precisely
 * what a free-text field lets through).
 */
export function monthLabelOptions(financeYear: string): string[] {
  const startYear = Number(financeYear.slice(0, 4));
  if (!Number.isFinite(startYear)) return [];
  return MONTH_NAMES.map((name, index) => {
    // Apr(3)–Dec(11) belong to the starting calendar year; Jan(0)–Mar(2) to the next.
    const calendarYear = index >= 3 ? startYear : startYear + 1;
    return { name, index, calendarYear };
  })
    .sort((a, b) => (a.index >= 3 ? a.index - 3 : a.index + 9) - (b.index >= 3 ? b.index - 3 : b.index + 9))
    .map((m) => `${m.name}-${String(m.calendarYear % 100).padStart(2, "0")}`);
}

/** Local-date ISO (YYYY-MM-DD). `new Date().toISOString()` is UTC, which in IST returns
 *  YESTERDAY between 00:00 and 05:29 — the same host-timezone day-shift that has bitten
 *  date handling elsewhere in this codebase. */
export function todayLocalISO(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
