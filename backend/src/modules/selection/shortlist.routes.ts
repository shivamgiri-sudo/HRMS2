/**
 * Shortlist decisions (plan 2026-10-09, S12-S14), mounted at /api/he/shortlist: HR overrides with reason and history,
 * shortlist runs and HR approvals, and the "booked but no longer meets the criteria" list. Requisition scope is checked
 * inside each service (a requisition outside the caller's scope is 404).
 */
import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { jobRequisitionService } from "../job-requisition/job-requisition.service.js";
import { APPROVAL_ROLES, approveBatch, approveStanding, createShortlistRun, enrolApproved, rejectPeople, revokeStanding } from "./approval.service.js";
import { currentFollowupPort } from "./enrolment-port.js";
import { OVERRIDE_ROLES, overrideHistory, removeOverride, setOverride, type OverrideActor } from "./override.service.js";
import { SOURCE_KINDS, type SourceKind } from "./selection-types.js";

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

// ── Runs and HR approval (S13): super_admin, hr, recruitment_hr; requisition scope inside the service ──
const kindOf = (v: unknown): SourceKind | null => ((SOURCE_KINDS as readonly string[]).includes(String(v)) ? (v as SourceKind) : null);
const mobilesOf = (v: unknown): string[] | null => (v === undefined ? [] : Array.isArray(v) && v.length <= 500 && v.every((m) => typeof m === "string" && /^[6-9]\d{9}$/.test(m)) ? (v as string[]) : null);
const bad = (res: Response, message: string) => res.status(400).json({ success: false, message });

shortlistRouter.post("/run", requireAuth, requireRole(...APPROVAL_ROLES), handle(async (req, res) => {
  const k = kindOf(req.body?.sourceKind);
  if (!str(req.body?.requisitionId) || !k) return bad(res, "requisitionId and sourceKind (meta_live, meta_old or he) are required");
  return res.json({ success: true, data: await createShortlistRun({ requisitionId: str(req.body.requisitionId), sourceKind: k, actor: actorOf(req) }) });
}));

shortlistRouter.post("/approve", requireAuth, requireRole(...APPROVAL_ROLES), handle(async (req, res) => {
  const b = req.body ?? {};
  const k = kindOf(b.sourceKind), untick = mobilesOf(b.untick), review = mobilesOf(b.approveReview);
  if (!str(b.requisitionId) || !str(b.runId) || !k || !untick || !review || (b.note != null && (typeof b.note !== "string" || b.note.length > 300))) {
    return bad(res, "requisitionId, sourceKind, runId are required; untick / approveReview are lists of mobiles; note up to 300 characters");
  }
  return res.json({ success: true, data: await approveBatch({ requisitionId: b.requisitionId, sourceKind: k, runId: b.runId, untick, approveReview: review, note: b.note ?? null, actor: actorOf(req) }) });
}));

shortlistRouter.post("/approve-standing", requireAuth, requireRole(...APPROVAL_ROLES), handle(async (req, res) => {
  const b = req.body ?? {};
  if (!str(b.requisitionId) || !str(b.versionId) || (b.days !== undefined && !Number.isInteger(b.days))) return bad(res, "requisitionId, versionId and optional whole days are required");
  return res.json({ success: true, data: await approveStanding({ requisitionId: b.requisitionId, versionId: b.versionId, days: b.days, actor: actorOf(req) }) });
}));

shortlistRouter.delete("/approve-standing/:id", requireAuth, requireRole(...APPROVAL_ROLES), handle(async (req, res) => {
  await revokeStanding({ approvalId: req.params.id, actor: actorOf(req) });
  return res.json({ success: true });
}));

shortlistRouter.post("/reject", requireAuth, requireRole(...APPROVAL_ROLES), handle(async (req, res) => {
  const b = req.body ?? {};
  const mobiles = mobilesOf(b.mobiles);
  if (!str(b.requisitionId) || !mobiles?.length) return bad(res, "requisitionId and mobiles are required");
  return res.json({ success: true, data: await rejectPeople({ requisitionId: b.requisitionId, mobiles, reason: str(b.reason), actor: actorOf(req) }) });
}));

/** Hands approved people to the follow-up enrolment; does nothing unless policy.shortlist.enrol = 1. */
shortlistRouter.post("/enrol", requireAuth, requireRole(...APPROVAL_ROLES), handle(async (req, res) => {
  const k = kindOf(req.body?.sourceKind);
  if (!str(req.body?.requisitionId) || !k) return bad(res, "requisitionId and sourceKind are required");
  if (!(await jobRequisitionService.isRequisitionVisible(req.authUser!, { id: str(req.body.requisitionId) }))) return res.status(404).json({ success: false, message: "Requisition not found" });
  return res.json({ success: true, data: await enrolApproved({ requisitionId: str(req.body.requisitionId), sourceKind: k, port: currentFollowupPort }) });
}));
