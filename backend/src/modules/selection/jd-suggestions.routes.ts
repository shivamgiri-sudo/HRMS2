/**
 * Requisition text suggestions (S-O8), registered on the criteria router (/api/job-requisition). Same roles and row scope as the
 * criteria API: reads for CRITERIA_READ_ROLES (recruiters 403), accept/dismiss for CRITERIA_EDIT_ROLES; a requisition outside
 * the caller's scope is 404. Accepting goes through saveRequisitionCriteria only (jd-suggestions.service.ts).
 */
import type { NextFunction, Response, Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { jobRequisitionService } from "../job-requisition/job-requisition.service.js";
import { CRITERIA_EDIT_ROLES } from "./criteria.service.js";
import { acceptSuggestions, dismissSuggestions, getSuggestions } from "./jd-suggestions.service.js";
import { CRITERIA_READ_ROLES } from "./selection-roles.js";

const MAX_IDS = 50;
type Handler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: Handler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  fn(req, res).catch((e: Error & { statusCode?: number }) => {
    if (e.statusCode && e.statusCode < 500) return res.status(e.statusCode).json({ success: false, message: e.message });
    return next(e);
  });
};
const inScope = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  jobRequisitionService.isRequisitionVisible(req.authUser!, { id: req.params.id })
    .then((ok) => (ok ? next() : res.status(404).json({ success: false, message: "Requisition not found" }))).catch(next);
};
const actorOf = (req: AuthenticatedRequest) => ({ id: req.authUser!.id, role: String(req.authUser!.role ?? "") });
const idsOf = (v: unknown): string[] | null =>
  (Array.isArray(v) && v.length > 0 && v.length <= MAX_IDS && v.every((x) => typeof x === "string" && x.length > 0 && x.length <= 64) ? [...new Set(v as string[])] : null);
const reasonOf = (v: unknown): string | null | false => (v === undefined || v === null ? null : typeof v === "string" && v.length <= 300 ? v : false);
const valuesOf = (v: unknown): Record<string, number> | null => {
  if (v === undefined || v === null) return {};
  if (typeof v !== "object" || Array.isArray(v)) return null;
  const e = Object.entries(v as Record<string, unknown>);
  return e.length <= MAX_IDS && e.every(([k, n]) => k.length <= 64 && typeof n === "number" && Number.isFinite(n)) ? (v as Record<string, number>) : null;
};
const bad = (res: Response, message: string) => res.status(400).json({ success: false, message });

export function registerJdSuggestionRoutes(r: Router): void {
  r.get("/:id/criteria/suggestions", requireAuth, requireRole(...CRITERIA_READ_ROLES), inScope, h(async (req, res) =>
    res.json({ success: true, data: await getSuggestions(req.params.id, String(req.authUser!.role ?? "")) })));

  r.post("/:id/criteria/suggestions/accept", requireAuth, requireRole(...CRITERIA_EDIT_ROLES), inScope, h(async (req, res) => {
    const b = req.body ?? {};
    const ids = idsOf(b.ids), reason = reasonOf(b.reason), values = valuesOf(b.values);
    if (!ids || reason === false || !values) return bad(res, `ids (1-${MAX_IDS} suggestion ids), optional values ({id: number}) and an optional reason (<= 300 chars) are required`);
    return res.json({ success: true, data: await acceptSuggestions({ requisitionId: req.params.id, ids, values, reason, actor: actorOf(req), dryRun: b.dryRun === true }) });
  }));

  r.post("/:id/criteria/suggestions/dismiss", requireAuth, requireRole(...CRITERIA_EDIT_ROLES), inScope, h(async (req, res) => {
    const b = req.body ?? {};
    const ids = idsOf(b.ids), reason = reasonOf(b.reason);
    if (!ids || reason === false) return bad(res, `ids (1-${MAX_IDS} suggestion ids) and an optional reason (<= 300 chars) are required`);
    return res.json({ success: true, data: await dismissSuggestions({ requisitionId: req.params.id, ids, undo: b.undo === true, reason, actor: actorOf(req) }) });
  }));
}
