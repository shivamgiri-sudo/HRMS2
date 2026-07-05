import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import { buildScopeWhereClause, hasAnyRole } from "../../shared/scopeAccess.js";
import { leaveService } from "./leave.service.js";

export const leaveSecureRouter = Router();
leaveSecureRouter.use(requireAuth);

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
const LEAVE_VIEW_SCOPE_ROLES = ["manager", "assistant_manager", "tl", "branch_head", "process_manager", "hr", "payroll_hr", "payroll_branch", "wfm"];

async function leaveListScope(userId: string): Promise<{ sql: string; params: unknown[] }> {
  if (await hasAnyRole(userId, "super_admin")) return { sql: "1=1", params: [] };
  const scoped = await buildScopeWhereClause(userId, LEAVE_VIEW_SCOPE_ROLES, { branchId: "e.branch_id", processId: "e.process_id", departmentId: "e.department_id", managerEmployeeId: "e.reporting_manager_id", employeeId: "e.id" }, { allowAdminBypass: false, allowCeoAllRead: false });
  if (scoped.sql !== "1=0") return scoped;
  const callerEmp = await getEmployeeForUser(userId);
  if (callerEmp?.id) return { sql: "e.id = ?", params: [callerEmp.id] };
  return { sql: "1=0", params: [] };
}

async function canReviewLeave(userId: string, requestId: string): Promise<boolean> {
  if (await hasAnyRole(userId, "super_admin")) return true;
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT lr.employee_id, e.branch_id, e.process_id, e.lob_id, e.department_id, e.reporting_manager_id, e.manager_id FROM leave_request lr JOIN employees e ON e.id = lr.employee_id WHERE lr.id = ? LIMIT 1`, [requestId]);
  const target = rows[0] as any;
  if (!target) return false;
  const callerEmp = await getEmployeeForUser(userId);
  if (callerEmp?.id && callerEmp.id === target.employee_id) return false;
  return Boolean(callerEmp?.id && (callerEmp.id === target.reporting_manager_id || callerEmp.id === target.manager_id));
}

leaveSecureRouter.get("/requests", h(async (req: any, res: any) => {
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const limit = Math.min(Math.max(1, Number(req.query.limit ?? 100) || 100), 500);
  const offset = (page - 1) * limit;
  const scope = await leaveListScope(req.authUser!.id);
  const conds: string[] = [`(${scope.sql})`];
  const params: unknown[] = [...scope.params];
  if (req.query.employeeId) { conds.push("lr.employee_id = ?"); params.push(String(req.query.employeeId)); }
  if (req.query.leaveTypeId) { conds.push("lr.leave_type_id = ?"); params.push(String(req.query.leaveTypeId)); }
  if (req.query.status) { conds.push("lr.status = ?"); params.push(String(req.query.status)); }
  if (req.query.fromDate) { conds.push("lr.from_date >= ?"); params.push(String(req.query.fromDate)); }
  if (req.query.toDate) { conds.push("lr.to_date <= ?"); params.push(String(req.query.toDate)); }
  if (req.query.activeOn) { conds.push("lr.from_date <= ?"); conds.push("lr.to_date >= ?"); params.push(String(req.query.activeOn), String(req.query.activeOn)); }
  if (req.query.year) { conds.push("YEAR(lr.from_date) = ?"); params.push(Number(req.query.year)); }
  const where = `WHERE ${conds.join(" AND ")}`;
  const fromSql = `FROM leave_request lr LEFT JOIN employees e ON e.id = lr.employee_id LEFT JOIN department_master dept ON dept.id = e.department_id LEFT JOIN branch_master bm ON bm.id = e.branch_id LEFT JOIN process_master pm ON pm.id = e.process_id LEFT JOIN leave_type_master lt ON lt.id = lr.leave_type_id LEFT JOIN leave_approval_log approval ON approval.id = (SELECT latest.id FROM leave_approval_log latest WHERE latest.leave_request_id = lr.id ORDER BY latest.action_at DESC LIMIT 1) LEFT JOIN employees rev ON rev.user_id = approval.action_by`;
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT lr.*, COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS employee_name, e.first_name, e.last_name, e.employee_code, e.avatar_url, dept.dept_name AS department_name, bm.branch_name, pm.process_name, lt.leave_name AS leave_type_name, lt.leave_code, COALESCE(NULLIF(TRIM(rev.full_name), ''), TRIM(CONCAT(rev.first_name, ' ', COALESCE(rev.last_name, '')))) AS reviewer_name, approval.action_at AS reviewed_at, approval.remarks AS review_notes ${fromSql} ${where} ORDER BY lr.applied_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
  const [countRows] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS total ${fromSql} ${where}`, params);
  return res.json({ success: true, data: rows, total: Number(countRows[0]?.total ?? 0), page, limit });
}));

leaveSecureRouter.patch("/requests/:id/review", h(async (req: any, res: any) => {
  if (!(await canReviewLeave(req.authUser!.id, req.params.id))) return res.status(403).json({ success: false, message: "Forbidden: leave request is outside your approval scope" });
  const status = String(req.body.status ?? "");
  const allowed = ["approved", "rejected", "branch_head_approved", "branch_head_rejected"];
  if (!allowed.includes(status)) return res.status(400).json({ success: false, message: "Invalid leave review status" });
  const data = await leaveService.reviewRequest(req.params.id, { status: status as any, remarks: req.body.remarks ?? req.body.reviewNotes ?? null }, req.authUser!.id);
  return res.json({ success: true, data, message: `Leave ${status}` });
}));

// PATCH /requests/:id/cancel — employee cancels their own leave (pending or approved)
leaveSecureRouter.patch("/requests/:id/cancel", h(async (req: any, res: any) => {
  const callerEmp = await getEmployeeForUser(req.authUser!.id);
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT employee_id, status FROM leave_request WHERE id = ? LIMIT 1",
    [req.params.id]
  );
  const request = rows[0] as any;
  if (!request) return res.status(404).json({ success: false, message: "Leave request not found" });
  // Allow employee to cancel their own; admin/hr can cancel anyone's
  const isOwn = callerEmp?.id === request.employee_id;
  const isPrivileged = await hasAnyRole(req.authUser!.id, "admin", "hr");
  if (!isOwn && !isPrivileged) return res.status(403).json({ success: false, message: "Forbidden" });
  if (!["pending", "approved", "pending_branch_head"].includes(request.status)) {
    return res.status(400).json({ success: false, message: `Cannot cancel a leave with status '${request.status}'` });
  }
  const data = await leaveService.reviewRequest(req.params.id, { status: "cancelled", remarks: req.body.reason ?? null }, req.authUser!.id);
  return res.json({ success: true, data, message: "Leave cancelled" });
}));
