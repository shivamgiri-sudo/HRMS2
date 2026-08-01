import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

/**
 * Which process a fact belongs to, as at the date it happened.
 *
 * Two things forced this.
 *
 * The upstream call-quality feed stopped populating Campaign in May 2026 — every
 * row since is NULL — so a quality score carries no process of its own. But its
 * `User` column IS the HRMS employee code, and all 48 scored agents in July
 * matched an employee, 46 of them with a process. Attribution therefore runs
 * through the person.
 *
 * Second, kpi_daily_actual.process_id_at_event is only 2.9% populated (1,429 of
 * 49,481) and 0% on quality rows, while 2,975 of the 3,203 employees carrying
 * KPI rows (92.9%) can in fact be resolved. The column was not unusable, it was
 * unwritten.
 *
 * Every result reports HOW it was resolved. A date-accurate assignment and a
 * fallback to the employee's current process are both useful and are not the
 * same claim, and collapsing them would repeat the mistake this whole effort is
 * correcting — presenting a guess with the confidence of a measurement.
 */

export type AttributionSource =
  /** Effective-dated assignment covering the event date. Accurate for transfers. */
  | "lob_assignment"
  /** The employee's process today. Correct only if they have not moved since. */
  | "employee_current"
  /** No process could be determined; the caller must queue an exception. */
  | "unresolved";

export type ProcessAttribution = {
  processId: string | null;
  source: AttributionSource;
  /** True only when the assignment window actually covers the event date. */
  dateAccurate: boolean;
};

const UNRESOLVED: ProcessAttribution = {
  processId: null,
  source: "unresolved",
  dateAccurate: false,
};

/**
 * Resolve one employee's process as at a date.
 *
 * Prefers an effective-dated LOB assignment covering that date, because that is
 * the only source that survives a transfer without retro-relabelling history.
 * Falls back to the employee's current process, flagged as not date-accurate.
 *
 * Where an employee is split across LOBs, the largest allocation wins, then the
 * later assignment — a 60/40 split has to resolve to something, and silently
 * picking the first row the database happened to return is not it.
 */
export async function resolveProcessAtDate(
  employeeId: string,
  eventDate: string,
): Promise<ProcessAttribution> {
  const [assigned] = await db.execute<RowDataPacket[]>(
    `SELECT plm.process_id
       FROM employee_lob_assignment ela
       JOIN process_lob_master plm ON plm.id = ela.process_lob_id
      WHERE ela.employee_id = ?
        AND ela.effective_from <= ?
        AND (ela.effective_to IS NULL OR ela.effective_to >= ?)
        -- The enum is ('draft','approved','inactive'); there is no 'active'.
        -- A draft assignment must not attribute a real score.
        AND ela.status = 'approved'
        AND plm.process_id IS NOT NULL
      ORDER BY ela.allocation_pct DESC, ela.effective_from DESC
      LIMIT 1`,
    [employeeId, eventDate, eventDate],
  );
  if (assigned[0]?.process_id) {
    return { processId: String(assigned[0].process_id), source: "lob_assignment", dateAccurate: true };
  }

  const [current] = await db.execute<RowDataPacket[]>(
    `SELECT process_id FROM employees WHERE id = ? LIMIT 1`,
    [employeeId],
  );
  if (current[0]?.process_id) {
    return {
      processId: String(current[0].process_id),
      source: "employee_current",
      // Deliberately false: this is where the employee sits now, which is only
      // the same thing as where they sat on eventDate if they never moved.
      dateAccurate: false,
    };
  }

  return UNRESOLVED;
}

/**
 * Attribute an upstream quality row, whose only identifier is the agent code.
 *
 * `db_audit.call_quality_assessment.User` holds the HRMS employee_code directly
 * (values like MAS57576), and both sides collate case-insensitively, so no
 * normalisation is needed. A code matching more than one employee is treated as
 * unresolved rather than guessed at.
 */
export async function resolveProcessForAgentCode(
  agentCode: string,
  eventDate: string,
): Promise<ProcessAttribution & { employeeId: string | null }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employees WHERE employee_code = ? LIMIT 2`,
    [String(agentCode).trim()],
  );

  // Ambiguity is a mapping problem, not something to resolve by picking one.
  if (rows.length !== 1) return { ...UNRESOLVED, employeeId: null };

  const employeeId = String(rows[0].id);
  const attribution = await resolveProcessAtDate(employeeId, eventDate);
  return { ...attribution, employeeId };
}
