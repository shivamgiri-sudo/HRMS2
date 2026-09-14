import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import * as svc from "./dashboard-builder.service.js";

/**
 * Dashboard Builder HTTP surface.
 *
 * Role gates decide who may reach these routes; they are NOT the data boundary.
 * Every rendered number is filtered through the VIEWER's own scope inside
 * renderDashboard, so sharing a dashboard can never share the data behind it
 * with somebody not entitled to that process.
 */

const router = Router();
type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

const VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head", "hr", "team_leader",
] as const;
const AUTHOR_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "tq_head",
] as const;

const bad = (res: Response, message: string) =>
  res.status(400).json({ success: false, code: "INVALID_INPUT", message });

router.get("/", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.listDashboards(req.authUser!.id, req.authUser!.role ?? "");
  res.json({ success: true, data });
}));

router.get("/:id", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getDashboard(req.authUser!.id, req.authUser!.role ?? "", req.params.id);
  if (!data) return res.status(404).json({ success: false, code: "NOT_FOUND", message: "Dashboard not found, or not shared with you." });
  res.json({ success: true, data });
}));

/** The one the view page calls: config plus resolved numbers, scoped to the reader. */
router.get("/:id/render", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.renderDashboard(req.authUser!.id, req.authUser!.role ?? "", req.params.id);
  if (!data) return res.status(404).json({ success: false, code: "NOT_FOUND", message: "Dashboard not found, or not shared with you." });
  res.json({ success: true, data });
}));

router.post("/", requireAuth, requireRole(...AUTHOR_ROLES), h(async (req, res) => {
  const b = req.body as Record<string, unknown>;
  try {
    const out = await svc.saveDashboard({
      id: typeof b.id === "string" ? b.id : undefined,
      userId: req.authUser!.id,
      name: String(b.name ?? ""),
      description: b.description == null ? null : String(b.description),
      processId: b.process_id == null ? null : String(b.process_id),
      visibleRoles: Array.isArray(b.visible_roles) ? b.visible_roles.map(String) : [],
    });
    res.json({ success: true, data: out });
  } catch (err) {
    return bad(res, (err as Error).message);
  }
}));

router.delete("/:id", requireAuth, requireRole(...AUTHOR_ROLES), h(async (req, res) => {
  const out = await svc.deleteDashboard(req.authUser!.id, req.params.id);
  if (!out.ok) return res.status(404).json({ success: false, code: "NOT_FOUND", message: "Dashboard not found, or it is not yours to delete." });
  res.json({ success: true, data: out });
}));

router.post("/:id/widgets", requireAuth, requireRole(...AUTHOR_ROLES), h(async (req, res) => {
  const b = req.body as Record<string, unknown>;
  try {
    const out = await svc.saveWidget({
      id: typeof b.id === "string" ? b.id : undefined,
      userId: req.authUser!.id,
      dashboardId: req.params.id,
      title: b.title == null ? null : String(b.title),
      widgetType: String(b.widget_type ?? ""),
      metricSource: String(b.metric_source ?? ""),
      metricKey: String(b.metric_key ?? ""),
      processId: b.process_id == null ? null : String(b.process_id),
      dateRange: b.date_range == null ? null : String(b.date_range),
      gridWidth: b.grid_width == null ? null : Number(b.grid_width),
      gridHeight: b.grid_height == null ? null : Number(b.grid_height),
      position: b.position == null ? null : Number(b.position),
      config: (b.config as Record<string, unknown>) ?? null,
    });
    res.json({ success: true, data: out });
  } catch (err) {
    return bad(res, (err as Error).message);
  }
}));

router.delete("/:id/widgets/:widgetId", requireAuth, requireRole(...AUTHOR_ROLES), h(async (req, res) => {
  try {
    const out = await svc.deleteWidget(req.authUser!.id, req.params.id, req.params.widgetId);
    if (!out.ok) return res.status(404).json({ success: false, code: "NOT_FOUND", message: "Widget not found." });
    res.json({ success: true, data: out });
  } catch (err) {
    return bad(res, (err as Error).message);
  }
}));

export const dashboardBuilderRouter = router;
export default router;
