import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireWriteAccess, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { visitorService } from "./visitor.service.js";
import { checkEventSchema, deskRegistrationSchema } from "./visitor.validation.js";

export const visitorSecurityRouter = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
const securityRoles = requireRole(
  "super_admin", "admin", "security_head", "visitor_security", "visitor_reception",
  "branch_head", "branch_hr", "hr_branch",
);

visitorSecurityRouter.use(requireAuth);

visitorSecurityRouter.post("/desk/visits", requireWriteAccess, securityRoles, h(async (req: AuthenticatedRequest, res) => {
  const input = deskRegistrationSchema.parse(req.body);
  const data = await visitorService.createDeskVisit(req.authUser.id, input, req);
  return res.status(201).json({ success: true, data });
}));

visitorSecurityRouter.post("/visits/:id/check-in", requireWriteAccess, securityRoles, h(async (req: AuthenticatedRequest, res) => {
  const visitId = z.string().uuid().parse(req.params.id);
  const input = checkEventSchema.parse(req.body);
  const data = await visitorService.checkEvent(req.authUser.id, visitId, "checked_in", input, req);
  return res.json({ success: true, data });
}));

visitorSecurityRouter.post("/visits/:id/check-out", requireWriteAccess, securityRoles, h(async (req: AuthenticatedRequest, res) => {
  const visitId = z.string().uuid().parse(req.params.id);
  const input = checkEventSchema.parse(req.body);
  const data = await visitorService.checkEvent(req.authUser.id, visitId, "checked_out", input, req);
  return res.json({ success: true, data });
}));

visitorSecurityRouter.get("/emergency-register", securityRoles, h(async (req: AuthenticatedRequest, res) => {
  const query = z.object({ branch_id: z.string().uuid().optional() }).parse(req.query);
  const data = await visitorService.emergencyRegister(req.authUser.id, query.branch_id);
  res.setHeader("Cache-Control", "no-store");
  return res.json({ success: true, data });
}));

visitorSecurityRouter.get("/occupancy", securityRoles, h(async (req: AuthenticatedRequest, res) => {
  const query = z.object({ branch_id: z.string().uuid().optional() }).parse(req.query);
  const data = await visitorService.liveOccupancy(req.authUser.id, query.branch_id);
  return res.json({ success: true, data });
}));
