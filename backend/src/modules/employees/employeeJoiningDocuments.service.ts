import { createHash, randomBytes, randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

import { env } from "../../config/env.js";
import { db } from "../../db/mysql.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import { hasAnyRole, hasScopedAccess, getUserRoleKeys } from "../../shared/scopeAccess.js";
import { analyzeEmployeeJoiningDocument } from "./employeeJoiningDocumentAnalysis.service.js";
import { esignWithUrl, generateClientTransactionId, sanitizeProviderPayload, luckpayClient } from "../integrations/luckpay/luckpay.client.js";
import { generateChecklistDraft } from "./universalDigitalFormFill.service.js";
import { templateFileExists } from "./joiningDocumentTemplatePath.js";
import { inboxService } from "../inbox/inbox.service.js";
import { emailService } from "../communication/email.service.js";
import { buildJoiningDocEsignEmailHtml, buildEpfComplianceReviewEmailHtml } from "../ats/ats.email.service.js";

const STORAGE_ROOT = path.resolve(process.cwd(), "private-storage", "employee-joining-documents");

/**
 * True when a stored joining-document file is readable on THIS machine.
 *
 * storage_path is written absolute, so the recorded value depends on which machine
 * and working directory wrote it. Verified live 2026-08-16: 9 of 51 rows hold a
 * foreign path (8 generated, 1 kit_source).
 *
 * WHY THIS IS NOT MERELY A 404, unlike the sibling readers fixed in 2e07eeee and
 * 3d2fe716. The two callers use this to decide whether a usable file already exists;
 * a false negative makes ensureGeneratedFile() REGENERATE the document and rewrite
 * the checklist status back to pending_candidate_esign / uploaded_pending_review,
 * recording a fresh DOCUMENT_GENERATED audit row. Its lookup prefers file_role
 * 'signed', so on the wrong row that silently replaces a completed e-signature with
 * a new unsigned draft and asks the employee to sign again.
 *
 * CURRENT EXPOSURE IS ZERO, and this is deliberate hardening rather than a repair:
 * checked per checklist with the same ordering the caller uses (signed first, then
 * newest), all 30 winning rows resolve locally and none of the 9 foreign rows is
 * currently selected — each is superseded by a newer local row. The guard exists
 * because pre-launch uploads from developer machines keep writing foreign paths, and
 * the day one becomes the newest row for its checklist, the failure is destructive
 * and silent.
 *
 * Files live at STORAGE_ROOT/<employeeId>/<documentCode>/<file>, so the fallback is
 * rebuilt from those parts. Splitting on BOTH separators is required: a backslash is
 * an ordinary filename character on Linux, so path.basename() on a Windows path
 * returns the whole string.
 */
function resolveJoiningDocumentFile(
  storedPath: unknown,
  employeeId: string,
  documentCode: string,
): string | null {
  const raw = String(storedPath ?? "").trim();
  if (raw && isReadableFile(raw)) return raw;

  const fileName = raw.split(/[\\/]/).pop();
  if (!fileName || !employeeId || !documentCode) return null;

  const candidate = path.join(
    STORAGE_ROOT,
    employeeId,
    String(documentCode).toLowerCase(),
    fileName,
  );
  return isReadableFile(candidate) ? candidate : null;
}

function isReadableFile(candidate: string): boolean {
  try {
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}
const ALLOWED_EXTENSIONS = new Set([".pdf", ".jpg", ".jpeg", ".png", ".webp", ".doc", ".docx"]);
const HR_SCOPE_ROLES = ["hr", "manager", "branch_head", "process_manager", "assistant_manager", "tl"];
const PAYROLL_SCOPE_ROLES = ["payroll_hr", "payroll"];
const SECURE_DOWNLOAD_ROLES = new Set(["admin", "super_admin", "hr", "manager", "payroll_hr", "payroll", "employee"]);
const PAYROLL_DOCUMENT_CODES = new Set(["EPF_DECLARATION", "EMPLOYMENT_CONTRACT"]);

/**
 * Every status this system actually writes to
 * employee_joining_document_checklist.status.
 *
 * The free-form PATCH endpoint previously accepted any string, so a typo became
 * a permanent unknown state and a deliberate value could fake completion.
 */
const ALLOWED_CHECKLIST_STATUSES = new Set([
  "pending_candidate_esign",
  "pending_hr_upload",
  "pending_generation",
  "template_pending",
  "ready_for_esign",
  "uploaded_pending_review",
  "uploaded_pending_esign",
  "esign_initiated",
  "esign_completed",
  "esign_failed",
  "employee_confirmed",
  "needs_correction",
  "correction_requested",
  "verified",
  "completed",
  "signed_verified",
  "wet_signed_uploaded",
]);

/** Verification outcomes only HR may set — never the employee about their own documents. */
const HR_ONLY_CHECKLIST_STATUSES = new Set([
  "verified",
  "completed",
  "signed_verified",
  "needs_correction",
  "correction_requested",
  // Asserting that a wet-signed copy is on file is a verification outcome like any
  // other: recalculateDocumentProgress counts it toward mandatory_completed, it is
  // in the terminal-status set, and payroll-governance treats it as satisfying the
  // joining-document gate. Left out of this list it was settable by the employee
  // themselves via isSelf access - self-approval of their own paperwork, the exact
  // hole already closed for 'verified'.
  "wet_signed_uploaded",
]);

type ActorType = "hr" | "candidate" | "system" | "employee" | "public_token";
type FileRole = "template" | "hr_uploaded" | "generated" | "sent_for_esign" | "signed" | "supporting";

export type LinkedGeneralDoc = {
  doc_type: string;
  doc_name: string | null;
  file_url: string;
  verified: number;
};

export type JoiningChecklistItem = {
  id: string;
  document_code: string;
  document_name: string;
  owner_type: string;
  action_type: string;
  status: string;
  mandatory: number;
  template_version: string;
  verification_status: string | null;
  verification_remarks: string | null;
  due_at: string | null;
  completed_at: string | null;
  latest_file_id: string | null;
  latest_file_name: string | null;
  latest_file_role: string | null;
  latest_file_mime: string | null;
  latest_esign_status: string | null;
  latest_esign_url: string | null;
  public_token_status: string | null;
  public_token_expires_at: string | null;
  publicTokenIssued: number;
  analysis_result_json: unknown;
  linked_doc?: LinkedGeneralDoc | null;
};

type EmployeeDocumentTarget = {
  id: string;
  employee_code: string | null;
  full_name: string | null;
  official_email: string | null;
  mobile: string | null;
  branch_id: string | null;
  process_id: string | null;
  lob_id: string | null;
  department_id: string | null;
  reporting_manager_id: string | null;
  manager_id: string | null;
  date_of_joining: string | null;
  candidate_id: string | null;
  joining_document_status: string | null;
  joining_document_completion_pct: number | null;
};

type AccessContext = {
  target: EmployeeDocumentTarget;
  roles: string[];
  actorEmployeeId: string | null;
  isAdmin: boolean;
  isSelf: boolean;
  canManage: boolean;
  canPayroll: boolean;
};

type ChecklistRow = {
  id: string;
  employee_id: string;
  candidate_id: string | null;
  document_code: string;
  document_name: string;
  status: string;
  action_type: string;
  owner_type: string;
  template_version: string;
};

type LatestFileRow = {
  id: string;
  checklist_id: string;
  original_filename: string | null;
  file_role: string;
  mime_type: string | null;
  storage_path: string;
};

type ESignSession = {
  checklist_id: string;
  employee_id: string;
  document_code: string;
  document_name: string;
  employee_name: string | null;
  employee_code: string | null;
  expires_at: string;
  token_status: string;
  provider_url: string | null;
  tx_status: string | null;
};

function ensureDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function nowPlusDays(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function sha256(input: string | Buffer) {
  return createHash("sha256").update(input).digest("hex");
}

function isMissingJoiningDocumentStatusColumn(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const errno = Number((error as { errno?: unknown }).errno ?? NaN);
  const message = String((error as { message?: unknown }).message ?? "");
  return (
    (code === "ER_BAD_FIELD_ERROR" || errno === 1054) &&
    message.includes("joining_document_status")
  );
}

function frontendBaseUrl() {
  // Defaults to the public address, matching joiningKitDispatch. Every link this
  // module builds is emailed to a candidate or employee, so a localhost fallback
  // here only ever produces a link the recipient cannot open. emailService
  // refuses to send one regardless; this stops it being built in the first place.
  return String(env.FRONTEND_URL || "https://mcnhrms.teammas.in").replace(/\/$/, "");
}

function safeExternalProviderUrl(value: unknown): string | null {
  const url = String(value ?? "").trim();
  if (!url) return null;
  if (url.includes("/api/public/employee-documents/esign/")) return null;
  return url;
}

function isPayrollDocument(code: string) {
  const normalized = String(code || "").trim().toUpperCase();
  return PAYROLL_DOCUMENT_CODES.has(normalized) || normalized.includes("EPF") || normalized.includes("STATUTORY");
}

function fileExtension(fileName: string) {
  return path.extname(fileName || "").toLowerCase();
}

export async function getEmployeeDocumentTarget(employeeId: string): Promise<EmployeeDocumentTarget | null> {
  const selectTarget = async (includeStatus: boolean) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
          e.id,
          e.employee_code,
          COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS full_name,
          COALESCE(NULLIF(TRIM(e.official_email), ''), NULLIF(TRIM(e.office_email), ''), e.email) AS official_email,
          e.mobile,
          e.branch_id,
          e.process_id,
          e.lob_id,
          e.department_id,
          e.reporting_manager_id,
          e.manager_id,
          e.date_of_joining,
          ob.candidate_id,
          ${includeStatus ? "e.joining_document_status" : "NULL"} AS joining_document_status,
          e.joining_document_completion_pct
         FROM employees e
         LEFT JOIN ats_onboarding_bridge ob ON ob.employee_id = e.id
        WHERE e.id = ?
        LIMIT 1`,
      [employeeId],
    );
    return (rows as unknown as EmployeeDocumentTarget[])[0] ?? null;
  };

  try {
    return await selectTarget(true);
  } catch (error) {
    if (isMissingJoiningDocumentStatusColumn(error)) {
      return await selectTarget(false);
    }
    throw error;
  }
}

export async function resolveEmployeeDocumentAccessContext(userId: string, employeeId: string): Promise<AccessContext> {
  const target = await getEmployeeDocumentTarget(employeeId);
  if (!target) {
    const err = new Error("Employee not found") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const roles = await getUserRoleKeys(userId);
  const actorEmployee = await getEmployeeForUser(userId);
  const isAdmin = roles.includes("super_admin") || roles.includes("admin");
  const isSelf = actorEmployee?.id === employeeId;
  const canPayroll = roles.includes("payroll_hr") || roles.includes("payroll");

  let canManage = isAdmin || isSelf;
  if (!canManage) {
    const targetManagerId = target.reporting_manager_id ?? target.manager_id ?? null;
    canManage = await hasScopedAccess(
      userId,
      [...HR_SCOPE_ROLES, ...PAYROLL_SCOPE_ROLES],
      {
        branchId: target.branch_id,
        processId: target.process_id,
        lobId: target.lob_id,
        departmentId: target.department_id,
        managerEmployeeId: targetManagerId,
        employeeId: target.id,
      },
      { allowAdminBypass: true, requireScopeForNonAdmin: true },
    );
  }

  if (!canManage) {
    const err = new Error("Forbidden: employee is outside your assigned scope") as Error & { statusCode?: number };
    err.statusCode = 403;
    throw err;
  }

  return {
    target,
    roles,
    actorEmployeeId: actorEmployee?.id ?? null,
    isAdmin,
    isSelf,
    canManage,
    canPayroll,
  };
}

async function auditDocumentAction(input: {
  employeeId: string;
  candidateId?: string | null;
  checklistId?: string | null;
  documentCode?: string | null;
  actionType: string;
  actorUserId?: string | null;
  actorType?: ActorType;
  remarks?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  await db.execute(
    `INSERT INTO employee_joining_document_audit_log
       (id, employee_id, candidate_id, checklist_id, document_code, action_type, old_value, new_value, remarks, actor_user_id, actor_type, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      input.employeeId,
      input.candidateId ?? null,
      input.checklistId ?? null,
      input.documentCode ?? null,
      input.actionType,
      input.oldValue ? JSON.stringify(input.oldValue) : null,
      input.newValue ? JSON.stringify(input.newValue) : null,
      input.remarks ?? null,
      input.actorUserId ?? null,
      input.actorType ?? "system",
      input.ipAddress ?? null,
      input.userAgent ?? null,
    ],
  );
}

async function ensureChecklistRows(target: EmployeeDocumentTarget, actorUserId?: string | null) {
  const [templates] = await db.execute<RowDataPacket[]>(
    `SELECT id, document_code, document_name, template_version, requires_candidate_esign, requires_hr_upload, is_mandatory
       FROM employee_joining_document_template
      WHERE active_status = 1
      ORDER BY is_mandatory DESC, document_name ASC`,
  );
  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT document_code FROM employee_joining_document_checklist WHERE employee_id = ?`,
    [target.id],
  );
  const existingCodes = new Set((existing as RowDataPacket[]).map((row) => String(row.document_code)));

  for (const template of templates as RowDataPacket[]) {
    const code = String(template.document_code);
    if (existingCodes.has(code)) continue;

    const actionType = Number(template.requires_candidate_esign) === 1
      ? "esign"
      : Number(template.requires_hr_upload) === 1
        ? "upload"
        : "generate";
    const ownerType = Number(template.requires_candidate_esign) === 1 ? "candidate" : "hr";
    const status = actionType === "esign"
      ? "pending_candidate_esign"
      : actionType === "generate"
        ? "pending_generation"
        : "pending_hr_upload";

    await db.execute(
      `INSERT INTO employee_joining_document_checklist
         (id, employee_id, candidate_id, template_id, document_code, document_name, template_version, owner_type, action_type, status, mandatory, due_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        target.id,
        target.candidate_id ?? null,
        template.id,
        code,
        template.document_name,
        template.template_version ?? "v1",
        ownerType,
        actionType,
        status,
        Number(template.is_mandatory) === 1 ? 1 : 0,
        target.date_of_joining ?? null,
      ],
    );
    await auditDocumentAction({
      employeeId: target.id,
      candidateId: target.candidate_id ?? null,
      documentCode: code,
      actionType: "CHECKLIST_CREATED",
      actorUserId: actorUserId ?? null,
      actorType: actorUserId ? "hr" : "system",
      newValue: { documentCode: code, status, actionType },
    });
  }
}

/**
 * The single writer of joining-document completion. Exported so the bulk
 * tracker actions defer to it instead of computing a rival figure.
 */
export async function recalculateDocumentProgress(employeeId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
        COUNT(*) AS total_count,
        SUM(CASE WHEN mandatory = 1 THEN 1 ELSE 0 END) AS mandatory_count,
        -- Must agree with isChecklistTerminalStatus below. It omitted
        -- 'esign_completed' and 'wet_signed_uploaded', so a joiner who Aadhaar
        -- e-signed every mandatory document still showed under 100% and stayed
        -- 'in_progress' for ever, unless HR additionally opened each item and
        -- pressed Verify. Three other consumers already use the wider set.
        SUM(CASE WHEN mandatory = 1 AND status IN ('verified', 'signed_verified', 'completed', 'esign_completed', 'wet_signed_uploaded') THEN 1 ELSE 0 END) AS mandatory_completed,
        SUM(CASE WHEN status IN ('verified', 'signed_verified', 'completed', 'esign_completed', 'wet_signed_uploaded') THEN 1 ELSE 0 END) AS completed_count
       FROM employee_joining_document_checklist
      WHERE employee_id = ?`,
    [employeeId],
  );
  const row = (rows as RowDataPacket[])[0];
  const total = Number(row?.mandatory_count ?? row?.total_count ?? 0);
  const done = Number(row?.mandatory_completed ?? row?.completed_count ?? 0);
  const pct = total > 0 ? Number(((done / total) * 100).toFixed(2)) : 0;
  const status = total > 0 && done >= total ? "completed" : done > 0 ? "in_progress" : "pending";

  try {
    await db.execute(
      `UPDATE employees
          SET joining_document_status = ?,
              joining_document_completion_pct = ?,
              joining_document_completed_at = CASE WHEN ? = 'completed' THEN COALESCE(joining_document_completed_at, NOW()) ELSE NULL END
        WHERE id = ?`,
      [status, pct, status, employeeId],
    );
  } catch (error) {
    if (!isMissingJoiningDocumentStatusColumn(error)) throw error;
    await db.execute(
      `UPDATE employees
          SET joining_document_completion_pct = ?,
              joining_document_completed_at = CASE WHEN ? = 'completed' THEN COALESCE(joining_document_completed_at, NOW()) ELSE NULL END
        WHERE id = ?`,
      [pct, status, employeeId],
    );
  }

  try {
    await db.execute(
      `UPDATE ats_onboarding_bridge
          SET joining_document_status = ?,
              joining_document_completion_pct = ?,
              joining_document_completed_at = CASE WHEN ? = 'completed' THEN COALESCE(joining_document_completed_at, NOW()) ELSE NULL END
        WHERE employee_id = ?`,
      [status, pct, status, employeeId],
    );
  } catch (error) {
    if (!isMissingJoiningDocumentStatusColumn(error)) throw error;
    await db.execute(
      `UPDATE ats_onboarding_bridge
          SET joining_document_completion_pct = ?,
              joining_document_completed_at = CASE WHEN ? = 'completed' THEN COALESCE(joining_document_completed_at, NOW()) ELSE NULL END
        WHERE employee_id = ?`,
      [pct, status, employeeId],
    ).catch(() => undefined);
  }
}

function resolveRoleForUpload(ownerType: string): FileRole {
  if (ownerType === "candidate") return "supporting";
  return "hr_uploaded";
}

async function fetchChecklistRow(checklistId: string): Promise<ChecklistRow | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_id, candidate_id, document_code, document_name, status, action_type, owner_type, template_version
       FROM employee_joining_document_checklist
      WHERE id = ?
      LIMIT 1`,
    [checklistId],
  );
  return (rows as unknown as ChecklistRow[])[0] ?? null;
}

async function latestChecklistFile(checklistId: string): Promise<LatestFileRow | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, checklist_id, original_filename, file_role, mime_type, storage_path
       FROM employee_joining_document_file
      WHERE checklist_id = ?
        AND deleted_at IS NULL
      ORDER BY FIELD(file_role, 'signed', 'generated', 'hr_uploaded', 'supporting', 'template', 'sent_for_esign'), uploaded_at DESC
      LIMIT 1`,
    [checklistId],
  );
  return (rows as unknown as LatestFileRow[])[0] ?? null;
}

async function writeSecureFile(params: {
  employeeId: string;
  documentCode: string;
  fileName: string;
  content: Buffer;
}) {
  const ext = fileExtension(params.fileName);
  if (ext && !ALLOWED_EXTENSIONS.has(ext) && ext !== ".txt") {
    const err = new Error(`File type ${ext} is not allowed`) as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }

  const safeDocumentCode = params.documentCode.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  const safeExt = ext || ".bin";
  const employeeDir = path.join(STORAGE_ROOT, params.employeeId, safeDocumentCode);
  ensureDir(employeeDir);

  const storedFilename = `${Date.now()}-${randomUUID()}${safeExt}`;
  const fullPath = path.join(employeeDir, storedFilename);
  fs.writeFileSync(fullPath, params.content);
  return {
    storedFilename,
    storagePath: fullPath,
    fileHash: sha256(params.content),
    fileSize: params.content.byteLength,
    mimeType: mimeTypeFromExtension(safeExt),
  };
}

function mimeTypeFromExtension(ext: string) {
  switch (ext) {
    case ".pdf": return "application/pdf";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".png": return "image/png";
    case ".webp": return "image/webp";
    case ".doc": return "application/msword";
    case ".docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default: return "application/octet-stream";
  }
}

async function insertFileRecord(params: {
  checklistId: string;
  employeeId: string;
  candidateId?: string | null;
  documentCode: string;
  fileRole: FileRole;
  originalFilename: string;
  storedFilename: string;
  storagePath: string;
  mimeType: string;
  fileSize: number;
  fileHash: string;
  uploadedBy?: string | null;
  uploadedByType?: ActorType;
}) {
  const id = randomUUID();
  await db.execute(
    `INSERT INTO employee_joining_document_file
       (id, checklist_id, employee_id, candidate_id, document_code, file_role, original_filename, stored_filename, storage_path, mime_type, file_size_bytes, file_hash_sha256, uploaded_by, uploaded_by_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.checklistId,
      params.employeeId,
      params.candidateId ?? null,
      params.documentCode,
      params.fileRole,
      params.originalFilename,
      params.storedFilename,
      params.storagePath,
      params.mimeType,
      params.fileSize,
      params.fileHash,
      params.uploadedBy ?? null,
      params.uploadedByType === "candidate"
        ? "candidate"
        : params.uploadedByType === "system"
          ? "system"
          : params.uploadedByType === "employee"
            ? "employee"
            : "hr",
    ],
  );
  return id;
}

/**
 * Throws unless a real template file exists on disk for this document.
 * Mirrors the check ensureGeneratedFile uses to decide template_pending.
 */
async function assertTemplateConfiguredForEsign(checklist: ChecklistRow): Promise<void> {
  // `template_version`, not `version`. There is no `version` column, so this
  // query raised "Unknown column 'version' in 'order clause'" on every call —
  // and the catch below turned that into an empty result, which reads exactly
  // like "no template configured". Every e-sign request was rejected with 409
  // regardless of how well the templates were set up.
  //
  // The catch stays, so a genuine database problem still degrades to a clear
  // message rather than a 500, but it now logs instead of swallowing silently.
  const [templateRows] = await db.execute<RowDataPacket[]>(
    `SELECT template_storage_path
       FROM employee_joining_document_template
      WHERE document_code = ? AND active_status = 1
      ORDER BY (template_version = ?) DESC, updated_at DESC
      LIMIT 1`,
    [checklist.document_code, checklist.template_version],
  ).catch((error: unknown) => {
    console.error(
      `[joining-docs] template lookup failed for ${checklist.document_code}:`,
      error instanceof Error ? error.message : String(error),
    );
    return [[] as RowDataPacket[], []] as [RowDataPacket[], unknown];
  });

  const storagePath = (templateRows as RowDataPacket[])[0]?.template_storage_path;
  if (templateFileExists(storagePath)) return;

  const err = new Error(
    `No document template is configured for ${checklist.document_code}. ` +
    `Upload the template under Settings → Document Templates before sending it for e-signature — ` +
    `otherwise the employee would be asked to sign a placeholder marked DRAFT.`,
  ) as Error & { statusCode?: number };
  err.statusCode = 409;
  throw err;
}

function isChecklistTerminalStatus(status: string) {
  return new Set(["verified", "completed", "esign_completed", "signed_verified", "wet_signed_uploaded"]).has(String(status || "").trim().toLowerCase());
}

async function generateAgreementPdf(checklist: ChecklistRow, target: EmployeeDocumentTarget, actorUserId?: string | null, templateConfigured = false) {
  if (templateConfigured) {
    try {
      await generateChecklistDraft(checklist.id, actorUserId ?? null);
      const generatedDraft = await latestChecklistFile(checklist.id);
      if (
        generatedDraft &&
        resolveJoiningDocumentFile(generatedDraft.storage_path, checklist.employee_id, checklist.document_code)
      ) {
        return generatedDraft;
      }
    } catch (err: unknown) {
      console.error('[generateAgreementPdf] Template rendering failed, falling back to placeholder draft:', {
        checklistId: checklist.id,
        documentCode: checklist.document_code,
        employeeId: checklist.employee_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  ensureDir(path.join(STORAGE_ROOT, target.id, checklist.document_code.toLowerCase()));
  const tempPath = path.join(
    STORAGE_ROOT,
    target.id,
    checklist.document_code.toLowerCase(),
    `${checklist.document_code.toLowerCase()}-${Date.now()}-${randomUUID()}.pdf`,
  );

  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: "A4" });
    const stream = fs.createWriteStream(tempPath);
    doc.pipe(stream);
    doc.fontSize(22).fillColor("#B91C1C").text("DRAFT - TEMPLATE NOT CONFIGURED", { align: "center" });
    doc.moveDown(0.75);
    doc.fillColor("#111827").fontSize(18).text(checklist.document_name, { align: "center" });
    doc.moveDown();
    doc.fontSize(11).text(`Employee: ${target.full_name ?? "Employee"}`);
    doc.text(`Employee Code: ${target.employee_code ?? "Not allotted"}`);
    doc.text(`Document Code: ${checklist.document_code}`);
    doc.text(`Version: ${checklist.template_version}`);
    doc.text(`Generated On: ${new Date().toLocaleString("en-IN")}`);
    doc.moveDown();
    doc.text(
      `This draft exists only because a production template has not been configured yet. ` +
      `HR must upload the official template and field map before this document can be used for production eSign.`,
      { align: "justify" },
    );
    doc.moveDown();
    doc.text("Key obligations:", { underline: true });
    doc.list([
      "Employee confirms all information and submitted records are accurate.",
      "Confidential and company data must be handled only through approved systems.",
      "Violations are subject to disciplinary and statutory action as applicable.",
      "The finalized signed artifact remains available only through secure HRMS preview and download routes.",
    ]);
    doc.moveDown(2);
    doc.text("Employee Signature / Aadhaar eSign", 72, doc.y + 12);
    doc.moveTo(72, doc.y + 28).lineTo(280, doc.y + 28).stroke();
    doc.moveDown(4);
    doc.text("HR Verification", 320, doc.y - 34);
    doc.moveTo(320, doc.y - 18).lineTo(520, doc.y - 18).stroke();
    doc.end();
    stream.on("finish", () => resolve());
    stream.on("error", reject);
  });

  const buffer = fs.readFileSync(tempPath);
  const storedFilename = path.basename(tempPath);
  const fileHash = sha256(buffer);
  const fileSize = buffer.byteLength;
  const fileId = await insertFileRecord({
    checklistId: checklist.id,
    employeeId: checklist.employee_id,
    candidateId: checklist.candidate_id ?? null,
    documentCode: checklist.document_code,
    fileRole: "generated",
    originalFilename: `${checklist.document_code.toLowerCase()}-${target.employee_code ?? checklist.employee_id}.pdf`,
    storedFilename,
    storagePath: tempPath,
    mimeType: "application/pdf",
    fileSize,
    fileHash,
    uploadedBy: actorUserId ?? null,
    uploadedByType: actorUserId ? "hr" : "system",
  });

  return {
    id: fileId,
    checklist_id: checklist.id,
    original_filename: `${checklist.document_code.toLowerCase()}-${target.employee_code ?? checklist.employee_id}.pdf`,
    file_role: "generated",
    mime_type: "application/pdf",
    storage_path: tempPath,
  } as LatestFileRow;
}

async function ensureGeneratedFile(checklist: ChecklistRow, target: EmployeeDocumentTarget, actorUserId?: string | null) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, checklist_id, original_filename, file_role, mime_type, storage_path
       FROM employee_joining_document_file
      WHERE checklist_id = ?
        AND file_role IN ('generated', 'signed')
        AND deleted_at IS NULL
      ORDER BY FIELD(file_role, 'signed', 'generated'), uploaded_at DESC
      LIMIT 1`,
    [checklist.id],
  );
  const existing = (rows as unknown as LatestFileRow[])[0] ?? null;
  // Resolve rather than trusting storage_path: a false negative here does not 404,
  // it regenerates the document and resets the checklist status. See
  // resolveJoiningDocumentFile.
  if (
    existing &&
    resolveJoiningDocumentFile(existing.storage_path, checklist.employee_id, checklist.document_code)
  ) {
    return existing;
  }

  const [templateRows] = await db.execute<RowDataPacket[]>(
    `SELECT template_storage_path
       FROM employee_joining_document_template
      WHERE document_code = ?
        AND template_version = ?
      AND active_status = 1
      LIMIT 1`,
    [checklist.document_code, checklist.template_version],
  );
  const templateRow = templateRows[0] as RowDataPacket | undefined;
  const templateConfigured = templateFileExists(templateRow?.template_storage_path);
  const generated = await generateAgreementPdf(checklist, target, actorUserId, templateConfigured);
  const fileId = generated.id;
  const originalFilename = generated.original_filename ?? `${checklist.document_code.toLowerCase()}-${target.employee_code ?? checklist.employee_id}.pdf`;

  await db.execute(
    `UPDATE employee_joining_document_checklist
        SET status = CASE
              WHEN ? = 1 THEN CASE WHEN action_type = 'esign' THEN 'pending_candidate_esign' ELSE 'uploaded_pending_review' END
              ELSE 'template_pending'
            END,
            updated_at = NOW()
      WHERE id = ?`,
    [templateConfigured ? 1 : 0, checklist.id],
  );

  await auditDocumentAction({
    employeeId: checklist.employee_id,
    candidateId: checklist.candidate_id ?? null,
    checklistId: checklist.id,
    documentCode: checklist.document_code,
    actionType: "DOCUMENT_GENERATED",
    actorUserId: actorUserId ?? null,
    actorType: actorUserId ? "hr" : "system",
    newValue: { fileId, originalFilename },
  });

  await recalculateDocumentProgress(checklist.employee_id);
  return {
    id: fileId,
    checklist_id: checklist.id,
    original_filename: originalFilename,
    file_role: "generated",
    mime_type: generated.mime_type,
    storage_path: generated.storage_path,
  } as LatestFileRow;
}

async function getChecklistBundle(employeeId: string): Promise<JoiningChecklistItem[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
        c.id,
        c.document_code,
        c.document_name,
        c.owner_type,
        c.action_type,
        c.status,
        c.mandatory,
        c.template_version,
        c.verification_status,
        c.verification_remarks,
        c.due_at,
        c.completed_at,
        c.analysis_result_json,
        lf.id AS latest_file_id,
        lf.original_filename AS latest_file_name,
        lf.file_role AS latest_file_role,
        lf.mime_type AS latest_file_mime,
        tx.status AS latest_esign_status,
        tx.provider_url AS latest_esign_url,
        tok.token_status AS public_token_status,
        tok.expires_at AS public_token_expires_at,
        CASE WHEN tok.token_status IS NOT NULL THEN 1 ELSE 0 END AS publicTokenIssued
       FROM employee_joining_document_checklist c
       LEFT JOIN employee_joining_document_file lf
         ON lf.id = (
           SELECT f2.id
             FROM employee_joining_document_file f2
            WHERE f2.checklist_id = c.id
              AND f2.deleted_at IS NULL
            ORDER BY FIELD(f2.file_role, 'signed', 'generated', 'hr_uploaded', 'supporting', 'template', 'sent_for_esign'), f2.uploaded_at DESC
            LIMIT 1
         )
       LEFT JOIN employee_document_esign_transaction tx
         ON tx.id = (
           SELECT t2.id
             FROM employee_document_esign_transaction t2
            WHERE t2.checklist_id = c.id
            ORDER BY t2.initiated_at DESC
            LIMIT 1
         )
       LEFT JOIN employee_joining_document_public_token tok
         ON tok.id = (
           SELECT p2.id
             FROM employee_joining_document_public_token p2
            WHERE p2.checklist_id = c.id
            ORDER BY p2.created_at DESC
            LIMIT 1
         )
      WHERE c.employee_id = ?
      ORDER BY c.mandatory DESC, c.document_name ASC`,
    [employeeId],
  );
  return (rows as unknown as JoiningChecklistItem[]).map((row) => ({
    ...row,
    latest_esign_url: safeExternalProviderUrl(row.latest_esign_url),
  }));
}

// Maps joining document codes → employee_documents doc_type values that represent the same document
const JOINING_TO_GENERAL_DOC_TYPE: Record<string, string[]> = {
  EMPLOYMENT_CONTRACT: ["contract", "offer_letter"],
  EPF_DECLARATION: ["epf_declaration"],
  OTHER_JOINING_DOCUMENT: ["other"],
};

export async function getJoiningDocumentPack(employeeId: string, userId: string) {
  const access = await resolveEmployeeDocumentAccessContext(userId, employeeId);
  await ensureChecklistRows(access.target, userId);
  await recalculateDocumentProgress(employeeId);
  const checklist = await getChecklistBundle(employeeId);

  // Cross-reference: fetch general employee_documents and attach matching ones to checklist items
  let generalDocs: RowDataPacket[] = [];
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT doc_type, doc_name, file_url, verified
         FROM employee_documents
        WHERE employee_id = ? AND file_url IS NOT NULL AND file_url <> ''`,
      [employeeId],
    );
    generalDocs = rows;
  } catch (_e) { /* table may not exist */ }

  const checklistWithLinks = checklist.map((item) => {
    if (item.latest_file_id) return item; // already has its own file
    const mappedTypes = JOINING_TO_GENERAL_DOC_TYPE[item.document_code];
    if (!mappedTypes) return item;
    const match = generalDocs.find((d) => mappedTypes.includes(String(d.doc_type ?? "").toLowerCase()));
    if (!match) return item;
    return {
      ...item,
      linked_doc: {
        doc_type: String(match.doc_type),
        doc_name: match.doc_name ? String(match.doc_name) : null,
        file_url: String(match.file_url),
        verified: Number(match.verified),
      } as LinkedGeneralDoc,
    };
  });

  const [auditRows] = await db.execute<RowDataPacket[]>(
    `SELECT action_type, remarks, actor_type, created_at, document_code
       FROM employee_joining_document_audit_log
      WHERE employee_id = ?
      ORDER BY created_at DESC
      LIMIT 20`,
    [employeeId],
  );

  return {
    employee: {
      id: access.target.id,
      employee_code: access.target.employee_code,
      full_name: access.target.full_name,
      official_email: access.target.official_email,
      mobile: access.target.mobile,
      joining_document_status: access.target.joining_document_status,
      joining_document_completion_pct: access.target.joining_document_completion_pct ?? 0,
      candidate_id: access.target.candidate_id,
    },
    permissions: {
      can_manage: access.canManage,
      can_download: access.roles.some((role) => SECURE_DOWNLOAD_ROLES.has(role)) || access.isSelf || access.isAdmin,
      can_payroll_view: access.canPayroll,
      is_self: access.isSelf,
    },
    checklist: checklistWithLinks,
    audit: auditRows,
  };
}

export async function generateJoiningDocumentChecklist(employeeId: string, userId: string) {
  const access = await resolveEmployeeDocumentAccessContext(userId, employeeId);
  await ensureChecklistRows(access.target, userId);
  await recalculateDocumentProgress(employeeId);
  await auditDocumentAction({
    employeeId,
    candidateId: access.target.candidate_id,
    actionType: "CHECKLIST_GENERATED",
    actorUserId: userId,
    actorType: access.isSelf ? "employee" : "hr",
    newValue: { generated: true },
  });
  return getJoiningDocumentPack(employeeId, userId);
}

export async function updateJoiningDocumentChecklistStatus(params: {
  employeeId: string;
  checklistId: string;
  actorUserId: string;
  status: string;
  remarks?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const access = await resolveEmployeeDocumentAccessContext(params.actorUserId, params.employeeId);
  const checklist = await fetchChecklistRow(params.checklistId);
  if (!checklist || checklist.employee_id !== params.employeeId) {
    const err = new Error("Checklist item not found") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  const nextStatus = String(params.status ?? "").trim().toLowerCase();
  if (!nextStatus) {
    const err = new Error("status is required") as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }

  // This endpoint accepted any free-text status, and access is granted to the
  // employee themselves (isSelf). That let a joiner PATCH their own document to
  // 'verified', which recalculateDocumentProgress counts as complete and which
  // stamps verified_by/verified_at — self-approval of their own paperwork.
  if (!ALLOWED_CHECKLIST_STATUSES.has(nextStatus)) {
    const err = new Error(
      `Unsupported status "${nextStatus}". Allowed: ${[...ALLOWED_CHECKLIST_STATUSES].sort().join(", ")}`,
    ) as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }

  // Verification outcomes are an HR decision — same guard reviewJoiningDocument
  // already applies.
  if (HR_ONLY_CHECKLIST_STATUSES.has(nextStatus)) {
    const isHrReviewer = access.isAdmin || access.roles.some((role) => [...HR_SCOPE_ROLES, "hr"].includes(role));
    if (!isHrReviewer) {
      const err = new Error(`Only HR-scoped users can set a document to "${nextStatus}"`) as Error & { statusCode?: number };
      err.statusCode = 403;
      throw err;
    }
  }

  const normalizedVerificationStatus =
    nextStatus === "verified"
      ? "verified"
      : nextStatus === "needs_correction" || nextStatus === "correction_requested"
        ? "needs_correction"
        : null;

  await db.execute(
    `UPDATE employee_joining_document_checklist
        SET status = ?,
            verification_status = COALESCE(?, verification_status),
            verification_remarks = CASE WHEN ? IS NULL OR ? = '' THEN verification_remarks ELSE ? END,
            verified_by = CASE WHEN ? = 'verified' THEN ? ELSE verified_by END,
            verified_at = CASE WHEN ? = 'verified' THEN NOW() ELSE verified_at END,
            completed_at = CASE WHEN ? THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
            updated_at = NOW()
      WHERE id = ?`,
    [
      nextStatus,
      normalizedVerificationStatus,
      params.remarks ?? null,
      params.remarks ?? null,
      params.remarks ?? null,
      nextStatus,
      params.actorUserId,
      nextStatus,
      isChecklistTerminalStatus(nextStatus) ? 1 : 0,
      checklist.id,
    ],
  );

  await auditDocumentAction({
    employeeId: checklist.employee_id,
    candidateId: checklist.candidate_id ?? null,
    checklistId: checklist.id,
    documentCode: checklist.document_code,
    actionType: "CHECKLIST_STATUS_UPDATED",
    actorUserId: params.actorUserId,
    actorType: access.isSelf ? "employee" : "hr",
    remarks: params.remarks ?? null,
    newValue: { status: nextStatus },
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
  });

  await recalculateDocumentProgress(params.employeeId);
  return getJoiningDocumentPack(params.employeeId, params.actorUserId);
}

export async function uploadJoiningDocument(params: {
  employeeId: string;
  checklistId: string;
  file: Express.Multer.File;
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  /**
   * HR is filing a physically signed copy because e-signing could not be used.
   * The provider is not always available - Luckpay rejects the DOCX drafts these
   * templates produce with "Unable to generate appearance" - and the API already
   * tells the operator to "use the wet-sign fallback workflow". Until now that
   * workflow did not exist: wet_signed_uploaded was read in five places and
   * written in none, so the fallback the UI advertised could never be reached.
   */
  wetSigned?: boolean;
}) {
  const access = await resolveEmployeeDocumentAccessContext(params.actorUserId, params.employeeId);
  const checklist = await fetchChecklistRow(params.checklistId);
  if (!checklist || checklist.employee_id !== params.employeeId) {
    const err = new Error("Checklist item not found") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  if (!params.file?.buffer?.byteLength) {
    const err = new Error("File upload is required") as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }

  const ext = fileExtension(params.file.originalname);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    const err = new Error(`File type ${ext || "unknown"} is not allowed`) as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }

  const written = await writeSecureFile({
    employeeId: params.employeeId,
    documentCode: checklist.document_code,
    fileName: params.file.originalname,
    content: params.file.buffer,
  });
  const fileId = await insertFileRecord({
    checklistId: checklist.id,
    employeeId: checklist.employee_id,
    candidateId: checklist.candidate_id ?? null,
    documentCode: checklist.document_code,
    fileRole: resolveRoleForUpload(checklist.owner_type),
    originalFilename: params.file.originalname,
    storedFilename: written.storedFilename,
    storagePath: written.storagePath,
    mimeType: params.file.mimetype || written.mimeType,
    fileSize: params.file.size,
    fileHash: written.fileHash,
    uploadedBy: params.actorUserId,
    uploadedByType: access.isSelf ? "employee" : "hr",
  });

  const analysis = await analyzeEmployeeJoiningDocument({
    filePath: written.storagePath,
    fileRole: resolveRoleForUpload(checklist.owner_type),
    documentCode: checklist.document_code,
    documentName: checklist.document_name,
    templateVersion: checklist.template_version,
    employeeName: access.target.full_name ?? "Employee",
    employeeCode: access.target.employee_code ?? "",
  }).catch(() => null);

  let nextStatus = checklist.action_type === "esign" ? "uploaded_pending_esign" : "uploaded_pending_review";
  if (params.wetSigned) {
    // Same guard as every other verification outcome - see HR_ONLY_CHECKLIST_STATUSES.
    const isHrReviewer = access.isAdmin || access.roles.some((role) => [...HR_SCOPE_ROLES, "hr"].includes(role));
    if (!isHrReviewer) {
      const err = new Error('Only HR-scoped users can file a wet-signed copy') as Error & { statusCode?: number };
      err.statusCode = 403;
      throw err;
    }
    nextStatus = "wet_signed_uploaded";
  }
  await db.execute(
    `UPDATE employee_joining_document_checklist
        SET status = ?,
            completed_at = NOW(),
            analysis_result_json = ?,
            updated_at = NOW()
      WHERE id = ?`,
    [nextStatus, analysis ? JSON.stringify(analysis) : null, checklist.id],
  );

  await auditDocumentAction({
    employeeId: checklist.employee_id,
    candidateId: checklist.candidate_id ?? null,
    checklistId: checklist.id,
    documentCode: checklist.document_code,
    actionType: "DOCUMENT_UPLOADED",
    actorUserId: params.actorUserId,
    actorType: access.isSelf ? "employee" : "hr",
    newValue: { fileId, status: nextStatus },
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
  });

  await recalculateDocumentProgress(params.employeeId);
  return getJoiningDocumentPack(params.employeeId, params.actorUserId);
}

export async function reviewJoiningDocument(params: {
  employeeId: string;
  checklistId: string;
  actorUserId: string;
  decision: "verified" | "needs_correction";
  remarks?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const access = await resolveEmployeeDocumentAccessContext(params.actorUserId, params.employeeId);
  const isHrReviewer = access.isAdmin || access.roles.some((role) => [...HR_SCOPE_ROLES, "hr"].includes(role));
  if (!isHrReviewer) {
    const err = new Error("Only HR-scoped users can review joining documents") as Error & { statusCode?: number };
    err.statusCode = 403;
    throw err;
  }

  const checklist = await fetchChecklistRow(params.checklistId);
  if (!checklist || checklist.employee_id !== params.employeeId) {
    const err = new Error("Checklist item not found") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const nextStatus = params.decision === "verified"
    ? checklist.action_type === "esign" ? "completed" : "verified"
    : "needs_correction";
  await db.execute(
    `UPDATE employee_joining_document_checklist
        SET status = ?,
            verification_status = ?,
            verification_remarks = ?,
            verified_by = ?,
            verified_at = NOW(),
            completed_at = CASE WHEN ? = 'verified' THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
            updated_at = NOW()
      WHERE id = ?`,
    [nextStatus, params.decision, params.remarks ?? null, params.actorUserId, params.decision, checklist.id],
  );

  await auditDocumentAction({
    employeeId: checklist.employee_id,
    candidateId: checklist.candidate_id ?? null,
    checklistId: checklist.id,
    documentCode: checklist.document_code,
    actionType: params.decision === "verified" ? "DOCUMENT_VERIFIED" : "DOCUMENT_PUSHBACK",
    actorUserId: params.actorUserId,
    actorType: "hr",
    remarks: params.remarks ?? null,
    newValue: { status: nextStatus },
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
  });

  await recalculateDocumentProgress(params.employeeId);
  return getJoiningDocumentPack(params.employeeId, params.actorUserId);
}

function buildPublicSigningLink(documentCode: string, publicToken: string) {
  if (String(documentCode).toUpperCase() === "EPF_DECLARATION") {
    return `${frontendBaseUrl()}/employee/epf-compliance/review/${publicToken}`;
  }
  return `${frontendBaseUrl()}/employee/joining-documents/esign/${publicToken}`;
}

export async function createJoiningDocumentEsignRequest(params: {
  employeeId: string;
  checklistId: string;
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const access = await resolveEmployeeDocumentAccessContext(params.actorUserId, params.employeeId);
  const checklist = await fetchChecklistRow(params.checklistId);
  if (!checklist || checklist.employee_id !== params.employeeId) {
    const err = new Error("Checklist item not found") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  // Refuse to send an unconfigured template out for signature. When no template
  // file exists, generateAgreementPdf produces a placeholder stamped
  // "DRAFT - TEMPLATE NOT CONFIGURED" and the checklist goes to
  // template_pending — but this flow ignored that and emailed the signing link
  // anyway, so a joiner could be asked to legally sign a watermarked draft.
  await assertTemplateConfiguredForEsign(checklist);

  const sourceFile = await ensureGeneratedFile(checklist, access.target, params.actorUserId);
  const publicToken = randomBytes(24).toString("hex");
  const publicTokenHash = sha256(publicToken);
  const tokenLink = buildPublicSigningLink(checklist.document_code, publicToken);

  await db.execute(
    `INSERT INTO employee_joining_document_public_token
       (id, checklist_id, employee_id, candidate_id, document_code, public_token, public_token_hash, token_status, expires_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    [
      randomUUID(),
      checklist.id,
      checklist.employee_id,
      checklist.candidate_id ?? null,
      checklist.document_code,
      publicToken,
      publicTokenHash,
      nowPlusDays(7),
      params.actorUserId,
    ],
  );

  const clientTransactionId = generateClientTransactionId("joining-doc");
  const transactionId = randomUUID();
  let providerReferenceId: string | null = null;
  let providerUrl: string | null = null;
  let externalProviderUrl: string | null = null;
  let responsePayload: Record<string, unknown> = {
    internalLinkIssued: true,
    publicTokenHash,
  };
  let status = "link_generated";
  let errorMessage: string | null = null;

  try {
    if (env.LUCKPAY_PROVIDER_ENABLED) {
      const luckpay = await esignWithUrl({
        filePath: sourceFile.storage_path,
        clientTransactionId,
        signedBy: access.target.full_name ?? access.target.employee_code ?? "Employee",
        location: "India",
        reason: checklist.document_name,
      });
      providerReferenceId = luckpay.providerReferenceId;
      externalProviderUrl = luckpay.providerUrl ?? null;
      providerUrl = externalProviderUrl;
      const luckpayResponse = luckpay.response && typeof luckpay.response === "object" && !Array.isArray(luckpay.response)
        ? { ...(luckpay.response as Record<string, unknown>) }
        : {};
      delete luckpayResponse.signLink;
      delete luckpayResponse.sign_link;
      responsePayload = sanitizeProviderPayload({
        ...luckpayResponse,
        internalLinkIssued: true,
        publicTokenHash,
      }) as Record<string, unknown>;
      status = luckpay.status || "initiated";
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    // Degrading to the internal signing link is intentional, but it must be
    // visible — otherwise a provider outage looks like a normal eSign request.
    console.warn(`[Luckpay] eSign fell back to internal link for checklist ${checklist.id}: ${errorMessage}`);
    responsePayload = sanitizeProviderPayload({
      internalLinkIssued: true,
      publicTokenHash,
      fallback: true,
    }) as Record<string, unknown>;
    status = "fallback_internal_link";
  }

  await db.execute(
    `INSERT INTO employee_document_esign_transaction
       (id, checklist_id, employee_id, candidate_id, document_code, provider, client_transaction_id, provider_reference_id, signer_name, signer_mobile, signer_email, signer_location, signing_reason, status, provider_url, response_payload, error_message, initiated_by)
     VALUES (?, ?, ?, ?, ?, 'luckpay', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      transactionId,
      checklist.id,
      checklist.employee_id,
      checklist.candidate_id ?? null,
      checklist.document_code,
      clientTransactionId,
      providerReferenceId,
      access.target.full_name ?? null,
      access.target.mobile ?? null,
      access.target.official_email ?? null,
      "India",
      checklist.document_name,
      status,
      providerUrl,
      JSON.stringify(responsePayload),
      errorMessage,
      params.actorUserId,
    ],
  );

  await db.execute(
    `UPDATE employee_joining_document_checklist
        SET status = 'esign_initiated',
            updated_at = NOW()
      WHERE id = ?`,
    [checklist.id],
  );

  await auditDocumentAction({
    employeeId: checklist.employee_id,
    candidateId: checklist.candidate_id ?? null,
    checklistId: checklist.id,
    documentCode: checklist.document_code,
    actionType: "ESIGN_INITIATED",
    actorUserId: params.actorUserId,
    actorType: "hr",
    newValue: { providerUrl: providerUrl ? "available" : "missing", publicTokenIssued: true },
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
  });

  await recalculateDocumentProgress(params.employeeId);

  // Auto-email the sign link to the employee (both personal and official email)
  try {
    // Fetch personal_email separately — it's not on EmployeeDocumentTarget
    const [empEmailRows] = await db.execute<RowDataPacket[]>(
      `SELECT personal_email FROM employees WHERE id = ? LIMIT 1`,
      [params.employeeId]
    );
    const personalEmail: string | null = (empEmailRows as any[])[0]?.personal_email ?? null;
    const toAddresses = [
      personalEmail,
      access.target.official_email,
    ].filter((e): e is string => typeof e === "string" && e.includes("@"));
    const uniqueTo = [...new Set(toAddresses)];
    if (uniqueTo.length > 0) {
      const expiryDate = new Date(Date.now() + 7 * 24 * 3600 * 1000);
      const expiryStr = expiryDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
      const emailHtml = buildJoiningDocEsignEmailHtml({
        employeeName: access.target.full_name ?? access.target.employee_code ?? "Employee",
        documentName: checklist.document_name,
        signLink: tokenLink,
        expiryStr,
      });
      for (const toAddr of uniqueTo) {
        await emailService.send({
          to: toAddr,
          subject: `Action Required: Please sign your ${checklist.document_name} — MAS Callnet`,
          html: emailHtml,
        });
      }
    } else {
      console.warn(`[joining-docs] eSign link not emailed — employee ${params.employeeId} has no personal_email or official_email on record`);
    }
  } catch (emailErr) {
    console.warn("[joining-docs] Non-fatal: eSign email delivery failed:", emailErr);
  }

  return {
    sign_link: tokenLink,
    provider_url: externalProviderUrl,
    provider_status: status,
    fallback_message: errorMessage,
    pack: await getJoiningDocumentPack(params.employeeId, params.actorUserId),
  };
}

async function fileAccessContext(fileId: string, userId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
        f.id,
        f.checklist_id,
        f.employee_id,
        f.document_code,
        f.storage_path,
        f.mime_type,
        f.original_filename,
        c.candidate_id
       FROM employee_joining_document_file f
       JOIN employee_joining_document_checklist c ON c.id = f.checklist_id
      WHERE f.id = ?
        AND f.deleted_at IS NULL
      LIMIT 1`,
    [fileId],
  );
  const file = (rows as RowDataPacket[])[0] as (RowDataPacket & {
    id: string;
    checklist_id: string;
    employee_id: string;
    document_code: string;
    storage_path: string;
    mime_type: string | null;
    original_filename: string | null;
    candidate_id: string | null;
  }) | undefined;
  if (!file) {
    const err = new Error("Document file not found") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  const access = await resolveEmployeeDocumentAccessContext(userId, String(file.employee_id));
  return { file, access };
}

export async function getJoiningDocumentFileForAccess(params: {
  fileId: string;
  actorUserId: string;
  action: "preview" | "download";
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const { file, access } = await fileAccessContext(params.fileId, params.actorUserId);
  const canDownload = access.isAdmin || access.isSelf || access.roles.some((role) => SECURE_DOWNLOAD_ROLES.has(role));
  const canPreview = access.canManage;

  if (params.action === "preview" && !canPreview) {
    const err = new Error("Not authorized to preview this document") as Error & { statusCode?: number };
    err.statusCode = 403;
    throw err;
  }
  if (params.action === "download" && !canDownload) {
    const err = new Error("Not authorized to download this document") as Error & { statusCode?: number };
    err.statusCode = 403;
    throw err;
  }
  if (access.canPayroll && !access.isAdmin && !access.isSelf && !isPayrollDocument(String(file.document_code))) {
    const err = new Error("Payroll access is limited to payroll-relevant joining documents") as Error & { statusCode?: number };
    err.statusCode = 403;
    throw err;
  }
  // Resolve through the module's own path fallback rather than trusting the stored
  // string. Some rows hold an absolute path from a developer machine
  // ("C:\Users\...\private-storage\...") because the same shared database is written
  // from off-server: the bytes can sit in the canonical place under STORAGE_ROOT
  // while the recorded path names a drive this host does not have. A bare
  // existsSync() on that string reports "missing from storage" for a file that is
  // right there. When the bytes genuinely are absent, this still returns null and
  // the same 404 is raised.
  const resolvedPath = resolveJoiningDocumentFile(
    file.storage_path,
    String(file.employee_id),
    String(file.document_code),
  );
  if (!resolvedPath) {
    const err = new Error("Secure document file is missing from storage") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  await auditDocumentAction({
    employeeId: String(file.employee_id),
    candidateId: String(file.candidate_id || ""),
    checklistId: String(file.checklist_id),
    documentCode: String(file.document_code),
    actionType: params.action === "preview" ? "DOCUMENT_PREVIEWED" : "DOCUMENT_DOWNLOADED",
    actorUserId: params.actorUserId,
    actorType: access.isSelf ? "employee" : "hr",
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
  });

  return {
    storagePath: resolvedPath,
    mimeType: String(file.mime_type || "application/octet-stream"),
    fileName: String(file.original_filename || `${file.document_code}.bin`),
  };
}

export async function getChecklistDocumentFileForAccess(params: {
  employeeId: string;
  checklistId: string;
  actorUserId: string;
  action: "preview" | "download";
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  await resolveEmployeeDocumentAccessContext(params.actorUserId, params.employeeId);
  const checklist = await fetchChecklistRow(params.checklistId);
  if (!checklist || checklist.employee_id !== params.employeeId) {
    const err = new Error("Checklist item not found") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  const file = await latestChecklistFile(checklist.id);
  if (!file?.id) {
    const err = new Error("Document file is not available yet") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  return getJoiningDocumentFileForAccess({
    fileId: file.id,
    actorUserId: params.actorUserId,
    action: params.action,
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
  });
}

export async function deleteJoiningDocumentFile(params: {
  employeeId: string;
  checklistId: string;
  fileId: string;
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const access = await resolveEmployeeDocumentAccessContext(params.actorUserId, params.employeeId);
  const checklist = await fetchChecklistRow(params.checklistId);
  if (!checklist || checklist.employee_id !== params.employeeId) {
    const err = new Error("Checklist item not found") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, storage_path, original_filename, file_role
       FROM employee_joining_document_file
      WHERE id = ?
        AND checklist_id = ?
        AND deleted_at IS NULL
      LIMIT 1`,
    [params.fileId, params.checklistId],
  );
  const file = rows[0] as (RowDataPacket & {
    id: string;
    storage_path: string | null;
    original_filename: string | null;
    file_role: string;
  }) | undefined;
  if (!file) {
    const err = new Error("Document file not found") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  if (String(file.file_role).toLowerCase() === "signed") {
    const err = new Error("Signed documents are locked and cannot be deleted") as Error & { statusCode?: number };
    err.statusCode = 409;
    throw err;
  }

  await db.execute(
    `UPDATE employee_joining_document_file
        SET deleted_at = NOW()
      WHERE id = ?
        AND deleted_at IS NULL`,
    [params.fileId],
  );

  await auditDocumentAction({
    employeeId: checklist.employee_id,
    candidateId: checklist.candidate_id ?? null,
    checklistId: checklist.id,
    documentCode: checklist.document_code,
    actionType: "DOCUMENT_FILE_DELETED",
    actorUserId: params.actorUserId,
    actorType: access.isSelf ? "employee" : "hr",
    newValue: { fileId: params.fileId, fileName: file.original_filename ?? null },
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
  });

  await recalculateDocumentProgress(params.employeeId);
  return getJoiningDocumentPack(params.employeeId, params.actorUserId);
}

export async function listJoiningDocumentTemplates() {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
        t.id,
        t.document_code,
        t.document_name,
        t.document_category,
        t.template_version,
        t.template_storage_path,
        t.template_mime_type,
        t.fill_mode,
        CASE WHEN t.template_storage_path IS NOT NULL AND t.template_storage_path <> '' THEN 1 ELSE 0 END AS template_uploaded,
        COUNT(m.id) AS field_map_count,
        t.requires_candidate_esign,
        t.requires_hr_upload,
        t.requires_hr_verification,
        t.is_mandatory,
        t.active_status,
        t.created_at,
        t.updated_at
       FROM employee_joining_document_template t
       LEFT JOIN document_template_field_map m
         ON m.document_code = t.document_code
        AND (m.template_id = t.id OR m.template_id IS NULL)
      GROUP BY
        t.id,
        t.document_code,
        t.document_name,
        t.document_category,
        t.template_version,
        t.template_storage_path,
        t.template_mime_type,
        t.fill_mode,
        t.requires_candidate_esign,
        t.requires_hr_upload,
        t.requires_hr_verification,
        t.is_mandatory,
        t.active_status,
        t.created_at,
        t.updated_at
      ORDER BY t.active_status DESC, t.document_name ASC`,
  );
  return rows.map((row) => ({
    ...row,
    template_storage_path: row.template_storage_path ? "configured" : null,
    template_ready: Number(row.template_uploaded ?? 0) === 1 && Number(row.field_map_count ?? 0) > 0,
  }));
}

export async function upsertJoiningDocumentTemplate(params: {
  id?: string | null;
  actorUserId: string;
  document_code: string;
  document_name: string;
  document_category: string;
  template_version?: string | null;
  requires_candidate_esign?: boolean;
  requires_hr_upload?: boolean;
  requires_hr_verification?: boolean;
  is_mandatory?: boolean;
  active_status?: boolean;
}) {
  const id = params.id || randomUUID();
  const [existingRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employee_joining_document_template WHERE id = ? LIMIT 1`,
    [id],
  );
  if ((existingRows as RowDataPacket[]).length > 0) {
    await db.execute(
      `UPDATE employee_joining_document_template
          SET document_code = ?,
              document_name = ?,
              document_category = ?,
              template_version = ?,
              requires_candidate_esign = ?,
              requires_hr_upload = ?,
              requires_hr_verification = ?,
              is_mandatory = ?,
              active_status = ?,
              created_by = COALESCE(created_by, ?),
              updated_at = NOW()
        WHERE id = ?`,
      [
        params.document_code.trim().toUpperCase(),
        params.document_name.trim(),
        params.document_category.trim().toLowerCase(),
        params.template_version?.trim() || "v1",
        params.requires_candidate_esign ? 1 : 0,
        params.requires_hr_upload ? 1 : 0,
        params.requires_hr_verification === false ? 0 : 1,
        params.is_mandatory === false ? 0 : 1,
        params.active_status === false ? 0 : 1,
        params.actorUserId,
        id,
      ],
    );
  } else {
    await db.execute(
      `INSERT INTO employee_joining_document_template
         (id, document_code, document_name, document_category, template_version, requires_candidate_esign, requires_hr_upload, requires_hr_verification, is_mandatory, active_status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.document_code.trim().toUpperCase(),
        params.document_name.trim(),
        params.document_category.trim().toLowerCase(),
        params.template_version?.trim() || "v1",
        params.requires_candidate_esign ? 1 : 0,
        params.requires_hr_upload ? 1 : 0,
        params.requires_hr_verification === false ? 0 : 1,
        params.is_mandatory === false ? 0 : 1,
        params.active_status === false ? 0 : 1,
        params.actorUserId,
      ],
    );
  }
  return listJoiningDocumentTemplates();
}

export async function getPublicJoiningDocumentEsignSession(publicToken: string): Promise<ESignSession> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
        tok.public_token_hash,
        tok.checklist_id,
        tok.employee_id,
        tok.document_code,
        tok.expires_at,
        tok.token_status,
        c.document_name,
        e.employee_code,
        COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS employee_name,
        tx.provider_url,
        tx.status AS tx_status
       FROM employee_joining_document_public_token tok
       JOIN employee_joining_document_checklist c ON c.id = tok.checklist_id
       JOIN employees e ON e.id = tok.employee_id
       LEFT JOIN employee_document_esign_transaction tx
         ON tx.id = (
           SELECT t2.id
             FROM employee_document_esign_transaction t2
            WHERE t2.checklist_id = tok.checklist_id
            ORDER BY t2.initiated_at DESC
            LIMIT 1
         )
       WHERE tok.public_token_hash = SHA2(?, 256)
       LIMIT 1`,
    [publicToken],
  );
  const row = (rows as unknown as ESignSession[])[0];
  if (!row) {
    const err = new Error("Invalid document signing link") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  if (row.token_status !== "active") {
    const err = new Error("This document signing link is no longer active") as Error & { statusCode?: number };
    err.statusCode = 410;
    throw err;
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    const err = new Error("This document signing link has expired") as Error & { statusCode?: number };
    err.statusCode = 410;
    throw err;
  }
  await db.execute(
    `UPDATE employee_joining_document_public_token
        SET last_started_at = NOW()
      WHERE public_token_hash = SHA2(?, 256)`,
    [publicToken],
  );
  await auditDocumentAction({
    employeeId: row.employee_id,
    checklistId: row.checklist_id,
    documentCode: row.document_code,
    actionType: "PUBLIC_REVIEW_OPENED",
    actorType: "public_token",
    newValue: { token: "active" },
  });
  return row;
}

/**
 * Ask the provider what happened to an open eSign and store the artefact.
 *
 * Luckpay's completion callback is unreliable (documented in
 * luckpay-status.service.ts), so signatures that genuinely happened can leave the
 * checklist parked at 'esign_initiated' forever. This is the pull side of that.
 */
export async function syncJoiningDocumentEsign(params: {
  employeeId: string;
  checklistId: string;
  actorUserId: string;
}) {
  await resolveEmployeeDocumentAccessContext(params.actorUserId, params.employeeId);
  const checklist = await fetchChecklistRow(params.checklistId);
  if (!checklist || checklist.employee_id !== params.employeeId) {
    const err = new Error("Checklist item not found") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT client_transaction_id
       FROM employee_document_esign_transaction
      WHERE checklist_id = ? AND provider = 'luckpay' AND client_transaction_id IS NOT NULL
      ORDER BY initiated_at DESC
      LIMIT 1`,
    [params.checklistId],
  );
  const clientTransactionId = String(rows[0]?.client_transaction_id ?? "").trim();
  if (!clientTransactionId) {
    return { synced: false, reason: "no_transaction", message: "No eSign transaction exists for this document yet." };
  }

  const { syncEsignStatus } = await import("../integrations/luckpay/luckpay-status.service.js");
  const outcome = await syncEsignStatus(clientTransactionId);
  return { synced: true, ...outcome };
}

export async function getJoiningDocumentEsignStatus(params: {
  employeeId: string;
  checklistId: string;
  actorUserId: string;
}) {
  await resolveEmployeeDocumentAccessContext(params.actorUserId, params.employeeId);
  const checklist = await fetchChecklistRow(params.checklistId);
  if (!checklist || checklist.employee_id !== params.employeeId) {
    const err = new Error("Checklist item not found") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
        tx.id,
        tx.provider,
        tx.status,
        tx.provider_reference_id,
        tx.provider_url,
        tx.error_message,
        tx.initiated_at,
        tx.completed_at,
        tok.token_status,
        tok.expires_at
       FROM employee_joining_document_checklist c
       LEFT JOIN employee_document_esign_transaction tx
         ON tx.id = (
           SELECT t2.id
             FROM employee_document_esign_transaction t2
            WHERE t2.checklist_id = c.id
            ORDER BY t2.initiated_at DESC
            LIMIT 1
         )
       LEFT JOIN employee_joining_document_public_token tok
         ON tok.id = (
           SELECT p2.id
             FROM employee_joining_document_public_token p2
            WHERE p2.checklist_id = c.id
            ORDER BY p2.created_at DESC
            LIMIT 1
         )
      WHERE c.id = ?
      LIMIT 1`,
    [params.checklistId],
  );
  const row = rows[0] ?? null;
  return {
    checklist_id: params.checklistId,
    document_code: checklist.document_code,
    checklist_status: checklist.status,
    transaction: row
      ? {
          id: String(row.id ?? ""),
          provider: String(row.provider ?? "luckpay"),
          status: String(row.status ?? "not_started"),
          provider_reference_id: row.provider_reference_id ?? null,
          provider_url: safeExternalProviderUrl(row.provider_url),
          error_message: row.error_message ?? null,
          initiated_at: row.initiated_at ?? null,
          completed_at: row.completed_at ?? null,
        }
      : null,
    public_token_status: row?.token_status ?? null,
    public_token_expires_at: row?.expires_at ?? null,
    publicTokenIssued: Boolean(row?.token_status),
  };
}

async function finalizeChecklistEsign(params: {
  checklist: ChecklistRow;
  signerName: string;
  signerRemarks?: string | null;
  /** Our own employee_document_esign_transaction primary key. */
  transactionId?: string | null;
  /** The id WE gave the provider, e.g. "joining-doc-<uuid>". */
  clientTransactionId?: string | null;
  /** The id the PROVIDER gave us (gatewayId), e.g. "APIB1785567457469073". */
  providerReferenceId?: string | null;
  publicToken?: string | null;
  actorType: ActorType;
  actionType: string;
  actorUserId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  /**
   * The provider's own completion timestamp, when the caller has one (the
   * backfill reads it off the Luckpay status response). Absent, `completed_at`
   * falls back to NOW() — exactly the behaviour before this parameter existed.
   */
  completedAt?: Date | null;
}) {
  const target = await getEmployeeDocumentTarget(params.checklist.employee_id);
  if (!target) {
    const err = new Error("Employee not found") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const sourceFile = await ensureGeneratedFile(params.checklist, target, params.actorUserId ?? null);
  const originalBuffer = fs.readFileSync(sourceFile.storage_path);

  // Prefer the provider's actual signed artefact. Previously this always stored
  // a byte-identical copy of the unsigned draft and still labelled it 'signed'
  // with signature_mode 'aadhaar_esign_verified' — a document that asserts a
  // signature it does not contain.
  const isWebhookFinalisation = params.actorType === "system" && String(params.actionType).includes("WEBHOOK");
  let signedBuffer: Buffer = originalBuffer;
  let providerArtefactRetrieved = false;

  if (isWebhookFinalisation && (params.clientTransactionId || params.providerReferenceId)) {
    try {
      // These MUST be the provider's own identifiers. This previously passed the
      // checklist UUID and our internal transaction PK, neither of which Luckpay
      // has ever seen, so every download silently failed and every signature was
      // recorded as 'pending_artefact'.
      const doc = await luckpayClient.downloadESignDocument({
        clientTransactionId: params.clientTransactionId ?? "",
        transactionId: params.providerReferenceId ?? "",
      });
      if (doc.buffer?.length) {
        signedBuffer = doc.buffer;
        providerArtefactRetrieved = true;
      }
    } catch (err: unknown) {
      // Never fail the finalisation on a download problem — the signature did
      // happen. Record that we could not retrieve the artefact so the claim
      // below stays honest and a retry can pick it up.
      console.warn(
        `[finalizeChecklistEsign] Could not retrieve signed artefact for checklist ${params.checklist.id}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  const signedCopy = await writeSecureFile({
    employeeId: params.checklist.employee_id,
    documentCode: params.checklist.document_code,
    fileName: `${params.checklist.document_code.toLowerCase()}-signed.pdf`,
    content: signedBuffer,
  });
  const signedFileId = await insertFileRecord({
    checklistId: params.checklist.id,
    employeeId: params.checklist.employee_id,
    candidateId: params.checklist.candidate_id ?? null,
    documentCode: params.checklist.document_code,
    fileRole: "signed",
    originalFilename: `${params.checklist.document_name}.pdf`,
    storedFilename: signedCopy.storedFilename,
    storagePath: signedCopy.storagePath,
    mimeType: "application/pdf",
    fileSize: originalBuffer.byteLength,
    fileHash: signedCopy.fileHash,
    uploadedBy: params.actorUserId ?? null,
    uploadedByType: params.actorType === "employee" ? "employee" : "system",
  });

  const isLuckpayVerifiedWebhook = isWebhookFinalisation;
  const nextChecklistStatus = isLuckpayVerifiedWebhook ? "esign_completed" : "employee_confirmed";
  const nextFillStatus = isLuckpayVerifiedWebhook ? "esign_completed" : "employee_review_pending";
  // Only claim a verified Aadhaar signature when we actually hold the signed
  // artefact. If the provider confirmed but the download failed, the signature
  // is real yet unretrieved — say so rather than overstating it.
  const nextSignatureMode = isLuckpayVerifiedWebhook
    ? (providerArtefactRetrieved ? "aadhaar_esign_verified" : "aadhaar_esign_pending_artefact")
    : params.actorType === "public_token"
      ? "internal_employee_acknowledgement"
      : "wet_signature_uploaded";

  // The completion fact is three writes — the checklist row, the transaction row
  // and the candidate's token — and they were three independent db.execute calls
  // with nothing holding them together, so a failure between them left a row
  // signed but its transaction still 'initiated', or signed with a token still
  // live. They now commit or roll back as one, the same shape bulkVerifyDocuments
  // (ats.joiningDocumentsTracker.service.ts) already uses.
  //
  // Audit, the payroll-HR inbox notification and recalculateDocumentProgress stay
  // OUTSIDE, deliberately: an audit failure must not roll back a real signature,
  // SMTP/inbox I/O must not hold a pool connection open (DB_POOL_MAX is 25), and
  // the recalculation reads the rows written here — inside it would read
  // uncommitted state and be rolled back with it, and it is derived data that is
  // recomputed on next read anyway.
  const isVerifiedAadhaarEsign = nextSignatureMode === "aadhaar_esign_verified";
  let priorVerificationState: { status: unknown; verification_status: unknown; due_at: unknown } | null = null;

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // Read what the verification write is about to overwrite so the audit row
    // below can carry it as old_value. A cleared due_at is otherwise
    // unrecoverable from the row — the audit entry is the only surviving record
    // of the original deadline.
    const [priorRows] = await connection.execute<RowDataPacket[]>(
      `SELECT status, verification_status, due_at
         FROM employee_joining_document_checklist
        WHERE id = ?
        LIMIT 1`,
      [params.checklist.id],
    );
    const prior = priorRows[0] as RowDataPacket | undefined;
    if (prior) {
      priorVerificationState = {
        status: prior.status ?? null,
        verification_status: prior.verification_status ?? null,
        due_at: prior.due_at ?? null,
      };
    }

    // The verification columns ride on the statement that already sets `status`,
    // not a second UPDATE, so "verified in the same transaction as completed" is
    // true at the statement level too.
    //
    // The gate is signature_mode = 'aadhaar_esign_verified', NOT
    // status = 'esign_completed'. 'aadhaar_esign_pending_artefact' also reaches
    // 'esign_completed' — the provider confirmed the signature but we could not
    // download the artefact — and a signature we cannot produce the document for
    // must not be recorded as verified. Those rows heal on a later sync pass.
    //
    // verified_by is left NULL on purpose. Every other writer of that column puts
    // a real user id there; there is no human verifier here and a sentinel would
    // make the column untrustworthy everywhere else. Provenance lives in
    // verification_remarks and, structurally, in Audit_Log.
    await connection.execute(
      `UPDATE employee_joining_document_checklist
          SET status = ?,
              fill_status = ?,
              signature_mode = ?,
              final_file_locked_at = CASE WHEN ? = 'esign_completed' THEN NOW() ELSE final_file_locked_at END,
              completed_at = CASE WHEN ? = 'esign_completed' THEN COALESCE(?, NOW()) ELSE completed_at END,
              verification_status = CASE WHEN ? = 'aadhaar_esign_verified' THEN 'verified' ELSE verification_status END,
              verified_at = CASE WHEN ? = 'aadhaar_esign_verified' THEN NOW() ELSE verified_at END,
              verification_remarks = CASE WHEN ? = 'aadhaar_esign_verified' THEN 'Verified by Aadhaar eSign (Luckpay)' ELSE verification_remarks END,
              due_at = CASE WHEN ? = 'aadhaar_esign_verified' THEN NULL ELSE due_at END,
              updated_at = NOW()
        WHERE id = ?`,
      [
        nextChecklistStatus,
        nextFillStatus,
        nextSignatureMode,
        nextChecklistStatus,
        nextChecklistStatus,
        params.completedAt ?? null,
        nextSignatureMode,
        nextSignatureMode,
        nextSignatureMode,
        nextSignatureMode,
        params.checklist.id,
      ],
    );

    if (params.transactionId) {
      // The .catch() that re-ran this without the JSON_SET is gone: it existed
      // to salvage a half-written completion when there was no transaction to
      // roll back. There is one now, so a JSON_SET failure fails the completion
      // instead of quietly dropping the signer name.
      await connection.execute(
        `UPDATE employee_document_esign_transaction
            SET status = 'signed',
                signed_file_id = ?,
                completed_at = NOW(),
                response_payload = JSON_SET(COALESCE(response_payload, JSON_OBJECT()), '$.signerName', ?, '$.remarks', ?)
          WHERE id = ?`,
        [signedFileId, params.signerName.trim(), params.signerRemarks ?? null, params.transactionId],
      );
    }

    if (params.publicToken) {
      const publicTokenHash = sha256(params.publicToken);
      await connection.execute(
        `UPDATE employee_joining_document_public_token
            SET token_status = 'consumed',
                consumed_at = NOW()
          WHERE public_token_hash = ?`,
        [publicTokenHash],
      );
    }

    await connection.commit();
  } catch (err: unknown) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  await auditDocumentAction({
    employeeId: params.checklist.employee_id,
    candidateId: params.checklist.candidate_id ?? null,
    checklistId: params.checklist.id,
    documentCode: params.checklist.document_code,
    actionType: params.actionType,
    actorUserId: params.actorUserId ?? null,
    actorType: params.actorType,
    remarks: params.signerRemarks ?? null,
    newValue: { signerName: params.signerName.trim(), signedFileId },
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
  });

  // A second row, in a vocabulary disjoint from the human-review one, so that
  // "this was verified by an eSign, not by someone clicking verify" is a value in
  // the log rather than an inference from timestamps. Written only when the
  // verification state was actually written.
  if (isVerifiedAadhaarEsign) {
    await auditDocumentAction({
      employeeId: params.checklist.employee_id,
      candidateId: params.checklist.candidate_id ?? null,
      checklistId: params.checklist.id,
      documentCode: params.checklist.document_code,
      actionType: "ESIGN_VERIFICATION_AUTO",
      actorUserId: params.actorUserId ?? null,
      actorType: params.actorType,
      remarks: "Verified by Aadhaar eSign (Luckpay)",
      oldValue: priorVerificationState ?? undefined,
      newValue: {
        verificationSource: "aadhaar_esign",
        signatureMode: nextSignatureMode,
        providerReferenceId: params.providerReferenceId ?? null,
      },
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    });
  }

  if (isLuckpayVerifiedWebhook) {
    try {
      const [empRows] = await db.execute<RowDataPacket[]>(
        `SELECT employee_code, full_name, branch_id FROM employees WHERE id = ? LIMIT 1`,
        [params.checklist.employee_id],
      );
      const emp = empRows[0] as { employee_code: string; full_name: string; branch_id: string | null } | undefined;
      if (emp) {
        const [hrRows] = await db.execute<RowDataPacket[]>(
          /*
           * u.full_name was selected here and auth_user has no such column - it holds id, email,
           * password_hash and login state, and the name lives on employees. So this raised
           * ER_BAD_FIELD_ERROR, the outer catch logged it, and payroll HR was never told an
           * eSign had completed. The notification looked implemented and delivered nothing.
           *
           * Repointed at e.full_name rather than dropped. My first fix removed it, on the
           * grounds that the loop below reads only hr.user_id - true today, but
           * esignHrNotificationColumns.contract.test.ts asserts this query carries the name from
           * the employees join, and it is right to: the recipient's name belongs in a
           * notification payload, and removing the column would have quietly closed off the
           * obvious next use. The join was already there; only the table qualifier was wrong.
           */
          `SELECT DISTINCT u.id as user_id, u.email, e.full_name
           FROM auth_user u
           JOIN user_roles ur ON ur.user_id = u.id
           JOIN employees e ON e.user_id = u.id AND e.active_status = 1
           WHERE ur.role_key = 'payroll_hr'
             AND (? IS NULL OR e.branch_id = ?)
           LIMIT 3`,
          [emp.branch_id, emp.branch_id],
        );
        for (const hr of hrRows as RowDataPacket[]) {
          await inboxService
            .createItem({
              user_id: hr.user_id,
              type: "esign_completed",
              title: `E-Sign Completed: ${params.checklist.document_name} — ${emp.full_name} [${emp.employee_code}]`,
              description: `${emp.full_name} has completed Aadhaar eSign for ${params.checklist.document_name}. You can now review and verify the signed document.`,
              entity_type: "employee_joining_document_checklist",
              entity_id: params.checklist.id,
              action_url: `/employees/${params.checklist.employee_id}/joining-documents`,
              priority: "medium",
            })
            .catch((err: unknown) => console.error("[finalizeChecklistEsign] inbox notification failed:", err));
        }
      }
    } catch (err: unknown) {
      console.error("[finalizeChecklistEsign] Failed to send eSign completion notification:", err);
    }
  }

  await recalculateDocumentProgress(params.checklist.employee_id);
  return {
    success: true,
    employee_id: params.checklist.employee_id,
    checklist_id: params.checklist.id,
    signed_file_id: signedFileId,
  };
}

export async function getPublicJoiningDocumentDraftFile(publicToken: string) {
  const session = await getPublicJoiningDocumentEsignSession(publicToken);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT storage_path, mime_type, original_filename
       FROM employee_joining_document_file
      WHERE checklist_id = ?
        AND deleted_at IS NULL
      ORDER BY FIELD(file_role, 'signed', 'generated', 'hr_uploaded', 'supporting', 'template', 'sent_for_esign'), uploaded_at DESC
      LIMIT 1`,
    [session.checklist_id],
  );
  const file = rows[0];
  if (!file?.storage_path || !fs.existsSync(String(file.storage_path))) {
    const err = new Error("Draft document is not available yet") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  await auditDocumentAction({
    employeeId: session.employee_id,
    checklistId: session.checklist_id,
    documentCode: session.document_code,
    actionType: "PUBLIC_DRAFT_DOWNLOADED",
    actorType: "public_token",
    newValue: { file_name: file.original_filename ?? null },
  });
  return {
    storagePath: String(file.storage_path),
    mimeType: String(file.mime_type || "application/octet-stream"),
    fileName: String(file.original_filename || `${session.document_code}.bin`),
  };
}

export async function completePublicJoiningDocumentEsign(params: {
  publicToken: string;
  signerName: string;
  signerRemarks?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const session = await getPublicJoiningDocumentEsignSession(params.publicToken);
  const checklist = await fetchChecklistRow(session.checklist_id);
  if (!checklist) {
    const err = new Error("Checklist item not found") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  const [txRows] = await db.execute<RowDataPacket[]>(
    `SELECT id
       FROM employee_document_esign_transaction
      WHERE checklist_id = ?
      ORDER BY initiated_at DESC
      LIMIT 1`,
    [checklist.id],
  );
  return finalizeChecklistEsign({
    checklist,
    signerName: params.signerName,
    signerRemarks: params.signerRemarks ?? null,
    transactionId: String(txRows[0]?.id ?? ""),
    publicToken: params.publicToken,
    actorType: "public_token",
    actionType: "PUBLIC_ESIGN_COMPLETED",
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
  });
}

export async function handleJoiningDocumentEsignWebhook(input: {
  payload: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const payload = input.payload ?? {};
  const providerReferenceId = String(
    payload.provider_reference_id ??
    payload.providerReferenceId ??
    payload.reference_id ??
    payload.referenceId ??
    payload.transaction_id ??
    payload.transactionId ??
    "",
  ).trim();
  const clientTransactionId = String(payload.client_transaction_id ?? payload.clientTransactionId ?? "").trim();

  // client_transaction_id is ours and unique per (provider, id); provider_reference_id
  // is the vendor's gatewayId. Match on the former FIRST rather than OR-ing both into
  // one query — an OR with ORDER BY initiated_at DESC can resolve to a different, newer
  // transaction than the one the callback is actually about.
  const TX_COLUMNS =
    "id, checklist_id, kit_id, scope, employee_id, candidate_id, document_code, status, client_transaction_id, provider_reference_id";

  const findTx = async (column: "client_transaction_id" | "provider_reference_id", value: string) => {
    if (!value) return undefined;
    const [found] = await db.execute<RowDataPacket[]>(
      `SELECT ${TX_COLUMNS}
         FROM employee_document_esign_transaction
        WHERE provider = 'luckpay' AND ${column} = ?
        ORDER BY initiated_at DESC
        LIMIT 1`,
      [value],
    );
    return found[0];
  };

  const tx = ((await findTx("client_transaction_id", clientTransactionId)) ??
    (await findTx("provider_reference_id", providerReferenceId))) as (RowDataPacket & {
    id: string;
    checklist_id: string;
    employee_id: string;
    candidate_id: string | null;
    document_code: string;
    status: string;
    client_transaction_id: string | null;
    provider_reference_id: string | null;
  }) | undefined;
  if (!tx) {
    return { matched: false, processed: false };
  }

  const rawStatus = String(payload.status ?? payload.event ?? payload.result ?? "").trim().toLowerCase();
  const normalizedStatus = rawStatus.includes("sign") || rawStatus.includes("success") || rawStatus.includes("complete")
    ? "signed"
    : rawStatus.includes("fail") || rawStatus.includes("reject") || rawStatus.includes("error")
      ? "failed"
      : rawStatus || "received";

  await db.execute(
    `UPDATE employee_document_esign_transaction
        SET status = ?,
            response_payload = ?,
            error_message = CASE WHEN ? = 'failed' THEN ? ELSE error_message END,
            completed_at = CASE WHEN ? IN ('signed', 'failed') THEN NOW() ELSE completed_at END,
            updated_at = NOW()
      WHERE id = ?`,
    [
      normalizedStatus,
      JSON.stringify(sanitizeProviderPayload(payload)),
      normalizedStatus,
      normalizedStatus === "failed" ? String(payload.message ?? payload.error_message ?? payload.error ?? "Provider callback reported failure") : null,
      normalizedStatus,
      tx.id,
    ],
  );

  if (normalizedStatus === "signed") {
    // A kit covers several documents with one signature, so completion has to
    // close every member rather than only the anchor the transaction points at.
    if (String((tx as { scope?: string }).scope ?? "document") === "kit" && (tx as { kit_id?: string }).kit_id) {
      const { finalizeKitEsign } = await import("./joiningKitDispatch.service.js");
      return {
        matched: true,
        processed: true,
        result: await finalizeKitEsign({
          kitId: String((tx as { kit_id?: string }).kit_id),
          transactionId: String(tx.id),
          clientTransactionId: tx.client_transaction_id ?? null,
          providerReferenceId: tx.provider_reference_id ?? null,
        }),
      };
    }

    const checklist = await fetchChecklistRow(String(tx.checklist_id));
    if (!checklist) {
      const err = new Error("Checklist item not found for eSign webhook") as Error & { statusCode?: number };
      err.statusCode = 404;
      throw err;
    }
    const signerName = String(payload.signer_name ?? payload.signerName ?? payload.employee_name ?? "Employee").trim() || "Employee";
    return {
      matched: true,
      processed: true,
      result: await finalizeChecklistEsign({
        checklist,
        signerName,
        signerRemarks: String(payload.remarks ?? payload.comment ?? "").trim() || null,
        transactionId: tx.id,
        // What the PROVIDER knows this signature by. tx.id is our own primary key
        // and means nothing to Luckpay — passing it as the provider's identifiers
        // is why no signed artefact has ever been retrieved.
        clientTransactionId: tx.client_transaction_id ?? null,
        providerReferenceId: tx.provider_reference_id ?? null,
        actorType: "system",
        actionType: "LUCKPAY_WEBHOOK_ESIGN_COMPLETED",
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      }),
    };
  }

  const checklist = await fetchChecklistRow(String(tx.checklist_id));
  if (checklist && normalizedStatus === "failed") {
    await db.execute(
      `UPDATE employee_joining_document_checklist
          SET fill_status = 'esign_failed',
              status = 'esign_failed',
              updated_at = NOW()
        WHERE id = ?`,
      [checklist.id],
    );
    await auditDocumentAction({
      employeeId: checklist.employee_id,
      candidateId: checklist.candidate_id ?? null,
      checklistId: checklist.id,
      documentCode: checklist.document_code,
      actionType: "LUCKPAY_WEBHOOK_ESIGN_FAILED",
      actorType: "system",
      remarks: String(payload.message ?? payload.error_message ?? payload.error ?? "Provider callback failure"),
      newValue: { transactionId: tx.id, providerReferenceId: providerReferenceId || null },
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    });
  }

  return { matched: true, processed: true, status: normalizedStatus };
}

export async function listEmployeeJoiningDocumentAudit(employeeId: string, userId: string) {
  await resolveEmployeeDocumentAccessContext(userId, employeeId);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT action_type, remarks, actor_type, created_at, document_code
       FROM employee_joining_document_audit_log
      WHERE employee_id = ?
      ORDER BY created_at DESC`,
    [employeeId],
  );
  return rows;
}

export async function createPublicTokenForEpfReview(params: {
  employeeId: string;
  actorUserId: string;
}) {
  const target = await getEmployeeDocumentTarget(params.employeeId);
  if (!target) {
    const err = new Error("Employee not found") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  await ensureChecklistRows(target, params.actorUserId);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_id, candidate_id, document_code, document_name, status, action_type, owner_type, template_version
       FROM employee_joining_document_checklist
      WHERE employee_id = ?
        AND document_code = 'EPF_DECLARATION'
      LIMIT 1`,
    [params.employeeId],
  );
  const checklist = (rows as unknown as ChecklistRow[])[0];
  if (!checklist) {
    const err = new Error("EPF declaration checklist item is not configured") as Error & { statusCode?: number };
    err.statusCode = 409;
    throw err;
  }

  const publicToken = randomBytes(24).toString("hex");
  const publicTokenHash = sha256(publicToken);
  await db.execute(
    `INSERT INTO employee_joining_document_public_token
       (id, checklist_id, employee_id, candidate_id, document_code, public_token, public_token_hash, token_status, expires_at, created_by)
     VALUES (?, ?, ?, ?, 'EPF_DECLARATION', NULL, ?, 'active', ?, ?)`,
    [randomUUID(), checklist.id, checklist.employee_id, checklist.candidate_id ?? null, publicTokenHash, nowPlusDays(7), params.actorUserId],
  );

  await auditDocumentAction({
    employeeId: checklist.employee_id,
    candidateId: checklist.candidate_id ?? null,
    checklistId: checklist.id,
    documentCode: checklist.document_code,
    actionType: "EPF_REVIEW_LINK_CREATED",
    actorUserId: params.actorUserId,
    actorType: "hr",
    newValue: { publicTokenIssued: true },
  });

  const reviewLink = `${frontendBaseUrl()}/employee/epf-compliance/review/${publicToken}`;

  // The link was returned to the HR screen for manual copy-paste and nothing
  // ever sent it, so in practice the member never saw their PF record — which is
  // most of why employee_epf_compliance_profile holds 4 rows. Same delivery and
  // failure handling as the joining-document e-sign mail: a mail problem must not
  // undo a token that has already been issued.
  let emailed = false;
  try {
    const [emailRows] = await db.execute<RowDataPacket[]>(
      `SELECT personal_email FROM employees WHERE id = ? LIMIT 1`,
      [params.employeeId],
    );
    const toAddresses = [
      (emailRows as RowDataPacket[])[0]?.personal_email as string | null,
      target.official_email,
    ].filter((e): e is string => typeof e === "string" && e.includes("@"));
    const uniqueTo = [...new Set(toAddresses)];
    if (uniqueTo.length > 0) {
      const expiryStr = new Date(Date.now() + 7 * 24 * 3600 * 1000)
        .toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
      const html = buildEpfComplianceReviewEmailHtml({
        employeeName: target.full_name ?? target.employee_code ?? "Employee",
        reviewLink,
        expiryStr,
      });
      for (const toAddr of uniqueTo) {
        await emailService.send({
          to: toAddr,
          subject: "Action Required: Check your PF details before filing — MAS Callnet",
          html,
        });
      }
      emailed = true;
    } else {
      console.warn(`[epf-compliance] review link not emailed — employee ${params.employeeId} has no personal_email or official_email on record`);
    }
  } catch (emailErr) {
    console.warn("[epf-compliance] Non-fatal: review email delivery failed:", emailErr);
  }

  return {
    public_token: publicToken,
    review_link: reviewLink,
    // Reported so the HR screen can say whether it still needs to share the link
    // by hand, rather than leaving the operator to guess.
    emailed,
  };
}

export async function hardDeleteMissingGeneratedArtifacts() {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employee_joining_document_file WHERE deleted_at IS NULL`,
  );
  let deleted = 0;
  for (const row of rows as RowDataPacket[]) {
    const fileId = String(row.id);
    const [fileRows] = await db.execute<RowDataPacket[]>(
      `SELECT storage_path FROM employee_joining_document_file WHERE id = ? LIMIT 1`,
      [fileId],
    );
    const file = fileRows[0];
    if (file && file.storage_path && !fs.existsSync(String(file.storage_path))) {
      await db.execute(`UPDATE employee_joining_document_file SET deleted_at = NOW() WHERE id = ?`, [fileId]);
      deleted += 1;
    }
  }
  return { deleted };
}

/**
 * Auto-generates joining document checklist and prefilled drafts for a newly created employee.
 * Called automatically after employee code generation in the ATS offer approval flow.
 */
export async function autoGenerateJoiningDocuments(
  employeeId: string,
  candidateId: string | null,
  actorUserId: string,
): Promise<void> {
  const target = await getEmployeeDocumentTarget(employeeId);
  if (!target) {
    console.error('[autoGenerateJoiningDocuments] Employee not found:', employeeId);
    return;
  }

  await ensureChecklistRows(target, actorUserId);

  const [checklistRows] = await db.execute<RowDataPacket[]>(
    `SELECT c.id AS checklist_id, c.document_code, c.action_type, t.template_storage_path, t.fill_mode
       FROM employee_joining_document_checklist c
       JOIN employee_joining_document_template t ON t.id = c.template_id
      WHERE c.employee_id = ?
        AND t.template_storage_path IS NOT NULL
        AND t.active_status = 1
      ORDER BY t.is_mandatory DESC, c.document_name ASC`,
    [employeeId],
  );

  let generated = 0;
  for (const row of checklistRows as RowDataPacket[]) {
    try {
      await generateChecklistDraft(String(row.checklist_id), actorUserId);
      generated++;
    } catch (err: unknown) {
      console.error('[autoGenerateJoiningDocuments] Failed to generate draft for checklist item:', {
        employeeId,
        checklistId: row.checklist_id,
        documentCode: row.document_code,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await recalculateDocumentProgress(employeeId);

  console.log('[autoGenerateJoiningDocuments] Completed:', {
    employeeId,
    totalChecklist: checklistRows.length,
    draftsGenerated: generated,
  });
}
