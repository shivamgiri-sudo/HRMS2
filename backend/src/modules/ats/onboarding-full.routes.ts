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
import { resolveOnboardingDocumentFile } from "./onboardingDocumentPath.js";
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
  initiateCandidateESignByToken,
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
import { syncDigilockerStatus } from "../integrations/luckpay/luckpay-status.service.js";

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
      branchId: candidate.branch_id_resolved ? String(candidate.branch_id_resolved) : undefined,
      processId: candidate.process_id_resolved ? String(candidate.process_id_resolved) : undefined,
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

  // Resolve rather than trusting the stored path: a row written on another machine
  // or under a different working directory would otherwise be unreadable here. This
  // guards against that mismatch; it is not a recovery mechanism -- the documents
  // marked file_missing are genuinely absent from disk. See onboardingDocumentPath.
  const filePath = resolveOnboardingDocumentFile(doc.file_path);
  if (!filePath) {
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

/**
 * Rate-limit identity for candidate routes.
 *
 * Keying on IP was wrong twice over. A branch office NATs every candidate behind
 * one public address, so candidates onboarding at the same time ate each other's
 * budget; and one candidate's own journey legitimately issues far more writes than
 * the old 10/min cap allowed — a single pass through the form burned the budget at
 * the document step, after which bank, education, experience, family, statutory and
 * submit all failed with "Too many requests". Keying on the onboarding token scopes
 * the budget to one candidate, which is the unit we actually want to protect.
 */
function candidateRateKey(req: Request): string {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const token = String(body.token ?? req.query.token ?? "").trim();
  if (token) return `tok:${createHash("sha256").update(token).digest("hex").slice(0, 32)}`;
  return `ip:${req.ip ?? req.socket.remoteAddress ?? "unknown"}`;
}

const limiterValidate = { keyGeneratorIpFallback: false as const };

/** 120 reads/min per candidate — /status is refetched after every save. */
const candidateReadLimiter = rateLimit({
  windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false,
  keyGenerator: candidateRateKey, validate: limiterValidate,
  message: { success: false, message: "Too many requests, please slow down" },
});
/** 100 writes/min per candidate — abuse guard, not a brake on normal form use. */
const candidateWriteLimiter = rateLimit({
  windowMs: 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false,
  keyGenerator: candidateRateKey, validate: limiterValidate,
  message: { success: false, message: "Too many requests, please slow down" },
});
/**
 * 30 uploads/min per candidate. Mounted AFTER multer so req.body.token exists —
 * multipart fields are not parsed before it — which means the file is already on
 * disk when we reject, so the handler removes it rather than orphaning it.
 */
const candidateUploadLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  keyGenerator: candidateRateKey, validate: limiterValidate,
  handler: (req: Request, res: Response) => {
    const uploaded = (req as Request & { file?: { path?: string } }).file;
    if (uploaded?.path) fs.unlink(uploaded.path, () => { /* best effort */ });
    res.status(429).json({ success: false, message: "Too many uploads, please wait a moment and try again" });
  },
});
/** 10 submissions/min per candidate — retrying a failed submit must not lock them out. */
const candidateSubmitLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  keyGenerator: candidateRateKey, validate: limiterValidate,
  message: { success: false, message: "Too many submission attempts, please wait" },
});

// Use process.cwd() (always the backend/ working directory) instead of __dirname
// which resolves differently in dev (src/) vs production (dist/src/)
const uploadDir = path.resolve(process.cwd(), "private-storage/onboarding-documents");
fs.mkdirSync(uploadDir, { recursive: true });
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

router.post("/documents", upload.single("file"), candidateUploadLimiter, h(async (req, res) => {
  const token = String(req.body.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  if (!req.file) return res.status(400).json({ success: false, message: "file required" });
  return res.status(201).json({ success: true, data: await uploadOnboardingDocument(token, req.file, req.body, meta(req)) });
}));

router.delete("/documents/:documentId", candidateWriteLimiter, h(async (req, res) => {
  const token = String(req.query.token ?? req.body.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await deleteOnboardingDocument(token, req.params.documentId, meta(req)) });
}));

router.get("/documents/preview/:documentId", h(async (req, res) => streamOnboardingDocument(req as Request & Partial<AuthenticatedRequest>, res, "preview")));
router.get("/documents/:documentId/download", h(async (req, res) => streamOnboardingDocument(req as Request & Partial<AuthenticatedRequest>, res, "download")));

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
  const otpId = randomUUID();

  await db.execute(
    `INSERT INTO candidate_onboarding_otp (id, candidate_id, mobile, otp_hash, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
    [otpId, tokenData.candidate_id, mobile, otpHash]
  );

  // Send via BOTH SMS and email, always — not a fallback chain. Previously
  // tried SMS once and only sent email if SMS failed, so as long as SMS
  // failed for any reason (a transient provider error, a format quirk),
  // email silently took over and the candidate's phone got nothing.
  const { sendOnboardingOtp } = await import("./ats.otp.service.js");
  const deliveryResult = await sendOnboardingOtp({
    mobile,
    otp,
    candidateName: tokenData.full_name,
    email: tokenData.email
  });

  // The OTP itself is deliberately not logged. It was, in plaintext alongside
  // the mobile number, which put a working second factor into any log file,
  // log shipper or support screen-share for its full 10-minute life. Each
  // channel's outcome and error is what a failed delivery actually needs
  // diagnosing.
  console.info(
    `[OTP] Delivery for candidate ${tokenData.candidate_id}: ` +
    `SMS=${deliveryResult.smsSuccess ? 'sent' : `failed (${deliveryResult.smsError})`}, ` +
    `Email=${deliveryResult.emailSuccess ? 'sent' : `failed (${deliveryResult.emailError})`}`
  );

  if (!deliveryResult.success) {
    return res.status(500).json({
      success: false,
      message: "Failed to send OTP via SMS or email. Please try again or contact support."
    });
  }

  const channels = [
    deliveryResult.smsSuccess ? 'SMS' : null,
    deliveryResult.emailSuccess ? 'email' : null,
  ].filter(Boolean);

  return res.json({
    success: true,
    message: `OTP sent via ${channels.join(' and ')}`,
    smsDelivered: deliveryResult.smsSuccess,
    emailDelivered: deliveryResult.emailSuccess,
    maskedMobile: mobile.slice(-4).padStart(mobile.length, "*")
  });
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

  if (Number(record.attempts) >= Number(record.max_attempts)) {
    return res.status(429).json({ success: false, message: "Too many incorrect attempts. Please request a new OTP." });
  }

  await db.execute(`UPDATE candidate_onboarding_otp SET attempts = attempts + 1 WHERE id = ?`, [record.id]);

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
  return res.json({ success: true, data: await initiateCandidateESignByToken(token, documentId) });
}));

/**
 * Reconcile the candidate's DigiLocker session against Luckpay and pull the KYC
 * documents once complete. The provider does not reliably push a callback, so
 * the candidate app calls this when it returns from the hosted flow.
 */
router.post("/digilocker/sync", candidateWriteLimiter, h(async (req, res) => {
  const token = String(req.body.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  const tokenData = await validateOnboardingToken(token);
  const result = await syncDigilockerStatus(String(tokenData.candidate_id));
  // storedFiles are absolute server paths — never expose them to the candidate.
  const { storedFiles, ...safe } = result;
  return res.json({ success: true, data: { ...safe, documentsStored: storedFiles?.length ?? 0 } });
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

router.post("/candidate/:candidateId/digilocker/sync", requireAuth, requireRole("admin", "super_admin", "hr"), h(async (req: AuthenticatedRequest, res) => {
  await assertOnboardingCandidateScope(req, req.params.candidateId, ["hr"]);
  return res.json({ success: true, data: await syncDigilockerStatus(req.params.candidateId) });
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
// Rate limited like every other candidate write route. These two were the only
// unauthenticated, transactional, DELETE-first endpoints without a limiter, so
// an unthrottled caller holding a token could wipe and rewrite these rows freely.
router.post("/family-members", candidateWriteLimiter, h(async (req, res) => {
  const { token, members } = req.body;
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await saveFamilyMembers(token, members ?? []) });
}));

// POST /nominees — replace all nominee rows for a candidate
router.post("/nominees", candidateWriteLimiter, h(async (req, res) => {
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
