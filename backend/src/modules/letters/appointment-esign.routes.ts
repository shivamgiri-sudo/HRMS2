import { Router } from "express";
import type { Request, Response } from "express";
import crypto from "crypto";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { appointmentEsignService } from "./appointment-esign.service.js";
import { env } from "../../config/env.js";

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
// Body: { pdfUrl?: string }  — pdfUrl is the signed/accessible URL of the generated PDF
router.post("/appointment/:requestId/candidate-esign/initiate", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { pdfUrl } = req.body ?? {};
  const result = await appointmentEsignService.initiateCandidateEsign(req.params.requestId, pdfUrl);
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

// ── Provider eSign Webhook (no auth — HMAC-SHA256 validated) ─────────────────
// Register this URL in Digio / Infinity AI portal:
//   POST https://mcnhrms.teammas.in/api/letters/appointment/esign-webhook
//
// Digio sends: { id, status, signing_parties: [{ identifier, status }] }
// Infinity AI sends: { request_id, status, signer: { status } }

router.post("/appointment/esign-webhook", h(async (req: Request, res: Response) => {
  const rawBody: string = (req as any).rawBody ?? JSON.stringify(req.body);
  const signature = String(req.headers["x-digio-signature"] ?? req.headers["x-esign-signature"] ?? "");

  // HMAC validation (uses same BGV_WEBHOOK_SECRET if set, or a dedicated ESIGN_WEBHOOK_SECRET)
  const secret = (env as any).ESIGN_WEBHOOK_SECRET ?? (env as any).BGV_WEBHOOK_SECRET ?? "";
  if (secret && signature) {
    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    if (signature !== expected) {
      return res.status(401).json({ error: "Invalid webhook signature" });
    }
  }

  const payload = req.body ?? {};

  // Normalise across Digio and Infinity AI response shapes
  let providerRequestId: string | undefined;
  let status: "signed" | "failed" | "expired" | undefined;

  // Digio shape: { id, status: 'signed'|'failed'|'expired' }
  if (payload.id && payload.status) {
    providerRequestId = String(payload.id);
    const s = String(payload.status).toLowerCase();
    if (s === "signed") status = "signed";
    else if (s === "expired") status = "expired";
    else status = "failed";
  }

  // Infinity AI shape: { request_id, status: 'completed'|'failed'|'expired' }
  if (!providerRequestId && payload.request_id) {
    providerRequestId = String(payload.request_id);
    const s = String(payload.status ?? "").toLowerCase();
    if (s === "completed" || s === "signed") status = "signed";
    else if (s === "expired") status = "expired";
    else status = "failed";
  }

  if (!providerRequestId || !status) {
    return res.status(400).json({ error: "Unrecognised webhook payload shape" });
  }

  await appointmentEsignService.handleEsignWebhook(providerRequestId, status, payload);
  res.json({ ok: true });
}));

export { router as appointmentEsignRouter };
