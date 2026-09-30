import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { logger } from "../../logger.js";
import { ADMIN_ROLES, VIEWER_ROLES, getConfig, isConfigured, isProcessReadable, isProcessWritable, listAllConfigsAdmin, listReadableConfigs, loadTargets, saveConfig } from "./pd.config.service.js";
import { listColumns, listTables, PdError, assertSourceName } from "./pd.source.js";
import { preview, suggest } from "./pd.admin.service.js";
import { getInboundConfig, getInboundTab, listCandidateTables, previewInbound, saveInboundConfig } from "./pd.inbound.service.js";
import { INBOUND_INSIGHT_ROLES } from "../call-master/inbound-projects.js";
import { requireAnyWritable } from "./shared/ext.routes.js";
import { loadConfigOrThrow } from "./pd.dataset.js";
import { getAgentDrill, getAgents, getDay, getOverview, categoryProfileOut } from "./pd.service.js";
import { getLive, liveEtag, streamCsv } from "./pd.live.js";
import { getWhy } from "./rootcause/why.service.js";
import { getForecast } from "./forecast/fc.service.js";
import { alertsRouter } from "./alerts/alerts.routes.js";
import { salesRouter } from "./sales/sales.routes.js";
import { outboundRouter } from "./outbound/outbound.routes.js";

/**
 * /api/process-dashboard -- config-driven dashboards for any process whose APR table has been registered (see sql/1941).
 * Admin routes (/admin/*) register and validate the mapping; viewer routes serve the dashboards. Role gates say who may call at all; the
 * data boundary is isProcessReadable / isProcessWritable, re-derived per request from the caller's scope (never from the URL alone).
 * The APR source is only ever read (SELECT in a READ ONLY transaction) -- see pd.source.ts.
 */
const router = Router();
type Handler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: Handler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch((err: unknown) => {
    if (err instanceof PdError) return res.status(err.status).json({ success: false, code: err.code, message: err.message });
    logger.error({ err, path: req.path }, "[process-dashboard] request failed");
    next(err);
  });
};
const UUID_RE = /^[0-9a-fA-F-]{36}$/;
const OUT_OF_SCOPE = { success: false, code: "OUT_OF_SCOPE", message: "That process is outside your scope." };
const q1 = (v: unknown): string => (typeof v === "string" ? v : "");

router.use(requireAuth);
// Sales / Outbound category templates (sql/1961): own routers, own role gates; /admin/sales|outbound/* and /:processId/sales|outbound/*.
router.use(salesRouter);
router.use(outboundRouter);

/* ---------------- admin ---------------- */
const admin = requireRole(...ADMIN_ROLES);

router.get("/admin/tables", admin, requireAnyWritable, h(async (req, res) => {
  res.json({ success: true, data: await listTables(q1(req.query.schema)) });
}));
router.get("/admin/columns", admin, requireAnyWritable, h(async (req, res) => {
  const { schema, table } = assertSourceName(q1(req.query.schema), q1(req.query.table));
  res.json({ success: true, data: await listColumns(schema, table) });
}));
router.post("/admin/suggest", admin, requireAnyWritable, h(async (req, res) => {
  const b = (req.body ?? {}) as { schema?: string; table?: string; processId?: string };
  res.json({ success: true, data: await suggest(String(b.schema ?? ""), String(b.table ?? ""), b.processId && UUID_RE.test(b.processId) ? b.processId : undefined) });
}));
router.post("/admin/preview", admin, h(async (req, res) => {
  const b = (req.body ?? {}) as { processId?: string; config?: Record<string, unknown> };
  if (!b.processId || !UUID_RE.test(b.processId)) throw new PdError(400, "BAD_PROCESS", "processId is required");
  if (!(await isProcessWritable(req.authUser!.id, b.processId))) return res.status(403).json(OUT_OF_SCOPE);
  res.json({ success: true, data: await preview(b.processId, b.config ?? {}) });
}));
router.get("/admin/configs", admin, requireAnyWritable, h(async (req, res) => {
  res.json({ success: true, data: await listAllConfigsAdmin(req.authUser!.id) });
}));
router.get("/admin/configs/:processId", admin, h(async (req, res) => {
  const { processId } = req.params;
  if (!UUID_RE.test(processId)) throw new PdError(400, "BAD_PROCESS", "Invalid process id");
  if (!(await isProcessWritable(req.authUser!.id, processId))) return res.status(403).json(OUT_OF_SCOPE);
  const cfg = await getConfig(processId);
  // A process with no config yet is a normal state for the setup screen, not an error: 200 with data null (no console 404).
  res.json({ success: true, data: cfg ? { ...cfg, configured: isConfigured(cfg) } : null });
}));

/* Support/inbound dialer source (process_inbound_config). Static paths first so ":processId" never swallows "tables"/"preview". */
router.get("/admin/inbound/tables", admin, requireAnyWritable, h(async (_req, res) => {
  res.json({ success: true, data: await listCandidateTables() });
}));
router.post("/admin/inbound/preview", admin, h(async (req, res) => {
  const b = (req.body ?? {}) as { processId?: string; config?: Record<string, unknown> };
  if (!b.processId || !UUID_RE.test(b.processId)) throw new PdError(400, "BAD_PROCESS", "processId is required");
  if (!(await isProcessWritable(req.authUser!.id, b.processId))) return res.status(403).json(OUT_OF_SCOPE);
  res.json({ success: true, data: await previewInbound(b.processId, b.config ?? {}) });
}));
router.get("/admin/inbound/:processId", admin, h(async (req, res) => {
  const { processId } = req.params;
  if (!UUID_RE.test(processId)) throw new PdError(400, "BAD_PROCESS", "Invalid process id");
  if (!(await isProcessWritable(req.authUser!.id, processId))) return res.status(403).json(OUT_OF_SCOPE);
  res.json({ success: true, data: await getInboundConfig(processId) });
}));
router.put("/admin/inbound/:processId", admin, h(async (req, res) => {
  const { processId } = req.params;
  if (!UUID_RE.test(processId)) throw new PdError(400, "BAD_PROCESS", "Invalid process id");
  if (!(await isProcessWritable(req.authUser!.id, processId))) return res.status(403).json(OUT_OF_SCOPE);
  res.json({ success: true, data: await saveInboundConfig(req.authUser!.id, processId, (req.body ?? {}) as Record<string, unknown>) });
}));
router.put("/admin/configs/:processId", admin, h(async (req, res) => {
  const { processId } = req.params;
  if (!UUID_RE.test(processId)) throw new PdError(400, "BAD_PROCESS", "Invalid process id");
  if (!(await isProcessWritable(req.authUser!.id, processId))) return res.status(403).json(OUT_OF_SCOPE);
  const cfg = await saveConfig(req.authUser!.id, processId, (req.body ?? {}) as Record<string, unknown>);
  res.json({ success: true, data: { ...cfg, configured: isConfigured(cfg) } });
}));

/* ---------------- viewer ---------------- */
const viewer = requireRole(...VIEWER_ROLES);

router.get("/configs", viewer, h(async (req, res) => {
  res.json({ success: true, data: await listReadableConfigs(req.authUser!.id, { onlyEnabled: req.query.enabled === "1" }) });
}));

/** Every /:processId/* viewer route: UUID, then the reader's own scope, then the loaded + verified config. */
const scoped = (fn: (l: Awaited<ReturnType<typeof loadConfigOrThrow>>, req: AuthenticatedRequest, res: Response) => Promise<unknown>, opts: { requireEnabled?: boolean } = {}) =>
  h(async (req, res) => {
    const { processId } = req.params;
    if (!UUID_RE.test(processId)) throw new PdError(400, "BAD_PROCESS", "Invalid process id");
    if (!(await isProcessReadable(req.authUser!.id, processId))) return res.status(403).json(OUT_OF_SCOPE);
    return fn(await loadConfigOrThrow(processId, opts), req, res);
  });

router.use("/:processId/alerts", alertsRouter); // alerts + digests (own role/scope guards, rate limits)
router.get("/:processId/config", viewer, h(async (req, res) => {
  const { processId } = req.params;
  if (!UUID_RE.test(processId)) throw new PdError(400, "BAD_PROCESS", "Invalid process id");
  if (!(await isProcessReadable(req.authUser!.id, processId))) return res.status(403).json(OUT_OF_SCOPE);
  const cfg = await getConfig(processId);
  if (!cfg) return res.status(404).json({ success: false, code: "NO_CONFIG", message: "No dashboard configuration for this process" });
  // Viewers never see the source schema/table/column names -- only what they need to render.
  const base = { processId, category: cfg.category, label: cfg.label, enabled: cfg.enabled, configured: isConfigured(cfg), refreshSeconds: cfg.refreshSeconds, timeUnit: cfg.timeUnit };
  let categoryProfile: ReturnType<typeof categoryProfileOut> | null = null;
  if (isConfigured(cfg)) {
    try { const l = await loadConfigOrThrow(processId, { requireEnabled: false }); categoryProfile = categoryProfileOut(l, await loadTargets(processId)); } catch (e) { if (!(e instanceof PdError)) throw e; }
  }
  res.json({ success: true, data: { ...base, categoryProfile } });
}));

/** Does this process have a live inbound dashboard (Live inbound tab)? Same role gate as /api/inbound-insights, which the tab then calls. */
router.get("/:processId/inbound", requireRole(...INBOUND_INSIGHT_ROLES), h(async (req, res) => {
  const { processId } = req.params;
  if (!UUID_RE.test(processId)) throw new PdError(400, "BAD_PROCESS", "Invalid process id");
  if (!(await isProcessReadable(req.authUser!.id, processId))) return res.status(403).json(OUT_OF_SCOPE);
  res.json({ success: true, data: await getInboundTab(processId) });
}));

router.get("/:processId/overview", viewer, scoped(async (l, req, res) => { res.json({ success: true, data: await getOverview(l, req.query) }); }));
router.get("/:processId/why", viewer, scoped(async (l, req, res) => { res.json({ success: true, data: await getWhy(l, req.query) }); }));
router.get("/:processId/forecast", viewer, scoped(async (l, req, res) => { res.json({ success: true, data: await getForecast(l, req.query) }); }));
router.get("/:processId/agents", viewer, scoped(async (l, req, res) => { res.json({ success: true, data: await getAgents(l, req.query) }); }));
router.get("/:processId/agents/:agentCode", viewer, scoped(async (l, req, res) => { res.json({ success: true, data: await getAgentDrill(l, req.params.agentCode, req.query) }); }));
router.get("/:processId/days/:date", viewer, scoped(async (l, req, res) => { res.json({ success: true, data: await getDay(l, req.params.date, req.query) }); }));
router.get("/:processId/live", viewer, scoped(async (l, req, res) => { res.json({ success: true, data: await getLive(l, req.query) }); }));
router.get("/:processId/export.csv", viewer, scoped(async (l, req, res) => { await streamCsv(l, res, q1(req.query.view) || "agents", req.query); }));

/** SSE: pushes the live snapshot whenever the source changes; polls the cheap fingerprint every refreshSeconds. Cookie-auth, like rta live-stream. */
router.get("/:processId/stream", viewer, scoped(async (l, req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  let last = ""; let closed = false; let busy = false;
  const tick = async () => {
    if (closed || busy) return;
    busy = true;
    try {
      const etag = await liveEtag(l);
      if (etag !== last) { const data = await getLive(l, req.query); last = etag; res.write(`event: live\nid: ${etag}\ndata: ${JSON.stringify({ success: true, data })}\n\n`); }
      else res.write(": keep-alive\n\n");
    } catch (err) {
      res.write(`event: error\ndata: ${JSON.stringify({ success: false, message: err instanceof PdError ? err.message : "Live update failed" })}\n\n`);
    } finally { busy = false; }
  };
  const timer = setInterval(() => { void tick(); }, Math.max(10, l.cfg.refreshSeconds) * 1000);
  req.on("close", () => { closed = true; clearInterval(timer); });
  await tick();
}));

export { router as processDashboardRouter };
