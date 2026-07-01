import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { migrationService } from "./migration.service.js";

export const migrationRouter = Router();
migrationRouter.use(requireAuth);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

migrationRouter.get("/status", h(async (_req: any, res: any) => {
  const data = await migrationService.getModuleStatus();
  return res.json({ success: true, data });
}));

migrationRouter.get("/legacy-status", h(async (_req: any, res: any) => {
  const data = await migrationService.getLegacyMigrationStatus();
  return res.json({ success: true, data });
}));
