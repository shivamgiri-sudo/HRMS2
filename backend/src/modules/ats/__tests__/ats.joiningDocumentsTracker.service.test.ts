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

    expect(summary).toEqual({
      total: 4,
      complete: 1,             // 100%
      pending_verification: 1, // 75-99%
      in_progress: 1,          // 1-74%
      not_started: 1,          // 0%
      overdue: 1,              // overdue_count > 0
      needs_correction: 1,     // needs_correction_count > 0
    });
  });

  it('should return zeros for empty array', () => {
    const summary = calculateTrackerSummary([]);
    expect(summary).toEqual({
      total: 0,
      complete: 0,
      pending_verification: 0,
      in_progress: 0,
      not_started: 0,
      overdue: 0,
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
}));

vi.mock('../../employees/employeeJoiningDocuments.service.js', () => ({
  generateJoiningDocumentChecklist: vi.fn(),
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
vi.mock('../../../db/mysql.js', () => ({
  db: {
    execute: mocks.mockDbExecute,
    getConnection: vi.fn().mockResolvedValue({
      execute: mocks.mockConnectionExecute,
      beginTransaction: mocks.mockBeginTransaction,
      commit: mocks.mockCommit,
      rollback: mocks.mockRollback,
      release: mocks.mockRelease,
    }),
  },
}));

import { db } from '../../../db/mysql.js';
import { sendRejectedEmail } from '../ats.email.service.js';
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
    vi.mocked(sendRejectedEmail).mockResolvedValue({ success: true, message: 'sent' } as never);

    const result = await sendBulkReminders(['emp-1', 'emp-2'], null, 'actor-user-1');

    expect(result.success).toBe(true);
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(sendRejectedEmail).toHaveBeenCalledTimes(2);
  });

  it('should skip employees without email and report them as failed', async () => {
    const mockEmployees = [
      { id: 'emp-1', employee_code: 'EMP001', full_name: 'Alice Smith', official_email: null, mobile: null },
      { id: 'emp-2', employee_code: 'EMP002', full_name: 'Bob Jones', official_email: 'bob@example.com', mobile: null },
    ];

    vi.mocked(db.execute).mockResolvedValueOnce([mockEmployees, []]);
    vi.mocked(sendRejectedEmail).mockResolvedValue({ success: true, message: 'sent' } as never);

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
    vi.mocked(sendRejectedEmail).mockRejectedValue(new Error('SMTP timeout'));

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

import { bulkAssignHR, bulkSetDueDate, bulkVerifyDocuments } from '../ats.joiningDocumentsTracker.service';
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
      .mockResolvedValueOnce([{}, []])                 // INSERT audit log
      .mockResolvedValueOnce([statsResult, []])        // SELECT stats
      .mockResolvedValueOnce([{}, []]);                // UPDATE employees

    const result = await bulkVerifyDocuments(['emp-1'], 'actor-user-1');

    expect(result.success).toBe(true);
    expect(result.verified).toBe(3);
    expect(result.errors).toHaveLength(0);
  });

  it('should update employees table with correct completion % after verification', async () => {
    const updateResult = { affectedRows: 2 } as ResultSetHeader;
    const statsResult = [{ total: 10, verified_count: 10 }]; // 100% complete

    mocks.mockConnectionExecute
      .mockResolvedValueOnce([updateResult, []])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([statsResult, []])
      .mockResolvedValueOnce([{}, []]);

    await bulkVerifyDocuments(['emp-1'], 'actor-user-1');

    // The employees UPDATE should set pct=100 and status='verified_complete'
    const empUpdateCall = mocks.mockConnectionExecute.mock.calls[3];
    expect(empUpdateCall[0]).toMatch(/UPDATE employees/i);
    expect(empUpdateCall[0]).toMatch(/joining_document_completion_pct/i);
    expect(empUpdateCall[1]).toContain(100);
    expect(empUpdateCall[1]).toContain('verified_complete');
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
      .mockResolvedValueOnce([statsResult, []])
      .mockResolvedValueOnce([{}, []])
      // emp-2
      .mockResolvedValueOnce([updateResult2, []])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([statsResult, []])
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
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([statsResult, []])
      .mockResolvedValueOnce([{}, []]);

    await bulkVerifyDocuments(['emp-1'], 'actor-user-1');

    const auditCall = mocks.mockConnectionExecute.mock.calls[1];
    expect(auditCall[0]).toMatch(/employee_joining_document_audit_log/i);
    expect(auditCall[0]).toMatch(/BULK_VERIFY/i);
    expect(auditCall[1]).toContain('actor-user-1');
    expect(auditCall[1]).toContain('emp-1');
  });
});
