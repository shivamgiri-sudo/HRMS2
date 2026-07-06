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
