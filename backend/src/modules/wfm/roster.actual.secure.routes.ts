import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { buildScopeWhereClause, hasAnyRole } from "../../shared/scopeAccess.js";

export const rosterActualSecureRouter = Router();
rosterActualSecureRouter.use(requireAuth);

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
const ROSTER_SCOPE_ROLES = ["wfm", "process_manager", "branch_head", "manager", "assistant_manager", "tl"];

async function actualRosterScope(userId: string) {
  if (await hasAnyRole(userId, "admin", "hr", "ceo")) return { sql: "1=1", params: [] as unknown[] };
  return buildScopeWhereClause(
    userId,
    ROSTER_SCOPE_ROLES,
    {
      branchId: "e.branch_id",
      processId: "e.process_id",
      departmentId: "e.department_id",
      managerEmployeeId: "COALESCE(a.manager_employee_id, e.reporting_manager_id)",
      employeeId: "e.id",
    },
    { allowAdminBypass: true, allowCeoAllRead: true },
  );
}

rosterActualSecureRouter.get("/actual-process", h(async (req: any, res: any) => {
  const scope = await actualRosterScope(req.authUser!.id);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.process_id, p.process_name
       FROM wfm_roster_assignment a
       JOIN employees e ON e.id = a.employee_id
       JOIN process_master p ON p.id = e.process_id
      WHERE e.process_id IS NOT NULL
        AND p.active_status = 1
        AND (${scope.sql})
      ORDER BY a.roster_date DESC
      LIMIT 1`,
    scope.params,
  );
  return res.json({ success: true, data: rows[0] ?? null });
}));

rosterActualSecureRouter.get("/actual-assignments", h(async (req: any, res: any) => {
  const scope = await actualRosterScope(req.authUser!.id);
  const conds: string[] = [`(${scope.sql})`];
  const params: unknown[] = [...scope.params];
  if (req.query.processId) { conds.push("e.process_id = ?"); params.push(String(req.query.processId)); }
  if (req.query.branchId) { conds.push("e.branch_id = ?"); params.push(String(req.query.branchId)); }
  if (req.query.fromDate) { conds.push("a.roster_date >= ?"); params.push(String(req.query.fromDate)); }
  if (req.query.toDate) { conds.push("a.roster_date <= ?"); params.push(String(req.query.toDate)); }
  const limit = Math.min(Math.max(Number(req.query.limit ?? 500) || 500, 1), 1000);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT a.id,
            a.employee_id,
            e.process_id,
            e.employee_code,
            COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS employee_name,
            DATE_FORMAT(a.roster_date, '%Y-%m-%d') AS roster_date,
            a.roster_status,
            a.publish_status,
            a.shift_start_time,
            a.shift_end_time,
            COALESCE(sm.shift_code, '') AS shift_code,
            COALESCE(sm.shift_name, '') AS shift_name,
            COALESCE(a.branch_name, b.branch_name) AS branch_name,
            COALESCE(a.process_name, p.process_name) AS process_name
       FROM wfm_roster_assignment a
       JOIN employees e ON e.id = a.employee_id
       LEFT JOIN wfm_shift_master sm ON sm.id = a.shift_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
      WHERE ${conds.join(" AND ")}
      ORDER BY a.roster_date DESC, e.employee_code ASC
      LIMIT ${limit}`,
    params,
  );
  return res.json({ success: true, data: rows });
}));
