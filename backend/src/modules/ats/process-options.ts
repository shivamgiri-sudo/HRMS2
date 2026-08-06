import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * The process names offered by every ATS dropdown.
 *
 * ONE LIST, ONE NAME. process_master is the only place a process exists, and the name it
 * holds is the name shown, the name stored on the submission, and the name reports group
 * by. Adding a client means adding it in Process Config, once.
 *
 * This replaces ats_form_config.hiringProcessOptions, a separately hand-maintained list of
 * short names — "Housing", "LP", "BBB", "Neeman's" — that had drifted badly from the
 * master it was meant to mirror. Measured on production before the change: 21 options, of
 * which only 6 matched an active process; 13 existed nowhere in process_master; and 59
 * active clients were not offered at all, so recruiters could not select most of the live
 * book of business.
 *
 * The alternative considered and rejected was an alias table mapping each short name to a
 * process id. It resolves the same way, but it keeps two names alive for one client
 * forever and means every new process must be remembered in two places — and whoever
 * forgets creates a gap that reads as complete.
 *
 * Active only: a closed process should not be offered for a new interview. Existing
 * submissions that reference one are unaffected — this governs what can be chosen next,
 * not what was chosen before.
 */
export async function listActiveProcessNames(): Promise<string[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT process_name
       FROM process_master
      WHERE active_status = 1
        AND process_name IS NOT NULL
        AND TRIM(process_name) <> ''
      ORDER BY process_name ASC`,
  );
  // Distinct on the trimmed name: the master carries near-duplicates that differ only by
  // trailing space, and two visually identical options in a dropdown are a support call.
  const seen = new Set<string>();
  const names: string[] = [];
  for (const row of rows as Array<{ process_name: string }>) {
    const name = String(row.process_name).trim();
    // Re-checked here rather than trusted to the WHERE clause above: MySQL's TRIM strips
    // spaces only, so a name made of non-breaking spaces passes the query and would
    // render as a selectable blank option that stores an empty process.
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}
