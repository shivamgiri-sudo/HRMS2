import { Router } from "express";
import { requireRole } from "../../../middleware/requireRole.js";
import { requireAuth } from "../../../middleware/authMiddleware.js";
import { ADMIN_ROLES, VIEWER_ROLES } from "../pd.config.service.js";
import { assertSourceName, listColumns, listTables } from "../pd.source.js";
import { guard, requireAnyWritable, guardBody, q1, wrap } from "../shared/ext.routes.js";
import { getSalesConfig, saveSalesConfig } from "./sales.config.js";
import { previewSales, suggestRoster, suggestSales } from "./sales.admin.js";
import { getSalesAgent, getSalesAgents, getSalesDay, getSalesLive, getSalesOverview, getSalesTab } from "./sales.service.js";

/** /api/process-dashboard/{admin/sales/*, :processId/sales/*} -- mounted by pd.routes.ts after its own requireAuth. */
const router = Router();
const admin = requireRole(...ADMIN_ROLES);
const viewer = requireRole(...VIEWER_ROLES);

router.get("/admin/sales/tables", requireAuth, admin, requireAnyWritable, wrap(async (req, res) => { res.json({ success: true, data: await listTables(q1(req.query.schema)) }); }));
router.get("/admin/sales/columns", requireAuth, admin, requireAnyWritable, wrap(async (req, res) => {
  const { schema, table } = assertSourceName(q1(req.query.schema), q1(req.query.table));
  res.json({ success: true, data: await listColumns(schema, table) });
}));
router.post("/admin/sales/suggest", requireAuth, admin, requireAnyWritable, wrap(async (req, res) => {
  const b = (req.body ?? {}) as { schema?: string; table?: string; roster?: boolean };
  res.json({ success: true, data: b.roster ? await suggestRoster(String(b.schema ?? ""), String(b.table ?? "")) : await suggestSales(String(b.schema ?? ""), String(b.table ?? "")) });
}));
router.post("/admin/sales/preview", requireAuth, admin, wrap(async (req, res) => {
  if (!(await guardBody(req, res))) return;
  res.json({ success: true, data: await previewSales(((req.body ?? {}) as { config?: Record<string, unknown> }).config ?? {}) });
}));
router.get("/admin/sales/:processId", requireAuth, admin, wrap(async (req, res) => {
  const id = await guard(req, res, "write"); if (!id) return;
  res.json({ success: true, data: await getSalesConfig(id) });
}));
router.put("/admin/sales/:processId", requireAuth, admin, wrap(async (req, res) => {
  const id = await guard(req, res, "write"); if (!id) return;
  res.json({ success: true, data: await saveSalesConfig(req.authUser!.id, id, (req.body ?? {}) as Record<string, unknown>) });
}));

const read = (fn: (id: string, req: Parameters<Parameters<typeof wrap>[0]>[0]) => Promise<unknown>) => wrap(async (req, res) => {
  const id = await guard(req, res, "read"); if (!id) return;
  res.json({ success: true, data: await fn(id, req) });
});
router.get("/:processId/sales/tab", requireAuth, viewer, read((id) => getSalesTab(id)));
router.get("/:processId/sales/overview", requireAuth, viewer, read((id, req) => getSalesOverview(id, req.query)));
router.get("/:processId/sales/agents", requireAuth, viewer, read((id, req) => getSalesAgents(id, req.query)));
router.get("/:processId/sales/agent/:code", requireAuth, viewer, read((id, req) => getSalesAgent(id, req.params.code, req.query)));
router.get("/:processId/sales/days/:date", requireAuth, viewer, read((id, req) => getSalesDay(id, req.params.date, req.query)));
router.get("/:processId/sales/live", requireAuth, viewer, read((id) => getSalesLive(id)));

export { router as salesRouter };
