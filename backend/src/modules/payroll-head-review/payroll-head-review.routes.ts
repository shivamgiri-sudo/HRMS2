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
// A rejection notifies exactly these people with a link straight to the detail
// page (see reject() in the service) — they must be able to open it read-only
// to see what's wrong, even though only REVIEWER_ROLES can approve/reject and
// only FIXER_ROLES can resubmit. migration 1542 grants the matching
// page_catalog access; this is the route-level half of that fix.
const VIEWER_ROLES = ["payroll_head", "payroll_hr", "branch_head", "hr", "admin", "super_admin"] as const;

// Widened from REVIEWER_ROLES to VIEWER_ROLES — GET /:employeeId (the full journey) was
// already open to payroll_hr/branch_head, they just had no way to discover which employee to
// look up. This is the read-only listing half of that same access; getQueue() branch/process-
// scopes payroll_hr/branch_head via buildScopeWhereClause, payroll_head/admin/super_admin still
// see everything.
router.get("/queue", requireAuth, requireRole(...VIEWER_ROLES), h(async (req: AuthenticatedRequest, res) => {
  const data = await svc.getQueue({
    status: typeof req.query.status === "string" ? req.query.status : undefined,
    q: typeof req.query.q === "string" ? req.query.q : undefined,
    branch: typeof req.query.branch === "string" ? req.query.branch : undefined,
  }, req.authUser!.id);
  res.json({ success: true, data });
}));

router.get("/branches", requireAuth, requireRole(...VIEWER_ROLES), h(async (req: AuthenticatedRequest, res) => {
  const data = await svc.listQueueBranches(req.authUser!.id);
  res.json({ success: true, data });
}));

router.get("/reasons", requireAuth, requireRole(...VIEWER_ROLES), h(async (_req, res) => {
  const data = await svc.listReasons();
  res.json({ success: true, data });
}));

router.get("/:employeeId", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
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

// No effective_from in the body — accept() confirms the date already set at
// assign time, the only date payroll actually reads. Taking a second,
// independently-entered date here is exactly what caused the two-dates-can-
// disagree bug fixed in 1542.
router.post("/:employeeId/package/accept", requireAuth, requireWriteAccess, requireRole(...REVIEWER_ROLES), h(async (req, res) => {
  const data = await svc.acceptPackage(req.params.employeeId, req.authUser!.id);
  res.json({ success: true, data });
}));

// One-click approval: copies the offered salary (from ats_employment_offer set by Branch HR)
// directly to salary_component_assignments without creating a catalog package.
router.post("/:employeeId/package/approve-offered", requireAuth, requireWriteAccess, requireRole(...REVIEWER_ROLES), h(async (req, res) => {
  const { effective_date } = req.body as Record<string, unknown>;
  if (!effective_date) {
    return res.status(400).json({ success: false, message: "effective_date is required." });
  }
  const data = await svc.approveOfferedPackage(req.params.employeeId, String(effective_date), req.authUser!.id);
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

// Correction path after approval — see reopen()'s own doc comment for why
// this never touches an already-run payroll calculation.
router.post("/:employeeId/reopen", requireAuth, requireWriteAccess, requireRole(...REVIEWER_ROLES), h(async (req, res) => {
  const { reason } = req.body as Record<string, unknown>;
  if (!reason) {
    return res.status(400).json({ success: false, message: "reason is required." });
  }
  const data = await svc.reopen(req.params.employeeId, String(reason), req.authUser!.id);
  res.json({ success: true, data });
}));

router.patch("/:employeeId/salary-start-date", requireAuth, requireWriteAccess, requireRole(...REVIEWER_ROLES), h(async (req, res) => {
  const { salary_start_date } = req.body as Record<string, unknown>;
  if (!salary_start_date || typeof salary_start_date !== "string") {
    return res.status(400).json({ success: false, message: "salary_start_date (YYYY-MM-DD) is required." });
  }
  const data = await svc.updateSalaryStartDate(req.params.employeeId, salary_start_date, req.authUser!.id);
  res.json({ success: true, data });
}));

router.patch("/:employeeId/assignment-effective-date", requireAuth, requireWriteAccess, requireRole(...REVIEWER_ROLES), h(async (req, res) => {
  const { effective_date, reason } = req.body as Record<string, unknown>;
  if (!effective_date || !reason) {
    return res.status(400).json({ success: false, message: "effective_date and reason are required." });
  }
  const data = await svc.updateAssignmentEffectiveDate(
    req.params.employeeId,
    String(effective_date),
    String(req.authUser!.id),
    String(reason)
  );
  res.json({ success: true, data });
}));

export const payrollHeadReviewRouter = router;
