import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { Router } from "express";
import multer from "multer";
import type { NextFunction, Request, Response } from "express";
import type { RowDataPacket } from "mysql2";

import { db } from "../../db/mysql.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { buildScopeWhereClause, hasAnyRole } from "../../shared/scopeAccess.js";
import {
  completePublicJoiningDocumentEsign,
  createJoiningDocumentEsignRequest,
  createPublicTokenForEpfReview,
  getJoiningDocumentFileForAccess,
  getPublicJoiningDocumentDraftFile,
  getJoiningDocumentPack,
  getPublicJoiningDocumentEsignSession,
  listJoiningDocumentTemplates,
  resolveEmployeeDocumentAccessContext,
  reviewJoiningDocument,
  upsertJoiningDocumentTemplate,
  uploadJoiningDocument,
} from "./employeeJoiningDocuments.service.js";
import {
  employeeReviewChecklistByToken,
  generateChecklistDraft,
  getChecklistFieldReview,
  listTemplateFieldMaps,
  manualFillChecklistValues,
  replaceTemplateFieldMaps,
  synchronizeChecklistFieldValues,
} from "./universalDigitalFormFill.service.js";
import { validateEpfCompliance } from "./epfComplianceValidation.service.js";

const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });
const TEMPLATE_STORAGE_ROOT = path.resolve(process.cwd(), "private-storage", "document-templates");
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

function epfFormPayloads(profile: Record<string, any>, nominees: any[], validation: any, ecr: Record<string, any> | null) {
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
      blockers: Array.isArray(validation?.issues) ? validation.issues.filter((issue: any) => issue.severity === "error") : [],
    },
    ECR_READINESS: {
      ecr_status: ecr?.ecr_status ?? "pending",
      blocked_reason: ecr?.blocked_reason ?? null,
      missing_fields: ecr?.missing_fields ?? validation?.missing_fields ?? [],
    },
  } as const;
}

function epfFormStatus(formCode: string, profileStatus: string, validation: any) {
  if (profileStatus === "payroll_approved") return "approved";
  if (profileStatus === "correction_requested") return "pushback";
  if (profileStatus === "employee_review_pending") return "employee_review_pending";
  if (formCode === "MISSING_DATA_ALERT") return (validation?.missing_fields?.length ?? 0) > 0 ? "draft" : "approved";
  if (formCode === "ECR_READINESS") return validation?.ecr_ready ? "ready" : "draft";
  return validation?.ready_for_submission ? "ready" : "draft";
}

async function upsertEpfFormInstances(params: {
  employeeId: string;
  profile: Record<string, any>;
  nominees: any[];
  validation: any;
  ecr: Record<string, any> | null;
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
  profile: Record<string, any>;
  receipt: Record<string, any>;
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
  if ((result as any).affectedRows === 0) {
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
    nominees as any[],
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
    nominees: nominees as any[],
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
employeeJoiningDocumentsRouter.use(requireAuth);

employeeJoiningDocumentsRouter.get("/:employeeId/joining-documents", h(async (req: AuthenticatedRequest, res) => {
  const data = await getJoiningDocumentPack(req.params.employeeId, req.authUser!.id);
  return res.json({ success: true, data });
}));

employeeJoiningDocumentsRouter.post("/:employeeId/joining-documents/checklist/:checklistId/upload", upload.single("file"), h(async (req: AuthenticatedRequest, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "file is required" });
  const data = await uploadJoiningDocument({
    employeeId: req.params.employeeId,
    checklistId: req.params.checklistId,
    file: req.file,
    actorUserId: req.authUser!.id,
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

employeeJoiningDocumentsRouter.put("/:employeeId/epf-compliance/profile", h(async (req: AuthenticatedRequest, res) => {
  const { profile } = await ensureEpfProfile(req.params.employeeId, req.authUser!.id);
  await db.execute(
      `UPDATE employee_epf_compliance_profile
        SET employee_name = ?,
            father_or_spouse_name = ?,
            relationship_type = ?,
            date_of_birth = ?,
            gender = ?,
            marital_status = ?,
            mobile_number = ?,
            personal_email = ?,
            aadhaar_masked = ?,
            pan_masked = ?,
            uan_masked = ?,
            previous_pf_member = ?,
            previous_eps_member = ?,
            international_worker = ?,
            excluded_employee = ?,
            joining_date = ?,
            basic_wage = ?,
            gross_monthly_wage = ?,
            status = 'draft',
            compliance_stage = 'profile_in_progress',
            updated_at = NOW()
      WHERE id = ?`,
    [
      req.body.employee_name ?? null,
      req.body.father_or_spouse_name ?? null,
      req.body.relationship_type ?? null,
      req.body.date_of_birth ?? null,
      req.body.gender ?? null,
      req.body.marital_status ?? null,
      req.body.mobile_number ?? null,
      req.body.personal_email ?? null,
      req.body.aadhaar_number ?? req.body.aadhaar_masked ?? null,
      req.body.pan_number ?? req.body.pan_masked ?? null,
      req.body.uan_number ?? req.body.uan_masked ?? null,
      req.body.previous_pf_member ? 1 : 0,
      req.body.previous_eps_member ? 1 : 0,
      req.body.international_worker ? 1 : 0,
      req.body.excluded_employee ? 1 : 0,
      req.body.joining_date ?? null,
      req.body.basic_wage ?? null,
      req.body.gross_monthly_wage ?? null,
      profile.id,
    ],
  );
  const { validation } = await syncEpfValidation(req.params.employeeId, req.authUser!.id);
  await logEpfAudit({
    employeeId: req.params.employeeId,
    profileId: String(profile.id),
    actionType: "EPF_PROFILE_UPDATED",
    actorUserId: req.authUser!.id,
    actorType: "hr",
    oldValue: profile,
    newValue: req.body ?? {},
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
    newValue: data,
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? null,
  });
  return res.json({ success: true, data });
}));

export const hrDocumentTemplatesRouter = Router();
hrDocumentTemplatesRouter.use(requireAuth, requireRole("admin", "super_admin", "hr"));

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

hrDocumentTemplatesRouter.post("/document-templates/:templateId/upload", upload.single("file"), h(async (req: AuthenticatedRequest, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "file is required" });
  const fillMode = String(req.body?.fill_mode ?? "placeholder");
  fs.mkdirSync(TEMPLATE_STORAGE_ROOT, { recursive: true });
  const ext = path.extname(req.file.originalname).toLowerCase() || ".bin";
  const storedName = `${req.params.templateId}-${Date.now()}${ext}`;
  const storagePath = path.join(TEMPLATE_STORAGE_ROOT, storedName);
  fs.writeFileSync(storagePath, req.file.buffer);
  await db.execute(
    `UPDATE employee_joining_document_template
        SET template_storage_path = ?,
            template_mime_type = ?,
            fill_mode = ?,
            updated_at = NOW()
      WHERE id = ?`,
    [storagePath, templateMimeFromName(req.file.originalname), fillMode, req.params.templateId],
  );
  return res.json({ success: true, data: await listJoiningDocumentTemplates() });
}));

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

publicEmployeeDocumentRouter.post("/esign/:token", h(async (req, res) => {
  const action = String(req.body?.action ?? "");
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
          req.params.token,
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
        newValue: { actor_name: req.body?.actor_name ?? null, consent_token: req.params.token },
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
        newValue: { actor_name: req.body?.actor_name ?? null },
        ipAddress: req.ip,
        userAgent: req.get("user-agent") ?? null,
      });
    }
    return res.json({ success: true, data: review });
  }
  if (action === "esign") {
    const session = await getPublicJoiningDocumentEsignSession(req.params.token);
    const data = await completePublicJoiningDocumentEsign({
      publicToken: req.params.token,
      signerName: String(req.body?.signer_name ?? req.body?.actor_name ?? "Employee"),
      signerRemarks: req.body?.comment ?? null,
      ipAddress: req.ip,
      userAgent: req.get("user-agent") ?? null,
    });
    if (String(session.document_code).toUpperCase() === "EPF_DECLARATION") {
      const [profileRows] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM employee_epf_compliance_profile WHERE employee_id = ? LIMIT 1`,
        [session.employee_id],
      );
      await logEpfAudit({
        employeeId: String(session.employee_id),
        profileId: String(profileRows[0]?.id ?? ""),
        actionType: "EPF_ESIGN_COMPLETED",
        actorType: "public_token",
        remarks: req.body?.comment ?? null,
        newValue: data,
        ipAddress: req.ip,
        userAgent: req.get("user-agent") ?? null,
      });
    }
    return res.json({ success: true, data });
  }
  return res.status(400).json({ success: false, message: "Unsupported action" });
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
