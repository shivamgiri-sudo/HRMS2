import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { controlTowerService as svc } from "./control-tower.service.js";

export const controlTowerRouter = Router();
controlTowerRouter.use(requireAuth);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

controlTowerRouter.get(
  "/events",
  h(async (req, res) => {
    const data = await svc.listEvents(req.query, req.authUser!.id);
    res.json({ success: true, data });
  })
);

controlTowerRouter.post(
  "/events",
  requireRole("admin", "hr", "wfm", "process_manager", "branch_head", "qa", "trainer", "recruiter"),
  h(async (req, res) => {
    const data = await svc.createEvent(req.body, req.authUser!.id);
    res.status(201).json({ success: true, data });
  })
);

controlTowerRouter.get(
  "/inbox",
  h(async (req, res) => {
    const data = await svc.listWorkInbox(req.query, req.authUser!.id);
    res.json({ success: true, data });
  })
);

controlTowerRouter.post(
  "/inbox",
  requireRole("admin", "hr", "wfm", "process_manager", "branch_head", "qa", "trainer", "recruiter"),
  h(async (req, res) => {
    const data = await svc.createInboxItem(req.body, req.authUser!.id);
    res.status(201).json({ success: true, data });
  })
);

controlTowerRouter.patch(
  "/inbox/:id/complete",
  h(async (req, res) => {
    const data = await svc.completeInboxItem(req.params.id, req.authUser!.id);
    res.json({ success: true, data });
  })
);

controlTowerRouter.get(
  "/master-data-health",
  requireRole("admin", "hr", "ceo", "wfm", "process_manager", "branch_head"),
  h(async (req, res) => {
    const data = await svc.getMasterDataHealth(req.authUser!.id);
    res.json({ success: true, data });
  })
);

controlTowerRouter.get(
  "/employee-360/:employeeId",
  h(async (req, res) => {
    const data = await svc.getEmployee360(req.params.employeeId, req.authUser!.id);
    res.json({ success: true, data });
  })
);

controlTowerRouter.get(
  "/risks",
  requireRole("admin", "hr", "ceo", "wfm", "process_manager", "branch_head", "qa"),
  h(async (req, res) => {
    const data = await svc.getRiskSummary(req.query, req.authUser!.id);
    res.json({ success: true, data });
  })
);

controlTowerRouter.get(
  "/my-team",
  h(async (req, res) => {
    const data = await svc.getManagerTeamHierarchy(req.authUser!.id);
    res.json({ success: true, data });
  })
);

controlTowerRouter.get(
  "/team/:managerId",
  requireRole("admin", "hr", "ceo", "wfm", "process_manager", "branch_head"),
  h(async (req, res) => {
    const data = await svc.getManagerTeamHierarchy(req.authUser!.id, req.params.managerId);
    res.json({ success: true, data });
  })
);
