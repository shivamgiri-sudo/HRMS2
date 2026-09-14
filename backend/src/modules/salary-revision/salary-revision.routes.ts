import { Router, type NextFunction, type Response } from "express";
import { requireAuth, requireWriteAccess, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import * as svc from "./salary-revision.service.js";

const router = Router();
type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

const REVIEWER_ROLES = ["payroll_head", "admin", "super_admin"] as const;
const FIXER_ROLES    = ["payroll_hr", "branch_head", "hr", "admin", "super_admin"] as const;

router.post("/", requireAuth, requireWriteAccess, requireRole(...FIXER_ROLES), h(async (req, res) => {
  const { employee_id, requested_effective_from, reason } = req.body as Record<string, unknown>;
  if (!employee_id || !requested_effective_from || !reason) {
    return res.status(400).json({ success: false, message: "employee_id, requested_effective_from, and reason are required." });
  }
  const data = await svc.createRevisionRequest({
    employee_id: String(employee_id),
    requested_effective_from: String(requested_effective_from),
    reason: String(reason),
    requested_by: String(req.authUser!.id),
  });
  res.json({ success: true, data });
}));

router.get("/", requireAuth, requireRole(...REVIEWER_ROLES), h(async (req, res) => {
  const data = await svc.listRevisionRequests({
    status: typeof req.query.status === "string" ? req.query.status : undefined,
    employee_id: typeof req.query.employee_id === "string" ? req.query.employee_id : undefined,
  });
  res.json({ success: true, data });
}));

router.post("/bulk-validate", requireAuth, requireRole(...FIXER_ROLES), h(async (req, res) => {
  const { employee_codes, requested_effective_from } = req.body as Record<string, unknown>;
  if (!Array.isArray(employee_codes) || employee_codes.length === 0) {
    return res.status(400).json({ success: false, message: "employee_codes must be a non-empty array." });
  }
  if (employee_codes.length > 200) {
    return res.status(400).json({ success: false, message: "Maximum 200 employee codes per request." });
  }
  if (!requested_effective_from) {
    return res.status(400).json({ success: false, message: "requested_effective_from is required." });
  }
  const results = await svc.bulkValidate({
    employee_codes: (employee_codes as unknown[]).map(String),
    requested_effective_from: String(requested_effective_from),
  });
  res.json({ success: true, results });
}));

router.post("/bulk", requireAuth, requireWriteAccess, requireRole(...FIXER_ROLES), h(async (req, res) => {
  const { employee_ids, requested_effective_from, reason } = req.body as Record<string, unknown>;
  if (!Array.isArray(employee_ids) || employee_ids.length === 0) {
    return res.status(400).json({ success: false, message: "employee_ids must be a non-empty array." });
  }
  if (employee_ids.length > 200) {
    return res.status(400).json({ success: false, message: "Maximum 200 employee IDs per request." });
  }
  if (!requested_effective_from || !reason) {
    return res.status(400).json({ success: false, message: "requested_effective_from and reason are required." });
  }
  const result = await svc.bulkCreate({
    employee_ids: (employee_ids as unknown[]).map(String),
    requested_effective_from: String(requested_effective_from),
    reason: String(reason),
    requested_by: String(req.authUser!.id),
  });
  res.json({ success: true, ...result });
}));

router.post("/:id/review", requireAuth, requireWriteAccess, requireRole(...REVIEWER_ROLES), h(async (req, res) => {
  const { action, remarks } = req.body as Record<string, unknown>;
  if (action !== "approve" && action !== "reject") {
    return res.status(400).json({ success: false, message: "action must be 'approve' or 'reject'." });
  }
  await svc.reviewRevisionRequest(
    Number(req.params.id),
    action as "approve" | "reject",
    String(req.authUser!.id),
    typeof remarks === "string" ? remarks : undefined
  );
  res.json({ success: true });
}));

export const salaryRevisionRouter = router;