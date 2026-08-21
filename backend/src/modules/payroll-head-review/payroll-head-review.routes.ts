import { Router, type NextFunction, type Response } from "express";
import { requireAuth, requireWriteAccess, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import * as svc from "./payroll-head-review.service.js";

const router = Router();
type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

const REVIEWER_ROLES = ["payroll_head", "admin", "super_admin"] as const;
// The reviewer is not the fixer: resubmit is for whoever can actually correct the
// underlying document/BGV/bank/salary issue, not for payroll_head to loop back to
// themselves.
const FIXER_ROLES = ["payroll_hr", "branch_head", "hr", "admin", "super_admin"] as const;

router.get("/queue", requireAuth, requireRole(...REVIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getQueue({
    status: typeof req.query.status === "string" ? req.query.status : undefined,
    q: typeof req.query.q === "string" ? req.query.q : undefined,
  });
  res.json({ success: true, data });
}));

router.get("/reasons", requireAuth, requireRole(...REVIEWER_ROLES), h(async (_req, res) => {
  const data = await svc.listReasons();
  res.json({ success: true, data });
}));

router.get("/:employeeId", requireAuth, requireRole(...REVIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getEmployeeJourney(req.params.employeeId);
  res.json({ success: true, data });
}));

router.post("/:employeeId/package/assign", requireAuth, requireWriteAccess, requireRole(...REVIEWER_ROLES), h(async (req, res) => {
  const { package_id, effective_date } = req.body as Record<string, unknown>;
  if (!package_id || !effective_date) {
    return res.status(400).json({ success: false, message: "package_id and effective_date are required." });
  }
  const data = await svc.assignPackage(req.params.employeeId, String(package_id), String(effective_date), req.authUser!.id);
  res.json({ success: true, data });
}));

router.post("/:employeeId/package/create-and-assign", requireAuth, requireWriteAccess, requireRole(...REVIEWER_ROLES), h(async (req, res) => {
  const { effective_date, ...packageData } = req.body as Record<string, unknown>;
  if (!effective_date) {
    return res.status(400).json({ success: false, message: "effective_date is required." });
  }
  const data = await svc.createAndAssignPackage(req.params.employeeId, packageData, String(effective_date), req.authUser!.id);
  res.json({ success: true, data });
}));

router.post("/:employeeId/package/accept", requireAuth, requireWriteAccess, requireRole(...REVIEWER_ROLES), h(async (req, res) => {
  const { effective_from } = req.body as Record<string, unknown>;
  if (!effective_from) {
    return res.status(400).json({ success: false, message: "effective_from is required." });
  }
  const data = await svc.acceptPackage(req.params.employeeId, String(effective_from), req.authUser!.id);
  res.json({ success: true, data });
}));

router.post("/:employeeId/approve", requireAuth, requireWriteAccess, requireRole(...REVIEWER_ROLES), h(async (req, res) => {
  const data = await svc.approve(req.params.employeeId, req.authUser!.id);
  res.json({ success: true, data });
}));

router.post("/:employeeId/reject", requireAuth, requireWriteAccess, requireRole(...REVIEWER_ROLES), h(async (req, res) => {
  const { category, reason_code, remarks } = req.body as Record<string, unknown>;
  if (!category || !reason_code || !remarks) {
    return res.status(400).json({ success: false, message: "category, reason_code and remarks are required." });
  }
  const data = await svc.reject(
    req.params.employeeId,
    category as svc.ReasonCategory,
    String(reason_code),
    String(remarks),
    req.authUser!.id
  );
  res.json({ success: true, data });
}));

router.post("/:employeeId/resubmit", requireAuth, requireWriteAccess, requireRole(...FIXER_ROLES), h(async (req, res) => {
  const data = await svc.resubmit(req.params.employeeId, req.authUser!.id);
  res.json({ success: true, data });
}));

export const payrollHeadReviewRouter = router;
