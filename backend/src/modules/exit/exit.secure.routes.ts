import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import { buildScopeWhereClause, hasAnyRole, hasScopedAccess } from "../../shared/scopeAccess.js";
import { exitService } from "./exit.service.js";

export const exitSecureRouter = Router();
exitSecureRouter.use(requireAuth);

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
const EXIT_SCOPE_ROLES = ["manager", "assistant_manager", "tl", "branch_head", "process_manager", "hr"];

async function exitListScope(userId: string) {
  if (await hasAnyRole(userId, "admin", "hr", "finance", "payroll", "ceo")) return { sql: "1=1", params: [] as unknown[] };
  const scoped = await buildScopeWhereClause(
    userId,
    EXIT_SCOPE_ROLES,
    {
      branchId: "e.branch_id",
      processId: "e.process_id",
      departmentId: "e.department_id",
      managerEmployeeId: "e.reporting_manager_id",
      employeeId: "e.id",
    },
    { allowAdminBypass: true, allowCeoAllRead: true },
  );
  if (scoped.sql !== "1=0") return scoped;
  const emp = await getEmployeeForUser(userId);
  if (emp?.id) return { sql: "e.id = ?", params: [emp.id] as unknown[] };
  return { sql: "1=0", params: [] as unknown[] };
}

async function canActOnExit(userId: string, exitRequestId: string) {
  if (await hasAnyRole(userId, "admin", "hr", "ceo")) return true;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT er.employee_id,
            e.branch_id,
            e.process_id,
            e.lob_id,
            e.department_id,
            e.reporting_manager_id,
            e.manager_id
       FROM exit_request er
       JOIN employees e ON e.id = er.employee_id
      WHERE er.id = ?
      LIMIT 1`,
    [exitRequestId],
  );
  const target = rows[0] as any;
  if (!target) return false;
  const callerEmp = await getEmployeeForUser(userId);
  if (callerEmp?.id === target.employee_id) return false;
  return hasScopedAccess(
    userId,
    EXIT_SCOPE_ROLES,
    {
      branchId: target.branch_id,
      processId: target.process_id,
      lobId: target.lob_id,
      departmentId: target.department_id,
      managerEmployeeId: target.reporting_manager_id ?? target.manager_id,
      employeeId: target.employee_id,
    },
    { allowAdminBypass: true, requireScopeForNonAdmin: true },
  );
}

exitSecureRouter.get("/stats", h(async (req: any, res: any) => {
  const scope = await exitListScope(req.authUser!.id);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT er.status, COUNT(*) AS cnt
       FROM exit_request er
       LEFT JOIN employees e ON e.id = er.employee_id
      WHERE ${scope.sql}
      GROUP BY er.status`,
    scope.params,
  );
  const counts: Record<string, number> = {};
  for (const row of rows as any[]) counts[String(row.status)] = Number(row.cnt ?? 0);
  const statuses = ["draft", "submitted", "manager_review", "hr_review", "admin_review", "accepted", "rejected", "revoked", "notice_serving", "exited"];
  const detailed = Object.fromEntries(statuses.map((s) => [s, counts[s] ?? 0])) as Record<string, number>;
  const total = Object.values(detailed).reduce((a, b) => a + b, 0);
  const pending = detailed.submitted + detailed.manager_review + detailed.hr_review + detailed.admin_review;
  return res.json({ success: true, data: { ...detailed, total, pending, completed: detailed.exited, active_notice: detailed.accepted + detailed.notice_serving } });
}));

exitSecureRouter.get("/", h(async (req: any, res: any) => {
  const privileged = await hasAnyRole(req.authUser!.id, "admin", "hr", "finance", "payroll", "ceo", ...EXIT_SCOPE_ROLES);
  if (!privileged) {
    const emp = await getEmployeeForUser(req.authUser!.id);
    if (!emp || !req.query.employeeId || String(req.query.employeeId) !== emp.id) {
      return res.status(403).json({ success: false, message: "Forbidden: employee collection access is not allowed" });
    }
  }
  const scope = await exitListScope(req.authUser!.id);
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const limit = Math.min(Math.max(1, Number(req.query.limit ?? 100) || 100), 500);
  const offset = (page - 1) * limit;
  const conds: string[] = [`(${scope.sql})`];
  const params: unknown[] = [...scope.params];
  if (req.query.status) { conds.push("er.status = ?"); params.push(String(req.query.status === "exit_confirmed" ? "exited" : req.query.status)); }
  if (req.query.employeeId) { conds.push("er.employee_id = ?"); params.push(String(req.query.employeeId)); }
  if (req.query.branchId) { conds.push("e.branch_id = ?"); params.push(String(req.query.branchId)); }
  if (req.query.processId) { conds.push("e.process_id = ?"); params.push(String(req.query.processId)); }
  if (req.query.search) {
    const q = `%${String(req.query.search)}%`;
    conds.push("(e.employee_code LIKE ? OR e.full_name LIKE ? OR er.resignation_reason LIKE ? OR er.exit_reason_category LIKE ?)");
    params.push(q, q, q, q);
  }
  const where = `WHERE ${conds.join(" AND ")}`;
  const fromSql = `FROM exit_request er LEFT JOIN employees e ON e.id = er.employee_id LEFT JOIN branch_master b ON b.id = e.branch_id LEFT JOIN process_master p ON p.id = e.process_id LEFT JOIN exit_employee_health_snapshot hs ON hs.exit_request_id = er.id LEFT JOIN (SELECT exit_request_id, COUNT(*) AS total_tasks, SUM(CASE WHEN status IN ('cleared','waived') THEN 1 ELSE 0 END) AS cleared_tasks FROM exit_clearance_task GROUP BY exit_request_id) clearance ON clearance.exit_request_id = er.id`;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT er.*, e.employee_code, COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS employee_name, b.branch_name, p.process_name, hs.engagement_score, hs.regrettable_exit, hs.risk_label, COALESCE(clearance.total_tasks, 0) AS clearance_total, COALESCE(clearance.cleared_tasks, 0) AS clearance_cleared ${fromSql} ${where} ORDER BY er.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const [countRows] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total ${fromSql} ${where}`, params);
  return res.json({ success: true, data: rows, total: Number(countRows[0]?.total ?? 0), page, limit });
}));

exitSecureRouter.patch("/:id/status", h(async (req: any, res: any) => {
  if (!(await canActOnExit(req.authUser!.id, req.params.id))) return res.status(403).json({ success: false, message: "Forbidden: exit request is outside your action scope" });
  const status = String(req.body?.status ?? "");
  const allowed = ["submitted", "manager_review", "hr_review", "admin_review", "accepted", "notice_serving", "exited", "exit_confirmed", "revoked", "rejected"];
  if (!allowed.includes(status)) return res.status(400).json({ success: false, message: "Invalid exit status" });
  const data = await exitService.updateExitStatus(req.params.id, status, String(req.body?.remarks ?? `Status changed to ${status}`), req.authUser!.id);
  return res.json({ success: true, data, message: `Exit request status updated to ${status}` });
}));

exitSecureRouter.post("/:id/status", h(async (req: any, res: any) => {
  req.method = "PATCH";
  if (!(await canActOnExit(req.authUser!.id, req.params.id))) return res.status(403).json({ success: false, message: "Forbidden: exit request is outside your action scope" });
  const status = String(req.body?.status ?? "");
  const allowed = ["submitted", "manager_review", "hr_review", "admin_review", "accepted", "notice_serving", "exited", "exit_confirmed", "revoked", "rejected"];
  if (!allowed.includes(status)) return res.status(400).json({ success: false, message: "Invalid exit status" });
  const data = await exitService.updateExitStatus(req.params.id, status, String(req.body?.remarks ?? `Status changed to ${status}`), req.authUser!.id);
  return res.json({ success: true, data, message: `Exit request status updated to ${status}` });
}));
