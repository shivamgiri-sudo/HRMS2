/**
 * Shortlist decisions (plan 2026-10-09, S12-S14), mounted at /api/he/shortlist: HR overrides with reason and history,
 * shortlist runs and HR approvals, and the "booked but no longer meets the criteria" list. Requisition scope is checked
 * inside each service (a requisition outside the caller's scope is 404).
 */
import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { OVERRIDE_ROLES, overrideHistory, removeOverride, setOverride, type OverrideActor } from "./override.service.js";

export const shortlistRouter = Router();

type Handler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
export const handle = (fn: Handler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  fn(req, res).catch((e: Error & { statusCode?: number; issues?: unknown }) => {
    if (e.statusCode && e.statusCode < 500) return res.status(e.statusCode).json({ success: false, message: e.message, ...(e.issues ? { issues: e.issues } : {}) });
    return next(e);
  });
};
export const actorOf = (req: AuthenticatedRequest): OverrideActor => ({ id: req.authUser!.id, role: String(req.authUser!.role ?? ""), user: req.authUser! });
const str = (v: unknown) => (typeof v === "string" ? v : "");

shortlistRouter.put("/override", requireAuth, requireRole(...OVERRIDE_ROLES), handle(async (req, res) => {
  const b = req.body ?? {};
  const r = await setOverride({ mobile: str(b.mobile), requisitionScope: str(b.requisitionScope), kind: b.kind, reason: str(b.reason), actor: actorOf(req) });
  return res.json({ success: true, data: r });
}));

shortlistRouter.delete("/override", requireAuth, requireRole(...OVERRIDE_ROLES), handle(async (req, res) => {
  const b = req.body ?? {};
  await removeOverride({ mobile: str(b.mobile), requisitionScope: str(b.requisitionScope), reason: str(b.reason), actor: actorOf(req) });
  return res.json({ success: true });
}));

shortlistRouter.get("/override/history", requireAuth, requireRole(...OVERRIDE_ROLES), handle(async (req, res) =>
  res.json({ success: true, data: await overrideHistory(str(req.query.mobile), actorOf(req)) })));
