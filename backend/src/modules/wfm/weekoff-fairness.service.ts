import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2/promise";

// ─── Fairness score computation ───────────────────────────────────────────────

const WEEKEND_DAYS = new Set([0, 6]); // Sun=0, Sat=6

/**
 * Compute and upsert fairness scores for all employees in a process for a given week.
 * Called by the auto-roster engine before week-off allocation.
 */
export async function computeAndStoreFairnessScores(
  processId: string,
  weekStartDate: string, // YYYY-MM-DD Monday
): Promise<void> {
  // Get all active employees in this process
  const [employees] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employees WHERE process_id = ? AND active_status = 1`,
    [processId],
  );

  for (const emp of employees as any[]) {
    const score = await computeEmployeeFairnessScore(emp.id, processId, weekStartDate);
    await upsertFairnessScore(emp.id, processId, weekStartDate, score);
  }
}

/**
 * Calculate fairness score for a single employee.
 */
async function computeEmployeeFairnessScore(
  employeeId: string,
  processId: string,
  weekStartDate: string,
): Promise<Omit<typeof SCORE_TEMPLATE, "employee_id" | "process_id" | "week_start_date">> {
  // Last 3 weeks of fairness history
  const [history] = await db.execute<RowDataPacket[]>(
    `SELECT week_start_date, assigned_day, assigned_day_is_preferred,
            consecutive_no_preferred_weekoff, consecutive_no_weekend_weekoff
       FROM weekoff_fairness_score
      WHERE employee_id = ? AND process_id = ?
        AND week_start_date < ?
      ORDER BY week_start_date DESC
      LIMIT 3`,
    [employeeId, processId, weekStartDate],
  );
  const hist = history as any[];

  // Current week preference
  const [prefRows] = await db.execute<RowDataPacket[]>(
    `SELECT preferred_day_1, preferred_day_2
       FROM week_off_preference
      WHERE employee_id = ? AND week_start_date = ?
      ORDER BY created_at ASC LIMIT 1`,
    [employeeId, weekStartDate],
  );
  const pref = (prefRows[0] as any);
  const preferredDay: number | null = pref?.preferred_day_1 ?? null;

  // Consecutive no-weekend off (from last history row, or 0 if new)
  const lastHistory = hist[0];
  let consecutiveNoWeekend = lastHistory?.consecutive_no_weekend_weekoff ?? 0;
  let consecutiveNoPreferred = lastHistory?.consecutive_no_preferred_weekoff ?? 0;

  // Check if last week had a weekend off
  if (lastHistory) {
    const lastAssigned = lastHistory.assigned_day;
    if (lastAssigned !== null && WEEKEND_DAYS.has(lastAssigned)) {
      consecutiveNoWeekend = 0;
    }
    if (lastHistory.assigned_day_is_preferred) {
      consecutiveNoPreferred = 0;
    }
  }

  // Check if new joinee (< 30 days in role)
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT date_of_joining FROM employees WHERE id = ? LIMIT 1`,
    [employeeId],
  );
  const doj = (empRows[0] as any)?.date_of_joining;
  const isNewJoinee = doj ? (
    (new Date(weekStartDate).getTime() - new Date(doj).getTime()) / 86400000 < 30
  ) : false;

  // Compute score
  let score = 100;

  // FCFS boost: check if preference was submitted early (relative to others)
  if (pref) score += 20;

  // No preferred last week
  if (consecutiveNoPreferred >= 1) score += 30;
  // No weekend for 2 weeks
  if (consecutiveNoWeekend >= 2) score += 50;
  // No weekend for 3+ weeks (override-level)
  if (consecutiveNoWeekend >= 3) score += 80;

  // New joinee penalty
  if (isNewJoinee) score -= 30;

  // Got preferred last week → lower priority
  if (lastHistory?.assigned_day_is_preferred) score -= 40;

  return {
    preferred_day: preferredDay,
    assigned_day: null,
    assigned_day_is_preferred: false,
    consecutive_no_preferred_weekoff: consecutiveNoPreferred,
    consecutive_no_weekend_weekoff: consecutiveNoWeekend,
    fairness_score: Math.max(0, score),
    allocation_exception_reason: null,
  };
}

const SCORE_TEMPLATE = {
  employee_id: "",
  process_id: "",
  week_start_date: "",
  preferred_day: null as number | null,
  assigned_day: null as number | null,
  assigned_day_is_preferred: false,
  consecutive_no_preferred_weekoff: 0,
  consecutive_no_weekend_weekoff: 0,
  fairness_score: 100,
  allocation_exception_reason: null as string | null,
};

async function upsertFairnessScore(
  employeeId: string,
  processId: string,
  weekStartDate: string,
  data: Omit<typeof SCORE_TEMPLATE, "employee_id" | "process_id" | "week_start_date">,
): Promise<void> {
  await db.execute(
    `INSERT INTO weekoff_fairness_score
       (id, employee_id, process_id, week_start_date, preferred_day, assigned_day,
        assigned_day_is_preferred, consecutive_no_preferred_weekoff,
        consecutive_no_weekend_weekoff, fairness_score, allocation_exception_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       preferred_day = VALUES(preferred_day),
       fairness_score = VALUES(fairness_score),
       consecutive_no_preferred_weekoff = VALUES(consecutive_no_preferred_weekoff),
       consecutive_no_weekend_weekoff = VALUES(consecutive_no_weekend_weekoff),
       updated_at = NOW()`,
    [
      randomUUID(), employeeId, processId, weekStartDate,
      data.preferred_day, data.assigned_day,
      data.assigned_day_is_preferred ? 1 : 0,
      data.consecutive_no_preferred_weekoff,
      data.consecutive_no_weekend_weekoff,
      data.fairness_score,
      data.allocation_exception_reason,
    ],
  );
}

/**
 * After allocation is complete, record the actual assignment and update consecutives.
 */
export async function recordWeekOffAllocation(
  employeeId: string,
  processId: string,
  weekStartDate: string,
  assignedDay: number | null,
  exceptionReason?: string,
): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT preferred_day, consecutive_no_preferred_weekoff, consecutive_no_weekend_weekoff
       FROM weekoff_fairness_score
      WHERE employee_id = ? AND week_start_date = ?
      LIMIT 1`,
    [employeeId, weekStartDate],
  );
  const current = (rows[0] as any);

  const isPreferred = current?.preferred_day !== null && current?.preferred_day === assignedDay;
  const isWeekend = assignedDay !== null && WEEKEND_DAYS.has(assignedDay);

  const consecutiveNoPreferred = isPreferred
    ? 0
    : (current?.consecutive_no_preferred_weekoff ?? 0) + 1;

  const consecutiveNoWeekend = isWeekend
    ? 0
    : (current?.consecutive_no_weekend_weekoff ?? 0) + 1;

  await db.execute(
    `UPDATE weekoff_fairness_score
        SET assigned_day = ?,
            assigned_day_is_preferred = ?,
            consecutive_no_preferred_weekoff = ?,
            consecutive_no_weekend_weekoff = ?,
            allocation_exception_reason = ?,
            updated_at = NOW()
      WHERE employee_id = ? AND week_start_date = ?`,
    [
      assignedDay, isPreferred ? 1 : 0,
      consecutiveNoPreferred, consecutiveNoWeekend,
      exceptionReason ?? null,
      employeeId, weekStartDate,
    ],
  );
}

/**
 * Get fairness scores for a process/week for the allocation engine.
 * Returns sorted by score DESC (highest priority first).
 */
export async function getFairnessScoresForWeek(
  processId: string,
  weekStartDate: string,
): Promise<any[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT wfs.*,
            CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS employee_name,
            e.employee_code,
            wop.preferred_day_1, wop.preferred_day_2
       FROM weekoff_fairness_score wfs
       JOIN employees e ON e.id = wfs.employee_id
       LEFT JOIN week_off_preference wop
              ON wop.employee_id = wfs.employee_id
             AND wop.week_start_date = wfs.week_start_date
      WHERE wfs.process_id = ? AND wfs.week_start_date = ?
      ORDER BY wfs.fairness_score DESC, wop.created_at ASC`,
    [processId, weekStartDate],
  );
  return rows as any[];
}
