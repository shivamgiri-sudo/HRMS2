/**
 * Routes for the POA Internal / External / Trail dashboard pages.
 * Mounted from onfido-process-dashboard.routes.ts via mountPoaPageRoutes(router, guard),
 * so they inherit the router's auth + Onfido scope and whatever role guard the caller passes.
 */
import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
  Router,
} from "express";
import {
  getPoaExternalPage,
  getPoaInternalPage,
  getPoaTrailPage,
  type PoaPageFilters,
} from "./onfido-poa-pages.service.js";
import {
  getPoaExternalBreakdownV2,
  getPoaInternalBreakdown,
  POA_EXTERNAL_BREAKDOWN_DIMENSIONS,
  POA_INTERNAL_BREAKDOWN_DIMENSIONS,
  type PoaExternalBreakdownDimension,
  type PoaInternalBreakdownDimension,
} from "./onfido-poa-breakdown.service.js";

function readFilters(req: Request): PoaPageFilters {
  const q = req.query as Record<string, unknown>;
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() !== "" ? v : undefined;
  return {
    from: str(q.from),
    to: str(q.to),
    tlName: str(q.tlName),
    amName: str(q.amName),
  };
}

function pageHandler<T>(
  load: (filters: PoaPageFilters) => Promise<T>,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    load(readFilters(req))
      .then((data) => {
        res.json({ success: true, data });
      })
      .catch(next);
  };
}

export function mountPoaPageRoutes(
  router: Router,
  guard: RequestHandler[],
): void {
  router.get("/poa-pages/internal", ...guard, pageHandler(getPoaInternalPage));
  router.get("/poa-pages/external", ...guard, pageHandler(getPoaExternalPage));
  router.get("/poa-pages/trail", ...guard, pageHandler(getPoaTrailPage));
  router.get("/poa-pages/internal-breakdown/:dimension", ...guard, (req, res, next) => {
    const dim = req.params.dimension;
    if (!POA_INTERNAL_BREAKDOWN_DIMENSIONS.has(dim)) {
      res.status(400).json({ success: false, message: "Unknown dimension" });
      return;
    }
    getPoaInternalBreakdown(readFilters(req), dim as PoaInternalBreakdownDimension)
      .then((data) => res.json({ success: true, data }))
      .catch(next);
  });
  router.get("/poa-pages/external-breakdown/:dimension", ...guard, (req, res, next) => {
    const dim = req.params.dimension;
    if (!POA_EXTERNAL_BREAKDOWN_DIMENSIONS.has(dim)) {
      res.status(400).json({ success: false, message: "Unknown dimension" });
      return;
    }
    getPoaExternalBreakdownV2(readFilters(req), dim as PoaExternalBreakdownDimension)
      .then((data) => res.json({ success: true, data }))
      .catch(next);
  });
}
