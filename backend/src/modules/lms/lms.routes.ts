import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireScopedRole } from "../../middleware/scopeMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { db } from "../../db/mysql.js";
import { lmsService } from "./lms.service.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// Get LMS deep-link URLs for authenticated employee (own) or admin/hr for any employee
router.get("/launch-urls/:employeeId", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const isAdminHr = await hasRole(userId, "admin", "hr");
  if (!isAdminHr) {
    const emp = await getEmployeeForUser(userId);
    if (!emp || emp.id !== req.params.employeeId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
  }
  res.json({ success: true, data: {
    learner_url: "https://mcnlms.teammas.in/lms",
    coordinator_url: "https://mcnlms.teammas.in/coordinator",
    admin_url: "https://mcnlms.teammas.in/admin",
  }});
}));

// Get progress summary for all employees (admin/hr/trainer)
router.get("/progress-summary", requireRole("admin", "hr", "trainer"), h(async (_req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, data: await lmsService.getProgressSummary() });
}));

// Get current user's LMS progress (convenience endpoint)
router.get("/progress/me", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const emp = await getEmployeeForUser(userId);
  if (!emp) {
    return res.status(404).json({ success: false, message: "Employee record not found for this user" });
  }
  res.json({ success: true, data: await lmsService.getProgress(emp.id) });
}));

// Get employee's LMS progress snapshot
router.get("/progress/:employeeId", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const isAdminHr = await hasRole(userId, "admin", "hr");
  if (!isAdminHr) {
    const emp = await getEmployeeForUser(userId);
    if (!emp || emp.id !== req.params.employeeId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
  }
  res.json({ success: true, data: await lmsService.getProgress(req.params.employeeId) });
}));

// Get certifications for employee
router.get("/certifications/:employeeId", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const isAdminHr = await hasRole(userId, "admin", "hr");
  if (!isAdminHr) {
    const emp = await getEmployeeForUser(userId);
    if (!emp || emp.id !== req.params.employeeId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
  }
  res.json({ success: true, data: await lmsService.getCertifications(req.params.employeeId) });
}));

// Get/update employee-to-LMS learner mapping (admin/hr/trainer)
router.get("/mapping", requireRole("admin", "hr", "trainer"), h(async (_req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, data: await lmsService.listMappings() });
}));

router.post("/mapping",
  requireRole("admin", "hr", "trainer"),
  requireScopedRole(["hr", "trainer"], async (req) => {
    // Trainer scoped by branch/process
    const [rows] = await db.execute(
      'SELECT branch_id, process_id FROM employees WHERE id = ? LIMIT 1',
      [req.body.employee_id]
    ) as any[];
    const emp = rows[0];
    return {
      branchId: emp?.branch_id,
      processId: emp?.process_id
    };
  }),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { employee_id, lms_learner_id, email } = req.body;
    if (!employee_id || !lms_learner_id) {
      return res.status(400).json({ error: "employee_id and lms_learner_id required" });
    }
    res.status(201).json({ success: true, data: await lmsService.upsertMapping(employee_id, lms_learner_id, email) });
  })
);

// Sync audit log
router.get("/sync-log", requireRole("admin", "hr", "trainer"), h(async (_req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, data: await lmsService.getSyncLog() });
}));

export { router as lmsRouter };
