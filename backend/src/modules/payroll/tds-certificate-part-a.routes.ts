import { Router } from "express";
import { randomUUID, createHash } from "crypto";
import path from "path";
import fs from "fs";
import multer from "multer";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { hasAnyRole } from "../../shared/scopeAccess.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import { registerUpload, issueDownloadToken } from "../document-vault/documentVault.service.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import {
  getPartAAvailability,
  recordPartA,
  verifyPartA,
} from "./tds-certificate-part-a.service.js";

/**
 * Part A of the salary TDS certificate — upload, verify, read, download.
 *
 * Part A is issued by TRACES from the quarterly return; it cannot be generated
 * here, so this ingests it. The three-step shape is deliberate:
 *
 *   upload   payroll files the TRACES PDF against an employee and year
 *   verify   payroll confirms it is the right document for that person
 *   read     the employee sees it, but only once verified
 *
 * Uploading and verifying are separate because a misfiled certificate is easy
 * to produce and impossible for an employee to detect — they would simply see
 * someone else's tax figures presented as their own.
 */

export const tdsCertificatePartARouter = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

tdsCertificatePartARouter.use(requireAuth);

/** Roles that may file and verify certificates on someone else's behalf. */
const PAYROLL_ROLES = ["admin", "super_admin", "payroll_head", "payroll", "payroll_hr", "finance"] as const;

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");

// TRACES issues Part A as a PDF. Accepting images invites a photographed
// screen, which cannot be checked against the digital signature that makes the
// certificate verifiable in the first place.
const ALLOWED_EXT = new Set([".pdf"]);

const partAStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(UPLOADS_ROOT, "tds-certificates");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
  },
});

const partAUpload = multer({
  storage: partAStorage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXT.has(ext)) cb(null, true);
    else cb(new Error(`Part A must be a PDF as issued by TRACES; received ${ext || "no extension"}`));
  },
});

function parseFinancialYear(raw: unknown): number | null {
  const year = Number(raw);
  return Number.isInteger(year) && year >= 1900 && year <= 2999 ? year : null;
}

/**
 * POST /:employeeId/:financialYear — file a TRACES Part A.
 *
 * Stored in the document vault rather than as a loose path, so the access
 * level, download tokens and access logging that already exist apply to it.
 */
tdsCertificatePartARouter.post(
  "/:employeeId/:financialYear",
  requireRole(...PAYROLL_ROLES),
  (req: any, res: any, next: any) => {
    partAUpload.single("file")(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
      }
      if (err) return res.status(400).json({ success: false, message: (err as Error).message });
      return next();
    });
  },
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { employeeId } = req.params;
    const financialYear = parseFinancialYear(req.params.financialYear);
    if (financialYear === null) {
      return res.status(400).json({ success: false, message: "financialYear must be a four-digit year, e.g. 2026 for FY 2026-27" });
    }

    const file = (req as unknown as { file?: Express.Multer.File }).file;
    if (!file) return res.status(400).json({ success: false, message: "A PDF file is required" });

    // Hash the stored bytes so a re-upload of the identical document is
    // detectable, and so the vault row can prove what was filed.
    const sha256 = createHash("sha256").update(fs.readFileSync(file.path)).digest("hex");

    const vaultDocumentId = await registerUpload({
      uploadedByUser: req.authUser!.id,
      category: "tds_certificate_part_a",
      storedFilename: path.basename(file.path),
      originalFilename: file.originalname,
      mimeType: file.mimetype,
      fileSizeBytes: file.size,
      sha256Hash: sha256,
      // A tax certificate carries PAN, salary and deposited tax; payroll is the
      // narrowest level that still lets payroll staff administer it.
      accessLevel: "payroll",
      ownerEmployeeId: employeeId,
    });

    const { id, formNumber } = await recordPartA({
      employeeId,
      financialYear,
      vaultDocumentId,
      storedFilename: path.basename(file.path),
      storageCategory: "tds-certificates",
      uploadedBy: req.authUser!.id,
      certificateNumber: typeof req.body?.certificate_number === "string" ? req.body.certificate_number.trim() : null,
      coversQuarters: typeof req.body?.covers_quarters === "string" ? req.body.covers_quarters.trim() : null,
      notes: typeof req.body?.notes === "string" ? req.body.notes.trim() : null,
    });

    void logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "TDS_PART_A_UPLOADED",
      module_key: "payroll",
      entity_type: "tds_certificate_part_a",
      entity_id: id,
      change_summary: { employeeId, financialYear, formNumber, vaultDocumentId },
      req,
    });

    return res.status(201).json({
      success: true,
      data: { id, financial_year: financialYear, form_number: formNumber, verified: false },
      message: `Form ${formNumber} Part A filed. It must be verified before the employee can see it.`,
    });
  }),
);

/**
 * POST /:employeeId/:financialYear/verify — confirm the document is the right one.
 *
 * Separate from upload on purpose: an employee cannot tell a misfiled
 * certificate from their own, so a second, deliberate act stands between the
 * two.
 */
tdsCertificatePartARouter.post(
  "/:employeeId/:financialYear/verify",
  requireRole(...PAYROLL_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { employeeId } = req.params;
    const financialYear = parseFinancialYear(req.params.financialYear);
    if (financialYear === null) {
      return res.status(400).json({ success: false, message: "financialYear must be a four-digit year" });
    }

    const ok = await verifyPartA(employeeId, financialYear, req.authUser!.id);
    if (!ok) {
      return res.status(404).json({ success: false, message: "No Part A on file for this employee and year" });
    }

    void logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "TDS_PART_A_VERIFIED",
      module_key: "payroll",
      entity_type: "tds_certificate_part_a",
      entity_id: `${employeeId}:${financialYear}`,
      change_summary: { employeeId, financialYear },
      req,
    });

    return res.json({ success: true, data: { employee_id: employeeId, financial_year: financialYear, verified: true } });
  }),
);

/**
 * Resolve who the caller may act for.
 *
 * Payroll roles act on anyone; everyone else only on themselves, resolved from
 * their own employee record rather than from a URL they control.
 */
async function resolveAccess(req: AuthenticatedRequest, targetEmployeeId: string) {
  if (await hasAnyRole(req.authUser!.id, ...PAYROLL_ROLES)) return { allowed: true, privileged: true };
  const own = await getEmployeeForUser(req.authUser!.id);
  return { allowed: Boolean(own && own.id === targetEmployeeId), privileged: false };
}

/** GET /:employeeId/:financialYear — status of a year's Part A. */
tdsCertificatePartARouter.get(
  "/:employeeId/:financialYear",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { employeeId } = req.params;
    const financialYear = parseFinancialYear(req.params.financialYear);
    if (financialYear === null) {
      return res.status(400).json({ success: false, message: "financialYear must be a four-digit year" });
    }

    const access = await resolveAccess(req, employeeId);
    if (!access.allowed) {
      return res.status(403).json({ success: false, message: "Forbidden: not your certificate" });
    }

    const availability = await getPartAAvailability(employeeId, financialYear);
    return res.json({ success: true, data: availability });
  }),
);

/**
 * POST /:employeeId/:financialYear/download-token — short-lived download grant.
 *
 * Returns a token the existing file route consumes, so this inherits the access
 * logging and expiry that already protect vault documents instead of streaming
 * a tax certificate from a fresh, unaudited code path.
 */
tdsCertificatePartARouter.post(
  "/:employeeId/:financialYear/download-token",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { employeeId } = req.params;
    const financialYear = parseFinancialYear(req.params.financialYear);
    if (financialYear === null) {
      return res.status(400).json({ success: false, message: "financialYear must be a four-digit year" });
    }

    const access = await resolveAccess(req, employeeId);
    if (!access.allowed) {
      return res.status(403).json({ success: false, message: "Forbidden: not your certificate" });
    }

    const availability = await getPartAAvailability(employeeId, financialYear);

    // getPartAAvailability withholds the vault id until verified, so an
    // unverified certificate cannot be downloaded even by payroll here — the
    // way to release it is to verify it, which is a recorded act.
    if (!availability.verified || !availability.vaultDocumentId) {
      return res.status(409).json({
        success: false,
        message: availability.message,
        data: { status: availability.status },
      });
    }

    const token = await issueDownloadToken({
      vaultItemId: availability.vaultDocumentId,
      issuedTo: req.authUser!.id,
      issuedFor: employeeId,
      purpose: `tds_part_a_fy_${financialYear}`,
      ttlMinutes: 15,
      maxUses: 3,
    });

    void logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "TDS_PART_A_DOWNLOAD_TOKEN_ISSUED",
      module_key: "payroll",
      entity_type: "tds_certificate_part_a",
      entity_id: `${employeeId}:${financialYear}`,
      change_summary: { employeeId, financialYear, self: !access.privileged },
      req,
    });

    return res.json({
      success: true,
      data: {
        token: token.rawToken,
        expires_at: token.expiresAt.toISOString(),
        // Ready to use: the client appends the token and the existing file
        // route consumes it, so the certificate is never streamed from a fresh,
        // unaudited path.
        download_url: `${availability.downloadPath}?token=${encodeURIComponent(token.rawToken)}`,
        certificate_number: availability.certificateNumber,
        form_number: availability.expectedFormNumber,
      },
    });
  }),
);
