import { Router, type Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { getUserBranchId } from "./finance-access-scope.js";
import { vendorApprovalService } from "./vendor-approval.service.js";

export const vendorApprovalRouter = Router();

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

const APPROVAL_WRITE_ROLES = ["finance_head", "super_admin"] as const;
const RAISE_ROLES = ["branch_admin", "finance_head", "super_admin", "admin"] as const;

vendorApprovalRouter.use(requireAuth);

// ── Raise a vendor create/update request ──────────────────────────────────────
vendorApprovalRouter.post(
  "/vendor-approval/raise",
  requireRole(...RAISE_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { requestType, vendorId, payload } = req.body as {
      requestType: "create" | "update";
      vendorId?: string;
      payload: Record<string, unknown>;
    };
    if (!requestType || !payload) {
      return res.status(400).json({ error: "requestType and payload are required" });
    }
    const branchId = await getUserBranchId(req.authUser!.id);
    const result = await vendorApprovalService.raise({
      requestType,
      vendorId: vendorId ?? null,
      payload,
      raisedBy: req.authUser!.id,
      branchId: branchId ?? "",
    });
    res.status(202).json({ success: true, data: result });
  })
);

// ── List all requests (finance head / super admin) ────────────────────────────
vendorApprovalRouter.get(
  "/vendor-approval/requests",
  requireRole(...APPROVAL_WRITE_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { status, branchId, limit } = req.query as {
      status?: string; branchId?: string; limit?: string;
    };
    const data = await vendorApprovalService.list({
      status: status || undefined,
      branchId: branchId || undefined,
      limit: limit ? Number(limit) : undefined,
    });
    res.json({ success: true, data });
  })
);

// ── List own requests (any authenticated user) ────────────────────────────────
vendorApprovalRouter.get(
  "/vendor-approval/my-requests",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const data = await vendorApprovalService.list({ raisedBy: req.authUser!.id, limit: 50 });
    res.json({ success: true, data });
  })
);

// ── Approve ───────────────────────────────────────────────────────────────────
vendorApprovalRouter.patch(
  "/vendor-approval/:id/approve",
  requireRole(...APPROVAL_WRITE_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { editedPayload, reviewNotes } = req.body as {
      editedPayload?: Record<string, unknown>;
      reviewNotes?: string;
    };
    const result = await vendorApprovalService.approve(
      req.params.id,
      req.authUser!.id,
      editedPayload ?? null,
      reviewNotes
    );
    res.json({ success: true, data: result });
  })
);

// ── Reject ────────────────────────────────────────────────────────────────────
vendorApprovalRouter.patch(
  "/vendor-approval/:id/reject",
  requireRole(...APPROVAL_WRITE_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { reviewNotes } = req.body as { reviewNotes?: string };
    if (!reviewNotes?.trim()) {
      return res.status(400).json({ error: "reviewNotes is required when rejecting a request" });
    }
    await vendorApprovalService.reject(req.params.id, req.authUser!.id, reviewNotes);
    res.json({ success: true });
  })
);
