import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { integrationController } from "./integration.controller.js";
import { integrationService } from "./integration.service.js";
import { syncDatabaseConnector } from "./adapters/dbSyncService.js";
import { executeConnector } from "./connectorRunner.js";
import { listEvents } from "./eventLog.js";

export const integrationRouter = Router();

integrationRouter.use(requireAuth);
integrationRouter.use(requireRole("admin"));

// Static routes must always be declared before /:key routes.
integrationRouter.get("/runs", (req, res, next) => {
  integrationController.listRuns(req as any, res).catch(next);
});

integrationRouter.get("/mapping-catalog", (req, res, next) => {
  integrationController.mappingCatalog(req as any, res).catch(next);
});

integrationRouter.post("/field-maps/confirm", (req, res, next) => {
  integrationController.confirmFieldMap(req as any, res).catch(next);
});

// GET /api/integration-hub/db-connectors — list only active database connectors.
integrationRouter.get("/db-connectors", async (_req: any, res: any, next: any) => {
  try {
    const all = await integrationService.list({ activeStatus: "active" });
    const dbConnectors = all.filter((connector) => connector.integration_type === "database");
    return res.json({ success: true, data: dbConnectors });
  } catch (error) {
    return next(error);
  }
});

// GET /api/integration-hub/stats — summary stat cards
integrationRouter.get("/stats", async (_req: any, res: any, next: any) => {
  try {
    const all = await integrationService.list({});
    const active = all.filter((c: any) => c.active_status === 1 || c.active_status === true);
    const errored = all.filter((c: any) => c.last_run_status === 'failed');
    // Runs today from DB
    const { db } = await import("../../db/mysql.js");
    const [runRows] = await (db as any).execute(
      `SELECT COUNT(*) AS cnt, SUM(status = 'complete') AS success_cnt
       FROM integration_sync_run WHERE DATE(created_at) = CURDATE()`
    );
    const runsToday = (runRows as any[])[0]?.cnt ?? 0;
    const successToday = (runRows as any[])[0]?.success_cnt ?? 0;
    return res.json({
      success: true,
      data: {
        total: all.length,
        active: active.length,
        error: errored.length,
        runs_today: runsToday,
        success_rate_today: runsToday > 0 ? Math.round((successToday / runsToday) * 100) : null,
      },
    });
  } catch (error) {
    return next(error);
  }
});

integrationRouter.get("/", (req, res, next) => {
  integrationController.list(req as any, res).catch(next);
});

integrationRouter.post("/", (req, res, next) => {
  integrationController.create(req as any, res).catch(next);
});

integrationRouter.get("/:key", (req, res, next) => {
  integrationController.getByKey(req as any, res).catch(next);
});

integrationRouter.put("/:key", (req, res, next) => {
  integrationController.update(req as any, res).catch(next);
});

integrationRouter.delete("/:key", async (req: any, res: any, next: any) => {
  try {
    await integrationService.delete(req.params.key);
    return res.json({ success: true, message: `Connector '${req.params.key}' deleted.` });
  } catch (error) {
    return next(error);
  }
});

integrationRouter.post("/:key/run", async (req: any, res: any, next: any) => {
  try {
    const connector = await integrationService.getByKey(req.params.key);
    const result = await executeConnector(connector, req.authUser!.id, req.body ?? {});
    return res.status(result.status === "failed" ? 502 : 200).json({
      success: result.status === "complete",
      data: result,
      message: result.status === "complete"
        ? `Fetched ${result.rows_fetched} row(s); promoted ${result.rows_promoted}`
        : "Connector run failed",
    });
  } catch (error) {
    return next(error);
  }
});

integrationRouter.get("/:key/field-maps", (req, res, next) => {
  integrationController.listFieldMaps(req as any, res).catch(next);
});

integrationRouter.get("/:key/table-maps", (req, res, next) => {
  integrationController.listTableMaps(req as any, res).catch(next);
});

integrationRouter.put("/:key/table-maps", (req, res, next) => {
  integrationController.upsertTableMap(req as any, res).catch(next);
});

integrationRouter.get("/:key/source-schema", (req, res, next) => {
  integrationController.sourceSchema(req as any, res).catch(next);
});

integrationRouter.get("/:key/suggestions", (req, res, next) => {
  integrationController.listSuggestions(req as any, res).catch(next);
});

integrationRouter.get("/:key/data-preview", async (req: any, res: any, next: any) => {
  try {
    const data = await integrationService.previewTargetData(req.params.key);
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

integrationRouter.get("/:key/schedule", (req, res, next) => {
  integrationController.getSchedule(req as any, res).catch(next);
});

integrationRouter.put("/:key/schedule", (req, res, next) => {
  integrationController.upsertSchedule(req as any, res).catch(next);
});

// POST /api/integration-hub/:key/db-sync — pull from an approved external DB connector.
integrationRouter.post("/:key/db-sync", async (req: any, res: any, next: any) => {
  try {
    const connector = await integrationService.getByKey(req.params.key);
    if (connector.integration_type !== "database") {
      return res.status(400).json({ success: false, message: "Not a database connector" });
    }

    const { fromDate, toDate } = req.body ?? {};
    if (connector.integration_key === "cosec_biometric") {
      const run = await executeConnector(
        connector,
        req.authUser?.id ?? null,
        { fromDate, toDate },
      );
      return res.status(run.status === "complete" ? 200 : 502).json({
        success: run.status === "complete",
        data: run,
        message: run.status === "complete"
          ? `Synced ${run.rows_promoted} COSEC attendance day(s)`
          : "COSEC attendance sync failed",
      });
    }
    const result = await syncDatabaseConnector(connector, {
      fromDate,
      toDate,
      userId: req.authUser?.id,
    });

    return res.json({
      success: result.errors.length === 0,
      data: result,
      message: `Synced ${result.rows_inserted} rows from ${connector.integration_name}`,
    });
  } catch (error) {
    return next(error);
  }
});

// GET /api/integration-hub/:key/events — integration event audit log
integrationRouter.get("/:key/events", async (req: any, res: any, next: any) => {
  try {
    const events = await listEvents(req.params.key, req.query.event_type as string | undefined);
    return res.json({ success: true, data: events });
  } catch (error) {
    return next(error);
  }
});

// DELETE /api/integration-hub/:key/field-maps/:mapId — deactivate a field mapping
integrationRouter.delete("/:key/field-maps/:mapId", async (req: any, res: any, next: any) => {
  try {
    const { db } = await import("../../db/mysql.js");
    await (db as any).execute(
      'UPDATE integration_field_map SET active_status = 0 WHERE id = ? AND integration_key = ?',
      [req.params.mapId, req.params.key]
    );
    return res.json({ success: true, message: "Field mapping deactivated" });
  } catch (error) {
    return next(error);
  }
});

// DELETE /api/integration-hub/:key/table-maps/:mapId — deactivate a table mapping
integrationRouter.delete("/:key/table-maps/:mapId", async (req: any, res: any, next: any) => {
  try {
    const { db } = await import("../../db/mysql.js");
    await (db as any).execute(
      'UPDATE integration_table_map SET active_status = 0 WHERE id = ? AND integration_key = ?',
      [req.params.mapId, req.params.key]
    );
    return res.json({ success: true, message: "Table mapping deactivated" });
  } catch (error) {
    return next(error);
  }
});
