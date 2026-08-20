import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export interface GridRow {
  employeeId: string;
  employeeName: string;
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

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       wra.employee_id        AS employee_id,
       e.full_name            AS employee_name,
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

  return (rows as RowDataPacket[]).map((r) => ({
    employeeId: String(r.employee_id),
    employeeName: String(r.employee_name),
    rosterDate: String(r.roster_date),
    assignmentId: r.assignment_id ? String(r.assignment_id) : null,
    shiftTemplateId: r.shift_template_id ? String(r.shift_template_id) : null,
    shiftTemplateName: r.shift_template_name ? String(r.shift_template_name) : null,
    isWeekOff: Number(r.is_week_off) === 1,
    finalRosterStatus: r.final_roster_status ? String(r.final_roster_status) : null,
  }));
}
