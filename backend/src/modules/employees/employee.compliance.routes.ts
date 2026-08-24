import { randomUUID } from "crypto";
import { applyEpfKycAndRegenerate } from "./epfKycCapture.service.js";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { Router } from "express";
import multer from "multer";
import type { NextFunction, Request, Response } from "express";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

import { env } from "../../config/env.js";
import { db } from "../../db/mysql.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { buildScopeWhereClause, hasAnyRole } from "../../shared/scopeAccess.js";
import {
  createJoiningDocumentEsignRequest,
  createPublicTokenForEpfReview,
  deleteJoiningDocumentFile,
  generateJoiningDocumentChecklist,
  getChecklistDocumentFileForAccess,
  getJoiningDocumentFileForAccess,
  getJoiningDocumentEsignStatus,
  syncJoiningDocumentEsign,
  getPublicJoiningDocumentDraftFile,
  getJoiningDocumentPack,
  getPublicJoiningDocumentEsignSession,
  handleJoiningDocumentEsignWebhook,
  listJoiningDocumentTemplates,
  resolveEmployeeDocumentAccessContext,
  reviewJoiningDocument,
  updateJoiningDocumentChecklistStatus,
  upsertJoiningDocumentTemplate,
  uploadJoiningDocument,
} from "./employeeJoiningDocuments.service.js";
import {
  ensureDefaultTemplateFieldMaps,
  employeeReviewChecklistByToken,
  generateChecklistDraft,
  getChecklistFieldReview,
  inspectChecklistAcroFormTemplate,
  listTemplateFieldMaps,
  manualFillChecklistValues,
  replaceTemplateFieldMaps,
  seedFieldMapsFromSchema,
  synchronizeChecklistFieldValues,
} from "./universalDigitalFormFill.service.js";
import { validateEpfCompliance } from "./epfComplianceValidation.service.js";
import {
  buildPublicTokenAuditValue,
  hashIdentifier,
  maskAadhaar,
  maskPan,
  maskUan,
  sanitizeEpfAuditRecord,
  verifyLuckpayWebhookSecret,
} from "./employeeCompliancePrivacy.js";

const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });
import { TEMPLATE_STORAGE_ROOT, toStorableTemplatePath } from "./joiningDocumentTemplatePath.js";
const EPF_REVIEW_CONSENT_TEXT = "Please verify your EPF details. These details will be used for EPFO compliance, UAN/KYC processing, nomination, payroll PF deduction, and statutory filing.";
const EPF_FORM_CODES = ["FORM_11", "FORM_2", "KYC_DECLARATION", "PF_ELIGIBILITY_SHEET", "HR_PAYROLL_PF_CHECKLIST", "MISSING_DATA_ALERT", "ECR_READINESS"] as const;

function templateMimeFromName(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".html" || ext === ".htm") return "text/html";
  return "application/octet-stream";
}

async function logEpfAudit(input: {
  employeeId: string;
  profileId?: string | null;
  actionType: string;
  actorUserId?: string | null;
  actorType?: "employee" | "hr" | "payroll" | "system" | "public_token";
  remarks?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  await db.execute(
    `INSERT INTO employee_epf_audit_log
       (id, profile_id, employee_id, action_type, actor_user_id, actor_type, remarks, old_value, new_value, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      input.profileId ?? null,
      input.employeeId,
      input.actionType,
      input.actorUserId ?? null,
      input.actorType ?? "system",
      input.remarks ?? null,
      input.oldValue ? JSON.stringify(input.oldValue) : null,
      input.newValue ? JSON.stringify(input.newValue) : null,
      input.ipAddress ?? null,
      input.userAgent ?? null,
    ],
  );
}

type EpfValidationSummary = {
  ready_for_submission?: boolean;
  ecr_ready?: boolean;
  missing_fields?: unknown[];
  issues?: Array<{ severity?: string }>;
};

type EpfProfileRow = Record<string, unknown> & {
  id?: string;
  status?: string;
  compliance_stage?: string;
  last_submitted_at?: string | null;
};

function epfFormPayloads(profile: Record<string, unknown>, nominees: Array<Record<string, unknown>>, validation: EpfValidationSummary | null, ecr: Record<string, unknown> | null) {
  return {
    FORM_11: {
      employee_name: profile.employee_name ?? null,
      father_or_spouse_name: profile.father_or_spouse_name ?? null,
      date_of_birth: profile.date_of_birth ?? null,
      joining_date: profile.joining_date ?? null,
      previous_pf_member: Boolean(profile.previous_pf_member),
      previous_eps_member: Boolean(profile.previous_eps_member),
      uan_masked: profile.uan_masked ?? null,
    },
    FORM_2: {
      employee_name: profile.employee_name ?? null,
      nominees: nominees.map((nominee) => ({
        nominee_name: nominee.nominee_name ?? null,
        relationship: nominee.relationship ?? null,
        share_percentage: nominee.share_percentage ?? 0,
        guardian_name: nominee.guardian_name ?? null,
      })),
    },
    KYC_DECLARATION: {
      employee_name: profile.employee_name ?? null,
      aadhaar_masked: profile.aadhaar_masked ?? null,
      pan_masked: profile.pan_masked ?? null,
      personal_email: profile.personal_email ?? null,
      mobile_number: profile.mobile_number ?? null,
    },
    PF_ELIGIBILITY_SHEET: {
      gross_monthly_wage: profile.gross_monthly_wage ?? null,
      basic_wage: profile.basic_wage ?? null,
      excluded_employee: Boolean(profile.excluded_employee),
      previous_pf_member: Boolean(profile.previous_pf_member),
      previous_eps_member: Boolean(profile.previous_eps_member),
    },
    HR_PAYROLL_PF_CHECKLIST: {
      ready_for_submission: Boolean(validation?.ready_for_submission),
      ecr_ready: Boolean(validation?.ecr_ready),
      missing_fields: validation?.missing_fields ?? [],
      issue_count: Array.isArray(validation?.issues) ? validation.issues.length : 0,
    },
    MISSING_DATA_ALERT: {
      missing_fields: validation?.missing_fields ?? [],
      blockers: Array.isArray(validation?.issues) ? validation.issues.filter((issue) => issue.severity === "error") : [],
    },
    ECR_READINESS: {
      ecr_status: ecr?.ecr_status ?? "pending",
      blocked_reason: ecr?.blocked_reason ?? null,
      missing_fields: ecr?.missing_fields ?? validation?.missing_fields ?? [],
    },
  } as const;
}

function epfFormStatus(formCode: string, profileStatus: string, validation: EpfValidationSummary | null) {
  if (profileStatus === "payroll_approved") return "approved";
  if (profileStatus === "correction_requested") return "pushback";
  if (profileStatus === "employee_review_pending") return "employee_review_pending";
  if (formCode === "MISSING_DATA_ALERT") return (validation?.missing_fields?.length ?? 0) > 0 ? "draft" : "approved";
  if (formCode === "ECR_READINESS") return validation?.ecr_ready ? "ready" : "draft";
  return validation?.ready_for_submission ? "ready" : "draft";
}

async function upsertEpfFormInstances(params: {
  employeeId: string;
  profile: EpfProfileRow;
  nominees: Array<Record<string, unknown>>;
  validation: EpfValidationSummary | null;
  ecr: Record<string, unknown> | null;
  actorUserId: string;
}) {
  const payloads = epfFormPayloads(params.profile, params.nominees, params.validation, params.ecr);
  for (const formCode of EPF_FORM_CODES) {
    await db.execute(
      `INSERT INTO employee_epf_form_instance
         (id, employee_id, profile_id, form_code, version_code, status, form_payload, submitted_at, approved_at, approved_by)
       VALUES (UUID(), ?, ?, ?, 'v1', ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         profile_id = VALUES(profile_id),
         status = VALUES(status),
         form_payload = VALUES(form_payload),
         submitted_at = VALUES(submitted_at),
         approved_at = VALUES(approved_at),
         approved_by = VALUES(approved_by),
         updated_at = NOW()`,
      [
        params.employeeId,
        params.profile.id,
        formCode,
        epfFormStatus(formCode, String(params.profile.status ?? "draft"), params.validation),
        JSON.stringify(payloads[formCode]),
        params.profile.last_submitted_at ?? null,
        String(params.profile.status ?? "") === "payroll_approved" ? new Date() : null,
        String(params.profile.status ?? "") === "payroll_approved" ? params.actorUserId : null,
      ],
    );
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT form_code, version_code, status, form_payload, submitted_at, approved_at
       FROM employee_epf_form_instance
      WHERE employee_id = ?
      ORDER BY form_code ASC`,
    [params.employeeId],
  );
  return rows;
}

async function buildConsentReceiptPdf(input: {
  profile: Record<string, unknown>;
  receipt: Record<string, unknown>;
}) {
  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 42, size: "A4" });
    doc.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text("EPF Consent Receipt", { align: "center" });
    doc.moveDown();
    doc.fontSize(11).text(`Employee: ${input.profile.employee_name ?? "Employee"}`);
    doc.text(`Employee ID: ${input.profile.employee_id ?? ""}`);
    doc.text(`Consent Version: ${input.receipt.consent_version ?? "v1"}`);
    doc.text(`Confirmed By: ${input.receipt.consented_by_name ?? "Employee"}`);
    doc.text(`Confirmed At: ${input.receipt.consented_at ? new Date(String(input.receipt.consented_at)).toLocaleString("en-IN") : "N/A"}`);
    doc.text(`Aadhaar: ${input.profile.aadhaar_masked ?? "Not provided"}`);
    doc.text(`PAN: ${input.profile.pan_masked ?? "Not provided"}`);
    doc.text(`UAN: ${input.profile.uan_masked ?? "Not provided"}`);
    doc.moveDown();
    doc.font("Helvetica-Bold").text("Consent Notice");
    doc.font("Helvetica").text(String(input.receipt.consent_text ?? EPF_REVIEW_CONSENT_TEXT), { align: "justify" });
    doc.moveDown();
    doc.font("Helvetica-Bold").text("Purpose");
    doc.font("Helvetica").text("EPF compliance, UAN/KYC processing, payroll PF deduction, nomination, statutory filing, ECR readiness, and statutory audit.", { align: "justify" });
    doc.end();
  });
}

async function ensureEpfProfile(employeeId: string, actorUserId: string) {
  const access = await resolveEmployeeDocumentAccessContext(actorUserId, employeeId);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM employee_epf_compliance_profile WHERE employee_id = ? LIMIT 1`,
    [employeeId],
  );
  const existing = rows[0];
  if (existing) return { access, profile: existing };

  const [result] = await db.execute(
    `INSERT INTO employee_epf_compliance_profile
       (id, employee_id, candidate_id, branch_id, process_id, employee_name, mobile_number, personal_email, joining_date, branch_name_snapshot, process_name_snapshot, status, compliance_stage)
     SELECT UUID(), e.id, ob.candidate_id, e.branch_id, e.process_id,
            COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))),
            e.mobile,
            COALESCE(NULLIF(TRIM(e.official_email), ''), NULLIF(TRIM(e.office_email), ''), e.email),
            e.date_of_joining,
            b.branch_name,
            p.process_name,
            'draft',
            'profile_pending'
       FROM employees e
       LEFT JOIN ats_onboarding_bridge ob ON ob.employee_id = e.id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
      WHERE e.id = ?`,
    [employeeId],
  );
  const affectedRows = (result as { affectedRows?: number }).affectedRows ?? 0;
  if (affectedRows === 0) {
    const err = new Error("Unable to initialize EPF profile") as Error & { statusCode?: number };
    err.statusCode = 409;
    throw err;
  }
  const [profileRows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM employee_epf_compliance_profile WHERE employee_id = ? LIMIT 1`,
    [employeeId],
  );
  return { access, profile: profileRows[0] };
}

async function epfNominees(profileId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT *
       FROM employee_epf_nominee
      WHERE profile_id = ?
      ORDER BY is_primary DESC, created_at ASC`,
    [profileId],
  );
  return rows;
}

async function syncEpfValidation(employeeId: string, actorUserId: string) {
  const { access, profile } = await ensureEpfProfile(employeeId, actorUserId);
  const nominees = await epfNominees(String(profile.id));
  const summary = await validateEpfCompliance(
    employeeId,
    {
      employee_name: profile.employee_name,
      father_or_spouse_name: profile.father_or_spouse_name,
      relationship_type: profile.relationship_type,
      date_of_birth: profile.date_of_birth,
      gender: profile.gender,
      marital_status: profile.marital_status,
      mobile_number: profile.mobile_number,
      personal_email: profile.personal_email,
      aadhaar_number: profile.aadhaar_masked,
      pan_number: profile.pan_masked,
      uan_number: profile.uan_masked,
      previous_pf_member: Number(profile.previous_pf_member) === 1,
      previous_eps_member: Number(profile.previous_eps_member) === 1,
      international_worker: Number(profile.international_worker) === 1,
      excluded_employee: Number(profile.excluded_employee) === 1,
      joining_date: profile.joining_date,
      basic_wage: Number(profile.basic_wage ?? 0),
      gross_monthly_wage: Number(profile.gross_monthly_wage ?? 0),
    },
    nominees as Array<Record<string, unknown>>,
  );

  await db.execute(`DELETE FROM employee_epf_validation_result WHERE profile_id = ?`, [profile.id]);
  for (const issue of summary.issues) {
    await db.execute(
      `INSERT INTO employee_epf_validation_result
         (id, profile_id, employee_id, validation_code, severity, validation_status, message, field_name, validation_payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        profile.id,
        employeeId,
        issue.code,
        issue.severity,
        issue.status,
        issue.message,
        issue.field_name ?? null,
        issue.payload ? JSON.stringify(issue.payload) : null,
      ],
    );
  }

  await db.execute(
    `INSERT INTO employee_epf_ecr_readiness
       (id, employee_id, profile_id, ecr_status, missing_fields, blocked_reason, ready_at, last_checked_at, checked_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?)
     ON DUPLICATE KEY UPDATE
       profile_id = VALUES(profile_id),
       ecr_status = VALUES(ecr_status),
       missing_fields = VALUES(missing_fields),
       blocked_reason = VALUES(blocked_reason),
       ready_at = VALUES(ready_at),
       last_checked_at = NOW(),
       checked_by = VALUES(checked_by)`,
    [
      randomUUID(),
      employeeId,
      profile.id,
      summary.ecr_ready ? "ready" : "pending",
      JSON.stringify(summary.missing_fields),
      summary.ready_for_submission ? null : summary.issues.filter((issue) => issue.severity === "error").map((issue) => issue.message).join("; "),
      summary.ecr_ready ? new Date() : null,
      actorUserId,
    ],
  );

  await db.execute(
    `UPDATE employee_epf_compliance_profile
        SET status = ?,
            compliance_stage = ?,
            uan_hash = COALESCE(?, uan_hash),
            aadhaar_hash = COALESCE(?, aadhaar_hash),
            pan_hash = COALESCE(?, pan_hash),
            uan_masked = COALESCE(?, uan_masked),
            aadhaar_masked = COALESCE(?, aadhaar_masked),
            pan_masked = COALESCE(?, pan_masked),
            updated_at = NOW()
      WHERE id = ?`,
    [
      ["employee_review_pending", "payroll_review_pending", "payroll_approved", "correction_requested"].includes(String(profile.status ?? ""))
        ? String(profile.status)
        : summary.ready_for_submission ? "draft" : "hr_fill_required",
      ["employee_review_pending", "payroll_review_pending", "payroll_approved", "correction_requested"].includes(String(profile.status ?? ""))
        ? String(profile.compliance_stage ?? summary.inferred_status)
        : summary.inferred_status,
      summary.uan_hash,
      summary.aadhaar_hash,
      summary.pan_hash,
      summary.uan_masked,
      summary.aadhaar_masked,
      summary.pan_masked,
      profile.id,
    ],
  );

  return {
    access,
    validation: summary,
  };
}

async function getEpfCompliancePack(employeeId: string, actorUserId: string) {
  await ensureEpfProfile(employeeId, actorUserId);
  const { validation } = await syncEpfValidation(employeeId, actorUserId);
  const [profileRows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM employee_epf_compliance_profile WHERE employee_id = ? LIMIT 1`,
    [employeeId],
  );
  const profile = profileRows[0];
  const nominees = await epfNominees(String(profile.id));
  const [validationRows] = await db.execute<RowDataPacket[]>(
    `SELECT validation_code, severity, validation_status, message, field_name, validation_payload, created_at
       FROM employee_epf_validation_result
      WHERE profile_id = ?
      ORDER BY created_at DESC`,
    [profile.id],
  );
  const [consentRows] = await db.execute<RowDataPacket[]>(
    `SELECT consented_by_name, consented_at
       FROM employee_epf_consent_receipt
      WHERE profile_id = ?
      ORDER BY consented_at DESC
      LIMIT 1`,
    [profile.id],
  );
  const [ecrRows] = await db.execute<RowDataPacket[]>(
    `SELECT ecr_status, missing_fields, blocked_reason, ready_at, last_checked_at
       FROM employee_epf_ecr_readiness
      WHERE employee_id = ?
      LIMIT 1`,
    [employeeId],
  );
  const ecr = ecrRows[0] ?? null;
  const forms = await upsertEpfFormInstances({
    employeeId,
    profile,
    nominees: nominees as Array<Record<string, unknown>>,
    validation,
    ecr,
    actorUserId,
  });
  return {
    profile,
    nominees,
    forms,
    validation,
    validation_rows: validationRows,
    consent_receipt: consentRows[0] ?? null,
    ecr,
  };
}

export const employeeJoiningDocumentsRouter = Router();

// Declared before requireAuth because the provider cannot present a session,
// so it must authenticate with the shared webhook secret instead. Without this
// check anyone able to guess a provider_reference_id could mark a document
// e-signed: the handler sets esign_completed, signature_mode
// 'aadhaar_esign_verified', and final_file_locked_at.
employeeJoiningDocumentsRouter.post("/:employeeId/joining-documents/esign/webhook/luckpay", h(async (req, res) => {
  if (!verifyLuckpayWebhookSecret(req.get("X-HRMS-Webhook-Secret"), env.LUCKPAY_WEBHOOK_SECRET)) {
    return res.status(401).json({ success: false, message: "Unauthorized webhook" });
  }
  const data = await handleJoiningDocumentEsignWebhook({
    payload: (req.body ?? {}) as Record<string, unknown>,
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? null,
  });
  return res.json({ success: true, data });
}));

employeeJoiningDocumentsRouter.use(requireAuth);

employeeJoiningDocumentsRouter.get("/:employeeId/joining-documents", h(async (req: AuthenticatedRequest, res) => {
  const data = await getJoiningDocumentPack(req.params.employeeId, req.authUser!.id);
  return res.json({ success: true, data });
}));

employeeJoiningDocumentsRouter.post("/:employeeId/joining-documents/generate-checklist", h(async (req: AuthenticatedRequest, res) => {
  const data = await generateJoiningDocumentChecklist(req.params.employeeId, req.authUser!.id);
  return res.status(201).json({ success: true, data });
}));

employeeJoiningDocumentsRouter.post("/:employeeId/joining-documents/checklist/:checklistId/upload", upload.single("file"), h(async (req: AuthenticatedRequest, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "file is required" });
  const data = await uploadJoiningDocument({
    employeeId: req.params.employeeId,
    checklistId: req.params.checklistId,
    file: req.file,
    actorUserId: req.authUser!.id,
      wetSigned: String(req.body?.wetSigned ?? req.body?.wet_signed ?? "").toLowerCase() === "true",
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? null,
  });
  return res.status(201).json({ success: true, data });
}));

employeeJoiningDocumentsRouter.post("/:employeeId/joining-documents/:checklistId/upload", upload.single("file"), h(async (req: AuthenticatedRequest, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "file is required" });
  const data = await uploadJoiningDocument({
    employeeId: req.params.employeeId,
    checklistId: req.params.checklistId,
    file: req.file,
    actorUserId: req.authUser!.id,
      wetSigned: String(req.body?.wetSigned ?? req.body?.wet_signed ?? "").toLowerCase() === "true",
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? null,
  });
  return res.status(201).json({ success: true, data });
}));

employeeJoiningDocumentsRouter.patch("/:employeeId/joining-documents/checklist/:checklistId/review", h(async (req: AuthenticatedRequest, res) => {
  const decision = String(req.body.decision ?? "");
  if (decision !== "verified" && decision !== "needs_correction") {
    return res.status(400).json({ success: false, message: "decision must be verified or needs_correction" });
  }
  const data = await reviewJoiningDocument({
    employeeId: req.params.employeeId,
    checklistId: req.params.checklistId,
    actorUserId: req.authUser!.id,
    decision,
    remarks: req.body.remarks ?? null,
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? null,
  });
  return res.json({ success: true, data });
}));

employeeJoiningDocumentsRouter.patch("/:employeeId/joining-documents/:checklistId/verify", h(async (req: AuthenticatedRequest, res) => {
  const decision = String(req.body.decision ?? "verified");
  if (decision !== "verified" && decision !== "needs_correction") {
    return res.status(400).json({ success: false, message: "decision must be verified or needs_correction" });
  }
  const data = await reviewJoiningDocument({
    employeeId: req.params.employeeId,
    checklistId: req.params.checklistId,
    actorUserId: req.authUser!.id,
    decision,
    remarks: req.body.remarks ?? null,
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? null,
  });
  return res.json({ success: true, data });
}));

employeeJoiningDocumentsRouter.patch("/:employeeId/joining-documents/:checklistId/status", h(async (req: AuthenticatedRequest, res) => {
  const status = String(req.body?.status ?? "").trim();
  if (!status) return res.status(400).json({ success: false, message: "status is required" });
  const data = await updateJoiningDocumentChecklistStatus({
    employeeId: req.params.employeeId,
    checklistId: req.params.checklistId,
    actorUserId: req.authUser!.id,
    status,
    remarks: req.body?.remarks ?? null,
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? null,
  });
  return res.json({ success: true, data });
}));

employeeJoiningDocumentsRouter.post("/:employeeId/joining-documents/checklist/:checklistId/esign-link", h(async (req: AuthenticatedRequest, res) => {
  const data = await createJoiningDocumentEsignRequest({
    employeeId: req.params.employeeId,
    checklistId: req.params.checklistId,
    actorUserId: req.authUser!.id,
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? null,
  });
  return res.json({ success: true, data });
}));

employeeJoiningDocumentsRouter.post("/:employeeId/joining-documents/:checklistId/esign/initiate", h(async (req: AuthenticatedRequest, res) => {
  const data = await createJoiningDocumentEsignRequest({
    employeeId: req.params.employeeId,
    checklistId: req.params.checklistId,
    actorUserId: req.authUser!.id,
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? null,
  });
  return res.json({ success: true, data });
}));

employeeJoiningDocumentsRouter.get("/:employeeId/joining-documents/files/:fileId/preview", h(async (req: AuthenticatedRequest, res) => {
  const file = await getJoiningDocumentFileForAccess({
    fileId: req.params.fileId,
    actorUserId: req.authUser!.id,
    action: "preview",
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? null,
  });
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${file.fileName.replace(/"/g, "")}"`);
  fs.createReadStream(file.storagePath).pipe(res);
}));

employeeJoiningDocumentsRouter.get("/:employeeId/joining-documents/files/:fileId/download", h(async (req: AuthenticatedRequest, res) => {
  const file = await getJoiningDocumentFileForAccess({
    fileId: req.params.fileId,
    actorUserId: req.authUser!.id,
    action: "download",
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? null,
  });
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${file.fileName.replace(/"/g, "")}"`);
  fs.createReadStream(file.storagePath).pipe(res);
}));

employeeJoiningDocumentsRouter.get("/:employeeId/joining-documents/:checklistId/preview", h(async (req: AuthenticatedRequest, res) => {
  const file = await getChecklistDocumentFileForAccess({
    employeeId: req.params.employeeId,
    checklistId: req.params.checklistId,
    actorUserId: req.authUser!.id,
    action: "preview",
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? null,
  });
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${file.fileName.replace(/"/g, "")}"`);
  fs.createReadStream(file.storagePath).pipe(res);
}));

employeeJoiningDocumentsRouter.get("/:employeeId/joining-documents/:checklistId/download", h(async (req: AuthenticatedRequest, res) => {
  const file = await getChecklistDocumentFileForAccess({
    employeeId: req.params.employeeId,
    checklistId: req.params.checklistId,
    actorUserId: req.authUser!.id,
    action: "download",
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? null,
  });
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${file.fileName.replace(/"/g, "")}"`);
  fs.createReadStream(file.storagePath).pipe(res);
}));

employeeJoiningDocumentsRouter.get("/:employeeId/joining-documents/checklist/:checklistId/review", h(async (req: AuthenticatedRequest, res) => {
  await resolveEmployeeDocumentAccessContext(req.authUser!.id, req.params.employeeId);
  await synchronizeChecklistFieldValues(req.params.checklistId, req.authUser!.id);
  const data = await getChecklistFieldReview(req.params.checklistId);
  return res.json({ success: true, data });
}));

employeeJoiningDocumentsRouter.put("/:employeeId/joining-documents/checklist/:checklistId/review", h(async (req: AuthenticatedRequest, res) => {
  const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];
  const data = await manualFillChecklistValues({
    checklistId: req.params.checklistId,
    actorUserId: req.authUser!.id,
    updates,
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? null,
  });
  return res.json({ success: true, data });
}));

employeeJoiningDocumentsRouter.post("/:employeeId/joining-documents/checklist/:checklistId/generate-draft", h(async (req: AuthenticatedRequest, res) => {
  await resolveEmployeeDocumentAccessContext(req.authUser!.id, req.params.employeeId);
  const data = await generateChecklistDraft(req.params.checklistId, req.authUser!.id);
  return res.json({ success: true, data });
}));

employeeJoiningDocumentsRouter.get("/:employeeId/joining-documents/checklist/:checklistId/acroform/inspect", h(async (req: AuthenticatedRequest, res) => {
  await resolveEmployeeDocumentAccessContext(req.authUser!.id, req.params.employeeId);
  const data = await inspectChecklistAcroFormTemplate(req.params.checklistId);
  return res.json({ success: true, data });
}));

employeeJoiningDocumentsRouter.get("/:employeeId/joining-documents/:checklistId/esign/status", h(async (req: AuthenticatedRequest, res) => {
  const data = await getJoiningDocumentEsignStatus({
    employeeId: req.params.employeeId,
    checklistId: req.params.checklistId,
    actorUserId: req.authUser!.id,
  });
  return res.json({ success: true, data });
}));

/**
 * Pull the signed artefact from the provider for a transaction that is still open.
 *
 * Luckpay does not reliably push a completion callback, so a document can sit at
 * 'esign_initiated' indefinitely after the employee has genuinely signed. This is
 * the manual counterpart to the reconciliation worker.
 */
employeeJoiningDocumentsRouter.post("/:employeeId/joining-documents/:checklistId/esign/sync", h(async (req: AuthenticatedRequest, res) => {
  const data = await syncJoiningDocumentEsign({
    employeeId: req.params.employeeId,
    checklistId: req.params.checklistId,
    actorUserId: req.authUser!.id,
  });
  return res.json({ success: true, data });
}));

employeeJoiningDocumentsRouter.delete("/:employeeId/joining-documents/:checklistId/files/:fileId", h(async (req: AuthenticatedRequest, res) => {
  const data = await deleteJoiningDocumentFile({
    employeeId: req.params.employeeId,
    checklistId: req.params.checklistId,
    fileId: req.params.fileId,
    actorUserId: req.authUser!.id,
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? null,
  });
  return res.json({ success: true, data });
}));

employeeJoiningDocumentsRouter.get("/:employeeId/epf-compliance", h(async (req: AuthenticatedRequest, res) => {
  const data = await getEpfCompliancePack(req.params.employeeId, req.authUser!.id);
  return res.json({ success: true, data });
}));

employeeJoiningDocumentsRouter.get("/:employeeId/epf-compliance/consent-receipt", h(async (req: AuthenticatedRequest, res) => {
  const { profile } = await ensureEpfProfile(req.params.employeeId, req.authUser!.id);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT consent_version, consent_text, consented_by_name, consented_at
       FROM employee_epf_consent_receipt
      WHERE profile_id = ?
      ORDER BY consented_at DESC
      LIMIT 1`,
    [profile.id],
  );
  const receipt = rows[0];
  if (!receipt) {
    return res.status(404).json({ success: false, message: "Consent receipt is not available yet." });
  }
  const pdf = await buildConsentReceiptPdf({ profile, receipt });
  await logEpfAudit({
    employeeId: req.params.employeeId,
    profileId: String(profile.id),
    actionType: "EPF_CONSENT_RECEIPT_DOWNLOADED",
    actorUserId: req.authUser!.id,
    actorType: "employee",
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? null,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="epf-consent-receipt-${req.params.employeeId}.pdf"`);
  return res.send(pdf);
}));

/**
 * Columns this endpoint may write, and how a submitted value is coerced.
 *
 * The update used to name all 34 unconditionally as `req.body.x ?? null`, so any
 * field the caller did not send was overwritten with NULL. The compliance screen
 * has inputs for barely half of them — nothing on it touches
 * previous_pf_account_number, ppo_number, passport_number, gender or
 * marital_status — so every save silently erased whatever was there, including
 * values written by an earlier caller that did send them. The request returned
 * success, and the audit log recorded the request body rather than the damage.
 *
 * Only keys actually present in the body are written now, which also makes the
 * endpoint safe for a partial save from a narrower screen.
 */
const EPF_PROFILE_BOOLEAN_COLUMNS = new Set([
  "previous_pf_member", "previous_eps_member", "international_worker",
  "specially_abled", "excluded_employee",
]);

const EPF_PROFILE_WRITABLE_COLUMNS = [
  "employee_name", "father_or_spouse_name", "relationship_type", "date_of_birth",
  "gender", "marital_status", "mobile_number", "personal_email",
  "previous_pf_member", "previous_pf_account_number", "previous_exit_date",
  "scheme_certificate_number", "ppo_number", "previous_eps_member",
  "international_worker", "country_of_origin", "passport_number",
  "passport_valid_from", "passport_valid_to", "education_qualification",
  "specially_abled", "disability_type", "aadhaar_name_as_per_kyc",
  "pan_name_as_per_kyc", "bank_verification_status", "pan_verification_status",
  "uan_verification_status", "excluded_employee", "joining_date",
  "basic_wage", "gross_monthly_wage",
] as const;

employeeJoiningDocumentsRouter.put("/:employeeId/epf-compliance/profile", h(async (req: AuthenticatedRequest, res) => {
  const { profile } = await ensureEpfProfile(req.params.employeeId, req.authUser!.id);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const sent = (key: string) => Object.prototype.hasOwnProperty.call(body, key);

  const sets: string[] = [];
  const params: unknown[] = [];
  for (const column of EPF_PROFILE_WRITABLE_COLUMNS) {
    if (!sent(column)) continue;
    sets.push(`${column} = ?`);
    // A boolean column still coerces, but only when the caller named it —
    // otherwise an absent flag would read as false and clear a real 1.
    params.push(EPF_PROFILE_BOOLEAN_COLUMNS.has(column) ? (body[column] ? 1 : 0) : body[column] ?? null);
  }

  // The masked identifiers accept either the raw or the pre-masked form, so they
  // are considered sent if either key appears.
  const masked: Array<[string, string[], (v: unknown) => unknown]> = [
    ["aadhaar_masked", ["aadhaar_number", "aadhaar_masked"], maskAadhaar],
    ["pan_masked", ["pan_number", "pan_masked"], maskPan],
    ["uan_masked", ["uan_number", "uan_masked"], maskUan],
  ];
  for (const [column, keys, mask] of masked) {
    if (!keys.some(sent)) continue;
    sets.push(`${column} = ?`);
    params.push(mask(body[keys[0]] ?? body[keys[1]] ?? null));
  }

  // Stage always advances, even for a save that changed nothing else.
  sets.push("status = 'draft'", "compliance_stage = 'profile_in_progress'", "updated_at = NOW()");
  params.push(profile.id);

  await db.execute(
    `UPDATE employee_epf_compliance_profile SET ${sets.join(", ")} WHERE id = ?`,
    params,
  );
  const { validation } = await syncEpfValidation(req.params.employeeId, req.authUser!.id);
  await logEpfAudit({
    employeeId: req.params.employeeId,
    profileId: String(profile.id),
    actionType: "EPF_PROFILE_UPDATED",
    actorUserId: req.authUser!.id,
    actorType: "hr",
    oldValue: sanitizeEpfAuditRecord(profile as Record<string, unknown>),
    newValue: sanitizeEpfAuditRecord((req.body ?? {}) as Record<string, unknown>),
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? null,
  });
  return res.json({ success: true, data: { validation, pack: await getEpfCompliancePack(req.params.employeeId, req.authUser!.id) } });
}));

employeeJoiningDocumentsRouter.put("/:employeeId/epf-compliance/nominees", h(async (req: AuthenticatedRequest, res) => {
  const { profile } = await ensureEpfProfile(req.params.employeeId, req.authUser!.id);
  const existingNominees = await epfNominees(String(profile.id));
  await db.execute(`DELETE FROM employee_epf_nominee WHERE profile_id = ?`, [profile.id]);
  const nominees = Array.isArray(req.body?.nominees) ? req.body.nominees : [];
  for (const nominee of nominees) {
    await db.execute(
      `INSERT INTO employee_epf_nominee
         (id, profile_id, employee_id, nominee_name, relationship, date_of_birth, share_percentage, guardian_name, guardian_relationship, aadhaar_last4, address_line, city, state, pincode, is_primary)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        profile.id,
        req.params.employeeId,
        nominee.nominee_name ?? null,
        nominee.relationship ?? null,
        nominee.date_of_birth ?? null,
        nominee.share_percentage ?? 0,
        nominee.guardian_name ?? null,
        nominee.guardian_relationship ?? null,
        nominee.aadhaar_last4 ?? null,
        nominee.address_line ?? null,
        nominee.city ?? null,
        nominee.state ?? null,
        nominee.pincode ?? null,
        nominee.is_primary ? 1 : 0,
      ],
    );
  }
  const { validation } = await syncEpfValidation(req.params.employeeId, req.authUser!.id);
  await logEpfAudit({
    employeeId: req.params.employeeId,
    profileId: String(profile.id),
    actionType: "EPF_NOMINEES_UPDATED",
    actorUserId: req.authUser!.id,
    actorType: "hr",
    oldValue: existingNominees,
    newValue: nominees,
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? null,
  });
  return res.json({ success: true, data: { validation, pack: await getEpfCompliancePack(req.params.employeeId, req.authUser!.id) } });
}));

employeeJoiningDocumentsRouter.post("/:employeeId/epf-compliance/submit", h(async (req: AuthenticatedRequest, res) => {
  const { profile } = await ensureEpfProfile(req.params.employeeId, req.authUser!.id);
  const { validation } = await syncEpfValidation(req.params.employeeId, req.authUser!.id);
  if (!validation.ready_for_submission) {
    return res.status(400).json({ success: false, message: "EPF compliance pack still has blocking validation errors.", data: validation });
  }
  await db.execute(
    `UPDATE employee_epf_compliance_profile
        SET status = 'employee_review_pending',
            compliance_stage = 'employee_review_pending',
            last_submitted_at = NOW(),
            correction_status = 'none',
            updated_at = NOW()
      WHERE id = ?`,
    [profile.id],
  );
  const reviewLink = await createPublicTokenForEpfReview({ employeeId: req.params.employeeId, actorUserId: req.authUser!.id });
  await logEpfAudit({
    employeeId: req.params.employeeId,
    profileId: String(profile.id),
    actionType: "EPF_SUBMITTED_FOR_EMPLOYEE_REVIEW",
    actorUserId: req.authUser!.id,
    actorType: "hr",
    newValue: { review_link: reviewLink.review_link },
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? null,
  });
  return res.json({ success: true, data: { reviewLink, pack: await getEpfCompliancePack(req.params.employeeId, req.authUser!.id) } });
}));

employeeJoiningDocumentsRouter.post("/:employeeId/epf-compliance/review-link", h(async (req: AuthenticatedRequest, res) => {
  const data = await createPublicTokenForEpfReview({ employeeId: req.params.employeeId, actorUserId: req.authUser!.id });
  const { profile } = await ensureEpfProfile(req.params.employeeId, req.authUser!.id);
  await logEpfAudit({
    employeeId: req.params.employeeId,
    profileId: String(profile.id),
    actionType: "EPF_REVIEW_LINK_CREATED",
    actorUserId: req.authUser!.id,
    actorType: "hr",
    newValue: buildPublicTokenAuditValue(),
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? null,
  });
  return res.json({ success: true, data });
}));

export const hrDocumentTemplatesRouter = Router();
hrDocumentTemplatesRouter.use(requireAuth, requireRole("admin", "super_admin", "hr", "payroll_hr", "payroll"));

hrDocumentTemplatesRouter.get("/document-templates", h(async (_req: AuthenticatedRequest, res) => {
  return res.json({ success: true, data: await listJoiningDocumentTemplates() });
}));

hrDocumentTemplatesRouter.put("/document-templates", h(async (req: AuthenticatedRequest, res) => {
  const body = req.body ?? {};
  const data = await upsertJoiningDocumentTemplate({
    id: body.id ?? null,
    actorUserId: req.authUser!.id,
    document_code: String(body.document_code ?? ""),
    document_name: String(body.document_name ?? ""),
    document_category: String(body.document_category ?? "other"),
    template_version: body.template_version ?? "v1",
    requires_candidate_esign: Boolean(body.requires_candidate_esign),
    requires_hr_upload: Boolean(body.requires_hr_upload),
    requires_hr_verification: body.requires_hr_verification !== false,
    is_mandatory: body.is_mandatory !== false,
    active_status: body.active_status !== false,
  });
  return res.json({ success: true, data });
}));

hrDocumentTemplatesRouter.post(
  "/document-templates/:templateId/upload",
  upload.fields([{ name: "template", maxCount: 1 }, { name: "file", maxCount: 1 }, { name: "schema", maxCount: 1 }]),
  h(async (req: AuthenticatedRequest, res) => {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const templateFile = files?.["template"]?.[0] ?? files?.["file"]?.[0];
    const schemaFile = files?.["schema"]?.[0];
    if (!templateFile) return res.status(400).json({ success: false, message: "template file is required" });

    const fillMode = String(req.body?.fill_mode ?? "placeholder");
    fs.mkdirSync(TEMPLATE_STORAGE_ROOT, { recursive: true });
    const ext = path.extname(templateFile.originalname).toLowerCase() || ".bin";
    const storedName = `${req.params.templateId}-${Date.now()}${ext}`;
    const storagePath = path.join(TEMPLATE_STORAGE_ROOT, storedName);
    fs.writeFileSync(storagePath, templateFile.buffer);

    const schemaFilename = schemaFile?.originalname ?? null;
    let parsedSchema: unknown = null;
    if (schemaFile) {
      try { parsedSchema = JSON.parse(schemaFile.buffer.toString("utf8")); } catch { /* ignore bad JSON */ }
    }

    await db.execute(
      `UPDATE employee_joining_document_template
          SET template_storage_path = ?,
              template_mime_type = ?,
              fill_mode = ?,
              template_schema_json = COALESCE(?, template_schema_json),
              template_schema_filename = COALESCE(?, template_schema_filename),
              updated_at = NOW()
        WHERE id = ?`,
      [
        // Store the file name, not an absolute path. Persisting the absolute path
        // put a developer's "C:\Users\...\document-templates\..." into the shared
        // database, which no Linux server can resolve — that is what silently
        // disabled joining-document e-signing for every template.
        toStorableTemplatePath(storagePath),
        templateMimeFromName(templateFile.originalname),
        fillMode,
        parsedSchema ? JSON.stringify(parsedSchema) : null,
        schemaFilename,
        req.params.templateId,
      ],
    );

    const [templateRows] = await db.execute<RowDataPacket[]>(
      `SELECT document_code FROM employee_joining_document_template WHERE id = ? LIMIT 1`,
      [req.params.templateId],
    );
    const documentCode = String(templateRows[0]?.document_code ?? "");

    if (documentCode) {
      if (parsedSchema && typeof parsedSchema === "object" && Array.isArray((parsedSchema as any).fields)) {
        await seedFieldMapsFromSchema(req.params.templateId, documentCode, parsedSchema as any, req.authUser!.id);
      } else {
        await ensureDefaultTemplateFieldMaps({
          templateId: req.params.templateId,
          documentCode,
          actorUserId: req.authUser!.id,
          fileName: templateFile.originalname,
          fileBuffer: templateFile.buffer,
        });
      }
    }

    return res.json({ success: true, data: await listJoiningDocumentTemplates() });
  }),
);

hrDocumentTemplatesRouter.get("/document-templates/:templateId/field-map", h(async (req: AuthenticatedRequest, res) => {
  const documentCode = String(req.query.documentCode ?? req.query.document_code ?? "");
  if (!documentCode) return res.status(400).json({ success: false, message: "documentCode is required" });
  return res.json({ success: true, data: await listTemplateFieldMaps(req.params.templateId, documentCode) });
}));

hrDocumentTemplatesRouter.put("/document-templates/:templateId/field-map", h(async (req: AuthenticatedRequest, res) => {
  const documentCode = String(req.body?.document_code ?? "");
  if (!documentCode) return res.status(400).json({ success: false, message: "document_code is required" });
  const maps = Array.isArray(req.body?.maps) ? req.body.maps : [];
  const data = await replaceTemplateFieldMaps(req.params.templateId, documentCode, req.authUser!.id, maps);
  return res.json({ success: true, data });
}));

export const publicEmployeeDocumentRouter = Router();

publicEmployeeDocumentRouter.get("/esign/:token", h(async (req, res) => {
  const session = await getPublicJoiningDocumentEsignSession(req.params.token);
  await synchronizeChecklistFieldValues(session.checklist_id);
  const review = await getChecklistFieldReview(session.checklist_id);
  return res.json({
    success: true,
    data: {
      session,
      review,
      employee_message: "These details have been prepared for your joining and statutory documents. Please review carefully before you confirm or proceed to eSign.",
    },
  });
}));

publicEmployeeDocumentRouter.get("/esign/:token/download", h(async (req, res) => {
  const file = await getPublicJoiningDocumentDraftFile(req.params.token);
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${file.fileName.replace(/"/g, "")}"`);
  fs.createReadStream(file.storagePath).pipe(res);
}));

/**
 * Statutory KYC supplied by the employee from the public e-sign review page.
 *
 * WHY THIS ROUTE DID NOT EXIST
 *   epfKycCapture.service.ts was written for exactly this — validateEpfKyc() and
 *   applyEpfKycAndRegenerate(), masking and hashing at the point of save — and had NO callers.
 *   EmployeeEpfComplianceReviewPage has been POSTing here the whole time, and its error
 *   handling already reads `body.errors` as [{field, message}], which is precisely what
 *   validateEpfKyc returns. The service and the page were built to meet; only the wire was
 *   missing, so every submission failed and the employee's bank, PAN, Aadhaar and UAN went
 *   nowhere.
 *
 * WHAT IS AND IS NOT STORED
 *   Nothing here writes a raw identifier. applyEpfKycAndRegenerate passes the values straight
 *   into the generated PDF as transient field values and records only the masked form plus a
 *   hash — see that file's header. This route adds no storage of its own and deliberately
 *   logs nothing: the body is the most sensitive payload in the application.
 *
 * AUTHENTICATION
 *   The same one the sibling routes use. getPublicJoiningDocumentEsignSession resolves the
 *   token by SHA2 hash and throws 404 for an unknown link, 410 for one that is inactive or
 *   expired, so an invalid token never reaches the service. The employee and checklist come
 *   from that session, never from the request body — a caller cannot aim this at someone
 *   else's document by changing a field.
 *
 *   An earlier revision of this comment said the router carries no rate limiter and suggested
 *   adding publicRegistrationLimiter to the mount. That was wrong on the first point and a
 *   bad idea on the second. globalLimiter is applied app-wide in app.ts BEFORE this mount and
 *   allows 500 requests per minute per IP, so these routes are throttled. And the token is
 *   randomBytes(24) — 192 bits — so guessing one is infeasible at any rate; a limiter here
 *   would not be preventing enumeration, only abuse that globalLimiter already caps.
 *
 *   Adding publicRegistrationLimiter (15 requests per 10 minutes) would meanwhile be actively
 *   harmful: a branch office shares one public IP, so a dozen employees signing documents on
 *   the same morning would lock each other out of their own onboarding.
 */
publicEmployeeDocumentRouter.post("/esign/:token/epf-kyc", h(async (req, res) => {
  const session = await getPublicJoiningDocumentEsignSession(req.params.token);

  const body = (req.body ?? {}) as Record<string, unknown>;
  const text = (value: unknown): string | null => {
    const s = typeof value === "string" ? value.trim() : "";
    return s === "" ? null : s;
  };

  // The page posts snake_case; the service takes camelCase. Mapped explicitly rather than
  // transformed, so a renamed field fails to compile instead of silently arriving as null.
  const result = await applyEpfKycAndRegenerate({
    checklistId: String(session.checklist_id),
    employeeId: String(session.employee_id),
    input: {
      panNumber:           text(body.pan_number),
      panNameAsPerKyc:     text(body.pan_name),
      aadhaarNumber:       text(body.aadhaar_number),
      aadhaarNameAsPerKyc: text(body.aadhaar_name),
      uanNumber:           text(body.uan_number),
      bankAccountNumber:   text(body.bank_account_number),
      bankIfsc:            text(body.bank_ifsc),
      bankAccountName:     text(body.bank_account_name),
    },
  });

  if (result.errors.length) {
    // Shape fixed by the caller: it maps errors[] into per-field messages.
    return res.status(400).json({
      success: false,
      message: "Please correct the highlighted details.",
      errors: result.errors,
    });
  }

  return res.json({ success: true, regenerated: result.regenerated });
}));

publicEmployeeDocumentRouter.post("/esign/:token", h(async (req, res) => {
  const action = String(req.body?.action ?? "");
  const publicTokenHash = hashIdentifier(req.params.token);
  if (action === "confirm" || action === "request_correction") {
    const session = await getPublicJoiningDocumentEsignSession(req.params.token);
    const review = await employeeReviewChecklistByToken({
      publicToken: req.params.token,
      action: action === "confirm" ? "confirm" : "request_correction",
      comment: req.body?.comment ?? null,
      actorName: req.body?.actor_name ?? null,
      ipAddress: req.ip,
      userAgent: req.get("user-agent") ?? null,
    });
    if (action === "confirm" && Boolean(req.body?.record_epf_consent)) {
      await db.execute(
        `INSERT INTO employee_epf_consent_receipt
           (id, profile_id, employee_id, consent_token, consent_text, consent_ip, consent_user_agent, consented_by_name)
         SELECT UUID(), p.id, p.employee_id, ?, ?, ?, ?, ?
           FROM employee_epf_compliance_profile p
          WHERE p.employee_id = ?`,
        [
          hashIdentifier(req.params.token),
          EPF_REVIEW_CONSENT_TEXT,
          req.ip,
          req.get("user-agent") ?? null,
          req.body?.actor_name ?? null,
          session.employee_id,
        ],
      );
      await db.execute(
        `UPDATE employee_epf_compliance_profile
            SET consent_status = 'confirmed',
                status = 'employee_review_pending',
            compliance_stage = 'payroll_review_pending',
            updated_at = NOW()
          WHERE employee_id = ?`,
        [session.employee_id],
      );
      const [profileRows] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM employee_epf_compliance_profile WHERE employee_id = ? LIMIT 1`,
        [session.employee_id],
      );
      await logEpfAudit({
        employeeId: String(session.employee_id),
        profileId: String(profileRows[0]?.id ?? ""),
        actionType: "EPF_EMPLOYEE_CONSENT_RECORDED",
        actorType: "public_token",
        remarks: req.body?.comment ?? null,
        newValue: { actor_name: req.body?.actor_name ?? null, consent_token_hash: publicTokenHash },
        ipAddress: req.ip,
        userAgent: req.get("user-agent") ?? null,
      });
    } else if (action === "request_correction" && String(session.document_code).toUpperCase() === "EPF_DECLARATION") {
      const [profileRows] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM employee_epf_compliance_profile WHERE employee_id = ? LIMIT 1`,
        [session.employee_id],
      );
      await db.execute(
        `UPDATE employee_epf_compliance_profile
            SET correction_status = 'requested',
                correction_requested_at = NOW(),
                correction_reason = ?,
                updated_at = NOW()
          WHERE employee_id = ?`,
        [req.body?.comment ?? null, session.employee_id],
      );
      await logEpfAudit({
        employeeId: String(session.employee_id),
        profileId: String(profileRows[0]?.id ?? ""),
        actionType: "EPF_CORRECTION_REQUESTED",
        actorType: "public_token",
        remarks: req.body?.comment ?? null,
        newValue: { actor_name: req.body?.actor_name ?? null, public_token_hash: publicTokenHash },
        ipAddress: req.ip,
        userAgent: req.get("user-agent") ?? null,
      });
    }
    return res.json({ success: true, data: review });
  }
  if (action === "esign") {
    const session = await getPublicJoiningDocumentEsignSession(req.params.token);
    const [profileRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM employee_epf_compliance_profile WHERE employee_id = ? LIMIT 1`,
      [session.employee_id],
    );
    await logEpfAudit({
      employeeId: String(session.employee_id),
      profileId: String(profileRows[0]?.id ?? ""),
      actionType: "EPF_ESIGN_STARTED",
      actorType: "public_token",
      remarks: req.body?.comment ?? null,
      newValue: { public_token_hash: publicTokenHash, providerUrlIssued: Boolean(session.provider_url) },
      ipAddress: req.ip,
      userAgent: req.get("user-agent") ?? null,
    });
    return res.json({
      success: true,
      data: {
        provider_url: session.provider_url,
        tx_status: session.tx_status,
        fallback_message: session.provider_url ? null : "Luckpay eSign is unavailable. Use the wet-sign fallback workflow.",
      },
    });
  }
  return res.status(400).json({ success: false, message: "Unsupported action" });
}));

publicEmployeeDocumentRouter.post("/esign/webhook/luckpay", h(async (req, res) => {
  const configuredSecret = env.LUCKPAY_WEBHOOK_SECRET;
  const webhookSecret = req.get("X-HRMS-Webhook-Secret");
  if (!verifyLuckpayWebhookSecret(webhookSecret, configuredSecret)) {
    return res.status(401).json({ success: false, message: "Unauthorized webhook" });
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const data = await handleJoiningDocumentEsignWebhook({
    payload: body,
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? null,
  });

  // Fallback: joining-document handler only looks in employee_document_esign_transaction.
  // Appointment letter e-signs are tracked in appointment_letter_request instead.
  // On signed callback: auto-complete the full chain (candidate_signed → company_signed →
  // completed) without DSC, download the signed PDF from Luckpay, save to vault, email candidate.
  if (!data.matched) {
    const clientTxId = String(body.client_transaction_id ?? body.clientTransactionId ?? "").trim();
    if (clientTxId) {
      const [alRows] = await db.execute<RowDataPacket[]>(
        `SELECT alr.id, alr.candidate_esign_status, alr.candidate_id,
                c.full_name, c.email
           FROM appointment_letter_request alr
           JOIN ats_candidate c ON c.id = alr.candidate_id
          WHERE alr.esign_transaction_id = ? LIMIT 1`,
        [clientTxId],
      );
      const alRow = alRows[0];
      if (alRow && alRow.candidate_esign_status === "pending") {
        const rawStatus = String(body.status ?? body.event ?? body.result ?? "").toLowerCase();
        const isSigned = rawStatus.includes("sign") || rawStatus.includes("success") || rawStatus.includes("complete");
        if (isSigned) {
          // Step 1: mark candidate signed
          await db.execute(
            `UPDATE appointment_letter_request
                SET current_state = 'candidate_signed', candidate_esign_status = 'signed', candidate_esign_at = NOW()
              WHERE id = ?`,
            [alRow.id],
          );

          // Step 2: auto company-sign (no DSC) + finalize
          const uploadRoot = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
          const vaultDir = path.join(uploadRoot, "vault", "appointment-letters", String(alRow.id));
          const vaultFile = path.join(vaultDir, "signed_appointment_letter.pdf");
          const vaultRelPath = `vault/appointment-letters/${alRow.id}/signed_appointment_letter.pdf`;

          // Download signed PDF from Luckpay
          let pdfBytes: Buffer | null = null;
          try {
            const { luckpayClient } = await import("../integrations/luckpay/luckpay.client.js");
            const [txRows] = await db.execute<RowDataPacket[]>(
              `SELECT provider_reference_id FROM ats_provider_transaction_log
               WHERE candidate_id = ? AND provider = 'luckpay' AND service_type = 'esign'
               ORDER BY updated_at DESC LIMIT 1`,
              [alRow.candidate_id],
            );
            const result = await luckpayClient.downloadESignDocument({
              clientTransactionId: clientTxId,
              transactionId: String(txRows[0]?.provider_reference_id ?? ""),
            });
            if (result.buffer?.length) pdfBytes = result.buffer;
          } catch (dlErr) {
            console.warn("[appointment-webhook] PDF download failed:", dlErr instanceof Error ? dlErr.message : dlErr);
          }

          // Fallback to offer letter PDF if download failed
          if (!pdfBytes) {
            const [offerRows] = await db.execute<RowDataPacket[]>(
              `SELECT pdf_path FROM ats_offer_letters WHERE candidate_id = ? AND pdf_path IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
              [alRow.candidate_id],
            );
            const srcPath = offerRows[0]?.pdf_path ? path.join(uploadRoot, String(offerRows[0].pdf_path)) : null;
            if (srcPath && fs.existsSync(srcPath)) pdfBytes = fs.readFileSync(srcPath);
          }

          if (pdfBytes) {
            fs.mkdirSync(vaultDir, { recursive: true });
            fs.writeFileSync(vaultFile, pdfBytes);
          }

          // Finalize in DB
          await db.execute(
            `UPDATE appointment_letter_request
                SET current_state = 'completed', company_sign_status = 'signed',
                    company_sign_at = NOW(), company_signed_by = 'system_auto',
                    pdf_locked = 1, pdf_locked_at = NOW(), vault_path = ?
              WHERE id = ?`,
            [vaultRelPath, alRow.id],
          );
          const [existingVault] = await db.execute<RowDataPacket[]>(
            `SELECT id FROM employee_document_vault WHERE source_entity_id = ? LIMIT 1`, [alRow.id],
          );
          if (!existingVault[0]) {
            await db.execute(
              `INSERT INTO employee_document_vault
                 (id, candidate_id, document_type, document_name, file_path, is_locked, locked_at, locked_by, source_module, source_entity_id, uploaded_at, uploaded_by)
               VALUES (?, ?, 'APPOINTMENT_LETTER', 'Signed Appointment Letter', ?, 1, NOW(), 'system_auto', 'letters', ?, NOW(), 'system_auto')`,
              [randomUUID(), alRow.candidate_id, vaultRelPath, alRow.id],
            );
          }
          await db.execute(
            `INSERT INTO appointment_letter_audit (id, letter_request_id, action, from_state, to_state, performed_by, remarks, created_at)
             VALUES (UUID(), ?, 'AUTO_COMPLETE_AND_SEND', 'candidate_esign_pending', 'completed', 'system_auto', 'Auto-finalized and emailed via Luckpay webhook', NOW())`,
            [alRow.id],
          );

          // Step 3: email candidate
          const candidateEmail = String(alRow.email ?? "");
          if (candidateEmail.includes("@")) {
            try {
              const { emailService } = await import("../communication/email.service.js");
              const frontendBase = process.env.FRONTEND_URL ?? process.env.APP_URL ?? "https://mcnhrms.teammas.in";
              const downloadUrl = `${frontendBase}/api/letters/appointment/by-candidate/${alRow.candidate_id}/download`;
              await emailService.send({
                to: candidateEmail,
                subject: "Your Appointment Letter — MAS Callnet",
                html: `<p>Dear ${String(alRow.full_name ?? "")},</p>
                       <p>Your appointment letter is ready. Please download it using the link below:</p>
                       <p><a href="${downloadUrl}" style="background:#2563eb;color:#fff;padding:8px 16px;border-radius:4px;text-decoration:none;">Download Appointment Letter</a></p>
                       <p>Regards,<br/>MAS Callnet HR Team</p>`,
                attachments: pdfBytes ? [{ filename: "Appointment_Letter.pdf", content: pdfBytes }] : undefined,
              });
            } catch (mailErr) {
              console.warn("[appointment-webhook] Email failed:", mailErr instanceof Error ? mailErr.message : mailErr);
            }
          }

          return res.json({ success: true, data: { matched: true, processed: true, source: "appointment_letter", auto_sent: true } });
        }
      }
    }
  }

  return res.json({ success: true, data });
}));

publicEmployeeDocumentRouter.post("/esign/:token/start", h(async (req, res) => {
  const session = await getPublicJoiningDocumentEsignSession(req.params.token);
  return res.json({
    success: true,
    data: {
      provider_url: session.provider_url,
      tx_status: session.tx_status,
      fallback_message: session.provider_url ? null : "Luckpay eSign is unavailable. Use the wet-sign fallback workflow.",
    },
  });
}));

export const payrollEpfComplianceRouter = Router();
payrollEpfComplianceRouter.use(requireAuth, requireRole("admin", "super_admin", "payroll_hr", "payroll", "hr", "manager"));

payrollEpfComplianceRouter.get("/epf-compliance", h(async (req: AuthenticatedRequest, res) => {
  const userId = req.authUser!.id;
  const adminBypass = await hasAnyRole(userId, "admin", "super_admin");
  const scoped = await buildScopeWhereClause(
    userId,
    ["payroll_hr", "payroll", "hr", "manager"],
    { branchId: "p.branch_id", processId: "p.process_id", departmentId: "e.department_id", managerEmployeeId: "e.reporting_manager_id", employeeId: "e.id" },
    { allowAdminBypass: true },
  );
  const whereSql = adminBypass ? "1=1" : scoped.sql;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
        p.employee_id,
        e.employee_code,
        p.employee_name,
        p.status,
        p.compliance_stage,
        p.consent_status,
        p.correction_status,
        p.joining_date,
        p.gross_monthly_wage,
        p.uan_masked,
        b.branch_name,
        pm.process_name,
        ecr.ecr_status,
        ecr.missing_fields,
        (SELECT COUNT(*) FROM employee_epf_validation_result vr WHERE vr.profile_id = p.id AND vr.severity = 'error') AS error_count
       FROM employee_epf_compliance_profile p
       JOIN employees e ON e.id = p.employee_id
       LEFT JOIN branch_master b ON b.id = p.branch_id
       LEFT JOIN process_master pm ON pm.id = p.process_id
       LEFT JOIN employee_epf_ecr_readiness ecr ON ecr.employee_id = p.employee_id
      WHERE (${whereSql})
      ORDER BY p.updated_at DESC`,
    adminBypass ? [] : scoped.params,
  );
  return res.json({ success: true, data: rows });
}));

payrollEpfComplianceRouter.post("/epf-compliance/:employeeId/review", h(async (req: AuthenticatedRequest, res) => {
  const decision = String(req.body?.decision ?? "");
  if (!["approved", "pushback"].includes(decision)) {
    return res.status(400).json({ success: false, message: "decision must be approved or pushback" });
  }
  const { profile } = await ensureEpfProfile(req.params.employeeId, req.authUser!.id);
  await syncEpfValidation(req.params.employeeId, req.authUser!.id);
  await db.execute(
    `UPDATE employee_epf_compliance_profile
        SET status = ?,
            compliance_stage = ?,
            correction_status = ?,
            correction_requested_at = CASE WHEN ? = 'pushback' THEN NOW() ELSE correction_requested_at END,
            correction_requested_by = CASE WHEN ? = 'pushback' THEN ? ELSE correction_requested_by END,
            correction_reason = CASE WHEN ? = 'pushback' THEN ? ELSE correction_reason END,
            payroll_reviewed_at = NOW(),
            payroll_reviewed_by = ?,
            retention_locked_at = CASE WHEN ? = 'approved' THEN COALESCE(retention_locked_at, NOW()) ELSE retention_locked_at END,
            updated_at = NOW()
      WHERE employee_id = ?`,
    [
      decision === "approved" ? "payroll_approved" : "correction_requested",
      decision === "approved" ? "payroll_review_complete" : "correction_requested",
      decision === "approved" ? "none" : "requested",
      decision,
      decision,
      req.authUser!.id,
      decision,
      req.body?.remarks ?? null,
      req.authUser!.id,
      decision,
      req.params.employeeId,
    ],
  );
  await logEpfAudit({
    employeeId: req.params.employeeId,
    profileId: String(profile.id),
    actionType: decision === "approved" ? "EPF_PAYROLL_APPROVED" : "EPF_PAYROLL_PUSHBACK",
    actorUserId: req.authUser!.id,
    actorType: "payroll",
    remarks: req.body?.remarks ?? null,
    newValue: { decision },
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? null,
  });
  return res.json({ success: true, data: await getEpfCompliancePack(req.params.employeeId, req.authUser!.id) });
}));

/**
 * POST /api/payroll/statutory-numbers/bulk-upload
 *
 * Bulk-set ESIC / PF / UAN numbers from a CSV keyed by employee code.
 *
 *   employee_code,esic_number,pf_number,uan_number
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * The ESIC Contribution Register ships with ESIC_NUMBER blank on every row, and the PF register
 * has the same gap. Measured on production 2026-08-12 across the 917 active ONROLL employees:
 * esic_number on 394, epf_number on 467, uan_number on 467. So roughly half the statutory
 * registers cannot be filed as generated, and no screen sets these in bulk.
 *
 * This has to land BEFORE the ESIC and PF register corrections, or those reports become
 * correctly scoped and still blank in the column that matters.
 *
 * ── DELIBERATE BEHAVIOURS ────────────────────────────────────────────────────
 *   - Blank cells SKIP rather than clear. A CSV carrying only ESIC numbers must not wipe the
 *     PF and UAN already on the row; partial sheets are the normal case here.
 *   - Rows are validated and REPORTED individually. One malformed UAN fails its own row and
 *     the rest still apply — the alternative, aborting the batch, is what makes people paste
 *     numbers straight into the database.
 *   - Format is enforced rather than trusted: UAN is 12 digits and ESIC is 10. Writing a
 *     malformed identifier is worse than leaving the cell empty, because a register that is
 *     blank is visibly incomplete while one carrying a wrong number files cleanly and fails at
 *     the department.
 *   - ?dryRun=1 validates and reports without writing, so a sheet can be checked before it
 *     touches 900 employee records.
 */
payrollEpfComplianceRouter.post(
  "/statutory-numbers/bulk-upload",
  requireAuth,
  requireRole("admin", "super_admin", "hr", "hr_head", "payroll", "payroll_head"),
  upload.single("file"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded. Send CSV as multipart field "file".' });
    }
    const dryRun = ["1", "true", "yes"].includes(String(req.query.dryRun ?? "").toLowerCase());

    const lines = req.file.buffer.toString("utf-8").split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return res.status(400).json({ success: false, message: "CSV has no data rows" });

    const headers = lines[0].split(",").map((x) => x.trim().toLowerCase().replace(/\s+/g, "_"));
    const idx = {
      code: headers.findIndex((x) => ["employee_code", "employeecode", "emp_code", "code"].includes(x)),
      esic: headers.findIndex((x) => ["esic_number", "esic", "esic_no", "esi_number"].includes(x)),
      pf:   headers.findIndex((x) => ["pf_number", "pf", "pf_no", "epf_number"].includes(x)),
      uan:  headers.findIndex((x) => ["uan_number", "uan", "uan_no"].includes(x)),
    };
    if (idx.code === -1) {
      return res.status(400).json({ success: false, message: "CSV must have an employee_code column" });
    }
    if (idx.esic === -1 && idx.pf === -1 && idx.uan === -1) {
      return res.status(400).json({ success: false, message: "CSV must have at least one of esic_number, pf_number, uan_number" });
    }

    const [empRows] = await db.execute<RowDataPacket[]>(
      "SELECT id, employee_code FROM employees WHERE active_status = 1"
    );
    const empMap = new Map((empRows as RowDataPacket[]).map((e) => [String(e.employee_code ?? "").trim().toLowerCase(), e.id as string]));

    const errors: string[] = [];
    const updates: Array<{ id: string; code: string; esic?: string; pf?: string; uan?: string }> = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim());
      const code = cols[idx.code] ?? "";
      if (!code) { errors.push(`Row ${i + 1}: employee_code is blank`); continue; }

      const empId = empMap.get(code.toLowerCase());
      if (!empId) { errors.push(`Row ${i + 1}: employee_code "${code}" not found among active employees`); continue; }

      const pick = (at: number) => (at === -1 ? "" : (cols[at] ?? "").trim());
      const esic = pick(idx.esic);
      const pf   = pick(idx.pf);
      const uan  = pick(idx.uan);

      // Digits only for the two that have a fixed statutory width.
      // 10, not 17. 17 is the employer's ESIC registration width, not the per-employee
      // Insured Person number this CSV carries — so the old check rejected every correct
      // value. Live 2026-08-16: 382 of the 394 active employees with an esic_number hold
      // 10 digits, and none holds 17. Kept in step with ESI_FORMAT in shared/statutoryFormat.ts.
      if (esic && !/^\d{10}$/.test(esic.replace(/\D/g, "")) ) {
        errors.push(`Row ${i + 1} (${code}): ESIC number must be 10 digits, got "${esic}"`); continue;
      }
      if (uan && !/^\d{12}$/.test(uan.replace(/\D/g, ""))) {
        errors.push(`Row ${i + 1} (${code}): UAN must be 12 digits, got "${uan}"`); continue;
      }
      if (pf && pf.length > 40) {
        errors.push(`Row ${i + 1} (${code}): PF number looks wrong (over 40 characters)`); continue;
      }
      if (!esic && !pf && !uan) { errors.push(`Row ${i + 1} (${code}): no values to set`); continue; }

      updates.push({
        id: empId,
        code,
        ...(esic ? { esic: esic.replace(/\D/g, "") } : {}),
        ...(pf ? { pf } : {}),
        ...(uan ? { uan: uan.replace(/\D/g, "") } : {}),
      });
    }

    if (dryRun) {
      return res.json({
        success: true,
        dryRun: true,
        data: { wouldUpdate: updates.length, rowsRejected: errors.length, errors: errors.slice(0, 100) },
      });
    }

    let updated = 0;
    for (const u of updates) {
      // Only the columns this row actually carries. A blank cell must not clear a stored value.
      const sets: string[] = [];
      const params: unknown[] = [];
      if (u.esic) { sets.push("esic_number = ?"); params.push(u.esic); }
      if (u.pf)   { sets.push("epf_number = ?");  params.push(u.pf); }
      if (u.uan)  { sets.push("uan_number = ?");  params.push(u.uan); }
      if (!sets.length) continue;
      params.push(u.id);
      const [r] = await db.execute<ResultSetHeader>(
        `UPDATE employees SET ${sets.join(", ")}, updated_at = NOW() WHERE id = ?`,
        params
      );
      updated += r.affectedRows;
    }

    await logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "STATUTORY_NUMBERS_BULK_UPLOAD",
      module_key: "PAYROLL",
      entity_type: "employees",
      entity_id: "bulk",
      change_summary: { rowsAccepted: updates.length, rowsRejected: errors.length, updated },
      req,
    });

    return res.json({
      success: true,
      data: { updated, rowsAccepted: updates.length, rowsRejected: errors.length, errors: errors.slice(0, 100) },
    });
  })
);
