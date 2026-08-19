import { parseKeyDocuments, calculateTrackerSummary, type EmployeeDocumentRow } from '../ats.joiningDocumentsTracker.service';

describe('parseKeyDocuments', () => {
  it('should parse valid key_documents_raw string', () => {
    const raw = 'APPOINTMENT_LETTER:uploaded_pending_review:null||ID_PROOF:completed:verified||BANK_DETAILS:pending_hr_upload:null';
    const result = parseKeyDocuments(raw);

    expect(result).toEqual([
      { code: 'APPOINTMENT_LETTER', status: 'uploaded_pending_review', verification_status: null },
      { code: 'ID_PROOF', status: 'completed', verification_status: 'verified' },
      { code: 'BANK_DETAILS', status: 'pending_hr_upload', verification_status: null },
    ]);
  });

  it('should return empty array for null input', () => {
    expect(parseKeyDocuments(null)).toEqual([]);
  });

  it('should return empty array for empty string', () => {
    expect(parseKeyDocuments('')).toEqual([]);
  });
});

describe('calculateTrackerSummary', () => {
  it('should calculate summary stats from employee rows', () => {
    const employees: EmployeeDocumentRow[] = [
      { joining_document_completion_pct: 100, needs_correction_count: 0, overdue_count: 0 } as EmployeeDocumentRow,
      { joining_document_completion_pct: 85, needs_correction_count: 0, overdue_count: 0 } as EmployeeDocumentRow,
      { joining_document_completion_pct: 50, needs_correction_count: 1, overdue_count: 0 } as EmployeeDocumentRow,
      { joining_document_completion_pct: 0, needs_correction_count: 0, overdue_count: 2 } as EmployeeDocumentRow,
    ];

    const summary = calculateTrackerSummary(employees);

    // Key names are the service's, not an earlier draft's. The buckets themselves were
    // always right — this test was written against total/complete/in_progress/not_started
    // while TrackerSummary has always returned total_employees/completed_count/
    // in_progress_count/pending_count, so it failed on every run since it was added.
    // JoiningDocumentsTrackerPage.tsx reads the service's names, so those are the contract.
    expect(summary).toEqual({
      total_employees: 4,
      completed_count: 1,      // 100%
      pending_verification: 1, // 75-99%
      in_progress_count: 1,    // 1-74%
      pending_count: 1,        // 0% — "not started"
      overdue_count: 1,        // overdue_count > 0
      needs_correction: 1,     // needs_correction_count > 0
    });
  });

  it('should return zeros for empty array', () => {
    const summary = calculateTrackerSummary([]);
    expect(summary).toEqual({
      total_employees: 0,
      completed_count: 0,
      pending_verification: 0,
      in_progress_count: 0,
      pending_count: 0,
      overdue_count: 0,
      needs_correction: 0,
    });
  });
});

// ─── Task 4: Bulk Action Tests ────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendBulkReminders, bulkGenerateChecklists } from '../ats.joiningDocumentsTracker.service';

// Mock external service dependencies
vi.mock('../ats.email.service.js', () => ({
  sendRejectedEmail: vi.fn(),
  // sendBulkReminders sends the joining-document reminder, not the rejection mail.
  sendJoiningDocReminderEmail: vi.fn(),
}));

vi.mock('../../employees/employeeJoiningDocuments.service.js', () => ({
  generateJoiningDocumentChecklist: vi.fn(),
  // The canonical completion writer. bulkVerifyDocuments now defers to it
  // instead of computing a rival percentage of its own.
  recalculateDocumentProgress: vi.fn(),
}));

// Hoisted mock state — accessible inside vi.mock factory AND in test bodies
const mocks = vi.hoisted(() => ({
  mockDbExecute: vi.fn(),
  mockConnectionExecute: vi.fn(),
  mockBeginTransaction: vi.fn(),
  mockCommit: vi.fn(),
  mockRollback: vi.fn(),
  mockRelease: vi.fn(),
}));

// Mock the DB module with connection support
// `query` and `execute` are deliberately the same spy. The service uses
// db.query() wherever a statement expands an array into `IN (?)`, because
// mysql2's prepared execute() does not expand arrays and silently matches
// nothing. Which of the two a given statement uses is an implementation detail
// these tests should not pin, so both resolve to one mock and the existing
// assertions keep working either way.
vi.mock('../../../db/mysql.js', () => ({
  db: {
    execute: mocks.mockDbExecute,
    query: mocks.mockDbExecute,
    getConnection: vi.fn().mockResolvedValue({
      execute: mocks.mockConnectionExecute,
      query: mocks.mockConnectionExecute,
      beginTransaction: mocks.mockBeginTransaction,
      commit: mocks.mockCommit,
      rollback: mocks.mockRollback,
      release: mocks.mockRelease,
    }),
  },
}));

import { db } from '../../../db/mysql.js';
import { sendRejectedEmail, sendJoiningDocReminderEmail } from '../ats.email.service.js';

/** One row per still-outstanding document; an employee with none is skipped, not mailed. */
const pendingDocsResult = [[{ document_name: 'NDA_CONFIDENTIALITY' }], []] as never;
import { generateJoiningDocumentChecklist } from '../../employees/employeeJoiningDocuments.service.js';

describe('sendBulkReminders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should send emails to employees with email addresses', async () => {
    const mockEmployees = [
      { id: 'emp-1', employee_code: 'EMP001', full_name: 'Alice Smith', official_email: 'alice@example.com', mobile: '9999999999' },
      { id: 'emp-2', employee_code: 'EMP002', full_name: 'Bob Jones', official_email: 'bob@example.com', mobile: null },
    ];

    vi.mocked(db.execute).mockResolvedValueOnce([mockEmployees, []]);
    // One pending-documents lookup per employee that has an email address.
    vi.mocked(db.execute).mockResolvedValueOnce(pendingDocsResult);
    vi.mocked(db.execute).mockResolvedValueOnce(pendingDocsResult);
    vi.mocked(sendJoiningDocReminderEmail).mockResolvedValue({ success: true, message: 'sent' } as never);

    const result = await sendBulkReminders(['emp-1', 'emp-2'], null, 'actor-user-1');

    expect(result.success).toBe(true);
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(sendJoiningDocReminderEmail).toHaveBeenCalledTimes(2);
  });

  it('should skip employees without email and report them as failed', async () => {
    const mockEmployees = [
      { id: 'emp-1', employee_code: 'EMP001', full_name: 'Alice Smith', official_email: null, mobile: null },
      { id: 'emp-2', employee_code: 'EMP002', full_name: 'Bob Jones', official_email: 'bob@example.com', mobile: null },
    ];

    vi.mocked(db.execute).mockResolvedValueOnce([mockEmployees, []]);
    // Only emp-2 has an email, so only one pending-documents lookup happens.
    vi.mocked(db.execute).mockResolvedValueOnce(pendingDocsResult);
    vi.mocked(sendJoiningDocReminderEmail).mockResolvedValue({ success: true, message: 'sent' } as never);

    const result = await sendBulkReminders(['emp-1', 'emp-2'], 'Please submit docs', 'actor-user-1');

    expect(result.success).toBe(true);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      employee_id: 'emp-1',
      employee_code: 'EMP001',
      error: 'No email address',
    });
  });

  it('should record email send errors without throwing', async () => {
    const mockEmployees = [
      { id: 'emp-1', employee_code: 'EMP001', full_name: 'Alice Smith', official_email: 'alice@example.com', mobile: null },
    ];

    vi.mocked(db.execute).mockResolvedValueOnce([mockEmployees, []]);
    vi.mocked(db.execute).mockResolvedValueOnce(pendingDocsResult);
    vi.mocked(sendJoiningDocReminderEmail).mockRejectedValue(new Error('SMTP timeout'));

    const result = await sendBulkReminders(['emp-1'], null, 'actor-user-1');

    expect(result.success).toBe(true);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toMatchObject({
      employee_id: 'emp-1',
      employee_code: 'EMP001',
      error: 'SMTP timeout',
    });
  });

  it('should return empty result when no employees found', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([[], []]);

    const result = await sendBulkReminders(['unknown-id'], null, 'actor-user-1');

    expect(result.success).toBe(true);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);
  });
});

/**
 * The tracker was widened to `active_status IN (0, 1)` to surface pre-joiners,
 * on the assumption that 0 meant "not yet joined". On live data it overwhelmingly
 * means "left": 57,310 resigned/terminated/inactive records against 9 employees
 * who genuinely have a joining checklist. The tracker returned 58,652 rows
 * instead of 1,344, and the bulk actions inherited the same scope — so selecting
 * from that list could generate joining paperwork for resigned staff.
 *
 * These tests pin the predicates rather than the row counts, because the ids
 * arrive from the client and the guard has to live in the SQL.
 */
describe('leaver scoping', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  const employeeSelectSql = () =>
    vi.mocked(db.query).mock.calls.map((call) => String(call[0])).find((sql) => /FROM employees/i.test(sql)) ?? '';

  it('bulkGenerateChecklists refuses resigned and terminated employees', async () => {
    // Employee selection, then the existing-checklist lookup.
    vi.mocked(db.query).mockResolvedValueOnce([[], []] as never);
    vi.mocked(db.query).mockResolvedValueOnce([[], []] as never);
    await bulkGenerateChecklists(['emp-1'], 'actor-user-1');

    const sql = employeeSelectSql();
    expect(sql, 'employee selection query was not issued').not.toBe('');
    expect(sql, 'a leaver could still be given a joining-document pack')
      .toMatch(/employment_status[\s\S]*NOT IN[\s\S]*resigned[\s\S]*terminated/i);
    // The predicate that caused the regression must be gone.
    expect(sql).not.toMatch(/active_status\s+IN\s*\(\s*0\s*,\s*1\s*\)/i);
  });

  it('sendBulkReminders refuses resigned and terminated employees', async () => {
    vi.mocked(db.query).mockResolvedValueOnce([[], []] as never);
    await sendBulkReminders(['emp-1'], null, 'actor-user-1');

    const sql = employeeSelectSql();
    expect(sql, 'employee selection query was not issued').not.toBe('');
    expect(sql, 'a leaver could still be chased for joining paperwork')
      .toMatch(/employment_status[\s\S]*NOT IN[\s\S]*resigned[\s\S]*terminated/i);
    expect(sql).not.toMatch(/active_status\s+IN\s*\(\s*0\s*,\s*1\s*\)/i);
  });
});

describe('bulkGenerateChecklists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should generate checklists for employees without existing checklists', async () => {
    const mockEmployees = [
      { id: 'emp-1', employee_code: 'EMP001', full_name: 'Alice Smith' },
      { id: 'emp-2', employee_code: 'EMP002', full_name: 'Bob Jones' },
    ];

    // First call: fetch employees
    vi.mocked(db.execute).mockResolvedValueOnce([mockEmployees, []]);
    // Second call: batch fetch existing checklists — none exist
    vi.mocked(db.execute).mockResolvedValueOnce([[], []]);

    vi.mocked(generateJoiningDocumentChecklist).mockResolvedValue({} as never);

    const result = await bulkGenerateChecklists(['emp-1', 'emp-2'], 'actor-user-1');

    expect(result.success).toBe(true);
    expect(result.generated).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(generateJoiningDocumentChecklist).toHaveBeenCalledTimes(2);
  });

  it('should skip employees that already have checklists', async () => {
    const mockEmployees = [
      { id: 'emp-1', employee_code: 'EMP001', full_name: 'Alice Smith' },
      { id: 'emp-2', employee_code: 'EMP002', full_name: 'Bob Jones' },
    ];

    // First call: fetch employees
    vi.mocked(db.execute).mockResolvedValueOnce([mockEmployees, []]);
    // Second call: batch fetch existing checklists — emp-1 exists, emp-2 doesn't
    vi.mocked(db.execute).mockResolvedValueOnce([[{ employee_id: 'emp-1' }], []]);

    vi.mocked(generateJoiningDocumentChecklist).mockResolvedValue({} as never);

    const result = await bulkGenerateChecklists(['emp-1', 'emp-2'], 'actor-user-1');

    expect(result.success).toBe(true);
    expect(result.generated).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(generateJoiningDocumentChecklist).toHaveBeenCalledTimes(1);
    expect(generateJoiningDocumentChecklist).toHaveBeenCalledWith('emp-2', 'actor-user-1');
  });

  it('should record generation errors without throwing', async () => {
    const mockEmployees = [
      { id: 'emp-1', employee_code: 'EMP001', full_name: 'Alice Smith' },
    ];

    // First call: fetch employees
    vi.mocked(db.execute).mockResolvedValueOnce([mockEmployees, []]);
    // Second call: batch fetch existing checklists — none exist
    vi.mocked(db.execute).mockResolvedValueOnce([[], []]);
    vi.mocked(generateJoiningDocumentChecklist).mockRejectedValue(new Error('Template not found'));

    const result = await bulkGenerateChecklists(['emp-1'], 'actor-user-1');

    expect(result.success).toBe(true);
    expect(result.generated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      employee_id: 'emp-1',
      employee_code: 'EMP001',
      error: 'Template not found',
    });
  });

  it('should return empty result when no employees found', async () => {
    // First call: fetch employees — none found
    vi.mocked(db.execute).mockResolvedValueOnce([[], []]);
    // Second call: batch fetch existing checklists — none (because no employees)
    vi.mocked(db.execute).mockResolvedValueOnce([[], []]);

    const result = await bulkGenerateChecklists(['unknown-id'], 'actor-user-1');

    expect(result.success).toBe(true);
    expect(result.generated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toHaveLength(0);
  });
});

// ─── Task 5: bulkAssignHR tests ───────────────────────────────────────────────

import { bulkAssignHR, bulkSetDueDate, bulkVerifyDocuments, streamBulkDocumentsZip } from '../ats.joiningDocumentsTracker.service';
import { recalculateDocumentProgress } from '../../employees/employeeJoiningDocuments.service.js';
import type { ResultSetHeader } from 'mysql2';

describe('bulkAssignHR', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockBeginTransaction.mockResolvedValue(undefined);
    mocks.mockCommit.mockResolvedValue(undefined);
    mocks.mockRollback.mockResolvedValue(undefined);
  });

  it('should update assigned_hr_user_id for all checklist rows and return updated count', async () => {
    const mockResultSetHeader = { affectedRows: 5 } as ResultSetHeader;
    // First call: UPDATE checklist rows
    mocks.mockConnectionExecute.mockResolvedValueOnce([mockResultSetHeader, []]);
    // Second call: audit log INSERT
    mocks.mockConnectionExecute.mockResolvedValueOnce([{}, []]);

    const result = await bulkAssignHR(['emp-1', 'emp-2'], 'hr-user-42', 'actor-user-1');

    expect(result).toEqual({ success: true, updated: 5 });
    expect(mocks.mockConnectionExecute).toHaveBeenCalledTimes(2);
    // First call should be the UPDATE
    const firstCall = mocks.mockConnectionExecute.mock.calls[0];
    expect(firstCall[0]).toMatch(/UPDATE employee_joining_document_checklist/i);
    expect(firstCall[0]).toMatch(/assigned_hr_user_id/i);
    expect(firstCall[1]).toEqual(['hr-user-42', ['emp-1', 'emp-2']]);
  });

  it('should log audit entry with action_type BULK_ASSIGN_HR', async () => {
    const mockResultSetHeader = { affectedRows: 2 } as ResultSetHeader;
    mocks.mockConnectionExecute.mockResolvedValueOnce([mockResultSetHeader, []]);
    mocks.mockConnectionExecute.mockResolvedValueOnce([{}, []]);

    await bulkAssignHR(['emp-1', 'emp-2'], 'hr-user-7', 'actor-user-1');

    const auditCall = mocks.mockConnectionExecute.mock.calls[1];
    expect(auditCall[0]).toMatch(/employee_joining_document_audit_log/i);
    expect(auditCall[0]).toMatch(/BULK_ASSIGN_HR/i);
    expect(auditCall[1]).toContain('actor-user-1');
  });

  it('should return updated: 0 when no rows matched', async () => {
    const mockResultSetHeader = { affectedRows: 0 } as ResultSetHeader;
    mocks.mockConnectionExecute.mockResolvedValueOnce([mockResultSetHeader, []]);
    mocks.mockConnectionExecute.mockResolvedValueOnce([{}, []]);

    const result = await bulkAssignHR(['unknown-emp'], 'hr-user-1', 'actor-user-1');

    expect(result).toEqual({ success: true, updated: 0 });
  });
});

// ─── Task 5: bulkSetDueDate tests ─────────────────────────────────────────────

describe('bulkSetDueDate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockBeginTransaction.mockResolvedValue(undefined);
    mocks.mockCommit.mockResolvedValue(undefined);
    mocks.mockRollback.mockResolvedValue(undefined);
  });

  it('should update due_at for all employees without document_codes filter', async () => {
    const mockResultSetHeader = { affectedRows: 8 } as ResultSetHeader;
    mocks.mockConnectionExecute.mockResolvedValueOnce([mockResultSetHeader, []]);
    mocks.mockConnectionExecute.mockResolvedValueOnce([{}, []]);

    const result = await bulkSetDueDate(['emp-1', 'emp-2'], '2026-08-01', null, 'actor-user-1');

    expect(result).toEqual({ success: true, updated: 8 });
    const updateCall = mocks.mockConnectionExecute.mock.calls[0];
    expect(updateCall[0]).toMatch(/UPDATE employee_joining_document_checklist/i);
    expect(updateCall[0]).toMatch(/due_at/i);
    // Should NOT filter by document_code when null
    expect(updateCall[0]).not.toMatch(/document_code IN/i);
  });

  it('should filter by document_codes when provided', async () => {
    const mockResultSetHeader = { affectedRows: 3 } as ResultSetHeader;
    mocks.mockConnectionExecute.mockResolvedValueOnce([mockResultSetHeader, []]);
    mocks.mockConnectionExecute.mockResolvedValueOnce([{}, []]);

    const result = await bulkSetDueDate(
      ['emp-1', 'emp-2'],
      '2026-08-15',
      ['APPOINTMENT_LETTER', 'ID_PROOF'],
      'actor-user-1'
    );

    expect(result).toEqual({ success: true, updated: 3 });
    const updateCall = mocks.mockConnectionExecute.mock.calls[0];
    expect(updateCall[0]).toMatch(/document_code IN/i);
    const callParams = updateCall[1] as unknown[];
    expect(callParams[0]).toBe('2026-08-15');
    expect(callParams[2]).toEqual(['APPOINTMENT_LETTER', 'ID_PROOF']);
  });

  it('should log audit entry with action_type BULK_SET_DUE_DATE', async () => {
    const mockResultSetHeader = { affectedRows: 4 } as ResultSetHeader;
    mocks.mockConnectionExecute.mockResolvedValueOnce([mockResultSetHeader, []]);
    mocks.mockConnectionExecute.mockResolvedValueOnce([{}, []]);

    await bulkSetDueDate(['emp-1'], '2026-09-01', null, 'actor-user-1');

    const auditCall = mocks.mockConnectionExecute.mock.calls[1];
    expect(auditCall[0]).toMatch(/employee_joining_document_audit_log/i);
    expect(auditCall[0]).toMatch(/BULK_SET_DUE_DATE/i);
    expect(auditCall[1]).toContain('actor-user-1');
  });
});

// ─── Task 5: bulkVerifyDocuments tests ───────────────────────────────────────

describe('bulkVerifyDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockBeginTransaction.mockResolvedValue(undefined);
    mocks.mockCommit.mockResolvedValue(undefined);
    mocks.mockRollback.mockResolvedValue(undefined);
  });

  it('should verify uploaded_pending_review documents and recalculate completion %', async () => {
    const updateResult = { affectedRows: 3 } as ResultSetHeader;
    const statsResult = [{ total: 10, verified_count: 8 }];

    // emp-1: UPDATE → 3 affected, audit log, stats SELECT, employees UPDATE
    mocks.mockConnectionExecute
      .mockResolvedValueOnce([updateResult, []])      // UPDATE checklist
      .mockResolvedValueOnce([{}, []]);                // INSERT audit log

    const result = await bulkVerifyDocuments(['emp-1'], 'actor-user-1');

    expect(result.success).toBe(true);
    expect(result.verified).toBe(3);
    expect(result.errors).toHaveLength(0);
  });

  /**
   * This previously asserted that bulkVerifyDocuments wrote its own completion
   * percentage — the behaviour that made the figure flip. It computed over all
   * documents rather than mandatory ones, wrote status strings
   * ('verified_complete' / 'pending_verification') that are in no consumer's
   * vocabulary, and updated `employees` without `ats_onboarding_bridge`. HR saw
   * 100%, then the next person to open the pack triggered the real
   * recalculation and the number fell again. The test encoded the bug, so it now
   * asserts the opposite.
   */
  it('defers completion to the canonical writer instead of computing its own', async () => {
    const updateResult = { affectedRows: 2 } as ResultSetHeader;

    mocks.mockConnectionExecute
      .mockResolvedValueOnce([updateResult, []])
      .mockResolvedValueOnce([{}, []]);

    await bulkVerifyDocuments(['emp-1'], 'actor-user-1');

    const statements = mocks.mockConnectionExecute.mock.calls.map((call) => String(call[0]));
    expect(
      statements.some((sql) => /UPDATE employees/i.test(sql) && /joining_document_completion_pct/i.test(sql)),
      'bulkVerifyDocuments is still writing its own completion percentage',
    ).toBe(false);

    // Verifying must move `status`, not only verification_status, or the
    // canonical recalculation still counts the row as incomplete.
    expect(statements[0]).toMatch(/SET\s+status\s*=\s*'verified'/i);
    expect(recalculateDocumentProgress).toHaveBeenCalledWith('emp-1');
  });

  it('should skip employees with no pending documents (0 affected rows)', async () => {
    const updateResult = { affectedRows: 0 } as ResultSetHeader;

    mocks.mockConnectionExecute.mockResolvedValueOnce([updateResult, []]);

    const result = await bulkVerifyDocuments(['emp-1'], 'actor-user-1');

    // Should not make further DB calls (audit, stats, employees update)
    expect(mocks.mockConnectionExecute).toHaveBeenCalledTimes(1);
    expect(result.verified).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('should process multiple employees and accumulate verified count', async () => {
    const updateResult1 = { affectedRows: 2 } as ResultSetHeader;
    const updateResult2 = { affectedRows: 3 } as ResultSetHeader;
    const statsResult = [{ total: 5, verified_count: 5 }];

    mocks.mockConnectionExecute
      // emp-1
      .mockResolvedValueOnce([updateResult1, []])
      .mockResolvedValueOnce([{}, []])
      // emp-2
      .mockResolvedValueOnce([updateResult2, []])
      .mockResolvedValueOnce([{}, []]);

    const result = await bulkVerifyDocuments(['emp-1', 'emp-2'], 'actor-user-1');

    expect(result.success).toBe(true);
    expect(result.verified).toBe(5);
    expect(result.errors).toHaveLength(0);
  });

  it('should collect errors per employee without stopping processing', async () => {
    const empCodeResult = [{ employee_code: 'EMP001' }];

    // connection.execute for the UPDATE throws (triggers rollback + error handling)
    mocks.mockConnectionExecute.mockRejectedValueOnce(new Error('DB timeout'));
    // db.execute for the employee_code lookup after rollback
    vi.mocked(db.execute).mockResolvedValueOnce([empCodeResult, []]);

    const result = await bulkVerifyDocuments(['emp-1'], 'actor-user-1');

    expect(result.success).toBe(true);
    expect(result.verified).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      employee_id: 'emp-1',
      error: 'DB timeout',
    });
  });

  it('should log audit with action_type BULK_VERIFY for each verified employee', async () => {
    const updateResult = { affectedRows: 1 } as ResultSetHeader;
    const statsResult = [{ total: 5, verified_count: 3 }];

    mocks.mockConnectionExecute
      .mockResolvedValueOnce([updateResult, []])
      .mockResolvedValueOnce([{}, []]);

    await bulkVerifyDocuments(['emp-1'], 'actor-user-1');

    const auditCall = mocks.mockConnectionExecute.mock.calls[1];
    expect(auditCall[0]).toMatch(/employee_joining_document_audit_log/i);
    expect(auditCall[0]).toMatch(/BULK_VERIFY/i);
    expect(auditCall[1]).toContain('actor-user-1');
    expect(auditCall[1]).toContain('emp-1');
  });
});

// ─── Task 6: streamBulkDocumentsZip tests ────────────────────────────────────

vi.mock('archiver', () => {
  const mockArchive = {
    pipe: vi.fn(),
    file: vi.fn(),
    finalize: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  };
  return {
    default: vi.fn().mockReturnValue(mockArchive),
  };
});

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  const mockExistsSync = vi.fn();
  return {
    ...actual,
    existsSync: mockExistsSync,
    default: {
      ...(actual as unknown as Record<string, unknown>).default ?? actual,
      existsSync: mockExistsSync,
    },
  };
});

import archiver from 'archiver';
import * as fsModule from 'fs';

describe('streamBulkDocumentsZip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should query DB for verified files for the given employee IDs', async () => {
    const mockFiles = [
      {
        employee_code: 'EMP001',
        full_name: 'John Doe',
        document_code: 'APPOINTMENT_LETTER',
        storage_path: 'emp-1/appointment.pdf',
        original_filename: 'appointment.pdf',
      },
    ];
    vi.mocked(db.execute).mockResolvedValueOnce([mockFiles, []]);
    vi.mocked(fsModule.existsSync).mockReturnValue(false); // file doesn't exist on disk

    const mockRes = { pipe: vi.fn() } as unknown as import('express').Response;

    await streamBulkDocumentsZip(['emp-1'], null, mockRes);

    const [[sql, params]] = vi.mocked(db.execute).mock.calls;
    expect(sql).toMatch(/employee_joining_document_file/i);
    expect(sql).toMatch(/employee_joining_document_checklist/i);
    expect(sql).toMatch(/verification_status.*verified/i);
    expect(sql).toMatch(/role IN/i);
    expect(params).toContainEqual(['emp-1']);
  });

  it('should filter by document_codes when provided', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([[], []]);
    vi.mocked(fsModule.existsSync).mockReturnValue(false);

    const mockRes = { pipe: vi.fn() } as unknown as import('express').Response;
    await streamBulkDocumentsZip(['emp-1'], ['APPOINTMENT_LETTER', 'ID_PROOF'], mockRes);

    const [[sql, params]] = vi.mocked(db.execute).mock.calls;
    expect(sql).toMatch(/document_code IN/i);
    expect((params as unknown[]).some(p => Array.isArray(p) && p.includes('APPOINTMENT_LETTER'))).toBe(true);
  });

  it('should not filter by document_codes when null', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([[], []]);
    vi.mocked(fsModule.existsSync).mockReturnValue(false);

    const mockRes = { pipe: vi.fn() } as unknown as import('express').Response;
    await streamBulkDocumentsZip(['emp-1'], null, mockRes);

    const [[sql]] = vi.mocked(db.execute).mock.calls;
    expect(sql).not.toMatch(/document_code IN/i);
  });

  it('should add existing files to archive with correct folder structure', async () => {
    const mockFiles = [
      {
        employee_code: 'EMP001',
        full_name: 'John Doe',
        document_code: 'APPOINTMENT_LETTER',
        storage_path: 'emp-1/appointment.pdf',
        original_filename: 'appointment.pdf',
      },
    ];
    vi.mocked(db.execute).mockResolvedValueOnce([mockFiles, []]);
    vi.mocked(fsModule.existsSync).mockReturnValue(true); // file exists

    // After vi.clearAllMocks() in beforeEach the factory default mock is wiped;
    // set up a fresh instance to be returned by archiver()
    const freshMockArchive = {
      pipe: vi.fn(),
      file: vi.fn(),
      finalize: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };
    vi.mocked(archiver).mockReturnValue(freshMockArchive as ReturnType<typeof archiver>);

    const mockRes = { pipe: vi.fn() } as unknown as import('express').Response;
    await streamBulkDocumentsZip(['emp-1'], null, mockRes);

    expect(freshMockArchive.file).toHaveBeenCalledTimes(1);
    const fileCall = freshMockArchive.file.mock.calls[0];
    // Archive path: EMP001-JohnDoe/APPOINTMENT_LETTER-appointment.pdf
    expect(fileCall[1]).toMatchObject({ name: 'EMP001-JohnDoe/APPOINTMENT_LETTER-appointment.pdf' });
  });

  it('should skip files that do not exist on disk', async () => {
    const mockFiles = [
      {
        employee_code: 'EMP001',
        full_name: 'John Doe',
        document_code: 'APPOINTMENT_LETTER',
        storage_path: 'emp-1/missing.pdf',
        original_filename: 'missing.pdf',
      },
    ];
    vi.mocked(db.execute).mockResolvedValueOnce([mockFiles, []]);
    vi.mocked(fsModule.existsSync).mockReturnValue(false); // file does NOT exist

    const freshMockArchive = {
      pipe: vi.fn(),
      file: vi.fn(),
      finalize: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };
    vi.mocked(archiver).mockReturnValue(freshMockArchive as ReturnType<typeof archiver>);

    const mockRes = { pipe: vi.fn() } as unknown as import('express').Response;
    await streamBulkDocumentsZip(['emp-1'], null, mockRes);

    expect(freshMockArchive.file).not.toHaveBeenCalled();
  });

  it('should pipe archive to the response object', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([[], []]);
    vi.mocked(fsModule.existsSync).mockReturnValue(false);

    const freshMockArchive = {
      pipe: vi.fn(),
      file: vi.fn(),
      finalize: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };
    vi.mocked(archiver).mockReturnValue(freshMockArchive as ReturnType<typeof archiver>);

    const mockRes = { pipe: vi.fn() } as unknown as import('express').Response;
    await streamBulkDocumentsZip(['emp-1'], null, mockRes);

    expect(freshMockArchive.pipe).toHaveBeenCalledWith(mockRes);
  });

  it('should call archive.finalize() after adding all files', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([[], []]);
    vi.mocked(fsModule.existsSync).mockReturnValue(false);

    const freshMockArchive = {
      pipe: vi.fn(),
      file: vi.fn(),
      finalize: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };
    vi.mocked(archiver).mockReturnValue(freshMockArchive as ReturnType<typeof archiver>);

    const mockRes = { pipe: vi.fn() } as unknown as import('express').Response;
    await streamBulkDocumentsZip(['emp-1'], null, mockRes);

    expect(freshMockArchive.finalize).toHaveBeenCalledTimes(1);
  });

  // ── Branch Head scoping ──────────────────────────────────────────────────
  // Mirrors getJoiningDocumentsTracker's isBranchHead check: a branch_head must
  // not be able to pull another branch's verified documents through this
  // bulk-download path just by supplying its employee_ids directly, even though
  // the regular list-and-select flow already keeps them inside their own branch.

  it('should restrict employee_ids to the branch_head actor\'s own branch before querying files', async () => {
    vi.mocked(fsModule.existsSync).mockReturnValue(false);
    const freshMockArchive = {
      pipe: vi.fn(),
      file: vi.fn(),
      finalize: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };
    vi.mocked(archiver).mockReturnValue(freshMockArchive as ReturnType<typeof archiver>);

    vi.mocked(db.execute)
      .mockResolvedValueOnce([[{ role_key: 'branch_head' }], []])            // getUserRoleKeys
      .mockResolvedValueOnce([[{ id: 'actor-emp-1', employee_code: 'A1' }], []]) // getEmployeeForUser
      .mockResolvedValueOnce([[{ branch_id: 'branch-A' }], []])              // actor's own branch_id
      .mockResolvedValueOnce([[{ id: 'emp-1' }], []])                        // only emp-1 is in branch-A
      .mockResolvedValueOnce([[], []]);                                     // final file query

    const mockRes = { pipe: vi.fn() } as unknown as import('express').Response;
    await streamBulkDocumentsZip(['emp-1', 'emp-2'], null, mockRes, 'actor-user-1');

    // Call 4 (0-indexed 3) is the "which of the requested ids are in my branch" check.
    const scopeCall = vi.mocked(db.execute).mock.calls[3];
    expect(scopeCall[0]).toMatch(/branch_id = \?/i);
    expect(scopeCall[1]).toEqual([['emp-1', 'emp-2'], 'branch-A']);

    // Call 5 (0-indexed 4) is the file query — must run against the scoped id list only.
    const fileCall = vi.mocked(db.execute).mock.calls[4];
    expect(fileCall[1]).toEqual([['emp-1']]);
  });

  it('should finalize an empty archive when a branch_head actor has no resolvable branch', async () => {
    const freshMockArchive = {
      pipe: vi.fn(),
      file: vi.fn(),
      finalize: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };
    vi.mocked(archiver).mockReturnValue(freshMockArchive as ReturnType<typeof archiver>);

    vi.mocked(db.execute)
      .mockResolvedValueOnce([[{ role_key: 'branch_head' }], []]) // getUserRoleKeys
      .mockResolvedValueOnce([[], []]);                            // getEmployeeForUser finds no employee record

    const mockRes = { pipe: vi.fn() } as unknown as import('express').Response;
    await streamBulkDocumentsZip(['emp-1', 'emp-2'], null, mockRes, 'actor-user-1');

    expect(freshMockArchive.finalize).toHaveBeenCalledTimes(1);
    expect(freshMockArchive.file).not.toHaveBeenCalled();
    // Only the two scope-resolution queries ran — the file query never fired.
    expect(vi.mocked(db.execute)).toHaveBeenCalledTimes(2);
  });

  it('should not scope employee_ids for a non-branch_head actor (e.g. hr) — unchanged from before the fix', async () => {
    const mockFiles = [
      {
        employee_code: 'EMP002',
        full_name: 'Jane Roe',
        document_code: 'ID_PROOF',
        storage_path: 'emp-2/id.pdf',
        original_filename: 'id.pdf',
      },
    ];
    vi.mocked(fsModule.existsSync).mockReturnValue(false);
    const freshMockArchive = {
      pipe: vi.fn(),
      file: vi.fn(),
      finalize: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };
    vi.mocked(archiver).mockReturnValue(freshMockArchive as ReturnType<typeof archiver>);

    vi.mocked(db.execute)
      .mockResolvedValueOnce([[{ role_key: 'hr' }], []]) // getUserRoleKeys — org-wide role
      .mockResolvedValueOnce([mockFiles, []]);            // file query runs unrestricted

    const mockRes = { pipe: vi.fn() } as unknown as import('express').Response;
    await streamBulkDocumentsZip(['emp-1', 'emp-2'], null, mockRes, 'actor-user-1');

    // Only the role lookup ran before the (unrestricted) file query — org-wide callers
    // see exactly what they saw before this fix.
    expect(vi.mocked(db.execute)).toHaveBeenCalledTimes(2);
    const fileCall = vi.mocked(db.execute).mock.calls[1];
    expect(fileCall[1]).toEqual([['emp-1', 'emp-2']]);
  });
});
