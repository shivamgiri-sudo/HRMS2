/**
 * The one place that decides what happens when a write lands on a locked attendance day.
 *
 * THE DEFECT THIS EXISTS TO PREVENT. Every writer of attendance_daily_record guards its columns
 * with `IF(is_locked = 0, VALUES(x), x)`. That is the right intent — a locked day must not be
 * overwritten — but it is expressed as a statement that SUCCEEDS and changes nothing. There is no
 * error, and no affected-row count that distinguishes "wrote" from "silently declined". So the
 * caller runs to completion, reports success, and the correction evaporates.
 *
 * Measured cost on production, 2026-09-05: 809 approved attendance corrections
 * (BATCH-1788287542227) and 70 approved leave days (BATCH-1788525513744) were discarded this way
 * — 514.5 days of pay — and every requester was told their change had been applied. It went
 * unnoticed for weeks precisely because the failure mode is indistinguishable from success.
 *
 * THE RULE. Suppression must never be silent. Before writing, ask which of the target days are
 * locked; if any are, refuse loudly and write nothing. Refusing is safe (the user retries through
 * the governance path); silently continuing is not (the day is wrong and nobody knows).
 *
 * Ownership is the one exemption: a correction may rewrite a day IT already owns, otherwise a
 * second look at your own correction becomes impossible.
 */

/** A write was refused because one or more target days are locked. Nothing was written. */
export class LockedDayWriteError extends Error {
  /** errorHandler.ts reads `statusCode`; anything else is masked as a 500. */
  readonly statusCode = 409;
  readonly lockedDates: string[];

  constructor(message: string, lockedDates: string[]) {
    super(message);
    this.name = "LockedDayWriteError";
    this.lockedDates = lockedDates;
  }
}

/** Minimal shape of the mysql2 connection/transaction handle these services pass around. */
type Executor = { execute: (sql: string, params?: unknown[]) => Promise<unknown> };

export interface LockedDay {
  date: string;
  /** True when the lock belongs to a specific correction/override rather than a payroll freeze. */
  ownedByCorrection: boolean;
}

/**
 * The locked subset of `dates` for one employee. One query per batch, not per row.
 *
 * `ownerRegularizationId` / `ownerUserId`, when given, exempt days this caller already owns.
 */
export async function findLockedDays(
  conn: Executor,
  employeeId: string,
  dates: string[],
  owner?: { regularizationId?: string | null; userId?: string | null },
): Promise<LockedDay[]> {
  if (!dates.length) return [];
  const placeholders = dates.map(() => "?").join(", ");
  const [rows] = (await conn.execute(
    `SELECT DATE_FORMAT(record_date,'%Y-%m-%d') d, regularization_id, override_by
       FROM attendance_daily_record
      WHERE employee_id = ? AND record_date IN (${placeholders}) AND is_locked = 1`,
    [employeeId, ...dates],
  )) as [Array<{ d: string; regularization_id: string | null; override_by: string | null }>, unknown];

  const locked: LockedDay[] = [];
  for (const r of rows) {
    const ownsIt =
      (!!owner?.regularizationId && r.regularization_id === owner.regularizationId) ||
      (!!owner?.userId && r.override_by === owner.userId);
    if (ownsIt) continue;
    locked.push({ date: r.d, ownedByCorrection: !!r.regularization_id || !!r.override_by });
  }
  return locked;
}

/**
 * The refusal wording, in one place so every caller says the same thing.
 *
 * States plainly that nothing was saved — the failure this replaces reported success, and a
 * message that does not say so leaves the reader assuming the change went through, which is
 * exactly how 514.5 days went unnoticed. Names the actual cause, because "already locked" sent
 * people looking for a conflicting correction that did not exist, and points at the remedy.
 */
export function lockedDayRefusalMessage(what: string, locked: LockedDay[]): string {
  const dates = locked.map((l) => l.date).sort();
  const shown = dates.slice(0, 5).join(", ") + (dates.length > 5 ? `, +${dates.length - 5} more` : "");
  const byCorrection = locked.some((l) => l.ownedByCorrection);

  if (byCorrection && locked.every((l) => l.ownedByCorrection)) {
    return (
      `${what} was NOT saved. ${dates.length === 1 ? "This day is" : `These ${dates.length} days are`} ` +
      `already locked by another correction: ${shown}. Resolve that correction first.`
    );
  }
  return (
    `${what} was NOT saved. ${dates.length === 1 ? "This day is" : `These ${dates.length} days are`} ` +
    `locked because payroll for that month is frozen: ${shown}. Unlock the day through the ` +
    `attendance-correction governance path, or handle it as an arrears adjustment in an open month.`
  );
}

/**
 * Refuse the whole write if any target day is locked. Call this BEFORE the write, so a refusal
 * leaves nothing half-applied.
 */
export async function assertDaysWritable(
  conn: Executor,
  employeeId: string,
  dates: string[],
  what: string,
  owner?: { regularizationId?: string | null; userId?: string | null },
): Promise<void> {
  const locked = await findLockedDays(conn, employeeId, dates, owner);
  if (locked.length) {
    throw new LockedDayWriteError(lockedDayRefusalMessage(what, locked), locked.map((l) => l.date));
  }
}
