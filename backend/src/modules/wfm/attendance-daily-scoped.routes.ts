import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";

export const attendanceDailyScopedRouter = Router();
attendanceDailyScopedRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
const DB_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/;

attendanceDailyScopedRouter.get("/daily", h(async (req, res) => {
  const userId = req.authUser!.id;
  const isAdminHrWfm = await hasRole(userId, "admin", "hr", "wfm");
  const isManager = await hasRole(userId, "manager");
  const callerEmp = await getEmployeeForUser(userId);

  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const limit = Math.min(Math.max(1, Number(req.query.limit ?? 50) || 50), 200);
  const offset = (page - 1) * limit;
  const params: unknown[] = [];
  const where: string[] = ["1=1"];

  if (!isAdminHrWfm) {
    if (!callerEmp?.id) return res.status(403).json({ success: false, error: "No employee record" });
    if (isManager) {
      where.push("(e.reporting_manager_id = ? OR e.manager_id = ? OR adr.employee_id = ?)");
      params.push(callerEmp.id, callerEmp.id, callerEmp.id);
    } else {
      where.push("adr.employee_id = ?");
      params.push(callerEmp.id);
    }
  } else if (req.query.employeeId) {
    const qEmpId = String(req.query.employeeId);
    if (!DB_ID_REGEX.test(qEmpId)) return res.status(400).json({ success: false, error: "Invalid employeeId" });
    where.push("adr.employee_id = ?");
    params.push(qEmpId);
  }

  if (req.query.processId) { where.push("adr.process_id = ?"); params.push(String(req.query.processId)); }
  if (req.query.fromDate) { where.push("adr.record_date >= ?"); params.push(String(req.query.fromDate)); }
  if (req.query.toDate) { where.push("adr.record_date <= ?"); params.push(String(req.query.toDate)); }
  if (req.query.attendanceStatus) { where.push("adr.attendance_status = ?"); params.push(String(req.query.attendanceStatus)); }

  const fromSql = `
    FROM attendance_daily_record adr
    LEFT JOIN employees e ON e.id = adr.employee_id
    LEFT JOIN department_master dm ON dm.id = e.department_id
  `;
  const whereSql = `WHERE ${where.join(" AND ")}`;

  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total ${fromSql} ${whereSql}`,
    params,
  );

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT adr.*,
            DATE_FORMAT(adr.record_date, '%Y-%m-%d') AS record_date,
            DATE_FORMAT(adr.record_date, '%Y-%m-%d') AS date,
            adr.clock_in_time AS clock_in,
            adr.clock_out_time AS clock_out,
            ROUND(adr.raw_minutes / 60, 2) AS total_hours,
            adr.attendance_status AS status,
            adr.clock_in_location AS clock_in_location_name,
            adr.clock_out_location AS clock_out_location_name,
            COALESCE(NULLIF(e.full_name, ''), CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, ''))) AS employee_name,
            COALESCE(NULLIF(e.first_name, ''), NULLIF(e.full_name, ''), '') AS first_name,
            COALESCE(e.last_name, '') AS last_name,
            e.employee_code,
            e.working_hours_start,
            e.working_hours_end,
            dm.dept_name AS department_name
       ${fromSql}
       ${whereSql}
      ORDER BY adr.record_date DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  const data = rows.map((r: any) => ({
    ...r,
    employee: {
      first_name: r.first_name ?? "",
      last_name: r.last_name ?? "",
      employee_code: r.employee_code ?? "",
      working_hours_start: r.working_hours_start ?? null,
      working_hours_end: r.working_hours_end ?? null,
    },
  }));

  return res.json({ success: true, data, total: Number(countRows[0]?.total ?? 0), page, limit });
}));
