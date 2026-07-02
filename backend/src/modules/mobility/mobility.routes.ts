import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { mobilityService } from "./mobility.service.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// ── Transfers ─────────────────────────────────────────────────────────────────

// GET /transfers — admin/hr see all; employee sees own
router.get("/transfers", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const { status } = req.query as Record<string, string>;

  if (await hasRole(userId, "admin", "hr")) {
    const data = await mobilityService.listTransfers({ status });
    return res.json({ success: true, data, total: data.length });
  }

  const emp = await getEmployeeForUser(userId);
  if (!emp) return res.status(403).json({ success: false, error: "No employee record linked to your account" });
  const data = await mobilityService.listTransfers({ employee_id: emp.id, status });
  return res.json({ success: true, data, total: data.length });
}));

// POST /transfers — admin/hr only
router.post("/transfers", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employee_id, transfer_type, from_value, to_value, effective_date, reason } = req.body as Record<string, string>;
  if (!employee_id || !transfer_type || !from_value || !to_value || !effective_date) {
    return res.status(400).json({ success: false, error: "employee_id, transfer_type, from_value, to_value, and effective_date are required" });
  }
  const data = await mobilityService.createTransfer({
    employee_id,
    transfer_type,
    from_value,
    to_value,
    effective_date,
    reason,
    initiated_by: req.authUser!.id,
  });
  return res.status(201).json({ success: true, data });
}));

// PATCH /transfers/:id — approve/reject (admin/hr)
router.patch("/transfers/:id", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
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
router.get("/promotions", h(async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.authUser!.id;
  const { status } = req.query as Record<string, string>;

  if (await hasRole(userId, "admin", "hr")) {
    const data = await mobilityService.listPromotions({ status });
    return res.json({ success: true, data, total: data.length });
  }

  const emp = await getEmployeeForUser(userId);
  if (!emp) return res.status(403).json({ success: false, error: "No employee record linked to your account" });
  const data = await mobilityService.listPromotions({ employee_id: emp.id, status });
  return res.json({ success: true, data, total: data.length });
}));

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
router.patch("/promotions/:id", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
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
