/**
 * Which payroll run statuses are closed to further computation.
 *
 * WHY THIS EXISTS AS ONE DEFINITION
 * ---------------------------------
 * The closed set was written out by hand in five places as
 * `["locked", "disbursed"]`. Production contains no run in either status: the
 * marker actually used is `FINALIZED`, stored uppercase. So every one of those
 * guards matched nothing, and all 67 runs — including 51 finalized ones going
 * back to 2021-03 — were open to recalculation.
 *
 * That is not a cosmetic gap. Recalculating a finalized run rewrites its lines
 * from TODAY's salary structures, attendance and statutory configuration, over
 * figures that were already paid and already filed in a quarterly TDS return.
 * The oldest such run covers 635 employees and ₹69,36,308 of net pay.
 *
 * Kept in one module so the next status added to the lifecycle is added once,
 * rather than in four places and forgotten in a fifth.
 */

/**
 * Statuses meaning "this run is settled; do not recompute it".
 *
 * Lower-case by convention — compare with isRunClosed(), never directly, since
 * the database stores FINALIZED uppercase while the older values are lowercase.
 */
export const CLOSED_RUN_STATUSES: ReadonlySet<string> = new Set([
  "locked",
  "disbursed",
  // The status payroll actually finishes runs in. Its absence from this set is
  // the reason the guards were inert.
  "finalized",
]);

/**
 * Whether a run status is closed to recomputation.
 *
 * Case- and whitespace-insensitive on purpose: the same lifecycle is written
 * 'FINALIZED' by the payroll UI and 'locked' by older code, and a guard that
 * only matches one casing is a guard that does not hold.
 */
export function isRunClosed(status: unknown): boolean {
  return CLOSED_RUN_STATUSES.has(String(status ?? "").trim().toLowerCase());
}

/** SQL fragment for the same rule, for statements that filter in the database. */
export const CLOSED_RUN_STATUSES_SQL = "'locked','disbursed','finalized'";
