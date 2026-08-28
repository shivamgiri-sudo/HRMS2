/**
 * Read-only routes for analytics.unified.service.ts.
 *
 * This module (candidate counts, hiring trends, source-channel ROI, recruiter trends,
 * predictive analytics, time-to-hire, ad-hoc custom reports) existed with zero routes and
 * zero frontend consumers — confirmed by grepping the whole repo for importers — until this
 * file. It is genuinely additive: no existing route, controller or page is touched or
 * replaced. The live ATS analytics surfaces (`/api/ats/stats`, `/api/ats/sourcing-channels`,
 * `/api/ats/command-centre/*`) are separate implementations in ats.service.ts and
 * command-centre.service.ts and are left exactly as they are.
 *
 * Role gate mirrors command-centre.routes.ts's — same "view-only analytics for management/
 * supervisory roles" audience, since this is the same kind of surface.
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  getUnifiedCandidateCount,
  getHiringTrends,
  getSourceChannelROI,
  getRecruiterTrends,
  getPredictiveAnalytics,
  getTimeToHireMetrics,
  getCustomReport,
} from "./analytics.unified.service.js";

export const atsAnalyticsRouter = Router();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}

atsAnalyticsRouter.use(requireAuth);
atsAnalyticsRouter.use(requireRole(
  "super_admin", "admin", "ceo",
  "hr", "manager", "process_manager", "branch_head",
  "recruiter", "tl", "team_leader",
  "qa", "wfm", "trainer", "payroll", "finance",
  "assistant_manager",
));

atsAnalyticsRouter.get("/candidate-count", async (_req: Request, res: Response) => {
  try {
    const data = await getUnifiedCandidateCount();
    return res.json({ success: true, data });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: errorMessage(error) });
  }
});

atsAnalyticsRouter.get("/hiring-trends", async (req: Request, res: Response) => {
  try {
    const monthsRaw = Number(req.query.months);
    const months = Number.isFinite(monthsRaw) && monthsRaw > 0 ? monthsRaw : 12;
    const data = await getHiringTrends(months);
    return res.json({ success: true, data });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: errorMessage(error) });
  }
});

atsAnalyticsRouter.get("/source-channel-roi", async (_req: Request, res: Response) => {
  try {
    const data = await getSourceChannelROI();
    return res.json({ success: true, data });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: errorMessage(error) });
  }
});

atsAnalyticsRouter.get("/recruiter-trends", async (req: Request, res: Response) => {
  try {
    const recruiterId = typeof req.query.recruiterId === "string" ? req.query.recruiterId : undefined;
    const data = await getRecruiterTrends(recruiterId);
    return res.json({ success: true, data });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: errorMessage(error) });
  }
});

atsAnalyticsRouter.get("/predictive", async (_req: Request, res: Response) => {
  try {
    const data = await getPredictiveAnalytics();
    return res.json({ success: true, data });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: errorMessage(error) });
  }
});

atsAnalyticsRouter.get("/time-to-hire", async (_req: Request, res: Response) => {
  try {
    const data = await getTimeToHireMetrics();
    return res.json({ success: true, data });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: errorMessage(error) });
  }
});

// POST, not GET: the request carries an array (metrics) and an arbitrary filter object,
// which a query string would need lossy/ambiguous encoding for. getCustomReport() itself
// already whitelists every column name that can appear in groupBy/filters (see
// ALLOWED_GROUP_BY / ALLOWED_FILTER_COLUMNS in analytics.unified.service.ts) — this route
// adds no SQL of its own and passes the body straight through to that guard.
atsAnalyticsRouter.post("/custom-report", async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      metrics?: unknown;
      groupBy?: unknown;
      dateFrom?: unknown;
      dateTo?: unknown;
      filters?: unknown;
    };
    if (!Array.isArray(body.metrics) || !body.metrics.every((m) => typeof m === "string")) {
      return res.status(400).json({ success: false, message: "metrics must be a string array" });
    }
    if (typeof body.groupBy !== "string" || !body.groupBy) {
      return res.status(400).json({ success: false, message: "groupBy is required" });
    }
    const data = await getCustomReport({
      metrics: body.metrics,
      groupBy: body.groupBy,
      dateFrom: typeof body.dateFrom === "string" ? body.dateFrom : undefined,
      dateTo: typeof body.dateTo === "string" ? body.dateTo : undefined,
      filters: (body.filters && typeof body.filters === "object")
        ? body.filters as Record<string, unknown>
        : undefined,
    });
    return res.json({ success: true, data });
  } catch (error: unknown) {
    // getCustomReport throws a plain Error on an invalid groupBy (whitelist rejection) —
    // that is a client mistake, not a server fault, so it is a 400 here rather than the
    // 500 every other route in this file returns.
    const message = errorMessage(error);
    const status = message.startsWith("Invalid groupBy column") ? 400 : 500;
    return res.status(status).json({ success: false, message });
  }
});
