import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireWriteAccess, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { visitorService } from "./visitor.service.js";
import { decisionSchema, extensionSchema, invitationSchema, visitListQuerySchema } from "./visitor.validation.js";

export const visitorRouter = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

visitorRouter.use(requireAuth);

visitorRouter.get("/hosts", h(async (req: AuthenticatedRequest, res) => {
  const query = z.object({
    q: z.string().trim().min(2).max(100),
    branch_id: z.string().uuid().optional(),
  }).parse(req.query);
  const data = await visitorService.listHosts(req.authUser.id, query.q, query.branch_id);
  return res.json({ success: true, data });
}));

visitorRouter.get("/visits", h(async (req: AuthenticatedRequest, res) => {
  const filters = visitListQuerySchema.parse(req.query);
  const data = await visitorService.listVisits(req.authUser.id, filters);
  return res.json({ success: true, data, meta: { limit: filters.limit, offset: filters.offset } });
}));

visitorRouter.get("/visits/:id", h(async (req: AuthenticatedRequest, res) => {
  const visitId = z.string().uuid().parse(req.params.id);
  const data = await visitorService.getVisit(req.authUser.id, visitId);
  return res.json({ success: true, data });
}));

visitorRouter.post("/invitations", requireWriteAccess, h(async (req: AuthenticatedRequest, res) => {
  const input = invitationSchema.parse(req.body);
  const data = await visitorService.createInvitation(req.authUser.id, input, req);
  return res.status(201).json({ success: true, data });
}));

visitorRouter.post("/visits/:id/approve", requireWriteAccess, h(async (req: AuthenticatedRequest, res) => {
  const visitId = z.string().uuid().parse(req.params.id);
  const { reason } = decisionSchema.parse(req.body);
  const data = await visitorService.decide(req.authUser.id, visitId, "approved", reason, req);
  return res.json({ success: true, data });
}));

visitorRouter.post("/visits/:id/reject", requireWriteAccess, h(async (req: AuthenticatedRequest, res) => {
  const visitId = z.string().uuid().parse(req.params.id);
  const { reason } = decisionSchema.extend({ reason: z.string().trim().min(3).max(500) }).parse(req.body);
  const data = await visitorService.decide(req.authUser.id, visitId, "rejected", reason, req);
  return res.json({ success: true, data });
}));

visitorRouter.post("/visits/:id/extend", requireWriteAccess, h(async (req: AuthenticatedRequest, res) => {
  const visitId = z.string().uuid().parse(req.params.id);
  const input = extensionSchema.parse(req.body);
  const data = await visitorService.extendVisit(req.authUser.id, visitId, input.scheduled_end, input.reason, req);
  return res.json({ success: true, data });
}));
