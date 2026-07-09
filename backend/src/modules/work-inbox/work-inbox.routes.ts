import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import * as svc from "./work-inbox.service.js";
import { resolveDashboardScope } from "../../shared/dashboardScope.js";
import { getUserRoleContext } from "../../shared/roleResolver.js";

interface ResolvedRequest extends AuthenticatedRequest {
  resolvedRole: string;
  roleCtx?: { roleKeys: string[]; primaryRole: string; isSuperAdmin: boolean; isHO: boolean };
}

const router = Router();
const h = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// Attach DB-resolved role to every request in this router
router.use(async (req: any, res: any, next: any) => {
  try {
    if (req.authUser?.id) {
      const ctx = await getUserRoleContext(req.authUser.id);
      req.resolvedRole = ctx.primaryRole;
      req.roleCtx = ctx;
    } else {
      req.resolvedRole = "employee";
    }
    next();
  } catch {
    req.resolvedRole = "employee";
    next();
  }
});

router.get("/stats", h(async (req: ResolvedRequest, res: any) => {
  const stats = await svc.getWorkItemStats(
    req.authUser!.id,
    req.resolvedRole
  );
  return res.json({ success: true, data: stats });
}));

router.get("/overdue", h(async (req: ResolvedRequest, res: any) => {
  const items = await svc.getOverdueItems(
    req.authUser!.id,
    req.resolvedRole
  );
  return res.json({ success: true, data: items });
}));

router.patch("/:id/priority", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: any) => {
  const { priority } = req.body as { priority: "low" | "medium" | "high" | "critical" };
  const allowed = ["low", "medium", "high", "critical"];
  if (!allowed.includes(priority)) {
    return res.status(400).json({ success: false, error: "Invalid priority value" });
  }
  await (await import("../../db/mysql.js")).db.execute(
    `UPDATE work_item SET priority=?, updated_at=NOW() WHERE id=?`,
    [priority, req.params.id]
  );
  return res.json({ success: true });
}));

router.get("/my", h(async (req: ResolvedRequest, res: any) => {
  const items = await svc.getMyWorkItems(req.authUser!.id, req.resolvedRole);
  return res.json({ success: true, data: items });
}));

// GET /api/work-inbox/my-actions — same as /my but with different endpoint for dashboard compatibility
router.get("/my-actions", h(async (req: ResolvedRequest, res: any) => {
  const items = await svc.getMyWorkItems(req.authUser!.id, req.resolvedRole);
  return res.json({ success: true, data: items });
}));

router.get("/team", h(async (req: AuthenticatedRequest, res: any) => {
  const items = await svc.getTeamWorkItems(req.authUser!.id);
  return res.json({ success: true, data: items });
}));

router.get("/dashboard", h(async (req: ResolvedRequest, res: any) => {
  const scope = await resolveDashboardScope(req.authUser!.id, req.resolvedRole);
  const requestedBranchId = req.query.branchId as string | undefined;
  const requestedProcessId = req.query.processId as string | undefined;

  let effectiveBranchId: string | undefined;
  let effectiveProcessId: string | undefined;

  if (scope.level === "ORG_ALL") {
    effectiveBranchId = requestedBranchId;
    effectiveProcessId = requestedProcessId;
  } else if (scope.level === "BRANCH_ALL") {
    effectiveBranchId =
      requestedBranchId && scope.branchIds.includes(requestedBranchId)
        ? requestedBranchId
        : undefined;
    if (!effectiveBranchId && scope.branchIds.length > 0) {
      effectiveBranchId = scope.branchIds[0];
    }
  } else if (scope.level === "PROCESS_ALL") {
    effectiveProcessId =
      requestedProcessId && scope.processIds.includes(requestedProcessId)
        ? requestedProcessId
        : undefined;
  }
  // SELF_ONLY / TEAM_ONLY: no branch/process filter — returns empty aggregate

  const items = await svc.getDashboardWorkItems(effectiveBranchId, effectiveProcessId);
  return res.json({ success: true, data: items });
}));

router.post("/:id/complete", h(async (req: AuthenticatedRequest, res: any) => {
  await svc.assertWorkItemAccess(req.authUser!.id, req.params.id, 'complete');
  await svc.completeWorkItem(req.params.id, req.authUser!.id, req.body.remarks);
  return res.json({ success: true });
}));

router.post("/:id/escalate", h(async (req: AuthenticatedRequest, res: any) => {
  await svc.assertWorkItemAccess(req.authUser!.id, req.params.id, 'escalate');
  await svc.escalateWorkItem(req.params.id, req.authUser!.id, req.body.remarks);
  return res.json({ success: true });
}));

router.post("/:id/reassign", h(async (req: AuthenticatedRequest, res: any) => {
  const { toUserId, remarks } = req.body as { toUserId?: string; remarks?: string };
  if (!toUserId) {
    return res.status(400).json({ success: false, error: "toUserId is required" });
  }
  await svc.assertWorkItemAccess(req.authUser!.id, req.params.id, 'reassign');
  await svc.reassignWorkItem(req.params.id, toUserId, req.authUser!.id, remarks);
  return res.json({ success: true });
}));

export { router as workInboxRouter };
