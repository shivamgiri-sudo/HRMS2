import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { getScope, isOrgWide, canAccessEmployee, employeeOwnerGuard, OUT_OF_SCOPE_MSG } from "../wfm/branch-scope.js";
import { mobilityService } from "./mobility.service.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h =
  (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) =>
    fn(req, res).catch(next);

router.use(requireAuth);

// ── Transfers ─────────────────────────────────────────────────────────────────

// GET /transfers — admin/hr see all; employee sees own
router.get(
  "/transfers",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.authUser!.id;
    const { status } = req.query as Record<string, string>;

  if (await hasRole(userId, "admin", "hr")) {
    const callerScope = await getScope(req);
    if (!callerScope) return res.status(401).json({ success: false, error: "Unauthorized" });
    const data = await mobilityService.listTransfers({ status, scope: isOrgWide(callerScope) ? undefined : callerScope });
    return res.json({ success: true, data, total: data.length });
  }),
);

// POST /transfers — admin/hr only
router.post("/transfers", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employee_id, transfer_type, from_value, to_value, effective_date, reason, new_reporting_manager_id } = req.body;
  if (!employee_id || !transfer_type || !to_value || !effective_date) {
    return res.status(400).json({ success: false, error: "Missing required fields" });
  }
  // hr is limited to its own branch / scope (owner ruling 2026-10-01): the employee being moved must be inside it.
  const callerScope = await getScope(req);
  if (!callerScope || !(await canAccessEmployee(callerScope, String(employee_id)))) {
    return res.status(403).json({ success: false, error: OUT_OF_SCOPE_MSG });
  }
  // Reporting manager is mandatory for cost_centre transfers
  if (transfer_type === "cost_centre" && !new_reporting_manager_id) {
    return res.status(400).json({ success: false, error: "new_reporting_manager_id is required for cost_centre transfers" });
  }
  // Not allowed for other transfer types
  if (new_reporting_manager_id && transfer_type !== "cost_centre") {
    return res.status(400).json({ success: false, error: "new_reporting_manager_id is only valid for cost_centre transfers" });
  }
  const data = await mobilityService.createTransfer({
    employee_id,
    transfer_type,
    from_value: from_value ?? "",
    to_value,
    effective_date,
    reason,
    initiated_by: req.authUser!.id,
    new_reporting_manager_id,
  });
  return res.status(201).json({ success: true, data });
}));

// PATCH /transfers/:id — approve/reject (admin/hr)
router.patch("/transfers/:id", requireRole("admin", "hr"), employeeOwnerGuard("transfer_record"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { action, remarks } = req.body as { action: "approved" | "rejected"; remarks?: string };
  if (!action || !["approved", "rejected"].includes(action)) {
    return res.status(400).json({ success: false, error: "action must be 'approved' or 'rejected'" });
  }
  const data = await mobilityService.updateTransfer(req.params.id, {
    action,
    remarks,
    approved_by: req.authUser!.id,
  });
  if (!data) return res.status(404).json({ success: false, error: "Transfer record not found" });
  return res.json({ success: true, data });
}));

// ── Promotions ────────────────────────────────────────────────────────────────

// GET /promotions — admin/hr see all; employee sees own
router.get(
  "/promotions",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.authUser!.id;
    const { status } = req.query as Record<string, string>;

  if (await hasRole(userId, "admin", "hr")) {
    const callerScope = await getScope(req);
    if (!callerScope) return res.status(401).json({ success: false, error: "Unauthorized" });
    const data = await mobilityService.listPromotions({ status, scope: isOrgWide(callerScope) ? undefined : callerScope });
    return res.json({ success: true, data, total: data.length });
  }),
);

// POST /promotions — admin/hr only
router.post("/promotions", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employee_id, from_designation, to_designation, from_grade, to_grade, effective_date, salary_revision, reason } = req.body as {
    employee_id: string;
    from_designation?: string;
    to_designation: string;
    from_grade?: string;
    to_grade?: string;
    effective_date: string;
    salary_revision?: number;
    reason?: string;
  };
  if (!employee_id || !to_designation || !effective_date) {
    return res.status(400).json({ success: false, error: "employee_id, to_designation, and effective_date are required" });
  }
  const callerScope = await getScope(req);
  if (!callerScope || !(await canAccessEmployee(callerScope, String(employee_id)))) {
    return res.status(403).json({ success: false, error: OUT_OF_SCOPE_MSG });
  }
  const data = await mobilityService.createPromotion({
    employee_id,
    from_designation,
    to_designation,
    from_grade,
    to_grade,
    effective_date,
    salary_revision,
    reason,
    initiated_by: req.authUser!.id,
  });
  return res.status(201).json({ success: true, data });
}));

// PATCH /promotions/:id — approve/reject (admin/hr)
router.patch("/promotions/:id", requireRole("admin", "hr"), employeeOwnerGuard("promotion_record"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { action, remarks } = req.body as { action: "approved" | "rejected"; remarks?: string };
  if (!action || !["approved", "rejected"].includes(action)) {
    return res.status(400).json({ success: false, error: "action must be 'approved' or 'rejected'" });
  }
  const data = await mobilityService.updatePromotion(req.params.id, {
    action,
    remarks,
    approved_by: req.authUser!.id,
  });
  if (!data) return res.status(404).json({ success: false, error: "Promotion record not found" });
  return res.json({ success: true, data });
}));

export { router as mobilityRouter };
