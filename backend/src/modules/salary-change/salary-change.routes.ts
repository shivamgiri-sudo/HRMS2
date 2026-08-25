import { Router, type NextFunction, type Response } from "express";
import { requireAuth, requireWriteAccess, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import * as svc from "./salary-change.service.js";

const router = Router();
type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

// Same authority as the Salary Review Queue's REVIEWER_ROLES — Payroll Head is already the
// final approver in this app, so a submit here takes effect immediately (per explicit
// confirmation), fully audited via employee_salary_change_log + logSensitiveAction.
const REVIEWER_ROLES = ["payroll_head", "admin", "super_admin"] as const;

router.get("/employee/:employeeId", requireAuth, requireRole(...REVIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getEmployeeSalaryProfile(req.params.employeeId);
  res.json({ success: true, data });
}));

router.post("/:employeeId", requireAuth, requireWriteAccess, requireRole(...REVIEWER_ROLES), h(async (req, res) => {
  const { package_id, effective_date, reason, requested_by_user_id, requested_by_name } =
    req.body as Record<string, unknown>;
  if (!package_id || !effective_date || !reason) {
    return res.status(400).json({ success: false, message: "package_id, effective_date, and reason are required." });
  }
  const data = await svc.changeSalary({
    employeeId: req.params.employeeId,
    packageId: String(package_id),
    effectiveDate: String(effective_date),
    reason: String(reason),
    requestedByUserId: typeof requested_by_user_id === "string" ? requested_by_user_id : null,
    requestedByName: typeof requested_by_name === "string" ? requested_by_name : null,
    actorUserId: req.authUser!.id,
  });
  res.json({ success: true, data });
}));

export const salaryChangeRouter = router;
