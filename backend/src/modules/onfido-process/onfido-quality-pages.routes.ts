/**
 * Routes for the Quality tab (Overall / Internal / External). Mounted from
 * onfido-process-dashboard.routes.ts via mountQualityPageRoutes(router, guard).
 *   GET /quality-pages/summary/:side      side = internal | external
 *   GET /quality-pages/trend/:side        ?granularity=daily|weekly|monthly
 *   GET /quality-pages/breakdown/:side/:dimension
 *   GET /quality-pages/internal-analyst   ?mode=daily|weekly|monthly|document|client|documentType|taskType
 */
import type { NextFunction, Request, RequestHandler, Response, Router } from "express";
import {
  ANALYST_QUALITY_MODES,
  QUALITY_BREAKDOWN_DIMENSIONS,
  getInternalAnalystQuality,
  getQualitySideBreakdown,
  getQualitySideSummary,
  getQualitySideTrend,
  type AnalystQualityMode,
  type QualityBreakdownDimension,
  type QualityPageFilters,
  type QualitySide,
} from "./onfido-quality-pages.service.js";

function readFilters(req: Request): QualityPageFilters {
  const q = req.query as Record<string, unknown>;
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() !== "" ? v : undefined;
  return {
    from: str(q.from),
    to: str(q.to),
    tlName: str(q.tlName),
    amName: str(q.amName),
    analystEmail: str(q.analystEmail),
  };
}

const asSide = (v: string): QualitySide | null =>
  v === "internal" || v === "external" ? v : null;

function wrap(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

export function mountQualityPageRoutes(router: Router, guard: RequestHandler[]): void {
  router.get(
    "/quality-pages/summary/:side",
    ...guard,
    wrap(async (req, res) => {
      const side = asSide(req.params.side);
      if (!side) {
        res.status(400).json({ success: false, message: "Unknown side" });
        return;
      }
      res.json({ success: true, data: await getQualitySideSummary(side, readFilters(req)) });
    }),
  );
  router.get(
    "/quality-pages/trend/:side",
    ...guard,
    wrap(async (req, res) => {
      const side = asSide(req.params.side);
      if (!side) {
        res.status(400).json({ success: false, message: "Unknown side" });
        return;
      }
      const g = req.query.granularity;
      const granularity = g === "daily" || g === "weekly" ? g : "monthly";
      res.json({ success: true, data: await getQualitySideTrend(side, readFilters(req), granularity) });
    }),
  );
  router.get(
    "/quality-pages/breakdown/:side/:dimension",
    ...guard,
    wrap(async (req, res) => {
      const side = asSide(req.params.side);
      const dim = req.params.dimension as QualityBreakdownDimension;
      if (!side || !QUALITY_BREAKDOWN_DIMENSIONS.includes(dim)) {
        res.status(400).json({ success: false, message: "Unknown side or dimension" });
        return;
      }
      res.json({ success: true, data: await getQualitySideBreakdown(side, dim, readFilters(req)) });
    }),
  );
  router.get(
    "/quality-pages/internal-analyst",
    ...guard,
    wrap(async (req, res) => {
      const mode = req.query.mode as AnalystQualityMode;
      if (!ANALYST_QUALITY_MODES.includes(mode)) {
        res.status(400).json({ success: false, message: "Unknown mode" });
        return;
      }
      res.json({ success: true, data: await getInternalAnalystQuality(mode, readFilters(req)) });
    }),
  );
}
