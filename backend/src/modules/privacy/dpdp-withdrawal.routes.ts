import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import * as svc from "./dpdp-withdrawal.service.js";
import { getUserRoleContext } from "../../shared/roleResolver.js";

export const dpdpWithdrawalRouter = Router();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

// POST /dpdp-withdrawal/request — employee submits
dpdpWithdrawalRouter.post(
  "/dpdp-withdrawal/request",
  requireAuth,
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { scope_json, reason, channel, requester_type } = req.body as {
      scope_json?: unknown;
      reason: string;
      channel?: string;
      requester_type?: string;
    };

    if (!reason?.trim()) {
      return res.status(400).json({ success: false, message: "reason is required" });
    }

    const data = await svc.submitRequest(
      req.authUser!.id,
      requester_type ?? "employee",
      scope_json ?? null,
      reason,
      channel ?? "self"
    );

    return res.status(201).json({ success: true, data });
  })
);

// GET /dpdp-withdrawal/my-requests — employee sees own
dpdpWithdrawalRouter.get(
  "/dpdp-withdrawal/my-requests",
  requireAuth,
  h(async (req: AuthenticatedRequest, res: Response) => {
    const data = await svc.getMyRequests(req.authUser!.id);
    return res.json({ success: true, data });
  })
);

// GET /dpdp-withdrawal — HR/compliance sees all
dpdpWithdrawalRouter.get(
  "/dpdp-withdrawal",
  requireAuth,
  requireRole("hr", "admin", "compliance", "dpo"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const data = await svc.listAll({
      status: req.query.status as string | undefined,
      branchId: req.query.branch_id as string | undefined,
    });
    return res.json({ success: true, data });
  })
);

// GET /dpdp-withdrawal/:id — get single (own or HR)
dpdpWithdrawalRouter.get(
  "/dpdp-withdrawal/:id",
  requireAuth,
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { primaryRole: role } = await getUserRoleContext((req as any).authUser?.id ?? '');
    const isHr = ["admin", "hr", "compliance", "dpo"].includes(role);
    const record = await svc.getById(req.params.id, req.authUser!.id, isHr);
    if (!record) {
      return res.status(404).json({ success: false, message: "Not found or access denied" });
    }
    return res.json({ success: true, data: record });
  })
);

// POST /dpdp-withdrawal/:id/start-review — HR starts review
dpdpWithdrawalRouter.post(
  "/dpdp-withdrawal/:id/start-review",
  requireAuth,
  requireRole("hr", "admin", "compliance"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    await svc.startReview(req.params.id, req.authUser!.id);
    return res.json({ success: true, message: "Review started and processing hold applied" });
  })
);

// POST /dpdp-withdrawal/:id/approve — HR/DPO approves
dpdpWithdrawalRouter.post(
  "/dpdp-withdrawal/:id/approve",
  requireAuth,
  requireRole("hr", "admin", "compliance", "dpo"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { remarks } = req.body as { remarks?: string };
    await svc.approve(req.params.id, req.authUser!.id, remarks);
    return res.json({ success: true, message: "Withdrawal approved" });
  })
);

// POST /dpdp-withdrawal/:id/reject — HR/DPO rejects
dpdpWithdrawalRouter.post(
  "/dpdp-withdrawal/:id/reject",
  requireAuth,
  requireRole("hr", "admin", "compliance", "dpo"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { reason } = req.body as { reason?: string };
    if (!reason?.trim()) {
      return res.status(400).json({ success: false, message: "reason is required for rejection" });
    }
    await svc.reject(req.params.id, req.authUser!.id, reason);
    return res.json({ success: true, message: "Withdrawal rejected" });
  })
);

// POST /dpdp-withdrawal/:id/release-hold — HR releases hold manually
dpdpWithdrawalRouter.post(
  "/dpdp-withdrawal/:id/release-hold",
  requireAuth,
  requireRole("hr", "admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    await svc.releaseHold(req.params.id, req.authUser!.id);
    return res.json({ success: true, message: "Processing hold released" });
  })
);

// GET /dpdp-withdrawal/:id/audit — full audit trail
dpdpWithdrawalRouter.get(
  "/dpdp-withdrawal/:id/audit",
  requireAuth,
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { primaryRole: role } = await getUserRoleContext((req as any).authUser?.id ?? '');
    const isHr = ["admin", "hr", "compliance", "dpo"].includes(role);
    // Anyone can see audit for their own request; HR can see all
    const record = await svc.getById(req.params.id, req.authUser!.id, isHr);
    if (!record) {
      return res.status(404).json({ success: false, message: "Not found or access denied" });
    }
    const data = await svc.getAudit(req.params.id);
    return res.json({ success: true, data });
  })
);
