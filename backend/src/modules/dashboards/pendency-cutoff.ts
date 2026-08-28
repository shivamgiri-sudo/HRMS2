/**
 * The date from which an outstanding item counts as live pendency.
 *
 * Owner ruling 2026-08-28: work raised **on or after 25-Aug-2026** is the queue people
 * are expected to clear. Anything older is history — either migrated from db_bill with a
 * status the legacy system had already moved past, or HRMS-era work that has since been
 * settled outside the system. Counting it made every approval tile a number nobody could
 * work down: 586 "pending" leave requests of which none was actionable, 280 "BGV pending"
 * standing for 109 people, 507 onboarding bridges of which 27 had already joined.
 *
 * Two properties this deliberately has:
 *
 *  - **It filters on when the item was RAISED, never on when it is due or when the leave
 *    period falls.** A request filed on 26-Aug for leave taken in July is live pendency —
 *    somebody still has to decide it. Filtering on `from_date` would have thrown it away.
 *
 *  - **Nothing is hidden.** Every metric that applies this also returns the count it held
 *    back, as `...BeforeCutoff`, so the headline reconciles against a plain status query
 *    without reading this file.
 *
 * ⚠️ This is a FIXED date, not a rolling window. It does not age: as time passes the
 * window widens and the queue grows again. That is intended — it marks a one-off line
 * under the migrated backlog, not an SLA. If the queues start filling with stale work
 * again, move this date (one edit, here) rather than adding a second cutoff elsewhere.
 * A rolling window would be `DATE_SUB(CURDATE(), INTERVAL n DAY)` and is a different
 * decision — see ATTENDANCE_EXCEPTIONS, which already works that way and is deliberately
 * NOT subject to this constant.
 */
export const PENDENCY_CUTOFF_DATE = "2026-08-25";

/**
 * `<expr> >= '2026-08-25'` for use inside a metric's SQL.
 *
 * Takes the column that records when the item was raised. Inlines the literal rather than
 * taking a bind parameter on purpose: these predicates sit inside `SUM(CASE WHEN ...)`
 * expressions that are already assembled by string interpolation, and threading one more
 * positional parameter through each call site is where the binding order goes wrong — see
 * the `[...scopeParams, ...scopeParams]` fix in management.service.ts. The value is a
 * compile-time constant in this file and never reaches here from a request.
 */
export function raisedOnOrAfterCutoffSql(raisedAtExpr: string): string {
  return `${raisedAtExpr} >= '${PENDENCY_CUTOFF_DATE}'`;
}
