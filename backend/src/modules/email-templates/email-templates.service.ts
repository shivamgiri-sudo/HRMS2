import { randomUUID } from 'crypto';
import * as XLSX from 'xlsx';
import { db } from '../../db/mysql.js';
import type { RowDataPacket, PoolConnection } from 'mysql2/promise';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmailTemplateRow {
  template_key:   string;
  module_name:    string;
  subject:        string;
  body_text:      string;
  body_html:      string;
  variables_json: string;
  is_active:      number;
}

export interface ValidatedRow extends EmailTemplateRow {
  rowNo:          number;
  errors:         string[];
  isNew:          boolean;   // true = INSERT, false = UPDATE
  autoVars:       string[];  // variables auto-detected from subject+body
}

export interface InvalidRow {
  rowNo:   number;
  raw:     Record<string, unknown>;
  errors:  string[];
}

export interface PreviewResult {
  totalRows:       number;
  newTemplateCount:   number;
  updateTemplateCount: number;
  validRows:       ValidatedRow[];
  invalidRows:     InvalidRow[];
  duplicateRows:   InvalidRow[];
}

export interface ConfirmResult {
  inserted: number;
  updated:  number;
  batchId:  string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const REQUIRED = ['template_key', 'module_name', 'subject', 'body_text'] as const;

/** Extract {{varName}} tokens from a string */
function extractVars(text: string): string[] {
  const found = new Set<string>();
  const re = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) found.add(m[1]);
  return [...found];
}

/** Normalise a raw cell value to string */
function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/** Coerce row object keys to lowercase with underscores */
function normaliseKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) {
    out[k.toLowerCase().replace(/\s+/g, '_')] = obj[k];
  }
  return out;
}

/** Very basic HTML sanitiser — strips <script> tags and on* attributes */
function sanitiseHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*(['"])[^'"]*\1/gi, '');
}

// ─── Parse file buffer → raw rows ─────────────────────────────────────────────

export function parseFileBuffer(
  buffer: Buffer,
  mimetype: string,
  originalName: string,
): Record<string, unknown>[] {
  const ext = originalName.split('.').pop()?.toLowerCase() ?? '';
  const isCsv = mimetype === 'text/csv' || ext === 'csv';

  const wb = isCsv
    ? XLSX.read(buffer, { type: 'buffer', raw: false })
    : XLSX.read(buffer, { type: 'buffer' });

  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error('Workbook has no sheets');

  // header: true → array of objects, defval: '' fills blanks
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    header: undefined,
    defval: '',
    raw: false,
  });
}

// ─── Preview (no DB writes) ───────────────────────────────────────────────────

export async function previewImport(
  rows: Record<string, unknown>[],
): Promise<PreviewResult> {
  const validRows:     ValidatedRow[] = [];
  const invalidRows:   InvalidRow[]   = [];
  const duplicateRows: InvalidRow[]   = [];

  // Collect all template_keys in this file to detect intra-file duplicates
  const seenInFile = new Map<string, number>(); // key → first rowNo

  // Fetch existing keys from DB in one query
  const [existing] = await db.execute<RowDataPacket[]>(
    'SELECT template_key FROM email_templates',
  );
  const existingKeys = new Set(existing.map((r) => (r as any).template_key as string));

  for (let i = 0; i < rows.length; i++) {
    const rowNo = i + 2; // 1-indexed, row 1 is header
    const raw   = normaliseKeys(rows[i]);
    const errors: string[] = [];

    // ── Required field checks ────────────────────────────────────────────────
    for (const f of REQUIRED) {
      if (!cell(raw[f])) errors.push(`${f} is required`);
    }

    const templateKey = cell(raw['template_key']).toUpperCase().replace(/\s+/g, '_');
    const moduleName  = cell(raw['module_name']);
    const subject     = cell(raw['subject']);
    const bodyText    = cell(raw['body_text']);
    const bodyHtml    = sanitiseHtml(cell(raw['body_html']));
    const isActiveStr = cell(raw['is_active']);
    const isActive    = isActiveStr === '' ? 1 : isActiveStr === '0' ? 0 : 1;

    // ── template_key format ──────────────────────────────────────────────────
    if (templateKey && !/^[A-Z][A-Z0-9_]{1,99}$/.test(templateKey)) {
      errors.push('template_key must be UPPER_SNAKE_CASE (letters, digits, underscores)');
    }

    // ── intra-file duplicate detection ───────────────────────────────────────
    if (templateKey) {
      if (seenInFile.has(templateKey)) {
        duplicateRows.push({
          rowNo,
          raw: rows[i],
          errors: [`Duplicate template_key "${templateKey}" — first seen at row ${seenInFile.get(templateKey)}`],
        });
        continue;
      }
      seenInFile.set(templateKey, rowNo);
    }

    // ── variables_json ───────────────────────────────────────────────────────
    let parsedVars: string[] = [];
    const rawVars = cell(raw['variables_json']);
    if (rawVars) {
      try {
        const parsed = JSON.parse(rawVars);
        if (!Array.isArray(parsed) || parsed.some((v) => typeof v !== 'string')) {
          errors.push('variables_json must be a JSON array of strings e.g. ["name","otp"]');
        } else {
          parsedVars = parsed;
        }
      } catch {
        errors.push('variables_json is not valid JSON');
      }
    }

    if (errors.length > 0) {
      invalidRows.push({ rowNo, raw: rows[i], errors });
      continue;
    }

    // ── Auto-detect variables if not supplied ────────────────────────────────
    const autoVars = parsedVars.length > 0
      ? parsedVars
      : [...new Set([...extractVars(subject), ...extractVars(bodyText), ...extractVars(bodyHtml)])];

    validRows.push({
      rowNo,
      template_key:   templateKey,
      module_name:    moduleName,
      subject,
      body_text:      bodyText,
      body_html:      bodyHtml,
      variables_json: JSON.stringify(autoVars),
      is_active:      isActive,
      errors:         [],
      isNew:          !existingKeys.has(templateKey),
      autoVars,
    });
  }

  return {
    totalRows:          rows.length,
    newTemplateCount:   validRows.filter((r) => r.isNew).length,
    updateTemplateCount: validRows.filter((r) => !r.isNew).length,
    validRows,
    invalidRows,
    duplicateRows,
  };
}

// ─── Confirm import (transactional) ───────────────────────────────────────────

export async function confirmImport(
  validRows: ValidatedRow[],
  userId: string,
  originalFileName: string,
): Promise<ConfirmResult> {
  if (!validRows.length) return { inserted: 0, updated: 0, batchId: '' };

  const batchId  = randomUUID();
  const batchNo  = `ETMPL-${Date.now()}`;
  let inserted   = 0;
  let updated    = 0;

  // Use a single connection for the transaction
  const conn: PoolConnection = await (db as any).getConnection();
  try {
    await conn.beginTransaction();

    // Record batch header
    await conn.execute(
      `INSERT INTO upload_batch
         (id, upload_batch_no, upload_type_code, original_file_name,
          total_rows, valid_rows, error_rows, imported_rows, batch_status, uploaded_by)
       VALUES (?, ?, 'EMAIL_TEMPLATE_IMPORT', ?, ?, ?, 0, ?, 'imported', ?)`,
      [
        batchId, batchNo, originalFileName,
        validRows.length, validRows.length,
        validRows.length, userId,
      ],
    );

    for (const row of validRows) {
      const rowId = randomUUID();

      // INSERT … ON DUPLICATE KEY UPDATE — never creates duplicate template_key
      const [result] = await conn.execute<any>(
        `INSERT INTO email_templates
           (id, template_key, module_name, subject, body_text, body_html,
            variables_json, is_active, imported_via, imported_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'bulk_import', ?)
         ON DUPLICATE KEY UPDATE
           module_name    = VALUES(module_name),
           subject        = VALUES(subject),
           body_text      = VALUES(body_text),
           body_html      = VALUES(body_html),
           variables_json = VALUES(variables_json),
           is_active      = VALUES(is_active),
           imported_via   = 'bulk_import',
           imported_by    = VALUES(imported_by),
           updated_at     = NOW()`,
        [
          rowId,
          row.template_key,
          row.module_name,
          row.subject,
          row.body_text || null,
          row.body_html || null,
          row.variables_json,
          row.is_active,
          userId,
        ],
      );

      // affectedRows=1 → INSERT, affectedRows=2 → UPDATE (MySQL ON DUPLICATE KEY convention)
      if (result.affectedRows === 1) inserted++;
      else updated++;

      // Batch row record
      await conn.execute(
        `INSERT INTO upload_batch_row
           (id, upload_batch_id, row_no, raw_data, normalized_data, row_status)
         VALUES (?, ?, ?, ?, ?, 'imported')`,
        [
          randomUUID(), batchId, row.rowNo,
          JSON.stringify({ template_key: row.template_key }),
          JSON.stringify({ template_key: row.template_key, module_name: row.module_name }),
        ],
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  return { inserted, updated, batchId };
}

// ─── List all templates ───────────────────────────────────────────────────────

export async function listEmailTemplates(filters: {
  module_name?: string;
  is_active?: boolean;
  search?: string;
}) {
  let q = 'SELECT * FROM email_templates WHERE 1=1';
  const p: unknown[] = [];
  if (filters.module_name) { q += ' AND module_name = ?';                       p.push(filters.module_name); }
  if (filters.is_active !== undefined) { q += ' AND is_active = ?';              p.push(filters.is_active ? 1 : 0); }
  if (filters.search)      { q += ' AND (template_key LIKE ? OR subject LIKE ?)'; p.push(`%${filters.search}%`, `%${filters.search}%`); }
  q += ' ORDER BY module_name ASC, template_key ASC';
  const [rows] = await db.execute<RowDataPacket[]>(q, p);
  return rows;
}

// ─── Update single template ───────────────────────────────────────────────────

export async function updateEmailTemplate(
  templateKey: string,
  data: Partial<EmailTemplateRow>,
  userId: string,
) {
  const fields: string[] = [];
  const params: unknown[] = [];
  if (data.module_name    !== undefined) { fields.push('module_name = ?');    params.push(data.module_name); }
  if (data.subject        !== undefined) { fields.push('subject = ?');        params.push(data.subject); }
  if (data.body_text      !== undefined) { fields.push('body_text = ?');      params.push(data.body_text); }
  if (data.body_html      !== undefined) { fields.push('body_html = ?');      params.push(sanitiseHtml(data.body_html)); }
  if (data.variables_json !== undefined) { fields.push('variables_json = ?'); params.push(data.variables_json); }
  if (data.is_active      !== undefined) { fields.push('is_active = ?');      params.push(data.is_active); }
  if (!fields.length) throw new Error('No fields to update');
  fields.push('imported_by = ?');
  params.push(userId, templateKey);
  await db.execute(
    `UPDATE email_templates SET ${fields.join(', ')} WHERE template_key = ?`,
    params,
  );
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT * FROM email_templates WHERE template_key = ?', [templateKey],
  );
  return rows[0] ?? null;
}

// ─── Test render ──────────────────────────────────────────────────────────────

export async function testRenderTemplate(
  templateKey: string,
  variables: Record<string, string>,
): Promise<{ subject: string; body_text: string; body_html: string }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT * FROM email_templates WHERE template_key = ? AND is_active = 1 LIMIT 1',
    [templateKey],
  );
  const tpl = rows[0] as any;
  if (!tpl) throw new Error(`Template "${templateKey}" not found or inactive`);

  function render(tmpl: string): string {
    return tmpl.replace(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g, (_, key) =>
      variables[key] !== undefined ? String(variables[key]) : `{{${key}}}`,
    );
  }

  return {
    subject:   render(tpl.subject ?? ''),
    body_text: render(tpl.body_text ?? ''),
    body_html: render(tpl.body_html ?? ''),
  };
}

// ─── Sample CSV buffer ────────────────────────────────────────────────────────

export function buildSampleCsvBuffer(): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([
    ['template_key', 'module_name', 'subject', 'body_text', 'body_html', 'variables_json', 'is_active'],
    [
      'HRMS_LOGIN_OTP',
      'Authentication',
      'Your HRMS Login OTP',
      'Dear {{employeeName}}, your OTP for HRMS login is {{otp}}. Valid for {{expiryMinutes}} minutes. Do not share.',
      '',
      '["employeeName","otp","expiryMinutes"]',
      '1',
    ],
    [
      'HRMS_WELCOME_ONBOARD',
      'Onboarding',
      'Welcome to MAS Callnet, {{employeeName}}!',
      'Hi {{employeeName}}, welcome to MAS Callnet. Your Employee ID is {{employeeCode}}. Joining date: {{joiningDate}}.',
      '',
      '["employeeName","employeeCode","joiningDate"]',
      '1',
    ],
    [
      'HRMS_PAYSLIP_READY',
      'Payroll',
      'Your payslip for {{monthYear}} is ready',
      'Dear {{employeeName}}, your payslip for {{monthYear}} is ready. Net pay: {{netPay}}. Login to HRMS to view.',
      '',
      '["employeeName","monthYear","netPay"]',
      '1',
    ],
    [
      'HRMS_LEAVE_APPROVED',
      'Leave',
      'Leave Approved: {{leaveDates}}',
      'Dear {{employeeName}}, your {{leaveType}} leave from {{fromDate}} to {{toDate}} has been approved by {{approverName}}.',
      '',
      '["employeeName","leaveType","fromDate","toDate","approverName"]',
      '1',
    ],
    [
      'HRMS_SALARY_ASSIGNED',
      'Payroll',
      'Salary structure assigned for {{employeeName}}',
      'Dear HR, a new salary of CTC {{ctcAnnual}} has been assigned to {{employeeName}} ({{employeeCode}}) effective {{effectiveDate}}.',
      '',
      '["employeeName","employeeCode","ctcAnnual","effectiveDate"]',
      '1',
    ],
  ]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'EmailTemplates');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

// ─── Import history ───────────────────────────────────────────────────────────

export async function listImportHistory() {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT b.id, b.upload_batch_no, b.original_file_name,
            b.total_rows, b.valid_rows, b.imported_rows,
            b.batch_status, b.created_at, b.uploaded_by
     FROM upload_batch b
     WHERE b.upload_type_code = 'EMAIL_TEMPLATE_IMPORT'
     ORDER BY b.created_at DESC LIMIT 50`,
  );
  return rows;
}
