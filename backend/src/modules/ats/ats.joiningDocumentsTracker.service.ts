import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { db } from '../../db/mysql.js';
import { getUserRoleKeys } from '../../shared/scopeAccess.js';
import { getEmployeeForUser } from '../../shared/accessGuard.js';
import { sendRejectedEmail } from './ats.email.service.js';
import { generateJoiningDocumentChecklist } from '../employees/employeeJoiningDocuments.service.js';
// archiver ships a CJS default; @types/archiver only declares named exports so we
// need a type-cast to satisfy the compiler while keeping vi.mock('archiver') working.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as _archiverNs from 'archiver';
import type { ArchiverOptions, Archiver as ArchiverInstance } from 'archiver';
import fs from 'fs';
import path from 'path';
import type { Response } from 'express';

// esModuleInterop wraps the CJS default as .default; fall back to the namespace itself.
const archiverLib = ((_archiverNs as unknown as { default?: unknown }).default ??
  _archiverNs) as (format: string, options?: ArchiverOptions) => ArchiverInstance;

const STORAGE_ROOT = path.resolve(process.cwd(), 'private-storage', 'employee-joining-documents');

export interface KeyDocumentStatus {
  code: 'APPOINTMENT_LETTER' | 'ID_PROOF' | 'BANK_DETAILS' | 'ADDRESS_PROOF';
  status: string;
  verification_status: string | null;
}

export interface EmployeeDocumentRow {
  id: string;
  employee_code: string;
  full_name: string;
  branch_name: string;
  process_name: string;
  lob_name: string | null;
  date_of_joining: string;
  joining_document_status: string | null;
  joining_document_completion_pct: number;
  total_documents: number;
  verified_count: number;
  needs_correction_count: number;
  overdue_count: number;
  last_document_update: string | null;
  assigned_hr_name: string | null;
  key_documents: KeyDocumentStatus[];
}

export interface TrackerSummary {
  total: number;
  complete: number;
  pending_verification: number;
  in_progress: number;
  not_started: number;
  overdue: number;
  needs_correction: number;
}

export interface TrackerQueryParams {
  branch_id?: string;
  process_id?: string;
  status?: string;
  completion_min?: number;
  completion_max?: number;
  document_code?: string;
  overdue_only?: boolean;
  updated_since?: string;
  search?: string;
}

export interface TrackerResponse {
  employees: EmployeeDocumentRow[];
  summary: TrackerSummary;
}

export function parseKeyDocuments(keyDocumentsRaw: string | null): KeyDocumentStatus[] {
  if (!keyDocumentsRaw || keyDocumentsRaw.trim() === '') {
    return [];
  }

  return keyDocumentsRaw
    .split('||')
    .filter(Boolean)
    .map(part => {
      const [code, status, verificationStatus] = part.split(':');
      return {
        code: code as KeyDocumentStatus['code'],
        status,
        verification_status: verificationStatus === 'null' ? null : verificationStatus,
      };
    });
}

export function calculateTrackerSummary(employees: EmployeeDocumentRow[]): TrackerSummary {
  if (employees.length === 0) {
    return {
      total: 0,
      complete: 0,
      pending_verification: 0,
      in_progress: 0,
      not_started: 0,
      overdue: 0,
      needs_correction: 0,
    };
  }

  const summary: TrackerSummary = {
    total: employees.length,
    complete: 0,
    pending_verification: 0,
    in_progress: 0,
    not_started: 0,
    overdue: 0,
    needs_correction: 0,
  };

  for (const emp of employees) {
    const pct = emp.joining_document_completion_pct;

    if (pct === 100) {
      summary.complete++;
    } else if (pct >= 75) {
      summary.pending_verification++;
    } else if (pct > 0) {
      summary.in_progress++;
    } else {
      summary.not_started++;
    }

    if (emp.overdue_count > 0) {
      summary.overdue++;
    }

    if (emp.needs_correction_count > 0) {
      summary.needs_correction++;
    }
  }

  return summary;
}

interface TrackerQueryRow extends RowDataPacket {
  id: string;
  employee_code: string;
  full_name: string;
  branch_id: string;
  branch_name: string;
  process_id: string | null;
  process_name: string | null;
  lob_name: string | null;
  date_of_joining: string;
  joining_document_status: string | null;
  joining_document_completion_pct: number;
  key_documents_raw: string | null;
  total_documents: number;
  verified_count: number;
  needs_correction_count: number;
  overdue_count: number;
  last_document_update: string | null;
  assigned_hr_name: string | null;
}

export async function getJoiningDocumentsTracker(
  actorUserId: string,
  filters: TrackerQueryParams
): Promise<TrackerResponse> {
  const roleKeys = await getUserRoleKeys(actorUserId);
  const isBranchHead = roleKeys.includes('branch_head');

  // Build WHERE clause filters
  const whereClauses: string[] = ['e.active_status = 1', 'e.employee_code IS NOT NULL'];
  const params: (string | number)[] = [];

  // Branch Head scoping
  if (isBranchHead) {
    const actorEmployee = await getEmployeeForUser(actorUserId);
    let actorBranchId: string | undefined;
    if (actorEmployee?.id) {
      // Fetch branch_id for the actor's employee record
      const [branchRows] = await db.execute<RowDataPacket[]>(
        'SELECT branch_id FROM employees WHERE id = ? LIMIT 1',
        [actorEmployee.id]
      );
      actorBranchId = (branchRows[0] as { branch_id: string } | undefined)?.branch_id;
    }
    if (!actorBranchId) {
      // Cannot resolve a branch for this branch_head — return empty rather than
      // falling through to an unrestricted query.
      return { employees: [], summary: calculateTrackerSummary([]) };
    }
    whereClauses.push('e.branch_id = ?');
    params.push(actorBranchId);
  }

  // Note: filters.status and filters.document_code are declared in TrackerQueryParams
  // but are not yet applied as SQL WHERE conditions. They are reserved for
  // route-level post-processing or a future enhancement task.

  // Apply filters
  if (filters.branch_id) {
    whereClauses.push('e.branch_id = ?');
    params.push(filters.branch_id);
  }

  if (filters.process_id) {
    whereClauses.push('e.process_id = ?');
    params.push(filters.process_id);
  }

  if (filters.completion_min !== undefined) {
    whereClauses.push('e.joining_document_completion_pct >= ?');
    params.push(filters.completion_min);
  }

  if (filters.completion_max !== undefined) {
    whereClauses.push('e.joining_document_completion_pct <= ?');
    params.push(filters.completion_max);
  }

  if (filters.search) {
    whereClauses.push('(e.employee_code LIKE ? OR e.full_name LIKE ?)');
    const searchPattern = `%${filters.search}%`;
    params.push(searchPattern, searchPattern);
  }

  // Subquery for overdue_only filter (need HAVING clause)
  let havingClause = '';
  if (filters.overdue_only) {
    havingClause = 'HAVING overdue_count > 0';
  }

  const whereSQL = whereClauses.join(' AND ');

  const sql = `
    SELECT
      e.id,
      e.employee_code,
      e.full_name,
      e.branch_id,
      e.process_id,
      e.date_of_joining,
      e.joining_document_status,
      e.joining_document_completion_pct,
      b.branch_name,
      p.process_name,
      p.lob_name,

      GROUP_CONCAT(
        CASE WHEN c.document_code IN ('APPOINTMENT_LETTER', 'ID_PROOF', 'BANK_DETAILS', 'ADDRESS_PROOF')
        THEN CONCAT(c.document_code, ':', c.status, ':', COALESCE(c.verification_status, 'null'))
        END SEPARATOR '||'
      ) AS key_documents_raw,

      COUNT(c.id) AS total_documents,
      SUM(CASE WHEN c.verification_status = 'verified' THEN 1 ELSE 0 END) AS verified_count,
      SUM(CASE WHEN c.status LIKE '%needs_correction%' THEN 1 ELSE 0 END) AS needs_correction_count,
      SUM(CASE WHEN c.due_at < NOW() AND c.verification_status IS NULL THEN 1 ELSE 0 END) AS overdue_count,
      MAX(c.updated_at) AS last_document_update,
      u.full_name AS assigned_hr_name

    FROM employees e
    LEFT JOIN branches b ON e.branch_id = b.id
    LEFT JOIN processes p ON e.process_id = p.id
    LEFT JOIN employee_joining_document_checklist c ON e.id = c.employee_id
    LEFT JOIN auth_user u ON c.assigned_hr_user_id = u.id

    WHERE ${whereSQL}
    GROUP BY e.id
    ${havingClause}
    ORDER BY e.date_of_joining DESC
    LIMIT 500
  `;

  const [rows] = await db.execute<TrackerQueryRow[]>(sql, params);

  const employees: EmployeeDocumentRow[] = rows.map(row => ({
    id: row.id,
    employee_code: row.employee_code,
    full_name: row.full_name,
    branch_name: row.branch_name || '',
    process_name: row.process_name || '',
    lob_name: row.lob_name,
    date_of_joining: row.date_of_joining,
    joining_document_status: row.joining_document_status,
    joining_document_completion_pct: Number(row.joining_document_completion_pct),
    total_documents: Number(row.total_documents),
    verified_count: Number(row.verified_count),
    needs_correction_count: Number(row.needs_correction_count),
    overdue_count: Number(row.overdue_count),
    last_document_update: row.last_document_update,
    assigned_hr_name: row.assigned_hr_name,
    key_documents: parseKeyDocuments(row.key_documents_raw),
  }));

  const summary = calculateTrackerSummary(employees);

  return { employees, summary };
}

// ─── Bulk Action Types ────────────────────────────────────────────────────────

export interface BulkRemindResult {
  success: true;
  sent: number;
  failed: number;
  errors: Array<{ employee_id: string; employee_code: string; error: string }>;
}

export interface BulkGenerateResult {
  success: true;
  generated: number;
  skipped: number;
  errors: Array<{ employee_id: string; employee_code: string; error: string }>;
}

// ─── sendBulkReminders ────────────────────────────────────────────────────────

export async function sendBulkReminders(
  employeeIds: string[],
  customMessage: string | null,
  actorUserId: string
): Promise<BulkRemindResult> {
  void actorUserId; // reserved for audit logging in future

  const result: BulkRemindResult = {
    success: true,
    sent: 0,
    failed: 0,
    errors: [],
  };

  const [employees] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_code, full_name, official_email, mobile
     FROM employees
     WHERE id IN (?) AND active_status = 1`,
    [employeeIds]
  );

  for (const emp of employees as Array<{
    id: string;
    employee_code: string;
    full_name: string;
    official_email: string | null;
    mobile: string | null;
  }>) {
    if (!emp.official_email) {
      result.failed++;
      result.errors.push({
        employee_id: emp.id,
        employee_code: emp.employee_code,
        error: 'No email address',
      });
      continue;
    }

    try {
      void customMessage; // reserved for future custom reminder template
      await sendRejectedEmail({
        candidateId: emp.id,
        to: emp.official_email,
        candidateName: emp.full_name,
        branchName: '',
      });
      result.sent++;
    } catch (error: unknown) {
      result.failed++;
      result.errors.push({
        employee_id: emp.id,
        employee_code: emp.employee_code,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

// ─── bulkAssignHR ─────────────────────────────────────────────────────────────

export interface BulkAssignResult {
  success: true;
  updated: number;
}

export async function bulkAssignHR(
  employeeIds: string[],
  assignedHrUserId: string,
  actorUserId: string
): Promise<BulkAssignResult> {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = (await connection.execute(
      `UPDATE employee_joining_document_checklist
       SET assigned_hr_user_id = ?, updated_at = NOW()
       WHERE employee_id IN (?)`,
      [assignedHrUserId, employeeIds]
    )) as [ResultSetHeader, unknown];

    await connection.execute(
      `INSERT INTO employee_joining_document_audit_log
       (employee_id, action_type, actor_user_id, remarks, created_at)
       SELECT DISTINCT employee_id, 'BULK_ASSIGN_HR', ?, ?, NOW()
       FROM employee_joining_document_checklist
       WHERE employee_id IN (?)`,
      [actorUserId, JSON.stringify({ assigned_hr_user_id: assignedHrUserId }), employeeIds]
    );

    await connection.commit();
    return { success: true, updated: result.affectedRows };
  } catch (error: unknown) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// ─── bulkSetDueDate ───────────────────────────────────────────────────────────

export interface BulkSetDueDateResult {
  success: true;
  updated: number;
}

export async function bulkSetDueDate(
  employeeIds: string[],
  dueDate: string,
  documentCodes: string[] | null,
  actorUserId: string
): Promise<BulkSetDueDateResult> {
  let sql = `UPDATE employee_joining_document_checklist
             SET due_at = ?, updated_at = NOW()
             WHERE employee_id IN (?)`;
  const params: (string | string[])[] = [dueDate, employeeIds];

  if (documentCodes && documentCodes.length > 0) {
    sql += ` AND document_code IN (?)`;
    params.push(documentCodes);
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = (await connection.execute(sql, params)) as [ResultSetHeader, unknown];

    await connection.execute(
      `INSERT INTO employee_joining_document_audit_log
       (employee_id, action_type, actor_user_id, remarks, created_at)
       SELECT DISTINCT employee_id, 'BULK_SET_DUE_DATE', ?, ?, NOW()
       FROM employee_joining_document_checklist
       WHERE employee_id IN (?)`,
      [actorUserId, JSON.stringify({ due_date: dueDate, document_codes: documentCodes }), employeeIds]
    );

    await connection.commit();
    return { success: true, updated: result.affectedRows };
  } catch (error: unknown) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// ─── bulkVerifyDocuments ──────────────────────────────────────────────────────

export interface BulkVerifyResult {
  success: true;
  verified: number;
  errors: Array<{ employee_id: string; employee_code: string; error: string }>;
}

export async function bulkVerifyDocuments(
  employeeIds: string[],
  actorUserId: string
): Promise<BulkVerifyResult> {
  const result: BulkVerifyResult = {
    success: true,
    verified: 0,
    errors: [],
  };

  for (const employeeId of employeeIds) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [updateResult] = (await connection.execute(
        `UPDATE employee_joining_document_checklist
         SET verification_status = 'verified', verified_at = NOW(), verified_by = ?, updated_at = NOW()
         WHERE employee_id = ? AND status = 'uploaded_pending_review'`,
        [actorUserId, employeeId]
      )) as [ResultSetHeader, unknown];

      if (updateResult.affectedRows > 0) {
        result.verified += updateResult.affectedRows;

        await connection.execute(
          `INSERT INTO employee_joining_document_audit_log
           (employee_id, action_type, actor_user_id, remarks, created_at)
           VALUES (?, 'BULK_VERIFY', ?, 'Verified all pending documents', NOW())`,
          [employeeId, actorUserId]
        );

        const [stats] = (await connection.execute(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN verification_status = 'verified' THEN 1 ELSE 0 END) AS verified_count
           FROM employee_joining_document_checklist WHERE employee_id = ?`,
          [employeeId]
        )) as [RowDataPacket[], unknown];

        const total = Number((stats[0] as any)?.total ?? 0);
        const verifiedCount = Number((stats[0] as any)?.verified_count ?? 0);
        const pct = total > 0 ? Math.round((verifiedCount / total) * 100) : 0;
        const docStatus = pct === 100 ? 'verified_complete' : 'pending_verification';

        await connection.execute(
          `UPDATE employees
           SET joining_document_completion_pct = ?, joining_document_status = ?, updated_at = NOW()
           WHERE id = ?`,
          [pct, docStatus, employeeId]
        );
      }

      await connection.commit();
    } catch (error: unknown) {
      await connection.rollback();
      const [emp] = await db.execute<RowDataPacket[]>(
        `SELECT employee_code FROM employees WHERE id = ? LIMIT 1`,
        [employeeId]
      );
      result.errors.push({
        employee_id: employeeId,
        employee_code: (emp[0] as any)?.employee_code ?? employeeId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      connection.release();
    }
  }

  return result;
}

// ─── streamBulkDocumentsZip ───────────────────────────────────────────────────

export async function streamBulkDocumentsZip(
  employeeIds: string[],
  documentCodes: string[] | null,
  res: Response
): Promise<void> {
  const archive = archiverLib('zip', { zlib: { level: 9 } });

  // Pipe archive data to Express response
  archive.pipe(res);

  let sql = `
    SELECT
      e.employee_code,
      e.full_name,
      c.document_code,
      f.storage_path,
      f.original_filename
    FROM employees e
    JOIN employee_joining_document_checklist c ON e.id = c.employee_id
    JOIN employee_joining_document_file f ON c.id = f.checklist_id
    WHERE e.id IN (?)
      AND f.role IN ('hr_uploaded', 'generated', 'signed')
      AND c.verification_status = 'verified'
  `;

  const params: (string[] | string)[] = [employeeIds];

  if (documentCodes && documentCodes.length > 0) {
    sql += ` AND c.document_code IN (?)`;
    params.push(documentCodes);
  }

  sql += ` ORDER BY e.employee_code, c.document_code`;

  const [files] = await db.execute<RowDataPacket[]>(sql, params);

  for (const file of files as Array<{
    employee_code: string;
    full_name: string;
    document_code: string;
    storage_path: string;
    original_filename: string;
  }>) {
    const fullPath = path.join(STORAGE_ROOT, file.storage_path);

    if (fs.existsSync(fullPath)) {
      const safeName = file.full_name.replace(/[^a-zA-Z0-9]/g, '');
      const folderName = `${file.employee_code}-${safeName}`;
      const archivePath = `${folderName}/${file.document_code}-${file.original_filename}`;
      archive.file(fullPath, { name: archivePath });
    }
  }

  await archive.finalize();
}

// ─── bulkGenerateChecklists ───────────────────────────────────────────────────

export async function bulkGenerateChecklists(
  employeeIds: string[],
  actorUserId: string
): Promise<BulkGenerateResult> {
  const result: BulkGenerateResult = {
    success: true,
    generated: 0,
    skipped: 0,
    errors: [],
  };

  const [employees] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_code, full_name
     FROM employees
     WHERE id IN (?) AND active_status = 1`,
    [employeeIds]
  );

  const [existingChecklists] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT employee_id FROM employee_joining_document_checklist WHERE employee_id IN (?)`,
    [employeeIds]
  );

  const existingEmployeeIds = new Set(
    (existingChecklists as Array<{ employee_id: string }>).map(r => r.employee_id)
  );

  for (const emp of employees as Array<{ id: string; employee_code: string; full_name: string }>) {
    if (existingEmployeeIds.has(emp.id)) {
      result.skipped++;
      continue;
    }

    try {
      await generateJoiningDocumentChecklist(emp.id, actorUserId);
      result.generated++;
    } catch (error: unknown) {
      result.errors.push({
        employee_id: emp.id,
        employee_code: emp.employee_code,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
