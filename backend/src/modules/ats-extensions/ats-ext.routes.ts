import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requisitionService, bgvService, offerService, duplicateService, sourcingAnalyticsService } from "./ats-ext.service.js";
import { assessmentProtectedRouter, assessmentPublicRouter } from "../ats-assessment/assessment.routes.js";
import {
  assessmentBuilderProtectedRouter,
  assessmentBuilderPublicRouter,
} from "../ats-assessment/assessment.template-builder.routes.js";

const router = Router();
type AsyncHandler = (req: AuthenticatedRequest | Request, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: Request, res: Response, next: NextFunction) => {
  void fn(req as AuthenticatedRequest | Request, res).catch(next);
};

// ── PUBLIC: Candidate pre-employment assessment ───────────────────────────────
// Builder routes are mounted first so the enhanced admin shell and builder page
// are served without replacing any ATS business route.
router.use(assessmentBuilderPublicRouter);
// Mounted before requireAuth. Assessment data is isolated from ATS queue/lifecycle statuses.
router.use(assessmentPublicRouter);

// ── PUBLIC: Offer Digital Acceptance ─────────────────────────────────────────
router.post("/offers/:id/respond", h(async (req: Request, res: Response) => {
  const { action, token, candidate_name, remarks } = req.body as { action?: string; token?: string; candidate_name?: string; remarks?: string };
  if (!action || (action !== "accepted" && action !== "declined")) return res.status(400).json({ error: "action must be 'accepted' or 'declined'" });
  if (!token) return res.status(400).json({ error: "token is required" });
  if (!candidate_name?.trim()) return res.status(400).json({ error: "candidate_name is required" });
  await offerService.respondToOffer(req.params.id, action, token, candidate_name.trim(), remarks);
  return res.json({ ok: true, message: `Offer ${action} successfully` });
}));

router.use(requireAuth);

// Protected builder save is mounted before the generic template endpoint so
// strict custom-template validation is always applied.
router.use(assessmentBuilderProtectedRouter);
// Protected assessment summaries/configuration. Authentication and role checks
// are additive and do not change any existing ATS route behaviour.
router.use(assessmentProtectedRouter);

// ── Manpower Requisitions ─────────────────────────────────────────────────────
router.get("/requisitions", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, data: await requisitionService.list(req.query as Record<string, string | undefined>) });
}));

router.post("/requisitions", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.status(201).json({ success: true, data: await requisitionService.create(req.body, req.authUser!.id, req) });
}));

router.post("/requisitions/:id/approve", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const action = String(req.body?.action ?? "approved");
  if (!["approved", "rejected"].includes(action)) return res.status(400).json({ error: "action must be approved or rejected" });
  await requisitionService.approve(req.params.id, req.authUser!.id, req, action as "approved" | "rejected", req.body?.remarks ?? null);
  res.json({ success: true, ok: true });
}));

// ── BGV ───────────────────────────────────────────────────────────────────────
router.get("/candidates/:id/bgv", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const record = await bgvService.get(req.params.id);
  if (!record) return res.status(404).json({ error: "Not found" });
  res.json({ success: true, data: record });
}));

router.post("/candidates/:id/bgv/initiate", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.status(201).json({ success: true, data: await bgvService.initiate(req.params.id, req.body, req.authUser!.id, req) });
}));

router.patch("/candidates/:id/bgv", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, data: await bgvService.updateStatus(req.params.id, req.body, req.authUser!.id, req) });
}));

router.post("/candidates/:id/bgv", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, data: await bgvService.updateStatus(req.params.id, req.body, req.authUser!.id, req) });
}));

// ── Offers ────────────────────────────────────────────────────────────────────
router.get("/offers", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, data: await offerService.list(req.query.candidate_id as string | undefined, req.query.status as string | undefined) });
}));

router.post("/offers", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.body.candidate_id) return res.status(400).json({ error: "candidate_id required" });
  res.status(201).json({ success: true, data: await offerService.create(req.body, req.authUser!.id, req) });
}));

router.patch("/offers/:id/status", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { status, reason, remarks } = req.body;
  if (!status) return res.status(400).json({ error: "status required" });
  await offerService.updateStatus(req.params.id, status, reason ?? remarks, req.authUser!.id, req);
  res.json({ success: true, ok: true });
}));

// ── Duplicate Detection ───────────────────────────────────────────────────────
router.get("/duplicates", requireRole("admin", "hr"), h(async (_req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, data: await duplicateService.listUnresolved() });
}));

router.post("/duplicates/:id/resolve", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const note = req.body.note ?? req.body.resolution ?? "resolved";
  await duplicateService.resolve(req.params.id, note, req.authUser!.id, req);
  res.json({ success: true, ok: true });
}));

// ── Sourcing Analytics ────────────────────────────────────────────────────────
router.get("/analytics/funnel", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, data: await sourcingAnalyticsService.getFunnel(req.query as Record<string, string | undefined>) });
}));

router.get("/analytics/stages", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true, data: await sourcingAnalyticsService.getStageWise(req.query as Record<string, string | undefined>) });
}));

export { router as atsExtRouter };
