import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { inboundProjectAllowed, resolveProcessScope, tpzGrantCoversInboundKey } from "../dashboards/process-scope-guards.js";
import { getInboundProject } from "./inbound-projects.js";
import { logger } from "../../lib/logger.js";
import * as svc from "./inbound.service.js";
import { getIstDateString } from '../../utils/dateUtils.js';

const router = Router();
const h = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: (e?: unknown) => void) => fn(req, res).catch(next);

router.use(
  requireAuth,
  requireRole("super_admin", "admin", "ceo", "manager", "process_manager", "operations_manager", "qa", "quality_analyst")
);

/**
 * Answer with the dialler-unavailable shape the frontend already understands,
 * and record why.
 *
 * Every handler below used a bare `catch {}` that returned this same body and
 * logged nothing whatsoever. The response contract was fine — NativeInboundDashboard
 * reads `_unavailable` and shows a named banner — but with no log line a broken
 * query, a bad credential and a genuinely quiet day were indistinguishable from
 * the server side. That is the same blindness that let dialer_1 fail 864 times
 * unnoticed.
 *
 * The status stays 200 deliberately: the frontend distinguishes "source down"
 * from "no data" via `_unavailable`, and changing the status here would break
 * that contract for no gain.
 */
function unavailable<T>(res: Response, route: string, error: unknown, fallback: T) {
  logger.error({ route, err: error }, `[Inbound] ${route} failed — responding _unavailable`);
  return res.json({ success: true, _unavailable: true, data: fallback });
}

/**
 * Branch / process scoping (owner ruling 2026-10-01). undefined = org-wide (nothing filtered); otherwise the
 * predicate keeps only projects whose process is inside the caller's scope.
 */
async function projectAllowFor(req: Request): Promise<svc.ProjectAllow | undefined> {
  const userId = (req as any).authUser?.id as string | undefined;
  const scope = userId ? await resolveProcessScope(userId) : { orgWide: false as const, processIds: new Set<string>(), processCodes: new Set<string>() };
  if (scope.orgWide) return undefined;
  return (p) => inboundProjectAllowed(scope, p);
}

// Every /project/:key/* endpoint: a key is only a request, it must sit inside the caller's scope.
router.use("/project/:key", async (req: Request, res: Response, next: (e?: unknown) => void) => {
  try {
    const allow = await projectAllowFor(req);
    if (allow && !(await tpzGrantCoversInboundKey(req as any, String(req.params.key)))) {
      const p = await getInboundProject(String(req.params.key));
      if (!p || !allow(p)) {
        return res.status(403).json({ success: false, message: "Forbidden: this project is outside your branch / assigned scope" });
      }
    }
    return next();
  } catch (err) {
    return next(err);
  }
});

function parseFilters(q: Record<string, unknown>) {
  const endDate   = q.endDate   ? String(q.endDate)   : getIstDateString();
  const startDate = q.startDate ? String(q.startDate) : getIstDateString();
  return { startDate, endDate };
}

// Overall (all projects)
router.get("/summary", h(async (req, res) => {
  try {
    const f = parseFilters(req.query as Record<string, unknown>);
    res.json({ success: true, data: await svc.getProjectSummary(f, undefined, await projectAllowFor(req)) });
  } catch (err) {
    unavailable(res, "GET /summary", err, []);
  }
}));
router.get("/today", h(async (req, res) => {
  try {
    const today = getIstDateString();
    res.json({ success: true, data: await svc.getProjectSummary({ startDate: today, endDate: today }, undefined, await projectAllowFor(req)) });
  } catch (err) {
    unavailable(res, "GET /today", err, []);
  }
}));
router.get("/trend", h(async (req, res) => {
  try {
    const f = parseFilters(req.query as Record<string, unknown>);
    res.json({ success: true, data: await svc.getProjectTrend(f, undefined, await projectAllowFor(req)) });
  } catch (err) {
    unavailable(res, "GET /trend", err, []);
  }
}));
router.get("/consolidated-trend", h(async (req, res) => {
  try {
    const f = parseFilters(req.query as Record<string, unknown>);
    res.json({ success: true, data: await svc.getConsolidatedTrend(f, await projectAllowFor(req)) });
  } catch (err) {
    unavailable(res, "GET /consolidated-trend", err, []);
  }
}));
router.get("/projects", h(async (req, res) => {
  const allow = await projectAllowFor(req);
  res.json({
    success: true,
    data: svc.PROJECTS.filter((p) => !allow || allow(p)).map((p) => ({
      key: p.key, name: p.name, icon: p.icon, color: p.color,
      mandate: p.mandate, required: p.required, hasFCR: p.hasFCR,
    })),
  });
}));

// Per-project
router.get("/project/:key", h(async (req, res) => {
  try {
    const f = parseFilters(req.query as Record<string, unknown>);
    const data = await svc.getProjectSummary(f, req.params.key);
    res.json({ success: true, data: data[0] ?? null });
  } catch (err) {
    unavailable(res, `GET /project/${req.params.key}`, err, null);
  }
}));
router.get("/project/:key/trend", h(async (req, res) => {
  try {
    const f = parseFilters(req.query as Record<string, unknown>);
    const data = await svc.getProjectTrend(f, req.params.key);
    res.json({ success: true, data: data[0]?.trend ?? [] });
  } catch (err) {
    unavailable(res, `GET /project/${req.params.key}/trend`, err, []);
  }
}));
router.get("/project/:key/hourly", h(async (req, res) => {
  try {
    const f = parseFilters(req.query as Record<string, unknown>);
    res.json({ success: true, data: await svc.getProjectHourly(f, req.params.key) });
  } catch (err) {
    unavailable(res, `GET /project/${req.params.key}/hourly`, err, []);
  }
}));
router.get("/project/:key/hourly-by-date", h(async (req, res) => {
  try {
    const f = parseFilters(req.query as Record<string, unknown>);
    res.json({ success: true, data: await svc.getProjectHourlyByDate(f, req.params.key) });
  } catch (err) {
    unavailable(res, `GET /project/${req.params.key}/hourly-by-date`, err, []);
  }
}));
router.get("/project/:key/lob", h(async (req, res) => {
  try {
    const f = parseFilters(req.query as Record<string, unknown>);
    res.json({ success: true, data: await svc.getProjectLobSummary(f, req.params.key) });
  } catch (err) {
    unavailable(res, `GET /project/${req.params.key}/lob`, err, []);
  }
}));
router.get("/project/:key/agents", h(async (req, res) => {
  try {
    const f = parseFilters(req.query as Record<string, unknown>);
    res.json({ success: true, data: await svc.getProjectAgentSummary(f, req.params.key) });
  } catch (err) {
    unavailable(res, `GET /project/${req.params.key}/agents`, err, []);
  }
}));

export { router as inboundRouter };
