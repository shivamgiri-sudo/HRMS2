/**
 * Refuses to compute a P&L for a period that has not happened yet.
 *
 * WHY THIS EXISTS. Every P&L aggregation here reads mirror/operational tables filtered by
 * `period_code = ?` (or `run_month = ?`). A genuinely future period (e.g. asking for 2027-06 in
 * 2026-08) simply matches zero rows — no error, no warning — so every figure comes back 0 and the
 * page renders exactly like a real branch that traded nothing and made no profit. That is
 * indistinguishable from a real zero, which is the one thing a P&L screen must never be. Confirmed
 * live 2026-08-22: `billing_invoice_particular_snapshot` for `period_code='2027-06'` returns 0
 * rows with no error.
 *
 * THE BOUNDARY IS THE CURRENT CALENDAR MONTH, NOT THE PREVIOUS ONE. The frontend's own
 * `defaultPeriod()` (ProcessPnlPage.tsx) already caps its "Next month" button at the PREVIOUS
 * month, because payroll runs in arrears and a not-yet-posted current month is intentionally
 * shown as "Live MTD" via pnl-reconciliation.service.ts's mode/blockers — that is a real, useful
 * state, not a future period. Blocking at the current month (reject anything > this month) is the
 * correct hard boundary: the current month has at least started and can hold real transactions;
 * next month structurally cannot. This guard must not be tightened to "previous month only" — that
 * would incorrectly reject the legitimate Live-MTD view of the current month.
 *
 * A direct `?period=` URL edit, a bookmarked link, or a caller that computes a period
 * programmatically all bypass the frontend's disabled button — this is the actual enforcement
 * point, not a UX nicety.
 */

const PERIOD_RE = /^\d{4}-\d{2}$/;

export class FuturePeriodError extends Error {
  statusCode = 400;
  constructor(period: string, currentPeriod: string) {
    super(`period ${period} has not happened yet (current period is ${currentPeriod}) — a P&L cannot be computed for a month that has not started`);
    this.name = "FuturePeriodError";
  }
}

/** YYYY-MM for "now", in UTC — matches the `period_code`/`run_month` convention used throughout
 *  this module (see e.g. ceo-overview.service.ts's own period handling), so the boundary lines up
 *  with how periods are actually stored, not with the server process's local timezone. */
export function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function isFuturePeriod(period: string): boolean {
  if (!PERIOD_RE.test(period)) return false; // malformed input is a different caller's problem
  return period > currentPeriod();
}

/** Throws FuturePeriodError (statusCode 400) for a period beyond the current month. Callers with
 *  their own "malformed period" handling should validate the YYYY-MM shape first — this function
 *  is silent (no-op) on a non-YYYY-MM string so it never masks that separate validation. */
export function assertNotFuturePeriod(period: string): void {
  if (isFuturePeriod(period)) throw new FuturePeriodError(period, currentPeriod());
}
