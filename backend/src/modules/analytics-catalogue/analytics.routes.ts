import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { AnalyticsError } from "./analytics.types.js";
import * as cat from "./catalogue.service.js";
import { fieldValues, runQuery, scopeOptions } from "./query.service.js";
import { ANALYTICS_VIEWER_ROLES } from "./scope.js";

/**
 * /api/analytics-catalogue — the catalogue and its query endpoint. Role gates only decide who may call; which ROWS come back is
 * always the viewer's own branch/process scope, applied inside the query service.
 */
const router = Router();
const ADMIN = ["super_admin", "admin"];
type Handler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: Handler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  fn(req, res).catch((e) => {
    if (e instanceof AnalyticsError) {
      const status = e.code === "NOT_FOUND" ? 404 : e.code === "FORBIDDEN" ? 403 : 400;
      return res.status(status).json({ success: false, code: e.code, message: e.message });
    }
    const msg = String((e as Error)?.message ?? "");
    if (/max_execution_time|maximum statement execution time/i.test(msg)) {
      return res.status(400).json({ success: false, code: "QUERY_TOO_SLOW", message: "This query took longer than 20 seconds. Narrow the date range or add a filter." });
    }
    next(e);
  });
};
const s = (v: unknown) => (typeof v === "string" ? v : "");

router.use(requireAuth);

router.get("/datasets", requireRole(...ANALYTICS_VIEWER_ROLES), h(async (req, res) => {
  res.json({ success: true, data: await cat.listDatasets(req.authUser!.id) });
}));
router.post("/query", requireRole(...ANALYTICS_VIEWER_ROLES), h(async (req, res) => {
  res.json({ success: true, data: await runQuery(req.authUser!.id, req.body) });
}));
router.get("/scope-options", requireRole(...ANALYTICS_VIEWER_ROLES), h(async (req, res) => {
  res.json({ success: true, data: await scopeOptions(req.authUser!.id) });
}));
router.get("/datasets/:code/values/:field", requireRole(...ANALYTICS_VIEWER_ROLES), h(async (req, res) => {
  res.json({ success: true, data: await fieldValues(req.authUser!.id, String(req.params.code), String(req.params.field), s(req.query.q)) });
}));

// ── Admin: register and maintain datasets ──
router.get("/admin/connections", requireRole(...ADMIN), h(async (_req, res) => {
  const { NAMED_POOLS } = await import("../kpi/kpi-studio.pools.js");
  res.json({ success: true, data: [{ key: "hrms", label: "HRMS (mas_hrms)" }, ...Object.entries(NAMED_POOLS).map(([key, p]) => ({ key, label: p.label }))] });
}));
router.get("/admin/tables", requireRole(...ADMIN), h(async (req, res) => {
  res.json({ success: true, data: await cat.listTables(s(req.query.connection) || "hrms") });
}));
router.post("/admin/introspect", requireRole(...ADMIN), h(async (req, res) => {
  res.json({ success: true, data: await cat.introspect(s(req.body?.connection) || "hrms", s(req.body?.table)) });
}));
router.get("/admin/datasets/:code", requireRole(...ADMIN), h(async (req, res) => {
  res.json({ success: true, data: await cat.getDatasetForEdit(String(req.params.code)) });
}));
router.post("/admin/datasets", requireRole(...ADMIN), h(async (req, res) => {
  res.status(201).json({ success: true, data: await cat.saveDataset(req.body ?? {}, req.authUser!.id) });
}));
router.put("/admin/datasets/:code", requireRole(...ADMIN), h(async (req, res) => {
  res.json({ success: true, data: await cat.saveDataset(req.body ?? {}, req.authUser!.id, String(req.params.code)) });
}));
router.delete("/admin/datasets/:code", requireRole(...ADMIN), h(async (req, res) => {
  await cat.archiveDataset(String(req.params.code));
  res.json({ success: true });
}));

export { router as analyticsCatalogueRouter };
