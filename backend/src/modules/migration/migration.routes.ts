import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { migrationService } from "./migration.service.js";
import { syncEmployeeStatutoryData } from "./syncStatutoryDataFromDbBill.js";
import { createLegacyJoiningChecklists } from "./createLegacyJoiningChecklists.js";

export const migrationRouter = Router();
migrationRouter.use(requireAuth);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

migrationRouter.get("/status", requireRole("admin", "super_admin"), h(async (_req: any, res: any) => {
  const data = await migrationService.getModuleStatus();
  return res.json({ success: true, data });
}));

migrationRouter.get("/legacy-status", requireRole("admin", "super_admin"), h(async (_req: any, res: any) => {
  const data = await migrationService.getLegacyMigrationStatus();
  return res.json({ success: true, data });
}));

migrationRouter.post("/sync-statutory-from-db-bill", requireRole("admin", "super_admin"), h(async (req: any, res: any) => {
  const { dryRun = false, employeeCode } = req.body;
  const result = await syncEmployeeStatutoryData({
    dryRun,
    employeeCodeFilter: employeeCode,
    actorUserId: req.authUser?.id,
  });
  return res.json({ success: true, data: result });
}));

migrationRouter.post("/create-legacy-checklists", requireRole("admin", "super_admin"), h(async (_req: any, res: any) => {
  const result = await createLegacyJoiningChecklists();
  return res.json({ success: true, data: result });
}));
