import { Router, type Request, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { logger } from "../../lib/logger.js";
import { getIstDateString } from "../../utils/dateUtils.js";
import { getInboundCalls, getInboundInsights, getInboundPeriods, isInsightProject } from "./inbound-insights.service.js";
import { INBOUND_INSIGHT_ROLES, STATIC_PROJECTS, getInboundProject } from "./inbound-projects.js";
import { inboundProjectAllowed, resolveProcessScope, tpzGrantCoversInboundKey } from "../dashboards/process-scope-guards.js";
import { isProcessReadable } from "../process-dashboard/pd.config.service.js";

const router = Router();
const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: (e?: unknown) => void) =>
    fn(req, res).catch(next);

// Same audience as the existing /api/inbound module.
router.use(
  requireAuth,
  requireRole(...INBOUND_INSIGHT_ROLES)
);

/**
 * Known project? Static keys answer exactly as before. A project an admin registered (process_inbound_config) is additionally held to the
 * reader's process scope, so a scoped manager cannot read another process's calls just by guessing its key.
 */
async function projectAllowed(req: Request, key: string): Promise<boolean> {
  // Branch / process scoping (owner ruling 2026-10-01): the catalogue process behind a static key must be inside
  // the caller's scope. Org-wide callers pass; admin-registered projects keep their own process check below.
  const callerId = (req as AuthenticatedRequest).authUser?.id;
  if (!callerId) return false;
  if (isInsightProject(key) || STATIC_PROJECTS.some((s) => s.key === key)) {
    const scope = await resolveProcessScope(callerId);
    if (!inboundProjectAllowed(scope, { key }) && !(await tpzGrantCoversInboundKey(req as AuthenticatedRequest, key))) return false;
  }
  if (isInsightProject(key)) return true;
  const p = await getInboundProject(key);
  if (!p) return false;
  if (p.source === "db" && p.processId && !STATIC_PROJECTS.some((s) => s.key === key)) {
    const userId = (req as AuthenticatedRequest).authUser?.id;
    return Boolean(userId) && (await isProcessReadable(userId as string, p.processId));
  }
  return true;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function baseFilters(req: Request) {
  const today = getIstDateString();
  return {
    startDate: str(req.query.startDate) ?? today,
    endDate: str(req.query.endDate) ?? today,
    campaign: str(req.query.campaign),
  };
}

function fail(res: Response, route: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  // Validation problems are the caller's; anything else is the dialler being unreachable or a bad query.
  const isInput =
    /must be YYYY-MM-DD|Invalid date|before startDate|limited to|Unknown campaign|not available for project/.test(
      message,
    );
  if (isInput) return res.status(400).json({ success: false, error: message });
  logger.error(
    { route, err },
    `[InboundInsights] ${route} failed — responding _unavailable`,
  );
  return res.json({ success: true, _unavailable: true, data: null });
}

router.get("/:key", h(async (req, res) => {
  const key = String(req.params.key);
  if (!(await projectAllowed(req, key))) return res.status(404).json({ success: false, error: "Unknown inbound project" });
  try {
    res.json({ success: true, data: await getInboundInsights(key, baseFilters(req)) });
  } catch (err) {
    fail(res, "GET /:key", err);
  }
}));

router.get("/:key/calls", h(async (req, res) => {
  const key = String(req.params.key);
  if (!(await projectAllowed(req, key))) return res.status(404).json({ success: false, error: "Unknown inbound project" });
  try {
    const q = req.query;
    const outcome = q.outcome === "answered" || q.outcome === "abandoned" ? q.outcome : undefined;
    const hourRaw = str(q.hour);
    const hour = hourRaw !== undefined && /^\d{1,2}$/.test(hourRaw) ? Number(hourRaw) : undefined;
    const date = str(q.date);
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ success: false, error: "date must be YYYY-MM-DD" });
    res.json({
      success: true,
      data: await getInboundCalls(key, {
        ...baseFilters(req),
        date,
        hour,
        quarter: str(q.quarter),
        agentId: str(q.agentId),
        outcome,
        waitBucket: str(q.waitBucket),
        callerKey: str(q.callerKey),
        weekday: str(q.weekday),
        disposition: str(q.disposition),
        disconnBy: str(q.disconnBy),
        page: str(q.page) ? Number(q.page) : 1,
      }),
    });
  } catch (err) {
    fail(res, "GET /:key/calls", err);
  }
}));

// Week-wise + date-wise columns for the Excel/PDF export (same rows and definitions as GET /:key).
router.get("/:key/periods", h(async (req, res) => {
  const key = String(req.params.key);
  if (!(await projectAllowed(req, key))) return res.status(404).json({ success: false, error: "Unknown inbound project" });
  try {
    res.json({ success: true, data: await getInboundPeriods(key, baseFilters(req)) });
  } catch (err) {
    fail(res, "GET /:key/periods", err);
  }
}));

export { router as inboundInsightsRouter };
