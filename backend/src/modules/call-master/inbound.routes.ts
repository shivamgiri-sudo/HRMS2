import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import * as svc from "./inbound.service.js";
import { getIstDateString } from '../../utils/dateUtils.js';

const router = Router();
const h = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: (e?: unknown) => void) => fn(req, res).catch(next);

router.use(
  requireAuth,
  requireRole("super_admin", "admin", "ceo", "manager", "process_manager", "operations_manager", "qa", "quality_analyst")
);

function parseFilters(q: Record<string, unknown>) {
  const now = new Date();
  const endDate   = q.endDate   ? String(q.endDate)   : getIstDateString();
  const startDate = q.startDate ? String(q.startDate) : getIstDateString();
  return { startDate, endDate };
}

// Overall (all projects)
router.get("/summary",             h(async (req, res) => {
  const f = parseFilters(req.query as Record<string, unknown>);
  res.json({ data: await svc.getProjectSummary(f) });
}));
router.get("/today",               h(async (_req, res) => {
  const today = getIstDateString();
  res.json({ data: await svc.getProjectSummary({ startDate: today, endDate: today }) });
}));
router.get("/trend",               h(async (req, res) => {
  const f = parseFilters(req.query as Record<string, unknown>);
  res.json({ data: await svc.getProjectTrend(f) });
}));
router.get("/consolidated-trend",  h(async (req, res) => {
  const f = parseFilters(req.query as Record<string, unknown>);
  res.json({ data: await svc.getConsolidatedTrend(f) });
}));
router.get("/projects",            h(async (_req, res) => {
  res.json({
    data: svc.PROJECTS.map((p) => ({
      key: p.key, name: p.name, icon: p.icon, color: p.color,
      mandate: p.mandate, required: p.required, hasFCR: p.hasFCR,
    })),
  });
}));

// Per-project
router.get("/project/:key",        h(async (req, res) => {
  const f = parseFilters(req.query as Record<string, unknown>);
  const data = await svc.getProjectSummary(f, req.params.key);
  res.json({ data: data[0] ?? null });
}));
router.get("/project/:key/trend",  h(async (req, res) => {
  const f = parseFilters(req.query as Record<string, unknown>);
  const data = await svc.getProjectTrend(f, req.params.key);
  res.json({ data: data[0]?.trend ?? [] });
}));
router.get("/project/:key/hourly", h(async (req, res) => {
  const f = parseFilters(req.query as Record<string, unknown>);
  res.json({ data: await svc.getProjectHourly(f, req.params.key) });
}));

export { router as inboundRouter };
