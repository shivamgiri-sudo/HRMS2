import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getNcosecPool } from "../../db/ncosecDb.js";
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

// GET /api/cosec-sync/stats
// Aggregate stats: biometric log counts, attendance record count, unmapped users, watermarks
cosecSyncRouter.get(
  "/stats",
  requireRole("admin", "hr", "wfm", "ceo"),
  h(async (_req: any, res: any) => {
    const [bioRows, attRows, unmappedRows, watermarkRows] = await Promise.all([
      db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total_bio_logs,
                MAX(punch_date) AS latest_bio_date
           FROM biometric_attendance_log`
      ),
      db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total_attendance_records
           FROM attendance_daily_record`
      ),
      db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS unmapped_count
           FROM cosec_unmapped_users`
      ),
      db.execute<RowDataPacket[]>(
        `SELECT *
           FROM source_sync_watermark
          ORDER BY source_key ASC`
      ),
    ]);

    return res.json({
      success: true,
      data: {
        biometric_log: bioRows[0][0] ?? {},
        attendance_records: attRows[0][0] ?? {},
        unmapped_users: unmappedRows[0][0] ?? {},
        watermarks: watermarkRows[0],
      },
    });
  })
);

// GET /api/cosec-sync/schema
// List all NCOSEC tables and their columns (admin/debug only)
cosecSyncRouter.get(
  "/schema",
  requireRole("admin"),
  h(async (_req: any, res: any) => {
    const pool = await getNcosecPool();

    // Get all tables
    const tablesResult = await pool.request().query(`
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_TYPE='BASE TABLE'
      ORDER BY TABLE_NAME
    `);

    const allTables = tablesResult.recordset.map((r: any) => r.TABLE_NAME);

    // Filter to attendance-related
    const attendanceKeywords = ['atd', 'attend', 'punch', 'summary', 'bio'];
    const relevantTables = allTables.filter((t: string) =>
      attendanceKeywords.some(kw => t.toLowerCase().includes(kw))
    );

    // Get column details for relevant tables
    const tableSchemas: Record<string, any> = {};

    for (const tableName of relevantTables) {
      const colResult = await pool.request().query(`
        SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = '${tableName}'
        ORDER BY ORDINAL_POSITION
      `);

      const countResult = await pool.request().query(`
        SELECT COUNT(*) as cnt FROM [${tableName}]
      `);

      tableSchemas[tableName] = {
        rowCount: countResult.recordset[0].cnt,
        columns: colResult.recordset.map((c: any) => ({
          name: c.COLUMN_NAME,
          type: c.DATA_TYPE,
          nullable: c.IS_NULLABLE === 'YES'
        }))
      };
    }

    return res.json({
      success: true,
      allTableCount: allTables.length,
      allTables,
      relevantTableCount: relevantTables.length,
      relevantTables,
      tableSchemas
    });
  })
);
