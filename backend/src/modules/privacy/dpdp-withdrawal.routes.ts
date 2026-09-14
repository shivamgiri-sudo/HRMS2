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
      channel ?? "self",
      { requester_ip: req.ip, requester_ua: req.headers['user-agent'] }
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
  requireRole("hr", "admin", "dpo", "compliance", "super_admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const data = await svc.listAll({
      status: req.query.status as string | undefined,
      branchId: req.query.branch_id as string | undefined,
      dateFrom: req.query.date_from as string | undefined,
      dateTo: req.query.date_to as string | undefined,
    });
    return res.json({ success: true, data });
  })
);

// GET /dpdp-withdrawal/stats — aggregate stats for dashboard
//
// Must stay registered before /dpdp-withdrawal/:id (below): Express matches routes in
// registration order, and :id matches any literal segment — this route used to sit ~80
// lines further down, after /dpdp-withdrawal/:id, so every request here was swallowed by
// the :id handler as svc.getById('stats', ...), which never matches a real row (id is a
// UUID) and 404s "Not found or access denied". Confirmed live-broken 2026-08-13:
// NativeDPDPWithdrawalAdmin.tsx's stats cards call this exact endpoint on every load, and
// its fetchStats() swallows the error ("stats are non-critical"), so the cards just
// silently render empty forever instead of surfacing the 404. Moved here, immediately
// after the other static /dpdp-withdrawal routes and before the first /:id route.
dpdpWithdrawalRouter.get(
  "/dpdp-withdrawal/stats",
  requireAuth,
  requireRole("hr", "admin", "dpo", "compliance", "super_admin"),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    const data = await svc.getStats();
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
    const record = await svc.getById(req.params.id, req.authUser!.id, isHr, true);
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
  requireRole("hr", "admin", "dpo", "compliance"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    await svc.startReview(req.params.id, req.authUser!.id);
    return res.json({ success: true, message: "Review started and processing hold applied" });
  })
);

// POST /dpdp-withdrawal/:id/approve — HR/DPO approves
dpdpWithdrawalRouter.post(
  "/dpdp-withdrawal/:id/approve",
  requireAuth,
  requireRole("hr", "admin", "dpo", "compliance"),
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
  requireRole("hr", "admin", "dpo", "compliance"),
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
  requireRole("hr", "admin", "compliance"),
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
    const isHr = ["admin", "hr", "compliance", "dpo", "super_admin"].includes(role);
    // Anyone can see audit for their own request; HR can see all
    const record = await svc.getById(req.params.id, req.authUser!.id, isHr);
    if (!record) {
      return res.status(404).json({ success: false, message: "Not found or access denied" });
    }
    const data = await svc.getAudit(req.params.id, req.authUser!.id);
    return res.json({ success: true, data });
  })
);

// GET /dpdp-withdrawal/stats moved above, before /dpdp-withdrawal/:id — see the comment there.

// GET /dpdp-withdrawal/:id/tasks — implementation tasks
dpdpWithdrawalRouter.get(
  "/dpdp-withdrawal/:id/tasks",
  requireAuth,
  requireRole("hr", "admin", "dpo", "compliance", "super_admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const data = await svc.getTasksForWithdrawal(req.params.id);
    return res.json({ success: true, data });
  })
);

// PATCH /dpdp-withdrawal/:id/tasks/:taskId — complete a task
dpdpWithdrawalRouter.patch(
  "/dpdp-withdrawal/:id/tasks/:taskId",
  requireAuth,
  requireRole("hr", "admin", "dpo", "compliance", "super_admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { notes } = req.body as { notes?: string };
    await svc.completeTask(req.params.taskId, req.authUser!.id, notes);
    return res.json({ success: true, message: "Task marked complete" });
  })
);

// GET /dpdp-withdrawal/:id/evidence — list evidence
dpdpWithdrawalRouter.get(
  "/dpdp-withdrawal/:id/evidence",
  requireAuth,
  requireRole("hr", "admin", "dpo", "compliance", "super_admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const data = await svc.getEvidenceForWithdrawal(req.params.id);
    return res.json({ success: true, data });
  })
);

// POST /dpdp-withdrawal/:id/evidence — add evidence record
dpdpWithdrawalRouter.post(
  "/dpdp-withdrawal/:id/evidence",
  requireAuth,
  requireRole("hr", "admin", "dpo", "compliance", "super_admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { evidence_type, description, file_ref } = req.body as {
      evidence_type: string;
      description: string;
      file_ref?: string;
    };
    if (!evidence_type?.trim() || !description?.trim()) {
      return res.status(400).json({ success: false, message: "evidence_type and description required" });
    }
    await svc.addEvidence(req.params.id, evidence_type, description, req.authUser!.id, file_ref);
    return res.status(201).json({ success: true, message: "Evidence recorded" });
  })
);
