import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { getUserRoleKeys } from '../../shared/scopeAccess.js';
import { getEmployeeForUser } from '../../shared/accessGuard.js';

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
    if (actorEmployee?.id) {
      // Fetch branch_id for the actor's employee record
      const [branchRows] = await db.execute<RowDataPacket[]>(
        'SELECT branch_id FROM employees WHERE id = ? LIMIT 1',
        [actorEmployee.id]
      );
      const actorBranchId = (branchRows[0] as { branch_id: string } | undefined)?.branch_id;

      if (actorBranchId) {
        whereClauses.push('e.branch_id = ?');
        params.push(actorBranchId);
      }
    }
  }

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
