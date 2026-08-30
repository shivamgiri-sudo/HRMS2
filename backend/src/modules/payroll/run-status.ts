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

/**
 * Statuses past which a run may no longer TRANSITION.
 *
 * Deliberately NOT the same set as CLOSED_RUN_STATUSES. That set answers "may this
 * run be recomputed", and it correctly includes `finalized`. Reusing it to answer
 * "may this run still move forward" is what stalled the lifecycle: the auto-lock
 * cron filtered on `status NOT IN (CLOSED_RUN_STATUSES)`, which excluded exactly
 * the status every production run finishes in, so `finalized -> locked` never fired
 * for any run. 2026-07 passed its window_close_date of 2026-08-29 with
 * auto_closed_at still NULL, and payroll-lifecycle.ts lists `locked` as finalized's
 * only forward target.
 *
 * `finalized` is closed to recomputation AND open to locking. Both are true; they
 * need two sets to say so.
 */
export const LOCK_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "locked",
  "disbursed",
  "cancelled",
]);

/** SQL form of LOCK_TERMINAL_STATUSES, for statements that filter in the database. */
export const LOCK_TERMINAL_STATUSES_SQL = "'locked','disbursed','cancelled'";

/** SQL fragment for the same rule, for statements that filter in the database. */
export const CLOSED_RUN_STATUSES_SQL = "'locked','disbursed','finalized'";

/**
 * Ordering that picks the canonical run when a month holds more than one.
 *
 * A month can legitimately hold several runs — a re-run, a correction, an
 * abandoned draft, or two import batches — and exactly one of them is the answer
 * to "what was this month's payroll". This ranks by how far a run progressed,
 * most authoritative first; callers break ties with created_at DESC.
 *
 * UPPER() because statuses are not stored in a consistent case. Production holds
 * 'FINALIZED' (51 of 67 runs) alongside lowercase 'approved', 'processing' and
 * 'draft'; a case-sensitive CASE dropped every FINALIZED run to the ELSE branch —
 * the worst rank — so the most authoritative status ranked below a partial
 * 'approved' run. For 2026-03 that selected a 226-line run over the real
 * 1,140-line payroll.
 *
 * Lives here rather than in any one route file so every report resolves a month
 * to the same run. Duplicated copies of this ordering are how the endpoints
 * drifted apart in the first place.
 */
export function runRankSql(alias = ""): string {
  const col = alias ? `${alias}.status` : "status";
  return `
  CASE UPPER(${col})
    WHEN 'FINALIZED'  THEN 1
    WHEN 'DISBURSED'  THEN 2
    WHEN 'LOCKED'     THEN 3
    WHEN 'APPROVED'   THEN 4
    WHEN 'COMPLETED'  THEN 5
    WHEN 'PROCESSING' THEN 6
    WHEN 'DRAFT'      THEN 7
    ELSE 8
  END`;
}
