import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { exitController } from "./exit.controller.js";

export const exitCompatRouter = Router();
exitCompatRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

function normalizeStatus(status: unknown) {
  const next = String(status ?? "").trim();
  return next === "exit_confirmed" ? "exited" : next;
}

async function finalExitBlockers(exitRequestId: string) {
  const [clearanceRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS open_count
       FROM exit_clearance_task
      WHERE exit_request_id = ?
        AND status NOT IN ('cleared', 'waived')`,
    [exitRequestId],
  );
  const [ffRows] = await db.execute<RowDataPacket[]>(
    `SELECT status, is_ff_provisional
       FROM full_final_calculation
      WHERE exit_request_id = ?
      ORDER BY created_at DESC
      LIMIT 1`,
    [exitRequestId],
  );
  const ff = ffRows[0];
  const blockers: string[] = [];
  const openClearance = Number(clearanceRows[0]?.open_count ?? 0);
  if (openClearance > 0) blockers.push(`${openClearance} clearance task(s) still open`);
  if (!ff) blockers.push("F&F calculation is missing");
  else {
    if (!["approved", "paid"].includes(String(ff.status))) blockers.push(`F&F is ${ff.status}`);
    if (Number(ff.is_ff_provisional) === 1) blockers.push("F&F is provisional");
  }
  return blockers;
}

const guardedStatusUpdate = [
  requireRole("admin", "hr", "manager"),
  h(async (req: AuthenticatedRequest, res) => {
    const nextStatus = normalizeStatus(req.body?.status);
    if (!nextStatus) return res.status(400).json({ success: false, message: "status is required" });
    if (nextStatus === "exited") {
      const blockers = await finalExitBlockers(req.params.id);
      if (blockers.length) {
        return res.status(409).json({
          success: false,
          message: "Cannot mark employee exited until exit controls are complete.",
          blockers,
        });
      }
    }
    req.body = { ...req.body, status: nextStatus };
    return exitController.updateExitStatus(req, res);
  }),
] as const;

exitCompatRouter.patch("/:id/status", ...guardedStatusUpdate);
exitCompatRouter.post("/:id/status", ...guardedStatusUpdate);

exitCompatRouter.get("/", h(async (req, res) => {
  const userId = req.authUser!.id;
  const isAdminHr = await hasRole(userId, "admin", "hr");
  const isFinancePayroll = await hasRole(userId, "finance", "payroll");
  const isManager = await hasRole(userId, "manager");
  const callerEmp = await getEmployeeForUser(userId);

  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const limit = Math.min(Math.max(1, Number(req.query.limit ?? 20) || 20), 100);
  const offset = (page - 1) * limit;
  const where: string[] = [];
  const params: unknown[] = [];

  if (!isAdminHr && !isFinancePayroll) {
    if (!callerEmp?.id) return res.status(403).json({ success: false, message: "No employee record linked to your login" });
    if (isManager) {
      where.push("(e.reporting_manager_id = ? OR e.manager_id = ? OR er.employee_id = ?)");
      params.push(callerEmp.id, callerEmp.id, callerEmp.id);
    } else {
      where.push("er.employee_id = ?");
      params.push(callerEmp.id);
    }
  } else if (req.query.employeeId) {
    where.push("er.employee_id = ?");
    params.push(String(req.query.employeeId));
  }

  if (req.query.status) { where.push("er.status = ?"); params.push(String(req.query.status) === "exit_confirmed" ? "exited" : String(req.query.status)); }
  if (req.query.branchId) { where.push("e.branch_id = ?"); params.push(String(req.query.branchId)); }
  if (req.query.processId) { where.push("e.process_id = ?"); params.push(String(req.query.processId)); }
  if (req.query.search) {
    const q = `%${String(req.query.search).trim()}%`;
    where.push("(e.employee_code LIKE ? OR e.full_name LIKE ? OR CONCAT_WS(' ', e.first_name, e.last_name) LIKE ? OR er.resignation_reason LIKE ? OR er.exit_reason_category LIKE ?)");
    params.push(q, q, q, q, q);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const fromSql = `
    FROM exit_request er
    LEFT JOIN employees e ON e.id = er.employee_id
    LEFT JOIN branch_master b ON b.id = e.branch_id
    LEFT JOIN process_master p ON p.id = e.process_id
    LEFT JOIN exit_employee_health_snapshot hs ON hs.exit_request_id = er.id
    LEFT JOIN (
      SELECT exit_request_id,
             COUNT(*) AS total_tasks,
             SUM(CASE WHEN status IN ('cleared','waived') THEN 1 ELSE 0 END) AS cleared_tasks
        FROM exit_clearance_task GROUP BY exit_request_id
    ) clearance ON clearance.exit_request_id = er.id
  `;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT er.*,
            e.employee_code,
            COALESCE(NULLIF(e.full_name, ''), CONCAT_WS(' ', e.first_name, e.last_name)) AS employee_name,
            b.branch_name,
            p.process_name,
            hs.engagement_score,
            hs.regrettable_exit,
            hs.risk_label,
            COALESCE(clearance.total_tasks, 0) AS clearance_total,
            COALESCE(clearance.cleared_tasks, 0) AS clearance_cleared
       ${fromSql}
       ${whereSql}
      ORDER BY er.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total ${fromSql} ${whereSql}`,
    params,
  );

  return res.json({ success: true, data: rows, total: Number(countRows[0]?.total ?? 0), page, limit });
}));
