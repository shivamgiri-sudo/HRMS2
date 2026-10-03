import type { RowDataPacket } from "mysql2";
import { type DossierWindow, type SqlExecutor } from "./dossierTypes.js";

export interface HeaderSection {
  employeeId: string;
  employeeCode: string;
  name: string;
  photoUrl: string | null;
  designation: string | null;
  department: string | null;
  branch: string | null;
  process: string | null;
  manager: string | null;
  dateOfJoining: string | null;
  dateOfExit: string | null;
  employmentStatus: string | null;
  /** Whole months from the first joining (or first stint) to the as-of date. */
  tenureMonths: number | null;
}

/** Whole months, pure string math. Never negative. */
export function tenureMonths(from: string | null, to: string): number | null {
  if (!from) return null;
  const [fy, fm, fd] = from.slice(0, 10).split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = to.slice(0, 10).split("-").map(Number) as [number, number, number];
  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) months -= 1;
  return Math.max(0, months);
}

// Display joins follow analytics/employee-360.service.ts: branch_master, process_master, designation_master,
// department_master. (Tables named branches/departments/designations do not exist.)
const HEADER_SQL = `
  SELECT e.id AS id, e.employee_code AS employee_code,
         COALESCE(NULLIF(e.full_name, ''), CONCAT(e.first_name, ' ', e.last_name)) AS full_name,
         e.photo_url AS photo_url, d.designation_name AS designation_name, dm.dept_name AS dept_name,
         b.branch_name AS branch_name, p.process_name AS process_name,
         CONCAT(mgr.first_name, ' ', mgr.last_name) AS manager_name, mgr.employee_code AS manager_code,
         DATE_FORMAT(e.date_of_joining, '%Y-%m-%d') AS date_of_joining,
         DATE_FORMAT(e.date_of_exit, '%Y-%m-%d') AS date_of_exit,
         e.employment_status AS employment_status
    FROM employees e
    LEFT JOIN branch_master b ON b.id = e.branch_id
    LEFT JOIN process_master p ON p.id = e.process_id
    LEFT JOIN designation_master d ON d.id = e.designation_id
    LEFT JOIN department_master dm ON dm.id = e.department_id
    LEFT JOIN employees mgr ON mgr.id = e.reporting_manager_id
   WHERE e.id = ?`;

const FIRST_STINT_SQL = `SELECT DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date FROM employment_stint WHERE employee_id = ? AND stint_no = 1`;

export async function loadHeaderSection(db: SqlExecutor, w: DossierWindow): Promise<HeaderSection | null> {
  const [rows] = await db.execute<RowDataPacket[]>(HEADER_SQL, [w.employeeId]);
  const r = rows[0];
  if (!r) return null;
  const [stintRows] = await db.execute<RowDataPacket[]>(FIRST_STINT_SQL, [w.employeeId]);
  const since: string | null = stintRows[0]?.start_date ?? r.date_of_joining ?? null;

  return {
    employeeId: String(r.id),
    employeeCode: String(r.employee_code),
    name: String(r.full_name ?? "").trim(),
    photoUrl: r.photo_url ?? null,
    designation: r.designation_name ?? null,
    department: r.dept_name ?? null,
    branch: r.branch_name ?? null,
    process: r.process_name ?? null,
    manager: r.manager_name ? `${String(r.manager_name).trim()}${r.manager_code ? ` (${r.manager_code})` : ""}` : null,
    dateOfJoining: r.date_of_joining ?? null,
    dateOfExit: r.date_of_exit ?? null,
    employmentStatus: r.employment_status ?? null,
    tenureMonths: tenureMonths(since, w.end),
  };
}
