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
import { esignWithUrl, generateClientTransactionId } from "../integrations/luckpay/luckpay.client.js";

const STORAGE_ROOT = path.resolve(process.cwd(), "private-storage", "employee-joining-documents");
const ALLOWED_EXTENSIONS = new Set([".pdf", ".jpg", ".jpeg", ".png", ".webp", ".doc", ".docx"]);
const HR_SCOPE_ROLES = ["hr", "manager", "branch_head", "process_manager", "assistant_manager", "tl"];
const PAYROLL_SCOPE_ROLES = ["payroll_hr", "payroll"];
const SECURE_DOWNLOAD_ROLES = new Set(["admin", "super_admin", "hr", "manager", "payroll_hr", "payroll", "employee"]);
const PAYROLL_DOCUMENT_CODES = new Set(["EPF_DECLARATION", "EMPLOYMENT_CONTRACT"]);

type ActorType = "hr" | "candidate" | "system" | "employee" | "public_token";
type FileRole = "template" | "hr_uploaded" | "generated" | "sent_for_esign" | "signed" | "supporting";

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
  public_token: string | null;
  public_token_status: string | null;
  public_token_expires_at: string | null;
  analysis_result_json: unknown;
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
  token: string;
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

function frontendBaseUrl() {
  return String(env.FRONTEND_URL || "http://localhost:8080").replace(/\/$/, "");
}

function isPayrollDocument(code: string) {
  const normalized = String(code || "").trim().toUpperCase();
  return PAYROLL_DOCUMENT_CODES.has(normalized) || normalized.includes("EPF") || normalized.includes("STATUTORY");
}

function fileExtension(fileName: string) {
  return path.extname(fileName || "").toLowerCase();
}

export async function getEmployeeDocumentTarget(employeeId: string): Promise<EmployeeDocumentTarget | null> {
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
        e.joining_document_status,
        e.joining_document_completion_pct
       FROM employees e
       LEFT JOIN ats_onboarding_bridge ob ON ob.employee_id = e.id
      WHERE e.id = ?
      LIMIT 1`,
    [employeeId],
  );
  return (rows as unknown as EmployeeDocumentTarget[])[0] ?? null;
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

async function recalculateDocumentProgress(employeeId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
        COUNT(*) AS total_count,
        SUM(CASE WHEN mandatory = 1 THEN 1 ELSE 0 END) AS mandatory_count,
        SUM(CASE WHEN mandatory = 1 AND status IN ('verified', 'signed_verified', 'completed') THEN 1 ELSE 0 END) AS mandatory_completed,
        SUM(CASE WHEN status IN ('verified', 'signed_verified', 'completed') THEN 1 ELSE 0 END) AS completed_count
       FROM employee_joining_document_checklist
      WHERE employee_id = ?`,
    [employeeId],
  );
  const row = (rows as RowDataPacket[])[0];
  const total = Number(row?.mandatory_count ?? row?.total_count ?? 0);
  const done = Number(row?.mandatory_completed ?? row?.completed_count ?? 0);
  const pct = total > 0 ? Number(((done / total) * 100).toFixed(2)) : 0;
  const status = total > 0 && done >= total ? "completed" : done > 0 ? "in_progress" : "pending";

  await db.execute(
    `UPDATE employees
        SET joining_document_status = ?,
            joining_document_completion_pct = ?,
            joining_document_completed_at = CASE WHEN ? = 'completed' THEN COALESCE(joining_document_completed_at, NOW()) ELSE NULL END
      WHERE id = ?`,
    [status, pct, status, employeeId],
  );

  await db.execute(
    `UPDATE ats_onboarding_bridge
        SET joining_document_status = ?,
            joining_document_completion_pct = ?,
            joining_document_completed_at = CASE WHEN ? = 'completed' THEN COALESCE(joining_document_completed_at, NOW()) ELSE NULL END
      WHERE employee_id = ?`,
    [status, pct, status, employeeId],
  ).catch(() => undefined);
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

function isChecklistTerminalStatus(status: string) {
  return new Set(["verified", "completed", "esign_completed", "signed_verified", "wet_signed_uploaded"]).has(String(status || "").trim().toLowerCase());
}

async function generateAgreementPdf(checklist: ChecklistRow, target: EmployeeDocumentTarget) {
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
    doc.fontSize(18).text(checklist.document_name, { align: "center" });
    doc.moveDown();
    doc.fontSize(11).text(`Employee: ${target.full_name ?? "Employee"}`);
    doc.text(`Employee Code: ${target.employee_code ?? "Not allotted"}`);
    doc.text(`Document Code: ${checklist.document_code}`);
    doc.text(`Version: ${checklist.template_version}`);
    doc.text(`Generated On: ${new Date().toLocaleString("en-IN")}`);
    doc.moveDown();
    doc.text(
      `This ${checklist.document_name} is generated inside HRMS as part of the employee joining document pack. ` +
      `The employee acknowledgement or Aadhaar eSign status is tracked separately and must be completed before final verification.`,
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
  return {
    path: tempPath,
    originalFilename: `${checklist.document_code.toLowerCase()}-${target.employee_code ?? checklist.employee_id}.pdf`,
    fileHash: sha256(buffer),
    fileSize: buffer.byteLength,
    mimeType: "application/pdf",
  };
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
  if (existing && fs.existsSync(existing.storage_path)) return existing;

  const generated = await generateAgreementPdf(checklist, target);
  const storedFilename = path.basename(generated.path);
  const fileId = await insertFileRecord({
    checklistId: checklist.id,
    employeeId: checklist.employee_id,
    candidateId: checklist.candidate_id ?? null,
    documentCode: checklist.document_code,
    fileRole: "generated",
    originalFilename: generated.originalFilename,
    storedFilename,
    storagePath: generated.path,
    mimeType: generated.mimeType,
    fileSize: generated.fileSize,
    fileHash: generated.fileHash,
    uploadedBy: actorUserId ?? null,
    uploadedByType: actorUserId ? "hr" : "system",
  });

  await db.execute(
    `UPDATE employee_joining_document_checklist
        SET status = CASE WHEN action_type = 'esign' THEN 'pending_candidate_esign' ELSE 'uploaded_pending_review' END,
            updated_at = NOW()
      WHERE id = ?`,
    [checklist.id],
  );

  await auditDocumentAction({
    employeeId: checklist.employee_id,
    candidateId: checklist.candidate_id ?? null,
    checklistId: checklist.id,
    documentCode: checklist.document_code,
    actionType: "DOCUMENT_GENERATED",
    actorUserId: actorUserId ?? null,
    actorType: actorUserId ? "hr" : "system",
    newValue: { fileId, originalFilename: generated.originalFilename },
  });

  await recalculateDocumentProgress(checklist.employee_id);
  return {
    id: fileId,
    checklist_id: checklist.id,
    original_filename: generated.originalFilename,
    file_role: "generated",
    mime_type: generated.mimeType,
    storage_path: generated.path,
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
        tok.public_token,
        tok.token_status AS public_token_status,
        tok.expires_at AS public_token_expires_at
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
  return rows as unknown as JoiningChecklistItem[];
}

export async function getJoiningDocumentPack(employeeId: string, userId: string) {
  const access = await resolveEmployeeDocumentAccessContext(userId, employeeId);
  await ensureChecklistRows(access.target, userId);
  await recalculateDocumentProgress(employeeId);
  const checklist = await getChecklistBundle(employeeId);

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
    checklist,
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

  const nextStatus = checklist.action_type === "esign" ? "uploaded_pending_esign" : "uploaded_pending_review";
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

  const sourceFile = await ensureGeneratedFile(checklist, access.target, params.actorUserId);
  const publicToken = randomBytes(24).toString("hex");
  const tokenLink = buildPublicSigningLink(checklist.document_code, publicToken);

  await db.execute(
    `INSERT INTO employee_joining_document_public_token
       (id, checklist_id, employee_id, candidate_id, document_code, public_token, token_status, expires_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    [
      randomUUID(),
      checklist.id,
      checklist.employee_id,
      checklist.candidate_id ?? null,
      checklist.document_code,
      publicToken,
      nowPlusDays(7),
      params.actorUserId,
    ],
  );

  const transactionId = randomUUID();
  let providerReferenceId: string | null = null;
  let providerUrl: string | null = tokenLink;
  let responsePayload: Record<string, unknown> = { signLink: tokenLink };
  let status = "link_generated";
  let errorMessage: string | null = null;

  try {
    if (env.LUCKPAY_PROVIDER_ENABLED) {
      const luckpay = await esignWithUrl({
        filePath: sourceFile.storage_path,
        clientTransactionId: generateClientTransactionId("joining-doc"),
        signedBy: access.target.full_name ?? access.target.employee_code ?? "Employee",
        location: "India",
        reason: checklist.document_name,
      });
      providerReferenceId = luckpay.providerReferenceId;
      providerUrl = luckpay.providerUrl ?? tokenLink;
      responsePayload = luckpay.response;
      status = luckpay.status || "initiated";
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    responsePayload = { signLink: tokenLink, fallback: true };
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
      generateClientTransactionId("joining-doc-track"),
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
    newValue: { providerUrl: providerUrl ? "available" : "missing", publicToken },
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
  });

  await recalculateDocumentProgress(params.employeeId);
  return {
    sign_link: tokenLink,
    provider_url: providerUrl,
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
  if (!fs.existsSync(String(file.storage_path))) {
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
    storagePath: String(file.storage_path),
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
    `SELECT id, document_code, document_name, document_category, template_version, requires_candidate_esign, requires_hr_upload, requires_hr_verification, is_mandatory, active_status, created_at, updated_at
       FROM employee_joining_document_template
      ORDER BY active_status DESC, document_name ASC`,
  );
  return rows;
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
        tok.public_token AS token,
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
      WHERE tok.public_token = ?
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
      WHERE public_token = ?`,
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
        tok.public_token,
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
          provider_url: row.provider_url ?? null,
          error_message: row.error_message ?? null,
          initiated_at: row.initiated_at ?? null,
          completed_at: row.completed_at ?? null,
        }
      : null,
    public_token: row?.public_token ?? null,
    public_token_status: row?.token_status ?? null,
    public_token_expires_at: row?.expires_at ?? null,
  };
}

async function finalizeChecklistEsign(params: {
  checklist: ChecklistRow;
  signerName: string;
  signerRemarks?: string | null;
  transactionId?: string | null;
  publicToken?: string | null;
  actorType: ActorType;
  actionType: string;
  actorUserId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const target = await getEmployeeDocumentTarget(params.checklist.employee_id);
  if (!target) {
    const err = new Error("Employee not found") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const sourceFile = await ensureGeneratedFile(params.checklist, target, params.actorUserId ?? null);
  const originalBuffer = fs.readFileSync(sourceFile.storage_path);
  const signedCopy = await writeSecureFile({
    employeeId: params.checklist.employee_id,
    documentCode: params.checklist.document_code,
    fileName: `${params.checklist.document_code.toLowerCase()}-signed.pdf`,
    content: originalBuffer,
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

  await db.execute(
    `UPDATE employee_joining_document_checklist
        SET status = 'esign_completed',
            fill_status = 'esign_completed',
            signature_mode = 'aadhaar_esign',
            final_file_locked_at = NOW(),
            completed_at = NOW(),
            updated_at = NOW()
      WHERE id = ?`,
    [params.checklist.id],
  );

  if (params.transactionId) {
    await db.execute(
      `UPDATE employee_document_esign_transaction
          SET status = 'signed',
              signed_file_id = ?,
              completed_at = NOW(),
              response_payload = JSON_SET(COALESCE(response_payload, JSON_OBJECT()), '$.signerName', ?, '$.remarks', ?)
        WHERE id = ?`,
      [signedFileId, params.signerName.trim(), params.signerRemarks ?? null, params.transactionId],
    ).catch(async () => {
      await db.execute(
        `UPDATE employee_document_esign_transaction
            SET status = 'signed',
                signed_file_id = ?,
                completed_at = NOW()
          WHERE id = ?`,
        [signedFileId, params.transactionId],
      );
    });
  }

  if (params.publicToken) {
    await db.execute(
      `UPDATE employee_joining_document_public_token
          SET token_status = 'consumed',
              consumed_at = NOW()
        WHERE public_token = ?`,
      [params.publicToken],
    );
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
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, checklist_id, employee_id, candidate_id, document_code, status
       FROM employee_document_esign_transaction
      WHERE (? <> '' AND provider_reference_id = ?)
         OR (? <> '' AND client_transaction_id = ?)
      ORDER BY initiated_at DESC
      LIMIT 1`,
    [providerReferenceId, providerReferenceId, clientTransactionId, clientTransactionId],
  );
  const tx = rows[0] as (RowDataPacket & {
    id: string;
    checklist_id: string;
    employee_id: string;
    candidate_id: string | null;
    document_code: string;
    status: string;
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
      JSON.stringify(payload),
      normalizedStatus,
      normalizedStatus === "failed" ? String(payload.message ?? payload.error_message ?? payload.error ?? "Provider callback reported failure") : null,
      normalizedStatus,
      tx.id,
    ],
  );

  if (normalizedStatus === "signed") {
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
  await db.execute(
    `INSERT INTO employee_joining_document_public_token
       (id, checklist_id, employee_id, candidate_id, document_code, public_token, token_status, expires_at, created_by)
     VALUES (?, ?, ?, ?, 'EPF_DECLARATION', ?, 'active', ?, ?)`,
    [randomUUID(), checklist.id, checklist.employee_id, checklist.candidate_id ?? null, publicToken, nowPlusDays(7), params.actorUserId],
  );

  await auditDocumentAction({
    employeeId: checklist.employee_id,
    candidateId: checklist.candidate_id ?? null,
    checklistId: checklist.id,
    documentCode: checklist.document_code,
    actionType: "EPF_REVIEW_LINK_CREATED",
    actorUserId: params.actorUserId,
    actorType: "hr",
    newValue: { publicToken },
  });

  return {
    public_token: publicToken,
    review_link: `${frontendBaseUrl()}/employee/epf-compliance/review/${publicToken}`,
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
