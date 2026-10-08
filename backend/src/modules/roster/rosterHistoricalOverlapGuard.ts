/**
 * Refuse to generate a roster cycle over dates that already carry live assignments.
 *
 * WHY
 *   roster-generation and wfm_roster_assignment are a pipeline, not two rival systems.
 *   Generation writes roster_daily_assignment, then syncGeneratedToLiveAssignments copies
 *   those rows into wfm_roster_assignment — the live ops table — using
 *
 *     ON DUPLICATE KEY UPDATE shift_id = VALUES(shift_id), decision_source = 'rule_engine'
 *
 *   So generating a cycle for a week that already has live assignments does not produce a
 *   second roster. It REPLACES the shift on the existing one with a shift derived from
 *   templates and rotation rules. wfm_roster_assignment holds 413,386 rows from 2025-04-01 to
 *   2026-07-19, and attendance is derived against rosters — so that is roster history being
 *   rewritten from a template, silently, with no audit of what it replaced.
 *
 *   The decision taken 2026-08-12 is to adopt the roster-gov lifecycle GOING FORWARD ONLY and
 *   treat the existing rows as a closed record. This is what makes that hold the first time
 *   somebody generates a cycle dated in the past.
 *
 * NO OVERRIDE FLAG, deliberately. An override that nothing calls is dead code, and a real
 * backfill case can add one with its own reasoning when it appears.
 */
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

export async function assertNoHistoricalRosterOverlap(
  weekStart: string,
  weekEnd: string,
): Promise<void> {
  // Counted against the LIVE table, because that is the one the sync overwrites. Checking
  // roster_daily_assignment instead would pass happily while history was replaced underneath.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS overlapping
       FROM wfm_roster_assignment
      WHERE roster_date BETWEEN ? AND ?`,
    [weekStart, weekEnd],
  );

  const overlapping = Number((rows as Array<{ overlapping?: number }>)[0]?.overlapping ?? 0);
  if (overlapping > 0) {
    throw Object.assign(
      new Error(
        `Refusing to generate: ${overlapping} live roster assignment(s) already exist between ` +
        `${weekStart} and ${weekEnd}. Generation would overwrite their shift with a ` +
        `template-derived one, and attendance is derived against rosters. Roster-gov is adopted ` +
        `going forward only — pick a cycle whose week has no existing assignments.`,
      ),
      { statusCode: 409 },
    );
  }
}
