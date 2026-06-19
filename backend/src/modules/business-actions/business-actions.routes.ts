import { Router } from "express";
import type { Response, NextFunction } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { businessActionsService } from "./business-actions.service.js";
import { businessActionSignalSync } from "./business-actions.signal-sync.js";

export const businessActionsRouter = Router();
businessActionsRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

businessActionsRouter.get("/summary", h(async (req, res) => {
  res.json({ success: true, data: await businessActionsService.summary(req.query as Record<string, unknown>) });
}));

businessActionsRouter.post("/sync-signals", h(async (req, res) => {
  const data = await businessActionSignalSync.syncAll(req.authUser!.id);
  res.json({ success: true, data });
}));

businessActionsRouter.post("/sync-signals/people-experience", h(async (req, res) => {
  const data = await businessActionSignalSync.syncPeopleExperience(req.authUser!.id);
  res.json({ success: true, data });
}));

businessActionsRouter.post("/sync-signals/support", h(async (req, res) => {
  const data = await businessActionSignalSync.syncSupportSla(req.authUser!.id);
  res.json({ success: true, data });
}));

businessActionsRouter.post("/sync-signals/grievance", h(async (req, res) => {
  const data = await businessActionSignalSync.syncGrievances(req.authUser!.id);
  res.json({ success: true, data });
}));

businessActionsRouter.get("/", h(async (req, res) => {
  res.json({ success: true, data: await businessActionsService.list(req.query as Record<string, unknown>) });
}));

businessActionsRouter.get("/:id", h(async (req, res) => {
  const data = await businessActionsService.get(req.params.id);
  if (!data) return res.status(404).json({ success: false, message: "Business action not found" });
  res.json({ success: true, data });
}));

businessActionsRouter.post("/", h(async (req, res) => {
  res.status(201).json({ success: true, data: await businessActionsService.create(req.body, req.authUser!.id) });
}));

businessActionsRouter.patch("/:id", h(async (req, res) => {
  res.json({ success: true, data: await businessActionsService.update(req.params.id, req.body, req.authUser!.id) });
}));

businessActionsRouter.post("/:id/assign", h(async (req, res) => {
  res.json({
    success: true,
    data: await businessActionsService.assign(
      req.params.id,
      req.body?.owner_user_id ?? null,
      req.body?.owner_role ?? null,
      req.authUser!.id
    ),
  });
}));

businessActionsRouter.post("/:id/escalate", h(async (req, res) => {
  res.json({ success: true, data: await businessActionsService.escalate(req.params.id, req.body?.reason ?? null, req.authUser!.id) });
}));

businessActionsRouter.post("/:id/complete", h(async (req, res) => {
  res.json({ success: true, data: await businessActionsService.complete(req.params.id, req.body?.closure_note ?? null, req.authUser!.id) });
}));

businessActionsRouter.post("/:id/comments", h(async (req, res) => {
  res.status(201).json({ success: true, data: await businessActionsService.comment(req.params.id, req.authUser!.id, req.body) });
}));
