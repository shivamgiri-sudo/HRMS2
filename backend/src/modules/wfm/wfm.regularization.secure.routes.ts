import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import { buildScopeWhereClause, hasAnyRole, hasScopedAccess } from "../../shared/scopeAccess.js";
import { regularizationSchema } from "./wfm.validation.js";
import { wfmService } from "./wfm.service.js";

export const wfmRegularizationSecureRouter = Router();
wfmRegularizationSecureRouter.use(requireAuth);

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
const WFM_SCOPE_ROLES = ["wfm", "hr", "manager", "assistant_manager", "tl", "branch_head", "process_manager"];

async function employeeTarget(employeeId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, branch_id, process_id, lob_id, department_id, reporting_manager_id, manager_id
       FROM employees
      WHERE id = ?
      LIMIT 1`,
    [employeeId],
  );
  return rows[0] as any | undefined;
}

async function canAccessEmployee(userId: string, employeeId: string, allowSelf = true) {
  if (await hasAnyRole(userId, "admin", "hr", "wfm", "ceo")) return true;
  const target = await employeeTarget(employeeId);
  if (!target) return false;
  const callerEmp = await getEmployeeForUser(userId);
  if (allowSelf && callerEmp?.id === employeeId) return true;
  return hasScopedAccess(
    userId,
    WFM_SCOPE_ROLES,
    {
      branchId: target.branch_id,
      processId: target.process_id,
      lobId: target.lob_id,
      departmentId: target.department_id,
      managerEmployeeId: target.reporting_manager_id ?? target.manager_id,
      employeeId,
    },
    { allowAdminBypass: true, requireScopeForNonAdmin: true },
  );
}

async function listScope(userId: string) {
  if (await hasAnyRole(userId, "admin", "hr", "wfm", "ceo")) return { sql: "1=1", params: [] as unknown[] };
  const scoped = await buildScopeWhereClause(
    userId,
    WFM_SCOPE_ROLES,
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

async function canReviewRegularization(userId: string, regularizationId: string) {
  if (await hasAnyRole(userId, "admin", "hr", "wfm", "ceo")) return true;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ar.employee_id,
            e.branch_id,
            e.process_id,
            e.lob_id,
            e.department_id,
            e.reporting_manager_id,
            e.manager_id
       FROM attendance_regularization ar
       JOIN employees e ON e.id = ar.employee_id
      WHERE ar.id = ?
      LIMIT 1`,
    [regularizationId],
  );
  const target = rows[0] as any;
  if (!target) return false;
  const callerEmp = await getEmployeeForUser(userId);
  if (callerEmp?.id === target.employee_id) return false;
  return hasScopedAccess(
    userId,
    WFM_SCOPE_ROLES,
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

wfmRegularizationSecureRouter.post("/regularizations", h(async (req: any, res: any) => {
  const input = regularizationSchema.parse(req.body);
  const callerEmp = await getEmployeeForUser(req.authUser.id);
  const requestedEmployeeId = String(req.body.employeeId ?? callerEmp?.id ?? "");
  if (!requestedEmployeeId) return res.status(403).json({ success: false, message: "No employee record" });

  if (!(await canAccessEmployee(req.authUser.id, requestedEmployeeId, true))) {
    return res.status(403).json({ success: false, error: "Forbidden: employee is outside your WFM scope" });
  }

  const isPrivileged = await hasAnyRole(req.authUser.id, "admin", "hr", "wfm", "manager", "assistant_manager", "tl", "branch_head", "process_manager", "ceo");
  const requestedByType = isPrivileged && callerEmp?.id !== requestedEmployeeId ? "manager" : "employee";
  const data = await wfmService.submitRegularization(
    { ...input, employeeId: requestedEmployeeId, requestedByType } as any,
    req.authUser.id,
  );
  return res.status(201).json({ success: true, data, message: "Regularization submitted" });
}));

wfmRegularizationSecureRouter.get("/regularizations/mine", h(async (req: any, res: any) => {
  const emp = await getEmployeeForUser(req.authUser.id);
  if (!emp) return res.status(403).json({ success: false, message: "No employee record" });
  const data = await wfmService.listRegularizations({ employeeId: emp.id });
  return res.json({ success: true, data });
}));

wfmRegularizationSecureRouter.get("/regularizations", h(async (req: any, res: any) => {
  const scope = await listScope(req.authUser.id);
  const conds: string[] = [`(${scope.sql})`];
  const params: unknown[] = [...scope.params];
  if (req.query.employeeId) { conds.push("ar.employee_id = ?"); params.push(String(req.query.employeeId)); }
  if (req.query.status) { conds.push("ar.status = ?"); params.push(String(req.query.status)); }
  if (req.query.fromDate) { conds.push("ar.session_date >= ?"); params.push(String(req.query.fromDate)); }
  if (req.query.toDate) { conds.push("ar.session_date <= ?"); params.push(String(req.query.toDate)); }

  const where = `WHERE ${conds.join(" AND ")}`;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ar.*,
            COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS employee_name,
            e.employee_code,
            b.branch_name,
            p.process_name,
            arm.label AS reason_label
       FROM attendance_regularization ar
       LEFT JOIN employees e ON e.id = ar.employee_id
       LEFT JOIN branch_master b ON b.id = COALESCE(ar.branch_id, e.branch_id)
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN attendance_reason_master arm ON arm.code = ar.reason_code
       ${where}
      ORDER BY ar.created_at DESC`,
    params,
  );
  return res.json({ success: true, data: rows });
}));

wfmRegularizationSecureRouter.patch("/regularizations/:id/review", h(async (req: any, res: any) => {
  if (!(await canReviewRegularization(req.authUser.id, req.params.id))) {
    return res.status(403).json({ success: false, message: "Forbidden: regularization is outside your approval scope" });
  }
  const status = String(req.body.status ?? "");
  if (!["approved", "rejected"].includes(status)) return res.status(400).json({ success: false, message: "Invalid review status" });
  const data = await wfmService.reviewRegularization(req.params.id, {
    status: status as any,
    reviewerNote: req.body.reviewerNote ?? req.body.remarks ?? null,
  }, req.authUser.id);
  return res.json({ success: true, data, message: `Regularization ${status}` });
}));
