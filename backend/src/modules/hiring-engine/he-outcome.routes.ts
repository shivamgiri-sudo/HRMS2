/**
 * No-show and decline reason routes (HE_OUTCOME_REASONS, default off). The POST needs WRITE roles and is the only write; the list needs VIEW
 * roles and carries masked mobiles only. A record outside the caller's scope answers 404, never 403. Logs carry the error code only.
 */
import type { NextFunction, Request, Response, Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { logger } from "../../logger.js";
import { parseReasonBody } from "./he-outcome-reason.js";
import { listOutcomes, recordOutcomeReason } from "./he-outcome-reason.service.js";
import { valueAddOn } from "./he-valueadd-switches.js";
import { branchScopeOf, isIsoDate } from "./he-stream.routes.js";
import { addDays, istToday } from "./requisition-stream.window.js";

const ID_RE = /^[0-9a-f-]{36}$/i;
const MAX_SPAN_DAYS = 14;
/** Runs before requireRole so a role without write access sees 404, not 403, while the switch is off. */
const switchOn = (_req: Request, res: Response, next: NextFunction): void => { if (valueAddOn("outcome_reasons")) next(); else fail(res, 404, "Not found"); };
const fail = (res: Response, status: number, message: string): void => { res.status(status).json({ success: false, message }); };

export function registerOutcomeRoutes(r: Router, roles: { view: readonly string[]; write: readonly string[] }): void {
  r.post("/matches/:id/outcome-reason", requireAuth, switchOn, requireRole(...roles.write), async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      if (!ID_RE.test(id)) return fail(res, 400, "Invalid id");
      const body = parseReasonBody(req.body);
      if ("error" in body) return fail(res, 400, body.error);
      const areq = req as AuthenticatedRequest;
      const out = await recordOutcomeReason(id, body, await branchScopeOf(areq), areq.authUser.id ?? null);
      if (out.status === "not_found") return fail(res, 404, "Candidate not found");
      if (out.status === "wrong_state") return fail(res, 409, "Only a no-show or a decline can have a reason");
      res.json({ success: true, data: { outcome: out.outcome, reason: out.reason, note: out.note } });
    } catch (err) {
      logger.error({ code: (err as { code?: unknown })?.code ?? "unknown" }, "[he-outcome] save failed");
      fail(res, 500, "Could not save the reason");
    }
  });

  r.get("/outcome-reasons", requireAuth, requireRole(...roles.view), async (req: Request, res: Response) => {
    try {
      if (!valueAddOn("outcome_reasons")) return void res.json({ success: true, data: { enabled: false, rows: [], truncated: false, partial: false } });
      const today = istToday();
      const to = req.query.to == null ? today : req.query.to, from = req.query.from == null ? addDays(today, -2) : req.query.from;
      if (!isIsoDate(from) || !isIsoDate(to) || to > today || from > to || addDays(from, MAX_SPAN_DAYS) <= to) return fail(res, 400, "Pick up to 14 days ending today");
      res.json({ success: true, data: await listOutcomes({ from, to }, await branchScopeOf(req as AuthenticatedRequest)) });
    } catch (err) {
      logger.error({ code: (err as { code?: unknown })?.code ?? "unknown" }, "[he-outcome] list failed");
      fail(res, 500, "Could not load the reasons");
    }
  });
}
