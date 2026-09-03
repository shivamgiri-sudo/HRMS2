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
    //
    // The 85% employee is now `in_progress`, not a fourth `pending_verification`
    // bucket: that band was counted somewhere no tile rendered. The three buckets
    // sum to total_employees; overdue_count and needs_correction are cross-cutting
    // and sit outside the sum (the 0% employee here is both pending and overdue).
    expect(summary).toEqual({
      total_employees: 4,
      completed_count: 1,      // 100%
      in_progress_count: 2,    // 85% (formerly pending_verification) + 50%
      pending_count: 1,        // 0% — "not started"
      overdue_count: 1,        // overdue_count > 0
      needs_correction: 1,     // needs_correction_count > 0
    });
    expect(
      summary.completed_count + summary.in_progress_count + summary.pending_count
    ).toBe(summary.total_employees);
  });

  it('should return zeros for empty array', () => {
    const summary = calculateTrackerSummary([]);
    expect(summary).toEqual({
      total_employees: 0,
      completed_count: 0,
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
  // Branch RBAC. Mocked at the resolver rather than at the two DB reads it makes
  // internally, so these tests state the scope decision they mean — org-wide,
  // one branch, or none — instead of a brittle sequence of row fixtures.
  mockBuildScopeWhereClause: vi.fn(async () => ({ sql: '1=1', params: [] as unknown[] })),
}));

vi.mock('../../../shared/scopeAccess.js', () => ({
  buildScopeWhereClause: mocks.mockBuildScopeWhereClause,
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

/**
 * The four statements `bulkVerifyDocuments` can issue per employee.
 *
 * Two UPDATEs, one per provenance, and one audit INSERT per UPDATE that actually
 * affected rows. `other` exists so an unrecognised statement is visible as itself
 * rather than being silently counted as one of the four.
 */
type VerifyStatement =
  | 'uploaded_update'
  | 'esigned_update'
  | 'audit_bulk_verify'
  | 'audit_bulk_verify_esigned'
  | 'other';

/**
 * Which statement a given SQL string is, by content.
 *
 * Content, not call index, deliberately. These tests used to queue one
 * `mockResolvedValueOnce` per expected call, so adding the eSigned UPDATE shifted
 * every later index by one: the mock meant for the audit INSERT was consumed by
 * the new UPDATE, and `calls[1]` stopped being the audit row it was named after.
 * A fifth statement would break a positional harness again; it cannot break this
 * one.
 *
 * Both UPDATEs set `verification_status = 'verified'`, so the SET clause does not
 * tell them apart — the WHERE does, and the status each one selects on is the
 * whole point of there being two.
 */
function classifyVerifyStatement(sql: string): VerifyStatement {
  if (/UPDATE\s+employee_joining_document_checklist/i.test(sql)) {
    if (/status\s*=\s*'uploaded_pending_review'/i.test(sql)) return 'uploaded_update';
    if (/status\s*=\s*'esign_completed'/i.test(sql)) return 'esigned_update';
  }
  if (/INSERT\s+INTO\s+employee_joining_document_audit_log/i.test(sql)) {
    // Ordered: 'BULK_VERIFY_ESIGNED' contains 'BULK_VERIFY', and the quotes stop
    // the shorter literal from matching the longer one.
    if (/'BULK_VERIFY_ESIGNED'/.test(sql)) return 'audit_bulk_verify_esigned';
    if (/'BULK_VERIFY'/.test(sql)) return 'audit_bulk_verify';
  }
  return 'other';
}

/** Rows each of the two UPDATEs reports for one employee. */
interface VerifyPlan {
  /** `affectedRows` for the uploaded-rows UPDATE — a human clicked verify. */
  uploaded: number;
  /** `affectedRows` for the eSigned-rows UPDATE — the provider verified the signature. */
  esigned: number;
}

/**
 * Answer `connection.execute` from a per-employee plan instead of a queue.
 *
 * The employee id is recovered from the bound parameters (every one of the four
 * statements binds it) rather than from the order calls arrive in, so the same
 * stub serves one employee or several without the caller counting statements.
 */
function stubVerifyStatements(plan: Record<string, VerifyPlan>): void {
  mocks.mockConnectionExecute.mockImplementation(async (sql: unknown, params: unknown = []) => {
    const kind = classifyVerifyStatement(String(sql));
    const employeeId = (params as unknown[]).find(
      (p): p is string => typeof p === 'string' && Object.prototype.hasOwnProperty.call(plan, p)
    );

    if (kind === 'uploaded_update' || kind === 'esigned_update') {
      if (!employeeId) {
        throw new Error(`No planned employee id in params for statement: ${String(sql)}`);
      }
      const affectedRows = kind === 'uploaded_update' ? plan[employeeId].uploaded : plan[employeeId].esigned;
      return [{ affectedRows } as ResultSetHeader, []];
    }

    // Audit inserts: the service never reads the result, only that it happened.
    return [{ affectedRows: 1 } as ResultSetHeader, []];
  });
}

/** Recorded calls of one kind, in the order they were issued. */
function verifyCallsOfKind(kind: VerifyStatement): unknown[][] {
  return mocks.mockConnectionExecute.mock.calls.filter(
    (call) => classifyVerifyStatement(String(call[0])) === kind
  );
}

describe('bulkVerifyDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks() clears recorded calls but keeps any mockImplementation, so a
    // stub set by one test would answer the next test's statements. Reset the
    // connection spy outright: every test below states its own statement results.
    mocks.mockConnectionExecute.mockReset();
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
    // Nothing to verify from either provenance: no uploaded rows awaiting review,
    // no eSigned rows still unverified.
    stubVerifyStatements({ 'emp-1': { uploaded: 0, esigned: 0 } });

    const result = await bulkVerifyDocuments(['emp-1'], 'actor-user-1');

    // Both UPDATEs are still attempted — that is how the service learns there is
    // nothing to do. What must not happen is anything downstream of them.
    expect(verifyCallsOfKind('uploaded_update')).toHaveLength(1);
    expect(verifyCallsOfKind('esigned_update')).toHaveLength(1);

    // No audit row of either kind: an employee whose documents did not change has
    // nothing to record.
    expect(verifyCallsOfKind('audit_bulk_verify')).toHaveLength(0);
    expect(verifyCallsOfKind('audit_bulk_verify_esigned')).toHaveLength(0);

    // Not pushed to recalcNeeded either — recalculating an unchanged employee's
    // percentage is work for no reason.
    expect(recalculateDocumentProgress).not.toHaveBeenCalled();

    expect(result.verified).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('should process multiple employees and accumulate verified count', async () => {
    // Deliberately one employee per provenance, and a third with neither, so the
    // total can only come out right if BOTH statements are counted and the empty
    // employee contributes nothing.
    stubVerifyStatements({
      'emp-1': { uploaded: 2, esigned: 0 }, // uploaded only
      'emp-2': { uploaded: 0, esigned: 3 }, // eSigned only
      'emp-3': { uploaded: 0, esigned: 0 }, // nothing to verify
    });

    const result = await bulkVerifyDocuments(['emp-1', 'emp-2', 'emp-3'], 'actor-user-1');

    expect(result.success).toBe(true);
    // 2 uploaded + 3 eSigned. Counting only the first statement gives 2, only the
    // second gives 3; 5 is reachable only by summing both.
    expect(result.verified).toBe(5);
    expect(result.errors).toHaveLength(0);

    // One audit row per statement that affected rows, and none for emp-3.
    const uploadedAudits = verifyCallsOfKind('audit_bulk_verify');
    const esignedAudits = verifyCallsOfKind('audit_bulk_verify_esigned');
    expect(uploadedAudits).toHaveLength(1);
    expect(esignedAudits).toHaveLength(1);
    expect(uploadedAudits[0][1]).toContain('emp-1');
    expect(esignedAudits[0][1]).toContain('emp-2');

    // Only the two employees whose rows actually changed reach the canonical
    // completion writer.
    expect(recalculateDocumentProgress).toHaveBeenCalledWith('emp-1');
    expect(recalculateDocumentProgress).toHaveBeenCalledWith('emp-2');
    expect(recalculateDocumentProgress).not.toHaveBeenCalledWith('emp-3');
    expect(recalculateDocumentProgress).toHaveBeenCalledTimes(2);
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
    // Both provenances affected rows for the same employee, so both audit rows are
    // expected — and each must carry its own action_type.
    stubVerifyStatements({ 'emp-1': { uploaded: 1, esigned: 2 } });

    const result = await bulkVerifyDocuments(['emp-1'], 'actor-user-1');

    const [uploadedAudit] = verifyCallsOfKind('audit_bulk_verify');
    expect(uploadedAudit, 'no BULK_VERIFY audit row was written').toBeDefined();
    expect(uploadedAudit[0]).toMatch(/employee_joining_document_audit_log/i);
    expect(uploadedAudit[0]).toMatch(/'BULK_VERIFY'/);
    expect(uploadedAudit[1]).toContain('actor-user-1');
    expect(uploadedAudit[1]).toContain('emp-1');

    // eSign-origin verification is recorded under its own action_type, so it is
    // distinguishable from a human verifying an upload by value rather than by
    // reading timestamps.
    const [esignedAudit] = verifyCallsOfKind('audit_bulk_verify_esigned');
    expect(esignedAudit, 'no BULK_VERIFY_ESIGNED audit row was written').toBeDefined();
    expect(esignedAudit[0]).toMatch(/'BULK_VERIFY_ESIGNED'/);
    expect(esignedAudit[1]).toContain('actor-user-1');
    expect(esignedAudit[1]).toContain('emp-1');
    // The eSigned row carries its provenance and row count as new_value.
    const esignedNewValue = (esignedAudit[1] as unknown[]).find(
      (p): p is string => typeof p === 'string' && p.trimStart().startsWith('{')
    );
    expect(esignedNewValue, 'BULK_VERIFY_ESIGNED wrote no new_value payload').toBeDefined();
    expect(JSON.parse(esignedNewValue!)).toMatchObject({
      verificationSource: 'aadhaar_esign',
      signatureMode: 'aadhaar_esign_verified',
      rowsVerified: 2,
    });

    expect(result.verified).toBe(3);
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

  // ── Branch RBAC ──────────────────────────────────────────────────────────
  // Nobody may pull another branch's verified documents through this
  // bulk-download path by supplying its employee_ids directly, even though the
  // list-and-select flow already keeps them inside their own branch. This used
  // to guard branch_head alone, which left hr and payroll_hr — the roles the
  // page is actually used by — downloading org-wide.

  it('restricts employee_ids to the actor\'s branch scope before querying files', async () => {
    vi.mocked(fsModule.existsSync).mockReturnValue(false);
    const freshMockArchive = {
      pipe: vi.fn(),
      file: vi.fn(),
      finalize: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };
    vi.mocked(archiver).mockReturnValue(freshMockArchive as ReturnType<typeof archiver>);

    mocks.mockBuildScopeWhereClause.mockResolvedValueOnce({ sql: 'e.branch_id = ?', params: ['branch-A'] });
    vi.mocked(db.execute)
      .mockResolvedValueOnce([[{ id: 'emp-1' }], []]) // only emp-1 is in branch-A
      .mockResolvedValueOnce([[], []]);               // file query

    const mockRes = { pipe: vi.fn() } as unknown as import('express').Response;
    await streamBulkDocumentsZip(['emp-1', 'emp-2'], null, mockRes, 'actor-user-1');

    // The scope check asks which of the requested ids the actor may have.
    const scopeCall = vi.mocked(db.execute).mock.calls[0];
    expect(scopeCall[0]).toMatch(/branch_id = \?/i);
    expect(scopeCall[1]).toEqual([['emp-1', 'emp-2'], 'branch-A']);

    // The file query then runs against the scoped id list only.
    const fileCall = vi.mocked(db.execute).mock.calls[1];
    expect(fileCall[1]).toEqual([['emp-1']]);
  });

  it('finalizes an empty archive when the actor holds no scope at all', async () => {
    const freshMockArchive = {
      pipe: vi.fn(),
      file: vi.fn(),
      finalize: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };
    vi.mocked(archiver).mockReturnValue(freshMockArchive as ReturnType<typeof archiver>);

    // 1=0 is what buildScopeWhereClause returns for a user whose roles carry no
    // assignment scope — fail closed, never fall through to an unrestricted query.
    mocks.mockBuildScopeWhereClause.mockResolvedValueOnce({ sql: '1=0', params: [] });

    const mockRes = { pipe: vi.fn() } as unknown as import('express').Response;
    await streamBulkDocumentsZip(['emp-1', 'emp-2'], null, mockRes, 'actor-user-1');

    expect(freshMockArchive.finalize).toHaveBeenCalledTimes(1);
    expect(freshMockArchive.file).not.toHaveBeenCalled();
    // No query ran at all — 1=0 needs no round trip to know the answer.
    expect(vi.mocked(db.execute)).not.toHaveBeenCalled();
  });

  it('leaves the id list alone for an org-wide actor', async () => {
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

    // scope_type='all', or super_admin.
    mocks.mockBuildScopeWhereClause.mockResolvedValueOnce({ sql: '1=1', params: [] });
    vi.mocked(db.execute).mockResolvedValueOnce([mockFiles, []]);

    const mockRes = { pipe: vi.fn() } as unknown as import('express').Response;
    await streamBulkDocumentsZip(['emp-1', 'emp-2'], null, mockRes, 'actor-user-1');

    // 1=1 short-circuits the scope query, so the file query is the only one.
    expect(vi.mocked(db.execute)).toHaveBeenCalledTimes(1);
    const fileCall = vi.mocked(db.execute).mock.calls[0];
    expect(fileCall[1]).toEqual([['emp-1', 'emp-2']]);
  });
});
