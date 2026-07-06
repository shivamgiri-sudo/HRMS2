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

// Mock the DB module
vi.mock('../../../db/mysql.js', () => {
  const mockExecute = vi.fn();
  return {
    db: {
      execute: mockExecute,
    },
  };
});

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
