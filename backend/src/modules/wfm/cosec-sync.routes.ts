import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { cosecSyncService } from "./cosec-sync.service.js";

export const cosecSyncRouter = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

cosecSyncRouter.use(requireAuth);

cosecSyncRouter.get(
  "/status",
  requireRole("admin", "hr", "wfm", "ceo"),
  h(async (_req: any, res: any) => {
    return res.json({
      success: true,
      running: cosecSyncService.isRunning(),
      lastSync: cosecSyncService.getLastSyncResult(),
      config: {
        hostConfigured: Boolean(process.env.NCOSEC_DB_HOST),
        database: process.env.NCOSEC_DB_NAME || "NCOSEC",
        table: process.env.NCOSEC_EVENT_TABLE || "dbo.Mx_ATDEventTrn",
        userColumn: process.env.NCOSEC_USER_ID_COLUMN || "UserID",
        datetimeColumn: process.env.NCOSEC_DATETIME_COLUMN || "EventDateTime",
        autoSyncEnabled: process.env.NCOSEC_SYNC_ENABLED === "true",
        intervalMs: Number(process.env.NCOSEC_SYNC_INTERVAL_MS || 300000),
      },
    });
  }),
);

cosecSyncRouter.post(
  "/run",
  requireRole("admin", "hr", "wfm"),
  h(async (req: any, res: any) => {
    const result = await cosecSyncService.sync({
      from: req.body?.from ?? req.query?.from,
      to: req.body?.to ?? req.query?.to,
    });
    return res.json(result);
  }),
);
