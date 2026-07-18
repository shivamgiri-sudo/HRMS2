import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { profileApprovalService } from "./profile-approval.service.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";

const router = Router();
router.use(requireAuth);

const h = (fn: (req: any, res: Response) => Promise<any>) => (req: any, res: Response, next: any) => fn(req, res).catch(next);

// GET /api/profile-approval/pending — list pending approvals for current user (HR/Payroll only)
router.get("/pending", requireRole("admin", "hr", "payroll_hr", "finance"), h(async (req: any, res: Response) => {
  const emp = await getEmployeeForUser(req.authUser?.id);
  if (!emp) return res.status(404).json({ success: false, error: "No employee record" });

  const approvals = await profileApprovalService.getPendingBankDetailsApprovals(emp.id);
  return res.json({ success: true, data: approvals });
}));

// PATCH /api/profile-approval/:id/review — approve or reject an update request
router.patch("/:id/review", requireRole("admin", "hr", "payroll_hr", "finance"), h(async (req: any, res: Response) => {
  const emp = await getEmployeeForUser(req.authUser?.id);
  if (!emp) return res.status(404).json({ success: false, error: "No employee record" });

  const { approved, note } = req.body;
  if (typeof approved !== "boolean") {
    return res.status(400).json({ success: false, error: "approved (boolean) required" });
  }

  await profileApprovalService.approveBankDetailsUpdate(emp.id, req.params.id, approved, note);
  return res.json({ success: true, message: approved ? "Approved" : "Rejected" });
}));

export const profileApprovalRouter = router;
