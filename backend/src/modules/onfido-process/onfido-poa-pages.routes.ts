/**
 * Routes for the POA Internal / External / Trail dashboard pages.
 * Mounted from onfido-process-dashboard.routes.ts via mountPoaPageRoutes(router, guard),
 * so they inherit the router's auth + Onfido scope and whatever role guard the caller passes.
 */
import type { NextFunction, Request, RequestHandler, Response, Router } from "express";
import {
  getPoaExternalPage,
  getPoaInternalPage,
  getPoaTrailPage,
  type PoaPageFilters,
} from "./onfido-poa-pages.service.js";

function readFilters(req: Request): PoaPageFilters {
  const q = req.query as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : undefined);
  return { from: str(q.from), to: str(q.to), tlName: str(q.tlName), amName: str(q.amName) };
}

function pageHandler<T>(load: (filters: PoaPageFilters) => Promise<T>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    load(readFilters(req))
      .then((data) => { res.json({ success: true, data }); })
      .catch(next);
  };
}

export function mountPoaPageRoutes(router: Router, guard: RequestHandler[]): void {
  router.get("/poa-pages/internal", ...guard, pageHandler(getPoaInternalPage));
  router.get("/poa-pages/external", ...guard, pageHandler(getPoaExternalPage));
  router.get("/poa-pages/trail", ...guard, pageHandler(getPoaTrailPage));
}
