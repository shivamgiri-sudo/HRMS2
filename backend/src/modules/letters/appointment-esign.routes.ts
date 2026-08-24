import { Router } from "express";
import type { Response } from "express";
import path from "path";
import fs from "fs";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { appointmentEsignService } from "./appointment-esign.service.js";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

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

// GET /appointment/by-candidate/:candidateId — HR: get e-sign status for a candidate's appointment letter
router.get("/appointment/by-candidate/:candidateId", requireRole("admin", "hr", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, current_state, candidate_esign_status, company_sign_status,
            candidate_esign_at, vault_path, esign_provider, candidate_esign_url, updated_at
     FROM appointment_letter_request
     WHERE candidate_id = ?
     ORDER BY updated_at DESC LIMIT 1`,
    [req.params.candidateId],
  );
  if (!rows[0]) return res.status(404).json({ error: "No appointment letter request found" });
  res.json({ data: rows[0] });
}));

// GET /appointment/by-candidate/:candidateId/download — HR: download the signed appointment letter
router.get("/appointment/by-candidate/:candidateId/download", requireRole("admin", "hr", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, current_state, vault_path FROM appointment_letter_request
     WHERE candidate_id = ? ORDER BY updated_at DESC LIMIT 1`,
    [req.params.candidateId],
  );
  const row = rows[0];
  if (!row) return res.status(404).json({ error: "No appointment letter found" });
  if (!row.vault_path) {
    return res.status(404).json({ error: "Signed document not yet available", current_state: row.current_state });
  }
  const uploadRoot = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
  const filePath = path.join(uploadRoot, row.vault_path);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found on server", vault_path: row.vault_path });
  }
  res.setHeader("Content-Disposition", `attachment; filename="signed_appointment_letter.pdf"`);
  res.setHeader("Content-Type", "application/pdf");
  res.sendFile(filePath);
}));

export { router as appointmentEsignRouter };
