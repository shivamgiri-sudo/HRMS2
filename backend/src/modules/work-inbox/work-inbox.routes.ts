import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import * as svc from "./work-inbox.service.js";

const router = Router();
const h = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

router.get("/my", h(async (req: AuthenticatedRequest, res: any) => {
  const items = await svc.getMyWorkItems(req.authUser!.id, (req.authUser as any).role ?? "");
  return res.json({ success: true, data: items });
}));

router.get("/team", h(async (req: AuthenticatedRequest, res: any) => {
  const items = await svc.getTeamWorkItems(req.authUser!.id);
  return res.json({ success: true, data: items });
}));

router.get("/dashboard", h(async (req: AuthenticatedRequest, res: any) => {
  const items = await svc.getDashboardWorkItems(
    req.query.branchId as string | undefined,
    req.query.processId as string | undefined
  );
  return res.json({ success: true, data: items });
}));

router.post("/:id/complete", h(async (req: AuthenticatedRequest, res: any) => {
  await svc.completeWorkItem(req.params.id, req.authUser!.id, req.body.remarks);
  return res.json({ success: true });
}));

router.post("/:id/escalate", h(async (req: AuthenticatedRequest, res: any) => {
  await svc.escalateWorkItem(req.params.id, req.authUser!.id, req.body.remarks);
  return res.json({ success: true });
}));

router.post("/:id/reassign", h(async (req: AuthenticatedRequest, res: any) => {
  await svc.reassignWorkItem(req.params.id, req.body.toUserId, req.authUser!.id, req.body.remarks);
  return res.json({ success: true });
}));

export { router as workInboxRouter };
