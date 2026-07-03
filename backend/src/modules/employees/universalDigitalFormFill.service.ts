import { createHash, randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import PDFDocumentKit from "pdfkit";
import { PDFDocument, StandardFonts } from "pdf-lib";
import PizZip from "pizzip";
import type { RowDataPacket } from "mysql2";

import { db } from "../../db/mysql.js";

const STORAGE_ROOT = path.resolve(process.cwd(), "private-storage", "employee-joining-documents");

type FieldMapInput = {
  id?: string;
  field_key: string;
  field_label: string;
  source_path?: string | null;
  page_no?: number;
  x?: number | null;
  y?: number | null;
  width?: number | null;
  height?: number | null;
  font_size?: number | null;
  font_weight?: string | null;
  alignment?: string | null;
  field_type?: string | null;
  required?: boolean;
  masking_rule?: string | null;
  mapping_mode?: string | null;
  placeholder_token?: string | null;
  pdf_field_name?: string | null;
};

type FieldValueUpdate = {
  field_key: string;
  value_text: string;
  reason?: string | null;
};

type ChecklistContextRow = {
  checklist_id: string;
  employee_id: string;
  candidate_id: string | null;
  document_code: string;
  document_name: string;
  template_id: string | null;
  template_name: string | null;
  template_storage_path: string | null;
  template_mime_type: string | null;
  fill_mode: string | null;
  template_schema_json: string | null;
};

function ensureDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeTrim(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function digitsOnly(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function hashValue(value: unknown) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized ? createHash("sha256").update(normalized).digest("hex") : null;
}

function maskDigits(value: unknown, visible = 4) {
  const digits = digitsOnly(value);
  if (!digits) return null;
  return `${"X".repeat(Math.max(0, digits.length - visible))}${digits.slice(-visible)}`;
}

function maskPan(value: unknown) {
  const pan = safeTrim(value)?.toUpperCase();
  if (!pan) return null;
  return `${pan.slice(0, 3)}XXXX${pan.slice(-2)}`;
}

function maskBankAccount(value: unknown) {
  const digits = digitsOnly(value);
  if (!digits) return null;
  return `XXXXXX${digits.slice(-4)}`;
}

function nestedValue(source: Record<string, unknown>, sourcePath?: string | null) {
  const normalized = safeTrim(sourcePath);
  if (!normalized) return null;
  return normalized.split(".").reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== "object") return null;
    return (acc as Record<string, unknown>)[key] ?? null;
  }, source);
}

function formatValueForField(value: unknown, fieldType: string) {
  if (value == null) return "";
  if (fieldType === "checkbox" || fieldType === "radio") {
    return value ? "Yes" : "";
  }
  return String(value);
}

async function auditFieldChange(input: {
  employeeId: string;
  candidateId?: string | null;
  checklistId: string;
  documentCode: string;
  actionType: string;
  actorUserId?: string | null;
  actorType?: "hr" | "employee" | "public_token" | "system";
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
      input.checklistId,
      input.documentCode,
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

async function checklistContext(checklistId: string): Promise<ChecklistContextRow> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
        c.id AS checklist_id,
        c.employee_id,
        c.candidate_id,
        c.document_code,
        c.document_name,
        c.template_id,
        t.document_name AS template_name,
        t.template_storage_path,
        t.template_mime_type,
        t.fill_mode,
        JSON_UNQUOTE(JSON_EXTRACT(t.template_schema_json, '$')) AS template_schema_json
       FROM employee_joining_document_checklist c
       LEFT JOIN employee_joining_document_template t ON t.id = c.template_id
      WHERE c.id = ?
      LIMIT 1`,
    [checklistId],
  );
  const row = (rows as unknown as ChecklistContextRow[])[0];
  if (!row) {
    const err = new Error("Checklist item not found") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }
  return row;
}

async function buildSourceContext(employeeId: string, candidateId?: string | null) {
  const [[employee]] = await db.execute<RowDataPacket[]>(
    `SELECT
        e.id,
        e.employee_code,
        COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')))) AS full_name,
        e.first_name,
        e.last_name,
        e.date_of_birth,
        e.date_of_joining,
        e.mobile,
        COALESCE(NULLIF(TRIM(e.official_email), ''), NULLIF(TRIM(e.office_email), ''), e.email) AS email,
        d.designation_name,
        dept.dept_name AS department_name,
        b.branch_name,
        p.process_name
       FROM employees e
       LEFT JOIN designation_master d ON d.id = e.designation_id
       LEFT JOIN department_master dept ON dept.id = e.department_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
      WHERE e.id = ?
      LIMIT 1`,
    [employeeId],
  );

  const [[bank]] = await db.execute<RowDataPacket[]>(
    `SELECT bank_name, bank_account_no, bank_ifsc
       FROM ats_candidate
      WHERE id = ?
      LIMIT 1`,
    [candidateId ?? ""],
  ).catch(() => [[null] as unknown as RowDataPacket[], []]);

  const [[onboarding]] = await db.execute<RowDataPacket[]>(
    `SELECT
        father_husband_name,
        date_of_birth,
        mobile_number,
        personal_email_id,
        pan_number_masked,
        aadhaar_number_masked,
        uan_number
       FROM candidate_onboarding_profile
      WHERE candidate_id = ?
      LIMIT 1`,
    [candidateId ?? ""],
  ).catch(() => [[null] as unknown as RowDataPacket[], []]);

  const [[epf]] = await db.execute<RowDataPacket[]>(
    `SELECT
        father_or_spouse_name,
        date_of_birth,
        mobile_number,
        personal_email,
        pan_masked,
        aadhaar_masked,
        uan_masked
       FROM employee_epf_compliance_profile
      WHERE employee_id = ?
      LIMIT 1`,
    [employeeId],
  ).catch(() => [[null] as unknown as RowDataPacket[], []]);

  return {
    employee: {
      full_name: employee?.full_name ?? null,
      employee_code: employee?.employee_code ?? null,
      date_of_birth: employee?.date_of_birth ?? onboarding?.date_of_birth ?? epf?.date_of_birth ?? null,
      date_of_joining: employee?.date_of_joining ?? null,
      designation: employee?.designation_name ?? null,
      department: employee?.department_name ?? null,
      branch: employee?.branch_name ?? null,
      process: employee?.process_name ?? null,
      mobile: employee?.mobile ?? onboarding?.mobile_number ?? epf?.mobile_number ?? null,
      email: employee?.email ?? onboarding?.personal_email_id ?? epf?.personal_email ?? null,
      father_name: epf?.father_or_spouse_name ?? onboarding?.father_husband_name ?? null,
    },
    statutory: {
      pan_masked: epf?.pan_masked ?? onboarding?.pan_number_masked ?? null,
      aadhaar_masked: epf?.aadhaar_masked ?? onboarding?.aadhaar_number_masked ?? null,
      uan: epf?.uan_masked ?? onboarding?.uan_number ?? null,
      bank_account_masked: maskBankAccount(bank?.bank_account_no ?? null),
    },
    system: {
      current_date: new Date().toISOString().slice(0, 10),
    },
  };
}

async function fieldMapsForTemplate(templateId: string | null, documentCode: string) {
  const params: unknown[] = [documentCode];
  let templateSql = "";
  if (templateId) {
    templateSql = " OR template_id = ?";
    params.push(templateId);
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT *
       FROM document_template_field_map
      WHERE document_code = ?${templateSql}
      ORDER BY page_no ASC, created_at ASC`,
    params,
  );
  return rows as RowDataPacket[];
}

function deriveFieldValue(map: RowDataPacket, sourceContext: Record<string, unknown>) {
  const sourceValue = nestedValue(sourceContext, String(map.source_path ?? ""));
  const fieldType = String(map.field_type ?? "text");
  const maskingRule = safeTrim(map.masking_rule);
  let rawValue = sourceValue;
  if (maskingRule === "aadhaar") rawValue = maskDigits(sourceValue);
  if (maskingRule === "pan") rawValue = maskPan(sourceValue);
  if (maskingRule === "bank_account") rawValue = maskBankAccount(sourceValue);
  const textValue = formatValueForField(rawValue, fieldType);
  return {
    value_text: textValue || null,
    masked_value: textValue || null,
    confidence_score: textValue ? 100 : 0,
    fill_status: textValue ? "auto_filled" : "hr_fill_required",
    requires_confirmation: textValue ? 0 : 1,
    value_source: "SYSTEM",
  };
}

async function upsertFieldValue(params: {
  checklistId: string;
  employeeId: string;
  documentCode: string;
  fieldKey: string;
  fieldLabel: string;
  sourcePath?: string | null;
  fieldType: string;
  valueText?: string | null;
  maskedValue?: string | null;
  valueSource: "SYSTEM" | "HR_ENTERED" | "EMPLOYEE_CONFIRMED" | "PAYROLL_ENTERED";
  fillStatus: string;
  confidenceScore?: number | null;
  requiresConfirmation?: number;
  employeeConfirmed?: number;
  employeeConfirmationComment?: string | null;
  hrReason?: string | null;
  actorUserId?: string | null;
}) {
  const [existingRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, value_text, value_source, fill_status, employee_confirmed
       FROM employee_joining_document_field_value
      WHERE checklist_id = ? AND field_key = ?
      LIMIT 1`,
    [params.checklistId, params.fieldKey],
  );
  const existing = existingRows[0] as RowDataPacket | undefined;
  if (existing) {
    await db.execute(
      `UPDATE employee_joining_document_field_value
          SET field_label = ?,
              source_path = ?,
              field_type = ?,
              value_text = ?,
              masked_value = ?,
              value_source = ?,
              fill_status = ?,
              confidence_score = ?,
              requires_confirmation = ?,
              employee_confirmed = ?,
              employee_confirmed_at = CASE WHEN ? = 1 THEN COALESCE(employee_confirmed_at, NOW()) ELSE employee_confirmed_at END,
              employee_confirmation_comment = ?,
              hr_reason = ?,
              updated_by = ?,
              updated_at = NOW()
        WHERE id = ?`,
      [
        params.fieldLabel,
        params.sourcePath ?? null,
        params.fieldType,
        params.valueText ?? null,
        params.maskedValue ?? null,
        params.valueSource,
        params.fillStatus,
        params.confidenceScore ?? null,
        params.requiresConfirmation ?? 0,
        params.employeeConfirmed ?? 0,
        params.employeeConfirmed ?? 0,
        params.employeeConfirmationComment ?? null,
        params.hrReason ?? null,
        params.actorUserId ?? null,
        existing.id,
      ],
    );
    return existing.id as string;
  }

  const id = randomUUID();
  await db.execute(
    `INSERT INTO employee_joining_document_field_value
       (id, checklist_id, employee_id, document_code, field_key, field_label, source_path, field_type, value_text, masked_value, value_source, fill_status, confidence_score, requires_confirmation, employee_confirmed, employee_confirmed_at, employee_confirmation_comment, hr_reason, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.checklistId,
      params.employeeId,
      params.documentCode,
      params.fieldKey,
      params.fieldLabel,
      params.sourcePath ?? null,
      params.fieldType,
      params.valueText ?? null,
      params.maskedValue ?? null,
      params.valueSource,
      params.fillStatus,
      params.confidenceScore ?? null,
      params.requiresConfirmation ?? 0,
      params.employeeConfirmed ?? 0,
      params.employeeConfirmed ? new Date() : null,
      params.employeeConfirmationComment ?? null,
      params.hrReason ?? null,
      params.actorUserId ?? null,
      params.actorUserId ?? null,
    ],
  );
  return id;
}

async function persistChecklistFillStatus(checklistId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
        SUM(CASE WHEN fill_status = 'hr_fill_required' THEN 1 ELSE 0 END) AS missing_count,
        SUM(CASE WHEN value_source = 'HR_ENTERED' THEN 1 ELSE 0 END) AS hr_count,
        SUM(CASE WHEN employee_confirmed = 0 THEN 1 ELSE 0 END) AS unconfirmed_count
       FROM employee_joining_document_field_value
      WHERE checklist_id = ?`,
    [checklistId],
  );
  const row = rows[0] as RowDataPacket | undefined;
  const missing = Number(row?.missing_count ?? 0);
  const hrEntered = Number(row?.hr_count ?? 0);
  const unconfirmed = Number(row?.unconfirmed_count ?? 0);

  const fillStatus = missing > 0
    ? "hr_fill_required"
    : hrEntered > 0
      ? "hr_filled"
      : "auto_filled";
  const reviewStatus = missing > 0
    ? "pending"
    : unconfirmed > 0
      ? "employee_review_pending"
      : "confirmed";

  await db.execute(
    `UPDATE employee_joining_document_checklist
        SET fill_status = ?,
            employee_review_status = ?,
            status = CASE
              WHEN ? = 'pending' THEN 'draft_generated'
              WHEN ? = 'employee_review_pending' THEN 'employee_review_pending'
              ELSE status
            END,
            updated_at = NOW()
      WHERE id = ?`,
    [fillStatus, reviewStatus, reviewStatus, reviewStatus, checklistId],
  );
}

export async function listTemplateFieldMaps(templateId: string, documentCode: string) {
  return fieldMapsForTemplate(templateId, documentCode);
}

export async function replaceTemplateFieldMaps(templateId: string, documentCode: string, actorUserId: string, maps: FieldMapInput[]) {
  await db.execute(
    `DELETE FROM document_template_field_map WHERE template_id = ? AND document_code = ?`,
    [templateId, documentCode],
  );
  for (const map of maps) {
    await db.execute(
      `INSERT INTO document_template_field_map
         (id, template_id, document_code, field_key, field_label, source_path, page_no, x, y, width, height, font_size, font_weight, alignment, field_type, required, masking_rule, mapping_mode, placeholder_token, pdf_field_name, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        map.id ?? randomUUID(),
        templateId,
        documentCode,
        map.field_key,
        map.field_label,
        map.source_path ?? null,
        Number(map.page_no ?? 1),
        map.x ?? null,
        map.y ?? null,
        map.width ?? null,
        map.height ?? null,
        map.font_size ?? null,
        map.font_weight ?? null,
        map.alignment ?? null,
        map.field_type ?? "text",
        map.required ? 1 : 0,
        map.masking_rule ?? null,
        map.mapping_mode ?? "placeholder",
        map.placeholder_token ?? null,
        map.pdf_field_name ?? null,
        actorUserId,
      ],
    );
  }
  return listTemplateFieldMaps(templateId, documentCode);
}

export async function synchronizeChecklistFieldValues(checklistId: string, actorUserId?: string | null) {
  const checklist = await checklistContext(checklistId);
  const maps = await fieldMapsForTemplate(checklist.template_id, checklist.document_code);
  const sourceContext = await buildSourceContext(checklist.employee_id, checklist.candidate_id);
  const [existingRows] = await db.execute<RowDataPacket[]>(
    `SELECT field_key, value_source, value_text
       FROM employee_joining_document_field_value
      WHERE checklist_id = ?`,
    [checklistId],
  );
  const existingByKey = new Map(existingRows.map((row) => [String(row.field_key), row]));

  for (const map of maps) {
    const existing = existingByKey.get(String(map.field_key));
    if (existing && ["HR_ENTERED", "EMPLOYEE_CONFIRMED", "PAYROLL_ENTERED"].includes(String(existing.value_source))) {
      continue;
    }
    const derived = deriveFieldValue(map, sourceContext);
    const valueId = await upsertFieldValue({
      checklistId,
      employeeId: checklist.employee_id,
      documentCode: checklist.document_code,
      fieldKey: String(map.field_key),
      fieldLabel: String(map.field_label),
      sourcePath: safeTrim(map.source_path),
      fieldType: String(map.field_type ?? "text"),
      valueText: derived.value_text,
      maskedValue: derived.masked_value,
      valueSource: "SYSTEM",
      fillStatus: derived.fill_status,
      confidenceScore: derived.confidence_score,
      requiresConfirmation: Number(derived.requires_confirmation),
      actorUserId,
    });
    await auditFieldChange({
      employeeId: checklist.employee_id,
      candidateId: checklist.candidate_id ?? null,
      checklistId,
      documentCode: checklist.document_code,
      actionType: derived.value_text ? "AUTO_FIELD_FILLED" : "AUTO_FIELD_MISSING",
      actorUserId,
      actorType: actorUserId ? "hr" : "system",
      newValue: {
        valueId,
        field_key: map.field_key,
        value_source: "SYSTEM",
        fill_status: derived.fill_status,
      },
    });
  }

  await persistChecklistFillStatus(checklistId);
  return getChecklistFieldReview(checklistId);
}

export async function manualFillChecklistValues(params: {
  checklistId: string;
  actorUserId: string;
  updates: FieldValueUpdate[];
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const checklist = await checklistContext(params.checklistId);
  for (const update of params.updates) {
    const [mapRows] = await db.execute<RowDataPacket[]>(
      `SELECT field_label, source_path, field_type
         FROM document_template_field_map
        WHERE document_code = ? AND field_key = ?
        ORDER BY updated_at DESC
        LIMIT 1`,
      [checklist.document_code, update.field_key],
    );
    const fieldMap = mapRows[0];
    const [existingRows] = await db.execute<RowDataPacket[]>(
      `SELECT value_text, value_source FROM employee_joining_document_field_value WHERE checklist_id = ? AND field_key = ? LIMIT 1`,
      [params.checklistId, update.field_key],
    );
    const existing = existingRows[0];
    await upsertFieldValue({
      checklistId: params.checklistId,
      employeeId: checklist.employee_id,
      documentCode: checklist.document_code,
      fieldKey: update.field_key,
      fieldLabel: String(fieldMap?.field_label ?? update.field_key),
      sourcePath: safeTrim(fieldMap?.source_path),
      fieldType: String(fieldMap?.field_type ?? "text"),
      valueText: safeTrim(update.value_text),
      maskedValue: safeTrim(update.value_text),
      valueSource: "HR_ENTERED",
      fillStatus: "hr_filled",
      confidenceScore: 100,
      requiresConfirmation: 1,
      actorUserId: params.actorUserId,
      hrReason: safeTrim(update.reason),
    });
    await auditFieldChange({
      employeeId: checklist.employee_id,
      candidateId: checklist.candidate_id ?? null,
      checklistId: params.checklistId,
      documentCode: checklist.document_code,
      actionType: "HR_FIELD_MANUAL_FILL",
      actorUserId: params.actorUserId,
      actorType: "hr",
      remarks: safeTrim(update.reason),
      oldValue: existing ? { value_text: existing.value_text, value_source: existing.value_source } : null,
      newValue: { value_text: update.value_text, value_source: "HR_ENTERED" },
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    });
  }
  await persistChecklistFillStatus(params.checklistId);
  return getChecklistFieldReview(params.checklistId);
}

async function writeArtifact(employeeId: string, documentCode: string, fileName: string, content: Buffer) {
  const dirPath = path.join(STORAGE_ROOT, employeeId, documentCode.toLowerCase(), "filled");
  ensureDir(dirPath);
  const storedFilename = `${Date.now()}-${randomUUID()}${path.extname(fileName) || ".pdf"}`;
  const storagePath = path.join(dirPath, storedFilename);
  fs.writeFileSync(storagePath, content);
  return {
    storedFilename,
    storagePath,
    fileHash: createHash("sha256").update(content).digest("hex"),
    fileSize: content.byteLength,
  };
}

async function attachGeneratedArtifact(checklist: ChecklistContextRow, content: Buffer, fileName: string, actorUserId?: string | null) {
  const artifact = await writeArtifact(checklist.employee_id, checklist.document_code, fileName, content);
  const fileId = randomUUID();
  await db.execute(
    `INSERT INTO employee_joining_document_file
       (id, checklist_id, employee_id, candidate_id, document_code, file_role, original_filename, stored_filename, storage_path, mime_type, file_size_bytes, file_hash_sha256, uploaded_by, uploaded_by_type)
     VALUES (?, ?, ?, ?, ?, 'generated', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fileId,
      checklist.checklist_id,
      checklist.employee_id,
      checklist.candidate_id ?? null,
      checklist.document_code,
      fileName,
      artifact.storedFilename,
      artifact.storagePath,
      mimeTypeFromFileName(fileName),
      artifact.fileSize,
      artifact.fileHash,
      actorUserId ?? null,
      actorUserId ? "hr" : "system",
    ],
  );
  await db.execute(
    `UPDATE employee_joining_document_checklist
        SET fill_status = CASE WHEN employee_review_status = 'confirmed' THEN 'ready_for_esign' ELSE fill_status END,
            status = CASE
              WHEN employee_review_status = 'confirmed' THEN 'ready_for_esign'
              WHEN fill_status = 'hr_fill_required' THEN 'hr_fill_required'
              ELSE 'draft_generated'
            END,
            updated_at = NOW()
      WHERE id = ?`,
    [checklist.checklist_id],
  );
  return fileId;
}

function mimeTypeFromFileName(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === ".html") return "text/html";
  if (ext === ".pdf") return "application/pdf";
  return "application/octet-stream";
}

async function renderSummaryPdf(checklist: ChecklistContextRow, values: RowDataPacket[]) {
  const outputPath = path.join(STORAGE_ROOT, checklist.employee_id, checklist.document_code.toLowerCase(), "summary-preview.pdf");
  ensureDir(path.dirname(outputPath));
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocumentKit({ margin: 42, size: "A4" });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);
    doc.fontSize(22).fillColor("#B91C1C").text("DRAFT - TEMPLATE NOT CONFIGURED", { align: "center" });
    doc.moveDown(0.75);
    doc.fillColor("#111827").fontSize(18).text(checklist.document_name, { align: "center" });
    doc.moveDown();
    doc.fontSize(11).text("Digital draft generated by HRMS Universal Digital Form Fill Engine.");
    doc.text("This is a placeholder until the official template and field map are configured.");
    doc.moveDown();
    values.forEach((value) => {
      doc.font("Helvetica-Bold").text(`${value.field_label}: `, { continued: true });
      doc.font("Helvetica").text(String(value.value_text ?? ""));
    });
    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
  return fs.readFileSync(outputPath);
}

async function renderPlaceholderDocx(templatePath: string, replacements: Record<string, string>) {
  const zip = new PizZip(fs.readFileSync(templatePath));
  const documentXml = zip.file("word/document.xml")?.asText();
  if (!documentXml) throw new Error("DOCX template is missing word/document.xml");
  let nextXml = documentXml;
  for (const [token, value] of Object.entries(replacements)) {
    nextXml = nextXml.split(`{{${token}}}`).join(value);
  }
  zip.file("word/document.xml", nextXml);
  return zip.generate({ type: "nodebuffer" });
}

async function renderFillablePdf(templatePath: string, fieldMaps: RowDataPacket[], values: RowDataPacket[]) {
  const pdfBytes = fs.readFileSync(templatePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const form = pdfDoc.getForm();
  const valueMap = new Map(values.map((value) => [String(value.field_key), String(value.value_text ?? "")]));
  for (const fieldMap of fieldMaps) {
    const fieldName = safeTrim(fieldMap.pdf_field_name) ?? String(fieldMap.field_key);
    const textValue = valueMap.get(String(fieldMap.field_key)) ?? "";
    const field = form.getFields().find((candidate) => candidate.getName() === fieldName);
    if (!field) continue;
    try {
      if ("setText" in field && typeof field.setText === "function") {
        const textField = field as { setText?: (value: string) => void };
        textField.setText?.(textValue);
      }
      if ("check" in field && typeof field.check === "function" && textValue) {
        const checkboxField = field as { check?: () => void };
        checkboxField.check?.();
      }
    } catch {
      continue;
    }
  }
  form.flatten();
  return Buffer.from(await pdfDoc.save());
}

async function renderOverlayPdf(templatePath: string, fieldMaps: RowDataPacket[], values: RowDataPacket[]) {
  const pdfBytes = fs.readFileSync(templatePath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const valueMap = new Map(values.map((value) => [String(value.field_key), String(value.value_text ?? "")]));
  const pages = pdfDoc.getPages();
  for (const map of fieldMaps) {
    const pageIndex = Math.max(0, Number(map.page_no ?? 1) - 1);
    const page = pages[pageIndex];
    if (!page) continue;
    const text = valueMap.get(String(map.field_key)) ?? "";
    if (!text) continue;
    const x = Number(map.x ?? 40);
    const y = Number(map.y ?? 700);
    const fontSize = Number(map.font_size ?? 10);
    if (String(map.field_type ?? "text") === "checkbox") {
      page.drawText(text ? "X" : "", { x, y, size: fontSize, font });
    } else {
      page.drawText(text, { x, y, size: fontSize, font });
    }
  }
  return Buffer.from(await pdfDoc.save());
}

export async function generateChecklistDraft(checklistId: string, actorUserId?: string | null) {
  const checklist = await checklistContext(checklistId);
  const fieldReview = await synchronizeChecklistFieldValues(checklistId, actorUserId);
  const values = fieldReview.values as RowDataPacket[];
  const replacements = Object.fromEntries(values.map((value) => [String(value.field_key), String(value.value_text ?? "")]));
  let outputFileName = `${checklist.document_code.toLowerCase()}-draft.pdf`;
  let content: Buffer;

  try {
    if (checklist.template_storage_path && fs.existsSync(checklist.template_storage_path)) {
      const fillMode = safeTrim(checklist.fill_mode) ?? "placeholder";
      const fieldMaps = await fieldMapsForTemplate(checklist.template_id, checklist.document_code);
      if (fillMode === "placeholder" && checklist.template_storage_path.toLowerCase().endsWith(".docx")) {
        outputFileName = `${checklist.document_code.toLowerCase()}-draft.docx`;
        content = await renderPlaceholderDocx(checklist.template_storage_path, replacements);
      } else if (fillMode === "fillable_pdf") {
        content = await renderFillablePdf(checklist.template_storage_path, fieldMaps, values);
      } else if (
        fillMode === "pdf_overlay" ||
        fillMode === "pdf_coordinate_overlay" ||
        fillMode === "scanned_pdf_overlay" ||
        fillMode === "image_pdf_overlay" ||
        checklist.template_storage_path.toLowerCase().endsWith(".pdf")
      ) {
        content = await renderOverlayPdf(checklist.template_storage_path, fieldMaps, values);
      } else {
        content = await renderSummaryPdf(checklist, values);
      }
    } else {
      content = await renderSummaryPdf(checklist, values);
    }
  } catch {
    content = await renderSummaryPdf(checklist, values);
  }

  const fileId = await attachGeneratedArtifact(checklist, content, outputFileName, actorUserId);
  await auditFieldChange({
    employeeId: checklist.employee_id,
    candidateId: checklist.candidate_id ?? null,
    checklistId,
    documentCode: checklist.document_code,
    actionType: "DRAFT_GENERATED",
    actorUserId,
    actorType: actorUserId ? "hr" : "system",
    newValue: { generated_file_id: fileId, output_file_name: outputFileName },
  });
  return {
    file_id: fileId,
    file_name: outputFileName,
    review: await getChecklistFieldReview(checklistId),
  };
}

export async function getChecklistFieldReview(checklistId: string) {
  const checklist = await checklistContext(checklistId);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT field_key, field_label, source_path, field_type, value_text, masked_value, value_source, fill_status, confidence_score, requires_confirmation, employee_confirmed, employee_confirmation_comment, hr_reason, updated_at
       FROM employee_joining_document_field_value
      WHERE checklist_id = ?
      ORDER BY updated_at ASC, field_label ASC`,
    [checklistId],
  );
  const [latestFileRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, original_filename, mime_type
       FROM employee_joining_document_file
      WHERE checklist_id = ?
        AND deleted_at IS NULL
      ORDER BY FIELD(file_role, 'signed', 'generated', 'hr_uploaded', 'supporting'), uploaded_at DESC
      LIMIT 1`,
    [checklistId],
  );
  return {
    checklist,
    values: rows,
    latest_file: latestFileRows[0] ?? null,
  };
}

export async function employeeReviewChecklistByToken(params: {
  publicToken: string;
  action: "confirm" | "request_correction";
  comment?: string | null;
  actorName?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT checklist_id, employee_id, document_code
       FROM employee_joining_document_public_token
      WHERE public_token = ?
        AND token_status = 'active'
        AND expires_at > NOW()
      LIMIT 1`,
    [params.publicToken],
  );
  const tokenRow = rows[0];
  if (!tokenRow) {
    const err = new Error("Invalid or expired employee review link") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  if (params.action === "confirm") {
    await db.execute(
      `UPDATE employee_joining_document_field_value
          SET employee_confirmed = 1,
              employee_confirmed_at = NOW(),
              employee_confirmation_comment = COALESCE(?, employee_confirmation_comment),
              value_source = CASE WHEN value_source = 'HR_ENTERED' THEN 'EMPLOYEE_CONFIRMED' ELSE value_source END,
              fill_status = 'ready_for_esign'
        WHERE checklist_id = ?`,
      [params.comment ?? null, tokenRow.checklist_id],
    );
    await db.execute(
      `UPDATE employee_joining_document_checklist
          SET employee_review_status = 'confirmed',
              employee_reviewed_at = NOW(),
              employee_review_comment = ?,
              fill_status = 'ready_for_esign',
              status = 'ready_for_esign',
              updated_at = NOW()
        WHERE id = ?`,
      [params.comment ?? null, tokenRow.checklist_id],
    );
  } else {
    await db.execute(
      `UPDATE employee_joining_document_field_value
          SET fill_status = 'correction_requested',
              employee_confirmation_comment = COALESCE(?, employee_confirmation_comment),
              updated_at = NOW()
        WHERE checklist_id = ?`,
      [params.comment ?? null, tokenRow.checklist_id],
    );
    await db.execute(
      `UPDATE employee_joining_document_checklist
          SET employee_review_status = 'correction_requested',
              employee_reviewed_at = NOW(),
              employee_review_comment = ?,
              fill_status = 'correction_requested',
              status = 'correction_requested',
              updated_at = NOW()
        WHERE id = ?`,
      [params.comment ?? null, tokenRow.checklist_id],
    );
  }

  await auditFieldChange({
    employeeId: String(tokenRow.employee_id),
    checklistId: String(tokenRow.checklist_id),
    documentCode: String(tokenRow.document_code),
    actionType: params.action === "confirm" ? "EMPLOYEE_REVIEW_CONFIRMED" : "EMPLOYEE_REVIEW_CORRECTION_REQUESTED",
    actorType: "public_token",
    remarks: params.comment ?? null,
    newValue: { actorName: params.actorName ?? null, action: params.action },
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
  });

  return getChecklistFieldReview(String(tokenRow.checklist_id));
}
