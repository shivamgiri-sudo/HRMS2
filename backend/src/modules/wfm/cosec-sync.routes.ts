import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
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
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ic.active_status, s.enabled, s.cron_expression,
              s.last_run_at, s.next_run_at
         FROM integration_config ic
         LEFT JOIN integration_schedule s
           ON s.integration_key = ic.integration_key
        WHERE ic.integration_key = 'cosec_biometric'
        LIMIT 1`,
    );
    const integration = rows[0] as any;
    return res.json({
      success: true,
      running: cosecSyncService.isRunning(),
      lastSync: cosecSyncService.getLastSyncResult(),
      config: {
        hostConfigured: Boolean(process.env.NCOSEC_DB_HOST),
        database: process.env.NCOSEC_DB_NAME || "NCOSEC",
        table: process.env.NCOSEC_EVENT_TABLE || "dbo.Mx_ATDEventTrn",
        userColumn: process.env.NCOSEC_USER_ID_COLUMN || "UserID",
        datetimeColumn: process.env.NCOSEC_DATETIME_COLUMN || "Edatetime",
        sourceAccess: "SELECT_ONLY",
        sourceMode: process.env.NCOSEC_SOURCE_MODE === "mssql" ? "mssql" : "mysql",
        autoSyncEnabled: Boolean(integration?.active_status && integration?.enabled),
        cronExpression: integration?.cron_expression ?? process.env.NCOSEC_SYNC_CRON ?? "0 */5 * * * *",
        lastScheduledRunAt: integration?.last_run_at ?? null,
        nextScheduledRunAt: integration?.next_run_at ?? null,
        intervalMs: Number(process.env.NCOSEC_SYNC_INTERVAL_MS || 300000),
      },
    });
  }),
);

cosecSyncRouter.post(
  "/test-connection",
  requireRole("admin", "wfm"),
  h(async (_req: any, res: any) => {
    const data = await cosecSyncService.testConnection();
    return res.json({ success: true, data });
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
