import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { lobCondition, type LobFilter } from "../../shared/lobFilter.js";

export interface GridRow {
  employeeId: string;
  employeeName: string;
  lobId: string | null;
  lobName: string | null;
  rosterDate: string;
  assignmentId: string | null;
  shiftTemplateId: string | null;
  shiftTemplateName: string | null;
  isWeekOff: boolean;
  finalRosterStatus: string | null;
}

export interface GridFilters {
  cycleId: string;
  branchId?: string;
  employeeSearch?: string;
  lob?: LobFilter;
}

export async function getRosterGrid(filters: GridFilters): Promise<GridRow[]> {
  const conds: string[] = ["wra.cycle_id = ?"];
  const params: unknown[] = [filters.cycleId];

  if (filters.branchId) {
    conds.push("e.branch_id = ?");
    params.push(filters.branchId);
  }
  if (filters.employeeSearch) {
    conds.push("(e.full_name LIKE ? OR e.employee_code LIKE ?)");
    const like = `%${filters.employeeSearch}%`;
    params.push(like, like);
  }
  const lobCond = filters.lob ? lobCondition(filters.lob, "e") : null;
  if (lobCond) {
    conds.push(lobCond.sql);
    params.push(...lobCond.params);
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       wra.employee_id        AS employee_id,
       e.full_name            AS employee_name,
       e.lob_id               AS lob_id,
       wra.roster_date        AS roster_date,
       wra.id                 AS assignment_id,
       wra.shift_template_id  AS shift_template_id,
       st.shift_name          AS shift_template_name,
       wra.is_week_off        AS is_week_off,
       wra.final_roster_status AS final_roster_status
     FROM wfm_roster_assignment wra
     JOIN employees e ON e.id = wra.employee_id
     LEFT JOIN wfm_shift_template st ON st.id = wra.shift_template_id
     WHERE ${conds.join(" AND ")}
     ORDER BY e.full_name, wra.roster_date`,
    params
  );

  // LOB names by parameterised id lookup (never JOIN lob_master: mixed collations).
  const lobIds = [...new Set((rows as RowDataPacket[]).map((r) => r.lob_id).filter(Boolean).map(String))];
  const lobNames = new Map<string, string>();
  if (lobIds.length) {
    const [lobRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, lob_name FROM lob_master WHERE id IN (${lobIds.map(() => "?").join(", ")})`,
      lobIds
    );
    for (const l of lobRows ?? []) lobNames.set(String(l.id), String(l.lob_name));
  }

  return (rows as RowDataPacket[]).map((r) => ({
    employeeId: String(r.employee_id),
    employeeName: String(r.employee_name),
    lobId: r.lob_id ? String(r.lob_id) : null,
    lobName: r.lob_id ? (lobNames.get(String(r.lob_id)) ?? null) : null,
    rosterDate: String(r.roster_date),
    assignmentId: r.assignment_id ? String(r.assignment_id) : null,
    shiftTemplateId: r.shift_template_id ? String(r.shift_template_id) : null,
    shiftTemplateName: r.shift_template_name ? String(r.shift_template_name) : null,
    isWeekOff: Number(r.is_week_off) === 1,
    finalRosterStatus: r.final_roster_status ? String(r.final_roster_status) : null,
  }));
}

export interface ShiftTemplateTimes {
  startTime: string;
  endTime: string;
}

/**
 * The template's own start/end times, resolved server-side.
 *
 * These feed AssignInput.shiftStartTime/shiftEndTime, which is what makes
 * roster.service.ts run its minimum-rest validation at all — that check is gated on
 * `if (input.shiftStartTime && input.shiftEndTime && ...)`, so an assign call that omits them
 * silently skips the guard the other four roster-write engines enforce. Resolved here rather
 * than accepted from the request body on purpose: a safety check fed by a client-supplied
 * value is not a safety check.
 *
 * Returns null when the id matches no template, so the caller can refuse the write instead of
 * assigning a shift that does not exist.
 */
export async function getShiftTemplateTimes(shiftTemplateId: string): Promise<ShiftTemplateTimes | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT start_time, end_time FROM wfm_shift_template WHERE id = ? LIMIT 1",
    [shiftTemplateId]
  );
  const row = rows[0];
  if (!row || row.start_time == null || row.end_time == null) return null;
  return { startTime: String(row.start_time), endTime: String(row.end_time) };
}
