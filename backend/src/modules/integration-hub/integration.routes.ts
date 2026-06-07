import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { integrationController } from "./integration.controller.js";
import { integrationService } from "./integration.service.js";
import { syncDatabaseConnector } from "./adapters/dbSyncService.js";

export const integrationRouter = Router();

integrationRouter.use(requireAuth);
integrationRouter.use(requireRole("admin"));

// Static routes must always be declared before /:key routes.
integrationRouter.get("/runs", (req, res, next) => {
  integrationController.listRuns(req as any, res).catch(next);
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

integrationRouter.post("/:key/run", (req, res, next) => {
  integrationController.createRun(req as any, res).catch(next);
});

integrationRouter.get("/:key/field-maps", (req, res, next) => {
  integrationController.listFieldMaps(req as any, res).catch(next);
});

integrationRouter.get("/:key/suggestions", (req, res, next) => {
  integrationController.listSuggestions(req as any, res).catch(next);
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
