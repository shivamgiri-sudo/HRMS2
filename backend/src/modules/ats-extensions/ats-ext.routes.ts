import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requisitionService, bgvService, offerService, duplicateService, sourcingAnalyticsService } from "./ats-ext.service.js";

const router = Router();
const h = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// ── Manpower Requisitions ─────────────────────────────────────────────────────
// scope-limited: manager/recruiter access deferred until user_assignment_scope enforcement is available

router.get("/requisitions", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ data: await requisitionService.list(req.query as any) });
}));

router.post("/requisitions", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.status(201).json({ data: await requisitionService.create(req.body, req.authUser!.id, req) });
}));

router.post("/requisitions/:id/approve", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  await requisitionService.approve(req.params.id, req.authUser!.id, req);
  res.json({ ok: true });
}));

// ── BGV ───────────────────────────────────────────────────────────────────────

router.get("/candidates/:id/bgv", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const record = await bgvService.get(req.params.id);
  if (!record) return res.status(404).json({ error: "Not found" });
  res.json({ data: record });
}));

router.post("/candidates/:id/bgv/initiate", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.status(201).json({ data: await bgvService.initiate(req.params.id, req.body, req.authUser!.id, req) });
}));

router.patch("/candidates/:id/bgv", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ data: await bgvService.updateStatus(req.params.id, req.body, req.authUser!.id, req) });
}));

// ── Offers ────────────────────────────────────────────────────────────────────

router.get("/offers", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ data: await offerService.list(req.query.candidate_id as string | undefined) });
}));

router.post("/offers", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.body.candidate_id || !req.body.offer_date) {
    return res.status(400).json({ error: "candidate_id and offer_date required" });
  }
  res.status(201).json({ data: await offerService.create(req.body, req.authUser!.id, req) });
}));

router.patch("/offers/:id/status", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { status, reason } = req.body;
  if (!status) return res.status(400).json({ error: "status required" });
  await offerService.updateStatus(req.params.id, status, reason, req.authUser!.id, req);
  res.json({ ok: true });
}));

// ── Duplicate Detection ───────────────────────────────────────────────────────
// scope-limited: manager/recruiter access deferred until user_assignment_scope enforcement is available

router.get("/duplicates", requireRole("admin", "hr"), h(async (_req: AuthenticatedRequest, res: Response) => {
  res.json({ data: await duplicateService.listUnresolved() });
}));

router.post("/duplicates/:id/resolve", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  await duplicateService.resolve(req.params.id, req.body.note ?? "", req.authUser!.id);
  res.json({ ok: true });
}));

// ── Sourcing Analytics ────────────────────────────────────────────────────────
// scope-limited: manager/recruiter access deferred until user_assignment_scope enforcement is available

router.get("/analytics/funnel", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ data: await sourcingAnalyticsService.getFunnel(req.query as any) });
}));

router.get("/analytics/stages", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  res.json({ data: await sourcingAnalyticsService.getStageWise(req.query as any) });
}));

export { router as atsExtRouter };
