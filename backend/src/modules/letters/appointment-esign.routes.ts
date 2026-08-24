import { Router } from "express";
import type { Response } from "express";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { appointmentEsignService } from "./appointment-esign.service.js";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import { luckpayClient } from "../integrations/luckpay/luckpay.client.js";

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

// POST /appointment/by-candidate/:candidateId/hr-send
// HR approves (no DSC) + downloads signed PDF from Luckpay + emails candidate + finalizes
router.post("/appointment/by-candidate/:candidateId/hr-send", requireRole("admin", "hr", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { candidateId } = req.params;
  const actorId = req.authUser!.id;

  // 1. Fetch appointment letter request + candidate details
  const [alRows] = await db.execute<RowDataPacket[]>(
    `SELECT alr.id, alr.current_state, alr.candidate_esign_status, alr.esign_transaction_id,
            alr.vault_path,
            c.full_name, c.email, c.mobile
       FROM appointment_letter_request alr
       JOIN ats_candidate c ON c.id = alr.candidate_id
      WHERE alr.candidate_id = ?
      ORDER BY alr.updated_at DESC LIMIT 1`,
    [candidateId],
  );
  const alRow = alRows[0];
  if (!alRow) return res.status(404).json({ error: "No appointment letter request found for this candidate" });
  if (!["candidate_signed", "company_sign_pending", "company_signed"].includes(String(alRow.current_state))) {
    return res.status(409).json({ error: `Cannot send: letter is in state '${alRow.current_state}'. Candidate must sign first.` });
  }

  // 2. Fetch Luckpay providerReferenceId from transaction log
  const [txRows] = await db.execute<RowDataPacket[]>(
    `SELECT client_transaction_id, provider_reference_id
       FROM ats_provider_transaction_log
      WHERE candidate_id = ? AND provider = 'luckpay' AND service_type = 'esign'
      ORDER BY updated_at DESC LIMIT 1`,
    [candidateId],
  );
  const tx = txRows[0];

  // 3. Download signed PDF from Luckpay (if provider enabled and tx found)
  const uploadRoot = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
  const vaultDir = path.join(uploadRoot, "vault", "appointment-letters", String(alRow.id));
  const vaultFile = path.join(vaultDir, "signed_appointment_letter.pdf");
  const vaultRelPath = `vault/appointment-letters/${alRow.id}/signed_appointment_letter.pdf`;

  let pdfBytes: Buffer | null = null;

  if (env.LUCKPAY_PROVIDER_ENABLED && tx?.client_transaction_id) {
    try {
      const result = await luckpayClient.downloadESignDocument({
        clientTransactionId: String(tx.client_transaction_id),
        providerReferenceId: String(tx.provider_reference_id ?? ""),
      });
      if (result.bytes?.length) pdfBytes = result.bytes as Buffer;
    } catch (err) {
      console.warn("[appointment-hr-send] Luckpay download failed, using source PDF fallback:", err instanceof Error ? err.message : err);
    }
  }

  // Fallback: use the original offer letter PDF if Luckpay download failed/unavailable
  if (!pdfBytes) {
    const [offerRows] = await db.execute<RowDataPacket[]>(
      `SELECT pdf_path FROM ats_offer_letters WHERE candidate_id = ? AND pdf_path IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      [candidateId],
    );
    const srcPath = offerRows[0]?.pdf_path ? path.join(uploadRoot, String(offerRows[0].pdf_path)) : null;
    if (srcPath && fs.existsSync(srcPath)) pdfBytes = fs.readFileSync(srcPath);
  }

  // Save PDF to vault
  if (pdfBytes) {
    fs.mkdirSync(vaultDir, { recursive: true });
    fs.writeFileSync(vaultFile, pdfBytes);
  }

  // 4. Mark company-signed + finalize (no DSC — HR approval only)
  const state = String(alRow.current_state);
  if (state === "candidate_signed") {
    await db.execute(
      `UPDATE appointment_letter_request
          SET current_state = 'company_signed', company_sign_status = 'signed',
              company_sign_at = NOW(), company_signed_by = ?
        WHERE id = ?`,
      [actorId, alRow.id],
    );
  }
  // Finalize
  await db.execute(
    `UPDATE appointment_letter_request
        SET current_state = 'completed', pdf_locked = 1, pdf_locked_at = NOW(), vault_path = ?
      WHERE id = ?`,
    [vaultRelPath, alRow.id],
  );
  // Audit
  await db.execute(
    `INSERT INTO appointment_letter_audit (id, letter_request_id, action, from_state, to_state, performed_by, remarks, created_at)
     VALUES (UUID(), ?, 'HR_SEND', ?, 'completed', ?, 'HR approved and sent to employee', NOW())`,
    [alRow.id, state, actorId],
  );
  // Upsert vault row
  const [existingVault] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employee_document_vault WHERE source_entity_id = ? LIMIT 1`, [alRow.id],
  );
  if (!existingVault[0]) {
    await db.execute(
      `INSERT INTO employee_document_vault
         (id, candidate_id, document_type, document_name, file_path, is_locked, locked_at, locked_by, source_module, source_entity_id, uploaded_at, uploaded_by)
       VALUES (?, ?, 'APPOINTMENT_LETTER', 'Signed Appointment Letter', ?, 1, NOW(), ?, 'letters', ?, NOW(), ?)`,
      [randomUUID(), candidateId, vaultRelPath, actorId, alRow.id, actorId],
    );
  }

  // 5. Email the candidate/employee
  const emailedTo: string[] = [];
  const candidateName = String(alRow.full_name ?? "");
  const candidateEmail = String(alRow.email ?? "");
  try {
    const { emailService } = await import("../communication/email.service.js");
    if (candidateEmail.includes("@")) {
      const frontendBase = process.env.FRONTEND_URL ?? process.env.APP_URL ?? "https://mcnhrms.teammas.in";
      const downloadUrl = `${frontendBase}/api/letters/appointment/by-candidate/${candidateId}/download`;
      await emailService.send({
        to: candidateEmail,
        subject: `Your Appointment Letter — MAS Callnet`,
        html: `<p>Dear ${candidateName},</p>
               <p>Your appointment letter has been signed and is ready. Please find it attached or download it using the link below:</p>
               <p><a href="${downloadUrl}" style="background:#2563eb;color:#fff;padding:8px 16px;border-radius:4px;text-decoration:none;">Download Appointment Letter</a></p>
               <p>If you have any questions, please contact HR.</p>
               <p>Regards,<br/>MAS Callnet HR Team</p>`,
        attachments: pdfBytes ? [{ filename: "Appointment_Letter.pdf", content: pdfBytes }] : undefined,
      });
      emailedTo.push(candidateEmail);
    }
  } catch (err) {
    console.warn("[appointment-hr-send] Email failed:", err instanceof Error ? err.message : err);
  }

  return res.json({ ok: true, emailed: emailedTo, vault_path: vaultRelPath, pdfSaved: !!pdfBytes });
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
