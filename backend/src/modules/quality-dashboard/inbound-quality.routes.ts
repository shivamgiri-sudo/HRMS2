import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import * as svc from "./inbound-quality.service.js";

const router = Router();
const h = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: (e?: unknown) => void) => fn(req, res).catch(next);

router.use(
  requireAuth,
  requireRole("super_admin", "admin", "ceo", "manager", "process_manager", "operations_manager", "qa", "quality_analyst")
);

function parseFilters(q: Record<string, unknown>): svc.InboundQualityFilters {
  const now       = new Date();
  const endDate   = q.endDate   ? String(q.endDate)   : now.toISOString().slice(0, 10);
  const startDate = q.startDate ? String(q.startDate) : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const clientId  = q.clientId  ? String(q.clientId)  : undefined;
  return { startDate, endDate, clientId };
}

// ── Dashboard endpoints ───────────────────────────────────────────────────────
router.get("/clients",               h(async (req, res) => res.json({ data: await svc.getInboundClients(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/kpis",                  h(async (req, res) => res.json({ data: await svc.getInboundProcessKPIs(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/top-performers",        h(async (req, res) => res.json({ data: await svc.getTopPerformers(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/daily-scores",          h(async (req, res) => res.json({ data: await svc.getDailyScores(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/scenarios",             h(async (req, res) => res.json({ data: await svc.getScenarios(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/social-media-threats",  h(async (req, res) => res.json({ data: await svc.getSocialMediaThreats(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/social-threat-detail",  h(async (req, res) => res.json({ data: await svc.getSocialThreatDetail(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/neg-signal-details",    h(async (req, res) => res.json({ data: await svc.getTopNegativeSignalDetails(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/pos-signal-details",    h(async (req, res) => res.json({ data: await svc.getTopPositiveSignals(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/transcript",            h(async (req, res) => {
  const leadId = String(req.query.leadId ?? "");
  if (!leadId) return res.status(400).json({ error: "leadId required" });
  res.json({ data: await svc.getTranscript(leadId) });
}));
router.get("/score-component-detail",h(async (req, res) => res.json({ data: await svc.getScoreComponentDetail(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/potential-scams",       h(async (req, res) => res.json({ data: await svc.getPotentialScams(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/potential-scams-detail",h(async (req, res) => res.json({ data: await svc.getPotentialScamsDetail(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/sensitive-word-analysis",h(async (req, res) => res.json({ data: await svc.getSensitiveWordAnalysis(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/fatal-analysis",        h(async (req, res) => res.json({ data: await svc.getFatalAnalysis(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/fatal-calls-list",      h(async (req, res) => res.json({ data: await svc.getFatalCallsList(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/repeat-analysis",       h(async (req, res) => res.json({ data: await svc.getRepeatAnalysis(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/agent-audit-band",      h(async (req, res) => res.json({ data: await svc.getAgentAuditBandSummary(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/agent-param",           h(async (req, res) => {
  const f = parseFilters(req.query as Record<string, unknown>);
  const scenario = req.query.scenario ? String(req.query.scenario) : undefined;
  res.json({ data: await svc.getAgentParameterWise({ ...f, scenario }) });
}));
router.get("/raw-data",              h(async (req, res) => {
  const limit = parseInt(String(req.query.limit ?? "500"), 10);
  res.json({ data: await svc.getRawData(parseFilters(req.query as Record<string, unknown>), limit) });
}));

// ── CLAP VOC Quotes (verbatim customer voice, 2026-07-17+) ───────────────────
router.get("/clap-voc-quotes",         h(async (req, res) => res.json({ data: await svc.getClapVocQuotes(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/clap-product-voc-summary",h(async (req, res) => res.json({ data: await svc.getClapProductVocSummary(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/clap-product-voc-quotes", h(async (req, res) => {
  const f = parseFilters(req.query as Record<string, unknown>);
  const branch = (req.query.branch as string | undefined) as ("customer" | "logistic" | "agent" | "product") | undefined;
  res.json({ data: await svc.getClapProductVocQuotes({ ...f, branch }) });
}));
router.get("/clap-intelligence",       h(async (req, res) => res.json({ data: await svc.getClapIntelligence(parseFilters(req.query as Record<string, unknown>)) })));

// ── Agent master management (super_admin / qa only) ────────────────────────
router.get("/agent-master",          h(async (_req, res) => res.json({ data: await svc.getAgentMaster() })));
router.get("/missing-agents",        h(async (req, res) => res.json({ data: await svc.getMissingAgents(parseFilters(req.query as Record<string, unknown>)) })));
router.post(
  "/agent-master",
  requireRole("super_admin", "qa"),
  h(async (req, res) => {
    const { masId, agentName } = req.body as { masId: string; agentName: string };
    if (!masId || !agentName) return res.status(400).json({ error: "masId and agentName required" });
    await svc.insertAgentMaster(masId, agentName);
    res.json({ ok: true });
  })
);

// ── Neg-keywords management (super_admin / qa only) ───────────────────────
router.get("/neg-keywords",  h(async (_req, res) => res.json({ data: await svc.getNegKeywords() })));
router.post(
  "/neg-keywords",
  requireRole("super_admin", "qa"),
  h(async (req, res) => {
    const { pattern, category } = req.body as { pattern: string; category: string };
    if (!pattern || !category) return res.status(400).json({ error: "pattern and category required" });
    await svc.addNegKeyword(pattern, category);
    res.json({ ok: true });
  })
);
router.patch(
  "/neg-keywords/:id",
  requireRole("super_admin", "qa"),
  h(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { enabled } = req.body as { enabled: boolean };
    await svc.updateNegKeyword(id, enabled);
    res.json({ ok: true });
  })
);
router.post(
  "/reload-neg-rules",
  requireRole("super_admin", "qa"),
  h(async (_req, res) => {
    await svc.reloadNegRules();
    res.json({ ok: true });
  })
);

export { router as inboundQualityRouter };
