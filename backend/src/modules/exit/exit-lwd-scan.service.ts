import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import { notifyLastWorkingDayApproaching } from './exit.notifications.js';

/**
 * Daily scan: exits whose confirmed last working day is approaching.
 *
 * notifyLastWorkingDayApproaching() has existed since the exit notification module was
 * written and had ZERO call sites — its three siblings (resignation submitted/decided,
 * F&F ready) are each invoked from the routes that cause them, but "the last working day
 * is near" is not caused by a request, so nothing ever fired it. It is also the only one
 * of the four that carries the open-clearance count, which makes it the alerting half of
 * the "exit clearance incomplete" control. The control was evaluable and never evaluated.
 *
 * Scope note: this scans and notifies. It does not block, escalate, or change any exit
 * record — clearance already withholds money at the F&F approval guard. The gap being
 * closed is that nobody was told before that point.
 *
 * Dedupe: the gateway claims (event_code, dedupe_key) permanently, and the key is
 * `exit_request:<id>:lwd`, so each exit raises this exactly once no matter how many times
 * the scan runs. That is what makes a daily re-scan safe rather than a daily nag.
 */

/** Days before the confirmed LWD that the alert is raised. */
const LOOKAHEAD_DAYS = 7;

/**
 * Exits that are finished or abandoned. `draft` is excluded too: an unsubmitted
 * resignation has no agreed last working day to be approaching.
 */
const TERMINAL_STATUSES = ['draft', 'exited', 'revoked', 'rejected', 'cancelled', 'withdrawn'];

export interface LwdScanResult {
  scanned: number;
  notified: number;
  failed: number;
}

export async function runLastWorkingDayScan(): Promise<LwdScanResult> {
  // Date arithmetic stays in SQL. Computing the window in JS and passing strings reads the
  // host clock, which on this deployment has already produced off-by-one-day bugs
  // (a local Date serialised back as UTC lands on the previous day).
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT er.id
       FROM exit_request er
      WHERE er.last_working_day_confirmed IS NOT NULL
        AND er.last_working_day_confirmed >= CURDATE()
        AND er.last_working_day_confirmed <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
        AND er.status NOT IN (${TERMINAL_STATUSES.map(() => '?').join(',')})
      ORDER BY er.last_working_day_confirmed ASC`,
    [LOOKAHEAD_DAYS, ...TERMINAL_STATUSES],
  );

  const result: LwdScanResult = { scanned: rows.length, notified: 0, failed: 0 };

  // Sequential, not Promise.all: 45 workers share one pool on this deployment, and a fan-out
  // here would be competing with every other scheduled job for the same connections.
  for (const row of rows) {
    try {
      await notifyLastWorkingDayApproaching(row.id as string);
      result.notified += 1;
    } catch (err) {
      // One unnotifiable exit must not abandon the rest of the batch.
      result.failed += 1;
      console.error(`[exit-lwd-scan] ${row.id}:`, (err as Error).message);
    }
  }

  return result;
}
