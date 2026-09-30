import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { AnalyticsError } from "./analytics.types.js";
import type { Viewer } from "./dashboards.access.js";
import * as svc from "./dashboards.service.js";
import { ANALYTICS_VIEWER_ROLES } from "./scope.js";

/**
 * /api/analytics-catalogue/dashboards — Dashboard Studio. The role gate only decides who may call; which dashboards a
 * caller sees or edits is decided per dashboard (owner, admin, shares) inside the service.
 */
const router = Router();
type Handler = (req: AuthenticatedRequest, res: Response, viewer: Viewer) => Promise<unknown>;
const h = (fn: Handler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  (async () => {
    const u = req.authUser!;
    const roles = Array.from(new Set([...(u.roles ?? []), u.role].filter(Boolean))) as string[];
    await fn(req, res, await svc.viewerFor(u.id, roles));
  })().catch((e) => {
    if (e instanceof svc.DashboardConflict) return res.status(409).json({ success: false, code: "CONFLICT", message: e.message });
    if (e instanceof AnalyticsError) {
      const status = e.code === "NOT_FOUND" ? 404 : e.code === "FORBIDDEN" ? 403 : 400;
      return res.status(status).json({ success: false, code: e.code, message: e.message });
    }
    next(e);
  });
};
const s = (v: unknown) => (typeof v === "string" ? v : "");
const gate = [requireAuth, requireRole(...ANALYTICS_VIEWER_ROLES)];

router.get("/", ...gate, h(async (_req, res, viewer) => {
  res.json({ success: true, data: await svc.listDashboards(viewer) });
}));
router.post("/", ...gate, h(async (req, res, viewer) => {
  res.status(201).json({ success: true, data: await svc.createDashboard(viewer, req.body ?? {}) });
}));
router.get("/share-targets", ...gate, h(async (_req, res, viewer) => {
  res.json({ success: true, data: await svc.shareTargets(viewer) });
}));
router.get("/share-targets/users", ...gate, h(async (req, res) => {
  res.json({ success: true, data: await svc.searchUsers(s(req.query.q)) });
}));
router.get("/:id", ...gate, h(async (req, res, viewer) => {
  res.json({ success: true, data: await svc.getDashboard(viewer, String(req.params.id)) });
}));
router.put("/:id", ...gate, h(async (req, res, viewer) => {
  res.json({ success: true, data: await svc.updateDashboard(viewer, String(req.params.id), req.body ?? {}) });
}));
router.delete("/:id", ...gate, h(async (req, res, viewer) => {
  await svc.deleteDashboard(viewer, String(req.params.id));
  res.json({ success: true, data: { id: String(req.params.id) } });
}));
router.put("/:id/widgets", ...gate, h(async (req, res, viewer) => {
  res.json({ success: true, data: await svc.saveWidgets(viewer, String(req.params.id), req.body?.widgets, req.body?.version) });
}));
router.put("/:id/shares", ...gate, h(async (req, res, viewer) => {
  res.json({ success: true, data: await svc.saveShares(viewer, String(req.params.id), req.body?.shares) });
}));
router.post("/:id/duplicate", ...gate, h(async (req, res, viewer) => {
  res.status(201).json({ success: true, data: await svc.duplicateDashboard(viewer, String(req.params.id), req.body?.name) });
}));

export { router as dashboardsRouter };
