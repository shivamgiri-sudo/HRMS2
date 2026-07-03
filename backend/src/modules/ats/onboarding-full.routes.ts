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
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import {
  addQualification,
  checkBgvReadiness,
  deleteOnboardingDocument,
  getFullOnboardingByCandidate,
  getFullOnboardingStatus,
  getOnboardingBlockers,
  getOnboardingDocument,
  logOnboardingAuditAction,
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const meta = (req: Request) => ({ ip: req.ip, userAgent: req.get("user-agent") ?? undefined });

const candidateReadLimiter = rateLimit({
  windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: "Too many requests, please slow down" },
});
const candidateWriteLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: "Too many requests, please slow down" },
});
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
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error("Invalid file type. Allowed: PDF, JPG, PNG, WEBP"));
  },
});

const ADMIN_ROLES = new Set(["admin", "super_admin", "ceo"]);
const HR_ROLES = new Set(["hr", "branch_hr", "manager"]);
const PAYROLL_ROLES = new Set(["payroll", "payroll_hr"]);
const RECRUITER_ROLES = new Set(["recruiter"]);
const SENSITIVE_DOC_TYPES = [
  "aadhaar", "aadhar", "aadhaar_front", "aadhaar_back", "aadhar_front", "aadhar_back",
  "pan", "bank", "bank_proof", "cancelled_cheque", "cheque", "statutory", "pf_form11",
  "form11", "uan", "esic", "bgv", "court", "criminal", "address_proof", "address",
];
const PAYROLL_DOC_TYPES = ["pan", "bank", "bank_proof", "cancelled_cheque", "cheque", "pf_form11", "form11", "uan", "esic", "statutory"];

function roleOf(req: AuthenticatedRequest | Request): string {
  const user = (req as AuthenticatedRequest).authUser as any;
  return String(user?.role ?? user?.role_name ?? user?.roleCode ?? user?.role_code ?? "").toLowerCase();
}

function userIdOf(req: AuthenticatedRequest | Request): string | null {
  return String(((req as AuthenticatedRequest).authUser as any)?.id ?? "") || null;
}

function documentTypeOf(doc: any): string {
  return String(doc?.doc_type ?? doc?.document_type ?? doc?.doc_name ?? doc?.file_original_name ?? "").toLowerCase().replace(/\s+/g, "_");
}

function includesDocType(docType: string, tokens: string[]): boolean {
  return tokens.some((token) => docType === token || docType.includes(token));
}

async function runRequireAuth(req: Request, res: Response): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) => {
      requireAuth(req as any, res as any, (err?: any) => err ? reject(err) : resolve());
    });
    return true;
  } catch {
    return false;
  }
}

async function hasCandidateScope(req: AuthenticatedRequest, candidateId: string): Promise<boolean> {
  const role = roleOf(req);
  if (ADMIN_ROLES.has(role)) return true;

  const userId = userIdOf(req);
  if (!userId) return false;

  const scoped = await buildScopeWhereClause(
    userId,
    ["hr", "branch_hr", "manager", "recruiter", "payroll_hr", "payroll"],
    { branchId: "c.applied_for_branch", processId: "c.applied_for_process" },
    { allowCeoAllRead: true }
  );

  if (!scoped?.sql) return false;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.id FROM ats_candidate c WHERE c.id = ? AND (${scoped.sql}) LIMIT 1`,
    [candidateId, ...(scoped.params ?? [])]
  );
  return rows.length > 0;
}

async function canAccessOnboardingDocument(
  req: Request,
  doc: any,
  action: "preview" | "download",
  tokenData?: any
): Promise<{ allowed: boolean; reason?: string; actorId?: string | null }> {
  const docCandidateId = String(doc?.candidate_id ?? "");
  const docType = documentTypeOf(doc);
  const isSensitive = includesDocType(docType, SENSITIVE_DOC_TYPES);
  const isPayrollDoc = includesDocType(docType, PAYROLL_DOC_TYPES);

  if (tokenData) {
    if (String(tokenData.candidate_id) !== docCandidateId) {
      return { allowed: false, reason: "Candidate token does not match this document" };
    }
    return { allowed: true, actorId: String(tokenData.candidate_id) };
  }

  const authReq = req as AuthenticatedRequest;
  const role = roleOf(authReq);
  const actorId = userIdOf(authReq);
  if (!actorId || !role) return { allowed: false, reason: "Authentication required" };

  if (ADMIN_ROLES.has(role)) return { allowed: true, actorId };

  const inScope = await hasCandidateScope(authReq, docCandidateId);
  if (!inScope) return { allowed: false, reason: "Candidate is outside your branch/process scope" };

  if (HR_ROLES.has(role)) return { allowed: true, actorId };

  if (PAYROLL_ROLES.has(role)) {
    return isPayrollDoc
      ? { allowed: true, actorId }
      : { allowed: false, reason: "Payroll users can access payroll-relevant onboarding documents only" };
  }

  if (RECRUITER_ROLES.has(role)) {
    if (action === "download") return { allowed: false, reason: "Recruiters cannot download onboarding documents" };
    return !isSensitive
      ? { allowed: true, actorId }
      : { allowed: false, reason: "Recruiters cannot access sensitive onboarding documents" };
  }

  return { allowed: false, reason: "Role is not authorized for onboarding documents" };
}

async function auditDocumentAccess(doc: any, action: string, req: Request, actorId: string | null, allowed: boolean, reason?: string) {
  await logOnboardingAuditAction(String(doc.candidate_id), action, {
    section: doc.doc_type ?? "document",
    remarks: `${allowed ? "Allowed" : "Denied"}: ${doc.file_original_name ?? doc.id}${reason ? ` — ${reason}` : ""}`,
    performedBy: actorId,
    ipAddress: req.ip,
  });
}

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

router.get("/documents/preview/:documentId", h(async (req, res) => {
  const token = String(req.query.token ?? "");
  const doc = await getOnboardingDocument(req.params.documentId);
  if (!doc) return res.status(404).json({ success: false, message: "Document not found" });

  let tokenData: any | undefined;
  if (token) {
    try { tokenData = await validateOnboardingToken(token); }
    catch { return res.status(401).json({ success: false, message: "Invalid or expired token" }); }
  } else {
    const authenticated = await runRequireAuth(req, res);
    if (!authenticated) return res.status(401).json({ success: false, message: "Authentication required" });
  }

  const decision = await canAccessOnboardingDocument(req, doc, "preview", tokenData);
  await auditDocumentAccess(doc, decision.allowed ? "DOCUMENT_VIEW" : "DOCUMENT_VIEW_DENIED", req, decision.actorId ?? null, decision.allowed, decision.reason);
  if (!decision.allowed) return res.status(403).json({ success: false, message: decision.reason ?? "Not authorized to view this document" });

  const filePath = doc.file_path as string;
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ success: false, message: "File not found on disk" });

  const mime = doc.mime_type || "application/octet-stream";
  const name = doc.file_original_name || `document-${req.params.documentId}`;
  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Disposition", `inline; filename=\"${name}\"`);
  res.setHeader("Cache-Control", "private, max-age=300");
  fs.createReadStream(filePath).pipe(res);
}));

router.get("/documents/:documentId/download", requireAuth, requireRole("admin", "super_admin", "hr", "payroll", "payroll_hr"), h(async (req: AuthenticatedRequest, res) => {
  const doc = await getOnboardingDocument(req.params.documentId);
  if (!doc) return res.status(404).json({ success: false, message: "Document not found" });

  const decision = await canAccessOnboardingDocument(req, doc, "download");
  await auditDocumentAccess(doc, decision.allowed ? "DOCUMENT_DOWNLOAD" : "DOCUMENT_DOWNLOAD_DENIED", req, decision.actorId ?? req.authUser!.id, decision.allowed, decision.reason);
  if (!decision.allowed) return res.status(403).json({ success: false, message: decision.reason ?? "Not authorized to download this document" });

  const filePath = doc.file_path as string;
  if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ success: false, message: "File not found on disk" });

  const mime = doc.mime_type || "application/octet-stream";
  const name = doc.file_original_name || `document-${req.params.documentId}`;
  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Disposition", `attachment; filename=\"${name}\"`);
  res.setHeader("Cache-Control", "private, max-age=0, no-cache");
  fs.createReadStream(filePath).pipe(res);
}));

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

router.post("/otp/send", h(async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ success: false, message: "token required" });

  const tokenData = await validateOnboardingToken(token);
  const mobile = String(tokenData.mobile ?? "").replace(/\D/g, "");
  if (!mobile || mobile.length < 10) {
    return res.status(400).json({ success: false, message: "No valid mobile number on file for this candidate" });
  }

  const [recent] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM candidate_onboarding_otp
      WHERE candidate_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 10 MINUTE)`,
    [tokenData.candidate_id]
  );
  if ((recent[0] as any)?.cnt >= 3) {
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

  try {
    const { sendOnboardingOtp } = await import("./ats.email.service.js");
    await sendOnboardingOtp({ mobile, otp, candidateName: tokenData.full_name, email: tokenData.email });
  } catch {
    if (process.env.NODE_ENV !== "production") console.info(`[OTP-DEV] ${mobile.slice(-4)}: ${otp}`);
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

  const record = rows[0] as any;
  if (!record) return res.status(400).json({ success: false, message: "OTP expired or not found. Please request a new one." });

  await db.execute(`UPDATE candidate_onboarding_otp SET attempts = attempts + 1 WHERE id = ?`, [record.id]);

  if (Number(record.attempts) >= Number(record.max_attempts)) {
    return res.status(429).json({ success: false, message: "Too many incorrect attempts. Please request a new OTP." });
  }

  if (record.otp_hash !== otpHash) return res.status(400).json({ success: false, message: "Incorrect OTP" });

  await db.execute(`UPDATE candidate_onboarding_otp SET verified = 1, used_at = NOW() WHERE id = ?`, [record.id]);
  await db.execute(
    `UPDATE candidate_onboarding_profile SET otp_verified = 1, otp_verified_at = NOW(), otp_mobile = ? WHERE candidate_id = ?`,
    [mobile, tokenData.candidate_id]
  );

  return res.json({ success: true, message: "OTP verified" });
}));

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

router.get("/autosave/:candidateId", requireAuth, requireRole("admin", "super_admin", "hr", "payroll_hr"), h(async (req: AuthenticatedRequest, res) => {
  if (!await hasCandidateScope(req, req.params.candidateId)) return res.status(403).json({ success: false, message: "Candidate outside your scope" });
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT section, data_json, saved_at FROM candidate_onboarding_autosave WHERE candidate_id = ?`,
    [req.params.candidateId]
  );
  return res.json({ success: true, data: rows });
}));

router.post("/privacy-consent", h(async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await recordPrivacyConsent(token) });
}));

router.post("/languages", h(async (req, res) => {
  const { token, languages } = req.body;
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await saveLanguages(token, languages ?? []) });
}));

router.get("/requests", requireAuth, requireRole("admin", "super_admin", "hr", "manager", "payroll_hr"), h(async (req: AuthenticatedRequest, res) => {
  const branchId = String(req.query.branchId ?? req.query.branch_id ?? "").trim() || null;
  const processId = String(req.query.processId ?? req.query.process_id ?? "").trim() || null;
  const rows = await listFullOnboardingRequests({ branchId, processId });
  if (ADMIN_ROLES.has(roleOf(req))) return res.json({ success: true, data: rows });
  const scopedRows = [];
  for (const row of rows as any[]) {
    if (row?.candidate_id && await hasCandidateScope(req, String(row.candidate_id))) scopedRows.push(row);
  }
  return res.json({ success: true, data: scopedRows });
}));

router.get("/candidate/:candidateId", requireAuth, requireRole("admin", "super_admin", "hr", "manager", "payroll_hr"), h(async (req: AuthenticatedRequest, res) => {
  if (!await hasCandidateScope(req, req.params.candidateId)) return res.status(403).json({ success: false, message: "Candidate outside your scope" });
  return res.json({ success: true, data: await getFullOnboardingByCandidate(req.params.candidateId) });
}));

router.patch("/candidate/:candidateId/review", requireAuth, requireRole("admin", "super_admin", "hr"), h(async (req: AuthenticatedRequest, res) => {
  if (!await hasCandidateScope(req, req.params.candidateId)) return res.status(403).json({ success: false, message: "Candidate outside your scope" });
  return res.json({ success: true, data: await reviewFullOnboarding(req.params.candidateId, req.body, req.authUser!.id) });
}));

router.patch("/candidate/:candidateId/payroll-review", requireAuth, requireRole("admin", "super_admin", "payroll", "payroll_hr"), h(async (req: AuthenticatedRequest, res) => {
  if (!await hasCandidateScope(req, req.params.candidateId)) return res.status(403).json({ success: false, message: "Candidate outside your scope" });
  return res.json({ success: true, data: await payrollReviewFullOnboarding(req.params.candidateId, req.body, req.authUser!.id) });
}));

router.get("/candidate/:candidateId/bgv-readiness", requireAuth, requireRole("admin", "super_admin", "hr", "payroll", "payroll_hr"), h(async (req: AuthenticatedRequest, res) => {
  if (!await hasCandidateScope(req, req.params.candidateId)) return res.status(403).json({ success: false, message: "Candidate outside your scope" });
  return res.json({ success: true, data: await checkBgvReadiness(req.params.candidateId) });
}));

router.post("/family-members", h(async (req, res) => {
  const { token, members } = req.body;
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await saveFamilyMembers(token, members ?? []) });
}));

router.post("/nominees", h(async (req, res) => {
  const { token, nominees } = req.body;
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  return res.json({ success: true, data: await saveNominees(token, nominees ?? []) });
}));

router.get("/blockers", h(async (req, res) => {
  const token = String(req.query.token ?? "");
  if (!token) return res.status(400).json({ success: false, message: "token required" });
  const tokenData = await validateOnboardingToken(token);
  const blockers = await getOnboardingBlockers(String(tokenData.candidate_id));
  return res.json({ success: true, data: blockers });
}));

router.patch("/pf-opt-out-consent", h(async (req, res) => {
  const { token, elected } = req.body;
  if (!token || elected === undefined) return res.status(400).json({ success: false, message: "token and elected required" });
  return res.json({ success: true, data: await savePfOptOutConsent(token, { elected: Boolean(elected) }) });
}));

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
