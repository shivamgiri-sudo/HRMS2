import { Router } from "express";
import { requireRole } from "../../../middleware/requireRole.js";
import { requireAuth } from "../../../middleware/authMiddleware.js";
import { ADMIN_ROLES, VIEWER_ROLES } from "../pd.config.service.js";
import { assertSourceName, listColumns, listTables } from "../pd.source.js";
import { guard, requireAnyWritable, guardBody, q1, wrap } from "../shared/ext.routes.js";
import { getOutboundConfig, saveOutboundConfig } from "./outbound.config.js";
import { previewOutbound, suggestOutbound } from "./outbound.admin.js";
import { getOutboundAgent, getOutboundAgents, getOutboundDispositions, getOutboundLive, getOutboundOverview, getOutboundTab } from "./outbound.service.js";

/** /api/process-dashboard/{admin/outbound/*, :processId/outbound/*} -- mounted by pd.routes.ts after its own requireAuth. */
const router = Router();
const admin = requireRole(...ADMIN_ROLES);
const viewer = requireRole(...VIEWER_ROLES);

router.get("/admin/outbound/tables", requireAuth, admin, requireAnyWritable, wrap(async (req, res) => { res.json({ success: true, data: await listTables(q1(req.query.schema)) }); }));
router.get("/admin/outbound/columns", requireAuth, admin, requireAnyWritable, wrap(async (req, res) => {
  const { schema, table } = assertSourceName(q1(req.query.schema), q1(req.query.table));
  res.json({ success: true, data: await listColumns(schema, table) });
}));
router.post("/admin/outbound/suggest", requireAuth, admin, requireAnyWritable, wrap(async (req, res) => {
  const b = (req.body ?? {}) as { schema?: string; table?: string };
  res.json({ success: true, data: await suggestOutbound(String(b.schema ?? ""), String(b.table ?? "")) });
}));
router.post("/admin/outbound/preview", requireAuth, admin, wrap(async (req, res) => {
  if (!(await guardBody(req, res))) return;
  res.json({ success: true, data: await previewOutbound(((req.body ?? {}) as { config?: Record<string, unknown> }).config ?? {}) });
}));
router.get("/admin/outbound/:processId", requireAuth, admin, wrap(async (req, res) => {
  const id = await guard(req, res, "write"); if (!id) return;
  res.json({ success: true, data: await getOutboundConfig(id) });
}));
router.put("/admin/outbound/:processId", requireAuth, admin, wrap(async (req, res) => {
  const id = await guard(req, res, "write"); if (!id) return;
  res.json({ success: true, data: await saveOutboundConfig(req.authUser!.id, id, (req.body ?? {}) as Record<string, unknown>) });
}));

const read = (fn: (id: string, req: Parameters<Parameters<typeof wrap>[0]>[0]) => Promise<unknown>) => wrap(async (req, res) => {
  const id = await guard(req, res, "read"); if (!id) return;
  res.json({ success: true, data: await fn(id, req) });
});
router.get("/:processId/outbound/tab", requireAuth, viewer, read((id) => getOutboundTab(id)));
router.get("/:processId/outbound/overview", requireAuth, viewer, read((id, req) => getOutboundOverview(id, req.query)));
router.get("/:processId/outbound/agents", requireAuth, viewer, read((id, req) => getOutboundAgents(id, req.query)));
router.get("/:processId/outbound/agent/:code", requireAuth, viewer, read((id, req) => getOutboundAgent(id, req.params.code, req.query)));
router.get("/:processId/outbound/dispositions", requireAuth, viewer, read((id, req) => getOutboundDispositions(id, req.query)));
router.get("/:processId/outbound/live", requireAuth, viewer, read((id) => getOutboundLive(id)));

export { router as outboundRouter };
