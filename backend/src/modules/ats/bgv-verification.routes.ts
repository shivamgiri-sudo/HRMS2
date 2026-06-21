import { Router, type Request, type Response, type NextFunction } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { hasScopedAccess, buildScopeWhereClause } from "../../shared/scopeAccess.js";
import { env } from "../../config/env.js";
import {
  getBgvStatusByToken,
  getBgvStatusForCandidate,
  listBgvQueueScoped,
  listVendorDispatches,
  manualReview,
  providerCallback,
  saveBgvConsentByToken,
  startDigilockerByToken,
  verifyAadhaarOfflineByToken,
  verifyAddressDocByToken,
  verifyBankByToken,
  verifyBankForCandidate,
  verifyCourtByToken,
  verifyEducationByToken,
  verifyPanByToken,
  verifyPanForCandidate,
  waiveCheck,
  dispatchToVendor,
  updateVendorResult,
} from "./bgv-verification.service.js";
import { getBgvProviderAdapter } from "./bgv-provider.adapter.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { atsService } from "./ats.service.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const meta = (req: Request) => ({ ip: req.ip, userAgent: req.get("user-agent") ?? undefined });

async function requireBgvCandidateScope(req: AuthenticatedRequest, candidateId: string): Promise<void> {
  const candidate = await atsService.getCandidate(candidateId);
  const allowed = await hasScopedAccess(req.authUser!.id, ["admin", "hr", "recruiter"], { branchId: candidate.applied_for_branch ?? undefined, processId: candidate.applied_for_process ?? undefined }, { allowAdminBypass: true });
  if (!allowed) throw Object.assign(new Error("Access denied"), { statusCode: 403 });
}

// Public token-driven candidate BGV routes. Mount before global requireAuth.
router.post("/consent", h(async (req, res) => {
  const token = String(req.body.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.status(201).json({ success: true, data: await saveBgvConsentByToken(token, req.body, meta(req)) });
}));

router.get("/status", h(async (req, res) => {
  const token = String(req.query.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await getBgvStatusByToken(token) });
}));

router.post("/verify/pan", h(async (req, res) => {
  const token = String(req.body.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await verifyPanByToken(token, req.body, meta(req)) });
}));

router.post("/verify/bank", h(async (req, res) => {
  const token = String(req.body.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await verifyBankByToken(token, req.body, meta(req)) });
}));

router.post("/verify/aadhaar-offline", h(async (req, res) => {
  const token = String(req.body.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await verifyAadhaarOfflineByToken(token, req.body, meta(req)) });
}));

router.post("/verify/address-doc", h(async (req, res) => {
  const token = String(req.body.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  if (!req.body.docType || !req.body.documentNumber) return res.status(400).json({ success: false, message: "docType and documentNumber required" });
  return res.json({ success: true, data: await verifyAddressDocByToken(token, { docType: req.body.docType, documentNumber: req.body.documentNumber }, meta(req)) });
}));

router.post("/verify/education", h(async (req, res) => {
  const token = String(req.body.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  if (!req.body.boardType || !req.body.yearOfPassing) return res.status(400).json({ success: false, message: "boardType and yearOfPassing required" });
  return res.json({ success: true, data: await verifyEducationByToken(token, {
    boardType: req.body.boardType,
    rollNumber: req.body.rollNumber,
    certificateNumber: req.body.certificateNumber,
    yearOfPassing: Number(req.body.yearOfPassing),
    institutionName: req.body.institutionName,
  }, meta(req)) });
}));

router.post("/verify/court", h(async (req, res) => {
  const token = String(req.body.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await verifyCourtByToken(token, meta(req)) });
}));

router.post("/digilocker/start", h(async (req, res) => {
  const token = String(req.body.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await startDigilockerByToken(token, Array.isArray(req.body.requestedDocuments) ? req.body.requestedDocuments : [], meta(req)) });
}));

// CI-BGV-01: HMAC-SHA256 signature validation
router.post("/provider/callback", h(async (req: Request & { rawBody?: Buffer }, res) => {
  const secret = env.BGV_WEBHOOK_SECRET;
  if (!secret) {
    if (env.NODE_ENV === "production") return res.status(503).json({ success: false, message: "Webhook not configured" });
    console.warn("[BGV] BGV_WEBHOOK_SECRET not set — skipping signature check in non-production mode");
  } else {
    const sigHeader = req.get("x-bgv-signature") ?? "";
    if (!sigHeader) return res.status(401).json({ success: false, message: "Missing x-bgv-signature header" });
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body));
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    let match = false;
    try {
      match = timingSafeEqual(Buffer.from(sigHeader, "hex"), Buffer.from(expected, "hex"));
    } catch {
      match = false;
    }
    if (!match) return res.status(401).json({ success: false, message: "Invalid webhook signature" });
  }
  return res.json({ success: true, data: await providerCallback(req.body) });
}));

// HR/BGV/Admin protected routes — all have role check + row-scope
router.get("/queue", requireAuth, requireRole("admin", "hr", "recruiter"), h(async (req: AuthenticatedRequest, res) => {
  const scoped = await buildScopeWhereClause(req.authUser!.id, ["admin", "hr", "recruiter"], { branchId: "c.applied_for_branch", processId: "c.applied_for_process" }, { allowAdminBypass: true });
  return res.json({ success: true, data: await listBgvQueueScoped(req.query.status as string | undefined, scoped) });
}));

router.get("/candidates/:candidateId", requireAuth, requireRole("admin", "hr", "recruiter"), h(async (req: AuthenticatedRequest, res) => {
  await requireBgvCandidateScope(req, req.params.candidateId);
  return res.json({ success: true, data: await getBgvStatusForCandidate(req.params.candidateId) });
}));

router.post("/candidates/:candidateId/verify/pan", requireAuth, requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res) => {
  await requireBgvCandidateScope(req, req.params.candidateId);
  return res.json({ success: true, data: await verifyPanForCandidate(req.params.candidateId, req.body, { actorType: "hr", actorId: req.authUser!.id }) });
}));

router.post("/candidates/:candidateId/verify/bank", requireAuth, requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res) => {
  await requireBgvCandidateScope(req, req.params.candidateId);
  return res.json({ success: true, data: await verifyBankForCandidate(req.params.candidateId, req.body, { actorType: "hr", actorId: req.authUser!.id }) });
}));

router.post("/candidates/:candidateId/manual-review", requireAuth, requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res) => {
  if (!req.body.remarks) return res.status(400).json({ success: false, message: "remarks required" });
  await requireBgvCandidateScope(req, req.params.candidateId);
  return res.json({ success: true, data: await manualReview(req.params.candidateId, req.body, req.authUser!.id) });
}));

router.post("/candidates/:candidateId/waive", requireAuth, requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res) => {
  if (!req.body.reason) return res.status(400).json({ success: false, message: "reason required" });
  await requireBgvCandidateScope(req, req.params.candidateId);
  return res.json({ success: true, data: await waiveCheck(req.params.candidateId, req.body, req.authUser!.id) });
}));

// ── BGV Report (HR-facing comprehensive report with document checklist + audit lock) ──
router.get("/report", requireAuth, requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res) => {
  const candidateId = String(req.query.candidateId ?? "");
  if (!candidateId) return res.status(400).json({ success: false, message: "candidateId required" });
  await requireBgvCandidateScope(req, candidateId);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT r.*, c.full_name AS candidate_name, c.candidate_code, c.mobile, c.email,
            b.branch_name, p.process_name
       FROM candidate_bgv_report r
       JOIN ats_candidate c ON c.id = r.candidate_id
       LEFT JOIN branch_master b ON b.id = c.applied_for_branch
       LEFT JOIN process_master p ON p.id = c.applied_for_process
      WHERE r.candidate_id = ? LIMIT 1`,
    [candidateId],
  );
  return res.json({ success: true, data: (rows as RowDataPacket[])[0] ?? null });
}));

router.post("/report", requireAuth, requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res) => {
  const { candidate_id, locked, ...fields } = req.body;
  if (!candidate_id) return res.status(400).json({ success: false, message: "candidate_id required" });
  await requireBgvCandidateScope(req, candidate_id);

  // Prevent updating a locked report
  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id, locked FROM candidate_bgv_report WHERE candidate_id = ? LIMIT 1`,
    [candidate_id],
  );
  if ((existing as RowDataPacket[])[0]?.locked) {
    return res.status(403).json({ success: false, message: "BGV report is locked and cannot be modified" });
  }

  const completedAt = locked ? new Date() : null;
  const completedBy = locked ? req.authUser!.id : null;

  await db.execute(
    `INSERT INTO candidate_bgv_report
       (candidate_id, photo_received, aadhaar_received, pan_received, passport_received,
        driving_license_received, edu_cert_received, prev_exp_received, bank_proof_received,
        offer_letter_received, box_file_no,
        aadhaar_status, aadhaar_name_match, aadhaar_remarks,
        pan_status, pan_name_match, pan_remarks,
        bank_status, bank_account_match, bank_remarks,
        education_status, education_remarks,
        employment_status, employment_remarks,
        address_status, address_remarks,
        criminal_status, criminal_remarks,
        esignature_status, esignature_remarks,
        overall_status, bgv_score, hr_remarks,
        completed_by, completed_at, locked)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       photo_received=VALUES(photo_received), aadhaar_received=VALUES(aadhaar_received),
       pan_received=VALUES(pan_received), passport_received=VALUES(passport_received),
       driving_license_received=VALUES(driving_license_received), edu_cert_received=VALUES(edu_cert_received),
       prev_exp_received=VALUES(prev_exp_received), bank_proof_received=VALUES(bank_proof_received),
       offer_letter_received=VALUES(offer_letter_received), box_file_no=VALUES(box_file_no),
       aadhaar_status=VALUES(aadhaar_status), aadhaar_name_match=VALUES(aadhaar_name_match), aadhaar_remarks=VALUES(aadhaar_remarks),
       pan_status=VALUES(pan_status), pan_name_match=VALUES(pan_name_match), pan_remarks=VALUES(pan_remarks),
       bank_status=VALUES(bank_status), bank_account_match=VALUES(bank_account_match), bank_remarks=VALUES(bank_remarks),
       education_status=VALUES(education_status), education_remarks=VALUES(education_remarks),
       employment_status=VALUES(employment_status), employment_remarks=VALUES(employment_remarks),
       address_status=VALUES(address_status), address_remarks=VALUES(address_remarks),
       criminal_status=VALUES(criminal_status), criminal_remarks=VALUES(criminal_remarks),
       esignature_status=VALUES(esignature_status), esignature_remarks=VALUES(esignature_remarks),
       overall_status=VALUES(overall_status), bgv_score=VALUES(bgv_score), hr_remarks=VALUES(hr_remarks),
       completed_by=IF(VALUES(locked)=1 AND locked=0, VALUES(completed_by), completed_by),
       completed_at=IF(VALUES(locked)=1 AND locked=0, VALUES(completed_at), completed_at),
       locked=IF(VALUES(locked)=1, 1, locked),
       updated_at=NOW()`,
    [
      candidate_id,
      fields.photo_received ? 1 : 0, fields.aadhaar_received ? 1 : 0, fields.pan_received ? 1 : 0,
      fields.passport_received ? 1 : 0, fields.driving_license_received ? 1 : 0, fields.edu_cert_received ? 1 : 0,
      fields.prev_exp_received ? 1 : 0, fields.bank_proof_received ? 1 : 0, fields.offer_letter_received ? 1 : 0,
      fields.box_file_no ?? null,
      fields.aadhaar_status ?? 'not_run', fields.aadhaar_name_match ?? null, fields.aadhaar_remarks ?? null,
      fields.pan_status ?? 'not_run', fields.pan_name_match ?? null, fields.pan_remarks ?? null,
      fields.bank_status ?? 'not_run', fields.bank_account_match ?? null, fields.bank_remarks ?? null,
      fields.education_status ?? 'not_run', fields.education_remarks ?? null,
      fields.employment_status ?? 'not_run', fields.employment_remarks ?? null,
      fields.address_status ?? 'not_run', fields.address_remarks ?? null,
      fields.criminal_status ?? 'not_run', fields.criminal_remarks ?? null,
      fields.esignature_status ?? 'not_done', fields.esignature_remarks ?? null,
      fields.overall_status ?? 'pending', fields.bgv_score ?? 0, fields.hr_remarks ?? null,
      completedBy, completedAt, locked ? 1 : 0,
    ],
  );
  return res.status(201).json({ success: true, message: locked ? "BGV report locked" : "BGV report saved" });
}));

// ── Vendor Dispatch (manual fallback when API BGV fails) ─────────────────────

router.get("/candidates/:candidateId/vendor-dispatches", requireAuth, requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res) => {
  await requireBgvCandidateScope(req, req.params.candidateId);
  return res.json({ success: true, data: await listVendorDispatches(req.params.candidateId) });
}));

router.post("/candidates/:candidateId/vendor-dispatch", requireAuth, requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res) => {
  const { checkType, checkId, vendorName, vendorContactEmail, vendorContactPhone, documentIds, dispatchNotes } = req.body;
  if (!checkType) return res.status(400).json({ success: false, message: "checkType required" });
  if (!vendorName) return res.status(400).json({ success: false, message: "vendorName required" });
  await requireBgvCandidateScope(req, req.params.candidateId);
  return res.status(201).json({
    success: true,
    data: await dispatchToVendor(req.params.candidateId, { checkType, checkId, vendorName, vendorContactEmail, vendorContactPhone, documentIds, dispatchNotes }, req.authUser!.id),
  });
}));

router.patch("/candidates/:candidateId/vendor-dispatch/:dispatchId/result", requireAuth, requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res) => {
  const { vendorResult, vendorReferenceNo, vendorRemarks, updateBgvCheck } = req.body;
  if (!vendorResult || !["verified", "not_verified", "inconclusive"].includes(vendorResult)) {
    return res.status(400).json({ success: false, message: "vendorResult must be verified | not_verified | inconclusive" });
  }
  await requireBgvCandidateScope(req, req.params.candidateId);
  return res.json({
    success: true,
    data: await updateVendorResult(req.params.candidateId, req.params.dispatchId, { vendorResult, vendorReferenceNo, vendorRemarks, updateBgvCheck: Boolean(updateBgvCheck) }, req.authUser!.id),
  });
}));

// ── BGV portal initiation (InfinitiAI candidate-portal flow) ──────────────────
// HR clicks "Initiate BGV via InfinitiAI" → backend calls InfinitiAI to create
// the candidate on their portal → InfinitiAI emails the candidate a login URL
// http://candidates.theinfiniti.ai/login/{token} to fill the BGV form themselves.
router.post("/report/initiate-portal", requireAuth, requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res) => {
  const { candidate_id } = req.body;
  if (!candidate_id) return res.status(400).json({ success: false, message: "candidate_id required" });
  await requireBgvCandidateScope(req, candidate_id);

  // Guard: already initiated
  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id, portal_status, locked FROM candidate_bgv_report WHERE candidate_id = ? LIMIT 1`,
    [candidate_id],
  );
  const existingRow = (existing as RowDataPacket[])[0];
  if (existingRow?.locked) {
    return res.status(403).json({ success: false, message: "BGV report is locked — cannot re-initiate portal" });
  }
  if (existingRow?.portal_status === 'initiated' || existingRow?.portal_status === 'candidate_submitted') {
    return res.status(409).json({ success: false, message: `Portal already ${existingRow.portal_status}. Use the existing portal link.` });
  }

  // Fetch candidate info needed by InfinitiAI
  const [candRows] = await db.execute<RowDataPacket[]>(
    `SELECT c.id, c.full_name, c.email, c.mobile, p.date_of_birth, p.father_name,
            CONCAT_WS(', ', pa.address_line1, pa.city, pa.state) AS address
       FROM ats_candidate c
       LEFT JOIN candidate_onboarding_profile p ON p.candidate_id = c.id
       LEFT JOIN candidate_onboarding_address pa ON pa.candidate_id = c.id AND pa.address_type = 'permanent' LIMIT 1
      WHERE c.id = ?`,
    [candidate_id],
  );
  const cand = (candRows as RowDataPacket[])[0];
  if (!cand) return res.status(404).json({ success: false, message: "Candidate not found" });

  const adapter = getBgvProviderAdapter();
  const result = await adapter.initiateCandidateBgv({
    candidateId: candidate_id,
    candidateName: String(cand.full_name ?? ""),
    email: String(cand.email ?? ""),
    mobile: cand.mobile ?? null,
    dateOfBirth: cand.date_of_birth ?? null,
    fatherName: cand.father_name ?? null,
    address: cand.address ?? null,
  });

  // Upsert bgv report row with portal fields
  await db.execute(
    `INSERT INTO candidate_bgv_report
       (candidate_id, infinity_ai_case_id, portal_initiated_at, portal_candidate_email,
        portal_login_url, portal_initiated_by, portal_status,
        photo_received, aadhaar_received, pan_received, passport_received,
        driving_license_received, edu_cert_received, prev_exp_received, bank_proof_received,
        offer_letter_received, box_file_no,
        aadhaar_status, pan_status, bank_status, education_status, employment_status,
        address_status, criminal_status, esignature_status,
        overall_status, bgv_score, locked)
     VALUES (?, ?, NOW(), ?, ?, ?, 'initiated',
             0, 0, 0, 0, 0, 0, 0, 0, 0, NULL,
             'not_run','not_run','not_run','not_run','not_run','not_run','not_run','not_done',
             'pending', 0, 0)
     ON DUPLICATE KEY UPDATE
       infinity_ai_case_id   = VALUES(infinity_ai_case_id),
       portal_initiated_at   = VALUES(portal_initiated_at),
       portal_candidate_email= VALUES(portal_candidate_email),
       portal_login_url      = VALUES(portal_login_url),
       portal_initiated_by   = VALUES(portal_initiated_by),
       portal_status         = IF(portal_status IN ('not_initiated','expired'), 'initiated', portal_status),
       updated_at            = NOW()`,
    [candidate_id, result.caseId, result.candidateEmail, result.portalLoginUrl, req.authUser!.id],
  );

  return res.status(201).json({
    success: true,
    message: `BGV portal initiated. Candidate will receive a login email at ${result.candidateEmail}.`,
    data: {
      caseId: result.caseId,
      portalLoginUrl: result.portalLoginUrl,
      candidateEmail: result.candidateEmail,
      expiresAt: result.expiresAt,
      providerKey: result.providerKey,
    },
  });
}));

export default router;
