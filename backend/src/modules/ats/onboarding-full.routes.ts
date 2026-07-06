import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { randomUUID, createHash } from "crypto";
import rateLimit from "express-rate-limit";

import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { hasScopedAccess, buildScopeWhereClause } from "../../shared/scopeAccess.js";
import { getUserRoleContext } from "../../shared/roleResolver.js";
import {
  addQualification,
  auditOnboardingDocumentAccess,
  canAccessOnboardingDocument,
  checkBgvReadiness,
  deleteOnboardingDocument,
  getFullOnboardingByCandidate,
  getLuckpayProviderRuntimeStatus,
  initiateCandidateDigilocker,
  initiateCandidateDigilockerByToken,
  initiateCandidateEsign,
  getOnboardingCandidateScope,
  getFullOnboardingStatus,
  getOnboardingBlockers,
  getOnboardingDocument,
  recordPrivacyConsent,
  listFullOnboardingRequests,
  payrollReviewFullOnboarding,
  reviewFullOnboarding,
  saveBankDetails,
  saveEmployeeDetails,
  saveExperienceDetails,
  saveFamilyDetails,
  saveFamilyMembers,
  saveFinalSection,
  saveLanguages,
  saveNominees,
  savePfOptOutConsent,
  saveProgress,
  saveStatutory,
  submitFullOnboarding,
  updateSectionStatus,
  uploadOnboardingDocument,
  validateOnboardingToken,
} from "./onboarding-full.service.js";

const router = Router();
type AsyncHandler = (req: Request, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: Request, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};
const meta = (req: Request) => ({ ip: req.ip, userAgent: req.get("user-agent") ?? undefined });
const ONBOARDING_SCOPE_ROLES = ["hr", "manager", "process_manager", "payroll_hr", "payroll", "recruiter"] as const;

interface CountRow extends RowDataPacket {
  cnt: number;
}

interface OnboardingOtpRow extends RowDataPacket {
  id: string;
  attempts: number;
  max_attempts: number;
  otp_hash: string;
}

async function assertOnboardingCandidateScope(req: AuthenticatedRequest, candidateId: string, scopedRoles: readonly string[] = ONBOARDING_SCOPE_ROLES) {
  const candidate = await getOnboardingCandidateScope(candidateId);
  if (!candidate) throw Object.assign(new Error("Candidate not found"), { statusCode: 404 });

  const allowed = await hasScopedAccess(
    req.authUser!.id,
    [...scopedRoles],
    {
      branchId: candidate.applied_for_branch ? String(candidate.applied_for_branch) : undefined,
      processId: candidate.applied_for_process ? String(candidate.applied_for_process) : undefined,
    },
    { allowAdminBypass: true, requireScopeForNonAdmin: true }
  );

  if (!allowed) {
    throw Object.assign(new Error("Forbidden for this branch/process scope"), { statusCode: 403 });
  }

  return candidate;
}

function safeAttachmentName(value: unknown) {
  return String(value ?? "document").replace(/[\r\n"]/g, "_");
}

async function streamOnboardingDocument(
  req: Request & Partial<AuthenticatedRequest>,
  res: Response,
  mode: "preview" | "download"
) {
  const token = String(req.query.token ?? "");
  const doc = await getOnboardingDocument(req.params.documentId);
  if (!doc) return res.status(404).json({ success: false, message: "Document not found" });

  if (token) {
    try {
      const tokenData = await validateOnboardingToken(token);
      const access = await canAccessOnboardingDocument({
        candidateTokenData: tokenData,
        document: doc as Record<string, unknown>,
        action: mode,
      });
      if (!access.allowed) {
        await auditOnboardingDocumentAccess(doc as Record<string, unknown>, mode === "download" ? "DOWNLOAD_DOCUMENT_DENIED" : "PREVIEW_DOCUMENT_DENIED", {
          ...meta(req),
          actorType: "candidate",
        });
        return res.status(403).json({ success: false, message: access.reason ?? "Access denied" });
      }
      await auditOnboardingDocumentAccess(doc, mode === "download" ? "DOWNLOAD_DOCUMENT" : "PREVIEW_DOCUMENT", {
        ...meta(req),
        actorType: "candidate",
      });
    } catch {
      return res.status(401).json({ success: false, message: "Invalid or expired token" });
    }
  } else {
    let authorized = false;
    let authError: unknown = null;
    await requireAuth(req as AuthenticatedRequest, res, (err?: unknown) => {
      authError = err ?? null;
      authorized = true;
    });
    if (authError) throw authError;
    if (!authorized) return;

    const authUser = (req as AuthenticatedRequest).authUser;
    if (!authUser?.id) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const { roleKeys } = await getUserRoleContext(authUser.id);
    const access = await canAccessOnboardingDocument({
      user: { ...authUser, roleKeys },
      document: doc as Record<string, unknown>,
      action: mode,
    });
    if (!access.allowed) {
      await auditOnboardingDocumentAccess(doc as Record<string, unknown>, mode === "download" ? "DOWNLOAD_DOCUMENT_DENIED" : "PREVIEW_DOCUMENT_DENIED", {
        ...meta(req),
        actorType: "hr",
        actorId: authUser.id,
        roleKeys,
      });
      return res.status(403).json({ success: false, message: access.reason ?? "Access denied" });
    }

    await auditOnboardingDocumentAccess(doc, mode === "download" ? "DOWNLOAD_DOCUMENT" : "PREVIEW_DOCUMENT", {
      ...meta(req),
      actorType: "hr",
      actorId: authUser.id,
      roleKeys,
    });
  }

  const filePath = String(doc.file_path ?? "");
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: "File not found on disk" });
  }

  res.setHeader("Content-Type", String(doc.mime_type ?? "application/octet-stream"));
  res.setHeader(
    "Content-Disposition",
    `${mode === "download" ? "attachment" : "inline"}; filename="${safeAttachmentName(doc.file_original_name ?? `document-${req.params.documentId}`)}"`
  );
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return fs.createReadStream(filePath).pipe(res);
}

/** 60 req/min per IP — general candidate onboarding read/write */
const candidateReadLimiter = rateLimit({
  windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: "Too many requests, please slow down" },
});
/** 10 req/min per IP — document upload, submit, and sensitive operations */
const candidateWriteLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: "Too many requests, please slow down" },
});
/** 5 req/min per IP — submission endpoint */
const candidateSubmitLimiter = rateLimit({
  windowMs: 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: "Too many submission attempts, please wait" },
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.resolve(__dirname, "../../../private-storage/onboarding-documents");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".pdf", ".jpg", ".jpeg", ".png", ".webp"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) { cb(null, true); } else { cb(new Error("Invalid file type. Allowed: PDF, JPG, PNG, WEBP")); }
  },
});

// Public token-driven candidate routes. Mount this BEFORE requireAuth in ats.routes.ts.
router.get("/validate-token", candidateReadLimiter, h(async (req, res) => {
  const token = String(req.query.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await validateOnboardingToken(token) });
}));

router.get("/status", candidateReadLimiter, h(async (req, res) => {
  const token = String(req.query.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await getFullOnboardingStatus(token) });
}));

router.post("/employee-details", candidateWriteLimiter, h(async (req, res) => {
  const { token, ...input } = req.body;
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await saveEmployeeDetails(token, input, meta(req)) });
}));

router.post("/bank-details", candidateWriteLimiter, h(async (req, res) => {
  const { token, ...input } = req.body;
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await saveBankDetails(token, input, meta(req)) });
}));

router.post("/qualification", candidateWriteLimiter, h(async (req, res) => {
  const { token, ...input } = req.body;
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.status(201).json({ success: true, data: await addQualification(token, input, meta(req)) });
}));

router.post("/family", candidateWriteLimiter, h(async (req, res) => {
  const { token, ...input } = req.body;
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await saveFamilyDetails(token, input, meta(req)) });
}));

router.post("/experience", candidateWriteLimiter, h(async (req, res) => {
  const { token, ...input } = req.body;
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await saveExperienceDetails(token, input, meta(req)) });
}));

router.post("/final-section", candidateWriteLimiter, h(async (req, res) => {
  const { token, ...input } = req.body;
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await saveFinalSection(token, input, meta(req)) });
}));

router.post("/documents", candidateWriteLimiter, upload.single("file"), h(async (req, res) => {
  const token = String(req.body.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  if (!req.file) return res.status(400).json({ success: false, message: "file required" });
  return res.status(201).json({ success: true, data: await uploadOnboardingDocument(token, req.file, req.body, meta(req)) });
}));

router.delete("/documents/:documentId", candidateWriteLimiter, h(async (req, res) => {
  const token = String(req.body.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await deleteOnboardingDocument(token, req.params.documentId, meta(req)) });
}));

router.get("/documents/preview/:documentId", h(async (req, res) => streamOnboardingDocument(req, res, "preview")));
router.get("/documents/:documentId/download", h(async (req, res) => streamOnboardingDocument(req, res, "download")));

router.post("/progress", candidateWriteLimiter, h(async (req, res) => {
  const token = String(req.body.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  const stepIdx = Number(req.body.stepIdx ?? req.body.step_idx ?? 0);
  return res.json({ success: true, data: await saveProgress(token, stepIdx) });
}));

router.post("/submit", candidateSubmitLimiter, h(async (req, res) => {
  const token = String(req.body.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  const geo = { submit_lat: req.body.submit_lat ?? null, submit_lng: req.body.submit_lng ?? null };
  return res.json({ success: true, data: await submitFullOnboarding(token, { ...meta(req), ...geo }) });
}));

router.post("/statutory", candidateWriteLimiter, h(async (req, res) => {
  const { token, ...input } = req.body;
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await saveStatutory(token, input) });
}));

// ── OTP routes ────────────────────────────────────────────────────────────────
router.post("/otp/send", h(async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ success: false, message: "token required" });

  const tokenData = await validateOnboardingToken(token);
  const mobile = String(tokenData.mobile ?? "").replace(/\D/g, "");
  if (!mobile || mobile.length < 10) {
    return res.status(400).json({ success: false, message: "No valid mobile number on file for this candidate" });
  }

  // Rate limit: max 3 sends per candidate per 10 min
  const [recent] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM candidate_onboarding_otp
      WHERE candidate_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 10 MINUTE)`,
    [tokenData.candidate_id]
  );
  const recentRow = recent[0] as CountRow | undefined;
  if ((recentRow?.cnt ?? 0) >= 3) {
    return res.status(429).json({ success: false, message: "Too many OTP requests. Please wait 10 minutes." });
  }

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const otpHash = createHash("sha256").update(otp + mobile).digest("hex");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  const otpId = randomUUID();

  await db.execute(
    `INSERT INTO candidate_onboarding_otp (id, candidate_id, mobile, otp_hash, expires_at) VALUES (?, ?, ?, ?, ?)`,
    [otpId, tokenData.candidate_id, mobile, otpHash, expiresAt]
  );

  // Send via SMTP (SMS gateway or email fallback)
  try {
    const { sendOnboardingOtp } = await import("./ats.email.service.js");
    await sendOnboardingOtp({ mobile, otp, candidateName: tokenData.full_name, email: tokenData.email });
  } catch (_e) {
    // Non-fatal in dev — log otp for debugging
    console.info(`[OTP-DEV] ${mobile}: ${otp}`);
  }

  return res.json({ success: true, message: "OTP sent", maskedMobile: mobile.slice(-4).padStart(mobile.length, "*") });
}));

router.post("/otp/verify", h(async (req, res) => {
  const { token, otp } = req.body;
  if (!token || !otp) return res.status(400).json({ success: false, message: "token and otp required" });

  const tokenData = await validateOnboardingToken(token);
  const mobile = String(tokenData.mobile ?? "").replace(/\D/g, "");
  const otpHash = createHash("sha256").update(String(otp) + mobile).digest("hex");

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM candidate_onboarding_otp
      WHERE candidate_id = ? AND verified = 0 AND expires_at > NOW()
      ORDER BY created_at DESC LIMIT 1`,
    [tokenData.candidate_id]
  );

  const record = rows[0] as OnboardingOtpRow | undefined;
  if (!record) return res.status(400).json({ success: false, message: "OTP expired or not found. Please request a new one." });

  await db.execute(`UPDATE candidate_onboarding_otp SET attempts = attempts + 1 WHERE id = ?`, [record.id]);

  if (Number(record.attempts) >= Number(record.max_attempts)) {
    return res.status(429).json({ success: false, message: "Too many incorrect attempts. Please request a new OTP." });
  }

  if (record.otp_hash !== otpHash) {
    return res.status(400).json({ success: false, message: "Incorrect OTP" });
  }

  await db.execute(`UPDATE candidate_onboarding_otp SET verified = 1, used_at = NOW() WHERE id = ?`, [record.id]);
  await db.execute(
    `UPDATE candidate_onboarding_profile SET otp_verified = 1, otp_verified_at = NOW(), otp_mobile = ? WHERE candidate_id = ?`,
    [mobile, tokenData.candidate_id]
  );

  return res.json({ success: true, message: "OTP verified" });
}));

// ── Autosave route ────────────────────────────────────────────────────────────
router.post("/autosave", h(async (req, res) => {
  const { token, section, data } = req.body;
  if (!token || !section) return res.status(400).json({ success: false, message: "token and section required" });

  const tokenData = await validateOnboardingToken(token);

  await db.execute(
    `INSERT INTO candidate_onboarding_autosave (id, candidate_id, section, data_json, saved_at)
     VALUES (UUID(), ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE data_json = VALUES(data_json), saved_at = NOW()`,
    [tokenData.candidate_id, section, JSON.stringify(data ?? {})]
  );

  return res.json({ success: true, savedAt: new Date().toISOString() });
}));

router.get("/autosave/:candidateId", requireAuth, requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT section, data_json, saved_at FROM candidate_onboarding_autosave WHERE candidate_id = ?`,
    [req.params.candidateId]
  );
  return res.json({ success: true, data: rows });
}));

// ── Privacy consent route ──────────────────────────────────────────────────────
router.post("/privacy-consent", h(async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await recordPrivacyConsent(token) });
}));

router.post("/digilocker/initiate", candidateWriteLimiter, h(async (req, res) => {
  const token = String(req.body.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await initiateCandidateDigilockerByToken(token) });
}));

router.post("/esign/initiate", candidateWriteLimiter, h(async (req, res) => {
  const token = String(req.body.token ?? "");
  const documentId = String(req.body.documentId ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  if (!documentId) return res.status(400).json({ success: false, message: "documentId required" });
  return res.json({ success: true, data: await initiateCandidateEsign(token, documentId) });
}));

// ── Language proficiency route ────────────────────────────────────────────────
router.post("/languages", h(async (req, res) => {
  const { token, languages } = req.body;
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await saveLanguages(token, languages ?? []) });
}));

// ── HR/BGV/Admin review routes ────────────────────────────────────────────────
router.get("/requests", requireAuth, requireRole("admin", "super_admin", "hr", "manager", "payroll_hr"), h(async (req: AuthenticatedRequest, res) => {
  const scoped = await buildScopeWhereClause(
    req.authUser!.id,
    ["hr", "manager", "process_manager", "payroll_hr"],
    { branchId: "c.applied_for_branch", processId: "c.applied_for_process" },
    { allowAdminBypass: true }
  );
  return res.json({ success: true, data: await listFullOnboardingRequests(scoped) });
}));

router.get("/candidate/:candidateId", requireAuth, requireRole("admin", "super_admin", "hr", "manager", "payroll_hr"), h(async (req: AuthenticatedRequest, res) => {
  await assertOnboardingCandidateScope(req, req.params.candidateId, ["hr", "manager", "process_manager", "payroll_hr"]);
  const scoped = await buildScopeWhereClause(
    req.authUser!.id,
    ["hr", "manager", "process_manager", "payroll_hr"],
    { branchId: "c.applied_for_branch", processId: "c.applied_for_process" },
    { allowAdminBypass: true }
  );
  const { roleKeys } = await getUserRoleContext(req.authUser!.id);
  return res.json({ success: true, data: await getFullOnboardingByCandidate(req.params.candidateId, { viewerRoleKeys: roleKeys, scopeFilter: scoped }) });
}));

router.patch("/candidate/:candidateId/review", requireAuth, requireRole("admin", "super_admin", "hr"), h(async (req: AuthenticatedRequest, res) => {
  await assertOnboardingCandidateScope(req, req.params.candidateId, ["hr"]);
  const scoped = await buildScopeWhereClause(
    req.authUser!.id,
    ["hr"],
    { branchId: "c.applied_for_branch", processId: "c.applied_for_process" },
    { allowAdminBypass: true }
  );
  return res.json({ success: true, data: await reviewFullOnboarding(req.params.candidateId, req.body, req.authUser!.id, scoped) });
}));

router.patch("/candidate/:candidateId/payroll-review", requireAuth, requireRole("admin", "super_admin", "payroll_hr", "payroll"), h(async (req: AuthenticatedRequest, res) => {
  await assertOnboardingCandidateScope(req, req.params.candidateId, ["payroll_hr", "payroll"]);
  const scoped = await buildScopeWhereClause(
    req.authUser!.id,
    ["payroll_hr", "payroll"],
    { branchId: "c.applied_for_branch", processId: "c.applied_for_process" },
    { allowAdminBypass: true }
  );
  return res.json({ success: true, data: await payrollReviewFullOnboarding(req.params.candidateId, req.body, req.authUser!.id, scoped) });
}));

router.get("/candidate/:candidateId/bgv-readiness", requireAuth, requireRole("admin", "super_admin", "hr", "payroll_hr", "payroll"), h(async (req: AuthenticatedRequest, res) => {
  await assertOnboardingCandidateScope(req, req.params.candidateId, ["hr", "payroll_hr", "payroll"]);
  return res.json({ success: true, data: await checkBgvReadiness(req.params.candidateId) });
}));

router.post("/candidate/:candidateId/digilocker/initiate", requireAuth, requireRole("admin", "super_admin", "hr"), h(async (req: AuthenticatedRequest, res) => {
  await assertOnboardingCandidateScope(req, req.params.candidateId, ["hr"]);
  return res.json({
    success: true,
    data: await initiateCandidateDigilocker(req.params.candidateId, {
      initiatedBy: req.authUser!.id,
      initiatedByType: "hr",
    }),
  });
}));

router.post("/candidate/:candidateId/esign/initiate", requireAuth, requireRole("admin", "super_admin", "hr"), h(async (req: AuthenticatedRequest, res) => {
  await assertOnboardingCandidateScope(req, req.params.candidateId, ["hr"]);
  return res.json({
    success: true,
    data: await initiateCandidateEsign(req.params.candidateId, req.body ?? {}, {
      initiatedBy: req.authUser!.id,
      initiatedByType: "hr",
    }),
  });
}));

router.get("/provider-status", requireAuth, requireRole("admin", "super_admin", "hr"), h(async (_req: AuthenticatedRequest, res) => {
  return res.json({ success: true, data: getLuckpayProviderRuntimeStatus() });
}));

// ── New routes added by migration 298 ────────────────────────────────────────

// POST /family-members — replace all family member rows for a candidate
router.post("/family-members", h(async (req, res) => {
  const { token, members } = req.body;
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await saveFamilyMembers(token, members ?? []) });
}));

// POST /nominees — replace all nominee rows for a candidate
router.post("/nominees", h(async (req, res) => {
  const { token, nominees } = req.body;
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await saveNominees(token, nominees ?? []) });
}));

// GET /blockers?token=... — list submission blockers for a candidate
router.get("/blockers", h(async (req, res) => {
  const token = String(req.query.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  const tokenData = await validateOnboardingToken(token);
  const blockers = await getOnboardingBlockers(String(tokenData.candidate_id));
  return res.json({ success: true, data: blockers });
}));

// PATCH /pf-opt-out-consent — candidate records Form 11 PF opt-out election
router.patch("/pf-opt-out-consent", h(async (req, res) => {
  const { token, elected } = req.body;
  if (!token || elected === undefined) return res.status(400).json({ success: false, message: "token and elected required" });
  return res.json({ success: true, data: await savePfOptOutConsent(token, { elected: Boolean(elected) }) });
}));

// PUT /section-status — upsert section completion for a candidate
router.put("/section-status", h(async (req, res) => {
  const { token, section, isComplete } = req.body;
  if (!token || !section) return res.status(400).json({ success: false, message: "token and section required" });
  const tokenData = await validateOnboardingToken(token);
  return res.json({
    success: true,
    data: await updateSectionStatus(String(tokenData.candidate_id), String(section), Boolean(isComplete)),
  });
}));

export default router;
