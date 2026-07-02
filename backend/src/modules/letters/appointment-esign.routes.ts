import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { appointmentEsignService } from "./appointment-esign.service.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// POST /appointment/:candidateId/create
router.post("/appointment/:candidateId/create", h(async (req: AuthenticatedRequest, res: Response) => {
  const { candidateId } = req.params;
  if (!candidateId) return res.status(400).json({ error: "candidateId required" });
  const id = await appointmentEsignService.createRequest(candidateId, req.authUser!.id);
  res.status(201).json({ data: { requestId: id } });
}));

// POST /appointment/:requestId/generate
router.post("/appointment/:requestId/generate", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { requestId } = req.params;
  const { templateData } = req.body;
  if (!templateData || typeof templateData !== "object") {
    return res.status(400).json({ error: "templateData object required" });
  }
  await appointmentEsignService.generateLetter(requestId, templateData, req.authUser!.id);
  res.json({ ok: true });
}));

// POST /appointment/:requestId/candidate-esign/initiate
router.post("/appointment/:requestId/candidate-esign/initiate", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const result = await appointmentEsignService.initiateCandidateEsign(req.params.requestId);
  res.json({ data: result });
}));

// POST /appointment/:requestId/candidate-esign/complete
router.post("/appointment/:requestId/candidate-esign/complete", h(async (req: AuthenticatedRequest, res: Response) => {
  const { signedBy } = req.body;
  const effectiveSignedBy: string = signedBy ?? req.authUser!.id;
  await appointmentEsignService.completeCandidateEsign(req.params.requestId, effectiveSignedBy);
  res.json({ ok: true });
}));

// POST /appointment/:requestId/company-sign/initiate
router.post("/appointment/:requestId/company-sign/initiate", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  await appointmentEsignService.initiateCompanySign(req.params.requestId, req.authUser!.id);
  res.json({ ok: true });
}));

// POST /appointment/:requestId/company-sign/complete
router.post("/appointment/:requestId/company-sign/complete", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { signedBy } = req.body;
  const effectiveSignedBy: string = signedBy ?? req.authUser!.id;
  await appointmentEsignService.completeCompanySign(req.params.requestId, effectiveSignedBy);
  res.json({ ok: true });
}));

// POST /appointment/:requestId/finalize
router.post("/appointment/:requestId/finalize", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  await appointmentEsignService.finalizeLetter(req.params.requestId, req.authUser!.id);
  res.json({ ok: true });
}));

// POST /appointment/:requestId/manual-override/request
router.post("/appointment/:requestId/manual-override/request", h(async (req: AuthenticatedRequest, res: Response) => {
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: "reason required" });
  await appointmentEsignService.requestManualOverride(req.params.requestId, reason, req.authUser!.id);
  res.json({ ok: true });
}));

// POST /appointment/:requestId/manual-override/approve  (admin or hr only)
router.post("/appointment/:requestId/manual-override/approve", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  await appointmentEsignService.approveManualOverride(req.params.requestId, req.authUser!.id);
  res.json({ ok: true });
}));

// POST /appointment/:requestId/manual-override/reject
router.post("/appointment/:requestId/manual-override/reject", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: "reason required" });
  await appointmentEsignService.rejectManualOverride(req.params.requestId, reason, req.authUser!.id);
  res.json({ ok: true });
}));

// GET /appointment/:requestId
router.get("/appointment/:requestId", h(async (req: AuthenticatedRequest, res: Response) => {
  const data = await appointmentEsignService.getRequest(req.params.requestId);
  if (!data) return res.status(404).json({ error: "Not found" });
  res.json({ data });
}));

// GET /appointment/:requestId/audit
router.get("/appointment/:requestId/audit", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const data = await appointmentEsignService.getAuditTrail(req.params.requestId);
  res.json({ data });
}));

export { router as appointmentEsignRouter };
