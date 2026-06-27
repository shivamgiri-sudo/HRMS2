import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { toIST, mysqlDatetimeToIST } from "../../shared/timezone.js";

export const biometricSummaryRouter = Router();
biometricSummaryRouter.use(requireAuth);

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

function dateValue(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function limitValue(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 1000) : fallback;
}

function commonWhere(query: any, params: any[]) {
  const clauses = ["adr.record_date BETWEEN ? AND ?"];
  params.push(dateValue(query.from, monthStart()), dateValue(query.to, today()));
  if (query.branchId) { clauses.push("e.branch_id = ?"); params.push(String(query.branchId)); }
  if (query.processId) { clauses.push("e.process_id = ?"); params.push(String(query.processId)); }
  if (query.costCentreId) { clauses.push("e.cost_centre_id = ?"); params.push(String(query.costCentreId)); }
  if (query.managerId) { clauses.push("e.reporting_manager_id = ?"); params.push(String(query.managerId)); }
  if (query.employeeId) { clauses.push("e.id = ?"); params.push(String(query.employeeId)); }
  return clauses.join(" AND ");
}

const roleGuard = requireRole("admin", "hr", "wfm", "manager", "process_manager", "team_leader", "tl", "ceo", "finance", "payroll");

biometricSummaryRouter.get("/adherence-summary", roleGuard, h(async (req: any, res: any) => {
  const params: any[] = [];
  const where = commonWhere(req.query, params);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS mandate_agent_days,
            SUM(adr.attendance_status = 'present') AS present_days,
            SUM(adr.attendance_status = 'half_day') AS half_days,
            SUM(adr.attendance_status = 'absent') AS absent_days,
            SUM(adr.late_mark = 1) AS late_days,
            ROUND(SUM(adr.attendance_status IN ('present','half_day')) * 100.0 / NULLIF(COUNT(*), 0), 2) AS adherence_pct,
            ROUND(SUM(adr.late_mark = 1) * 100.0 / NULLIF(COUNT(*), 0), 2) AS late_pct,
            ROUND(SUM(adr.attendance_status = 'absent') * 100.0 / NULLIF(COUNT(*), 0), 2) AS shrinkage_pct
       FROM attendance_daily_record adr
       JOIN employees e ON e.id = adr.employee_id
      WHERE ${where}`,
    params,
  );
  return res.json({ success: true, data: rows[0] ?? {} });
}));

biometricSummaryRouter.get("/agent-view", roleGuard, h(async (req: any, res: any) => {
  const params: any[] = [];
  const where = commonWhere(req.query, params);
  const limit = limitValue(req.query.limit, 500);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id AS employee_id,
            e.employee_code,
            COALESCE(NULLIF(e.full_name, ''), CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS employee_name,
            COUNT(*) AS working_days,
            SUM(adr.attendance_status = 'present') AS present_days,
            SUM(adr.attendance_status = 'half_day') AS half_days,
            SUM(adr.attendance_status = 'absent') AS absent_days,
            SUM(adr.late_mark = 1) AS late_days,
            ROUND(SUM(adr.attendance_status IN ('present','half_day')) * 100.0 / NULLIF(COUNT(*), 0), 2) AS adherence_pct,
            ROUND(SUM(adr.late_mark = 1) * 100.0 / NULLIF(COUNT(*), 0), 2) AS late_pct,
            ROUND(SUM(COALESCE(adr.biometric_minutes, adr.raw_minutes, 0)) / 60, 2) AS total_biometric_hours
       FROM attendance_daily_record adr
       JOIN employees e ON e.id = adr.employee_id
      WHERE ${where}
      GROUP BY e.id, e.employee_code, employee_name
      ORDER BY late_days DESC, employee_name ASC
      LIMIT ${limit}`,
    params,
  );
  return res.json({ success: true, data: rows, meta: { count: rows.length } });
}));

biometricSummaryRouter.get("/reconciliation", roleGuard, h(async (req: any, res: any) => {
  const params: any[] = [];
  const where = commonWhere(req.query, params);
  const limit = limitValue(req.query.limit, 500);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT adr.record_date,
            e.id AS employee_id,
            e.employee_code,
            COALESCE(NULLIF(e.full_name, ''), CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS employee_name,
            adr.attendance_status,
            adr.lwp_value,
            adr.late_mark,
            adr.late_by_minutes,
            adr.clock_in_time,
            adr.clock_out_time,
            adr.biometric_minutes,
            ibd.first_punch,
            ibd.last_punch,
            ibd.biometric_minutes AS imported_biometric_minutes
       FROM attendance_daily_record adr
       JOIN employees e ON e.id = adr.employee_id
       LEFT JOIN integration_biometric_daily ibd ON ibd.employee_code = e.employee_code AND ibd.activity_date = adr.record_date
      WHERE ${where}
      ORDER BY adr.record_date DESC, employee_name ASC
      LIMIT ${limit}`,
    params,
  );
  const data = rows.map((row: any) => ({
    ...row,
    clock_in_time:  mysqlDatetimeToIST(row.clock_in_time),
    clock_out_time: mysqlDatetimeToIST(row.clock_out_time),
    first_punch:    mysqlDatetimeToIST(row.first_punch),
    last_punch:     mysqlDatetimeToIST(row.last_punch),
    mismatch_type: !row.first_punch && ["present", "half_day"].includes(String(row.attendance_status))
      ? "NO_BIOMETRIC_FOR_PRESENT"
      : row.first_punch && String(row.attendance_status) === "absent"
        ? "PUNCHED_BUT_ABSENT"
        : null,
  }));
  return res.json({ success: true, data, meta: { count: data.length } });
}));
