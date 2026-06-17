import { Router } from "express";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireScopedRole } from "../../middleware/scopeMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { db } from "../../db/mysql.js";
import { lmsService } from "./lms.service.js";

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

async function currentHrmsRoles(userId: string): Promise<string[]> {
  const [rows] = await db.execute<RowDataPacket[]>("SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1", [userId]);
  return rows.map((row: any) => String(row.role_key));
}

async function currentEmployee(userId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.*, b.branch_name, p.process_name, d.dept_name AS department_name
       FROM employees e
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN department_master d ON d.id = e.department_id
      WHERE e.user_id = ? AND e.active_status = 1
      ORDER BY e.updated_at DESC
      LIMIT 1`,
    [userId],
  );
  return rows[0] as any | undefined;
}

async function currentLmsContext(req: AuthenticatedRequest, res: Response) {
  const employee = await currentEmployee(req.authUser!.id);
  if (!employee) {
    res.status(403).json({ success: false, message: "No active HRMS employee profile found for LMS mapping" });
    return null;
  }
  const roles = await currentHrmsRoles(req.authUser!.id);
  const access = await lmsService.getAccessForEmployee(employee, roles);
  return { employee, roles, access };
}

async function resolveOwnEmployeeId(req: AuthenticatedRequest, res: Response) {
  const emp = await getEmployeeForUser(req.authUser!.id);
  if (!emp?.id) {
    res.status(403).json({ success: false, message: "No employee record" });
    return null;
  }
  return emp.id;
}

// Native HRMS-integrated LMS access. No external link or LMS re-login required.
router.get("/native/access", h(async (req: AuthenticatedRequest, res: Response) => {
  const ctx = await currentLmsContext(req, res);
  if (!ctx) return;
  res.json({ success: true, data: ctx.access });
}));

router.get("/native/employee", h(async (req: AuthenticatedRequest, res: Response) => {
  const ctx = await currentLmsContext(req, res);
  if (!ctx) return;
  if (!ctx.access.access.employee) return res.status(403).json({ success: false, message: "LMS employee access is not mapped" });
  const data = await lmsService.getNativeEmployeeDashboard(ctx.access.employeeCode, ctx.access.user.email);
  res.json({ success: true, data: { ...data, access: ctx.access } });
}));

router.get("/native/coordinator", h(async (req: AuthenticatedRequest, res: Response) => {
  const ctx = await currentLmsContext(req, res);
  if (!ctx) return;
  if (!ctx.access.access.coordinator) return res.status(403).json({ success: false, message: "Coordinator LMS access is not assigned to this HRMS user" });
  res.json({ success: true, data: { ...(await lmsService.getNativeCoordinatorDashboard(ctx.access)), access: ctx.access } });
}));

router.get("/native/admin", h(async (req: AuthenticatedRequest, res: Response) => {
  const ctx = await currentLmsContext(req, res);
  if (!ctx) return;
  if (!ctx.access.access.admin) return res.status(403).json({ success: false, message: "Admin LMS access is not assigned to this HRMS user" });
  res.json({ success: true, data: { ...(await lmsService.getNativeAdminDashboard()), access: ctx.access } });
}));

// Legacy aliases retained for existing pages.
router.get("/launch-urls/me", h(async (req: AuthenticatedRequest, res: Response) => {
  const employeeId = await resolveOwnEmployeeId(req, res);
  if (!employeeId) return;
  res.json({ success: true, data: { learner_url: "/lms/my-learning", coordinator_url: "/lms/coordinator", admin_url: "/lms/integration" } });
}));

router.get("/launch-urls/:employeeId", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const isAdminHr = await hasRole(userId, "admin", "hr");
  if (!isAdminHr) {
    const emp = await getEmployeeForUser(userId);
    if (!emp || emp.id !== req.params.employeeId) return res.status(403).json({ success: false, message: "Forbidden" });
  }
  res.json({ success: true, data: { learner_url: "/lms/my-learning", coordinator_url: "/lms/coordinator", admin_url: "/lms/integration" } });
}));

router.get("/progress/me", h(async (req: AuthenticatedRequest, res: Response) => {
  const employeeId = await resolveOwnEmployeeId(req, res);
  if (!employeeId) return;
  res.json({ success: true, data: await lmsService.getProgress(employeeId) });
}));

router.get("/progress/:employeeId", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const isAdminHr = await hasRole(userId, "admin", "hr");
  if (!isAdminHr) {
    const emp = await getEmployeeForUser(userId);
    if (!emp || emp.id !== req.params.employeeId) return res.status(403).json({ success: false, message: "Forbidden" });
  }
  res.json({ success: true, data: await lmsService.getProgress(req.params.employeeId) });
}));

router.get("/certifications/me", h(async (req: AuthenticatedRequest, res: Response) => {
  const employeeId = await resolveOwnEmployeeId(req, res);
  if (!employeeId) return;
  res.json({ success: true, data: await lmsService.getCertifications(employeeId) });
}));

router.get("/certifications/:employeeId", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const isAdminHr = await hasRole(userId, "admin", "hr");
  if (!isAdminHr) {
    const emp = await getEmployeeForUser(userId);
    if (!emp || emp.id !== req.params.employeeId) return res.status(403).json({ success: false, message: "Forbidden" });
  }
  res.json({ success: true, data: await lmsService.getCertifications(req.params.employeeId) });
}));

router.get("/mapping", requireRole("admin", "hr", "trainer"), h(async (_req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, data: await lmsService.listMappings() });
}));

router.post("/mapping",
  requireRole("admin", "hr", "trainer"),
  requireScopedRole(["hr", "trainer"], async (req) => {
    const [rows] = await db.execute(
      'SELECT branch_id, process_id FROM employees WHERE id = ? LIMIT 1',
      [req.body.employee_id]
    ) as any[];
    const emp = rows[0];
    return { branchId: emp?.branch_id, processId: emp?.process_id };
  }),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { employee_id, lms_learner_id, email } = req.body;
    if (!employee_id || !lms_learner_id) return res.status(400).json({ error: "employee_id and lms_learner_id required" });
    res.status(201).json({ success: true, data: await lmsService.upsertMapping(employee_id, lms_learner_id, email) });
  })
);

router.get("/sync-log", requireRole("admin", "hr", "trainer"), h(async (_req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, data: await lmsService.getSyncLog() });
}));

export { router as lmsRouter };
