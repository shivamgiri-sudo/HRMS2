import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db to avoid needing a real MySQL connection
vi.mock('../../../db/mysql.js', () => ({
  db: {
    execute: vi.fn(),
  },
}));

// Mock side-effect imports that would pull in real DB or notification logic
vi.mock('../../payroll/payrollCalculate.service.js', () => ({
  calculateGratuity: vi.fn().mockResolvedValue({ eligible: false, reason: 'not_configured', years: 0, amount: 0 }),
}));
vi.mock('../../payroll/noc-release-gate.service.js', () => ({
  nocReleaseStatusForEmployee: vi.fn().mockResolvedValue({ blocked: false }),
}));
vi.mock('../exit.notifications.js', () => ({
  notifyFullFinalReady: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../shared/auditLog.js', () => ({
  logSensitiveAction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../shared/moneyEventAudit.js', () => ({
  recordMoneyEventAudit: vi.fn().mockResolvedValue(undefined),
}));

import { ffService } from '../ff.service.js';
import { db } from '../../../db/mysql.js';

const mockDb = db as unknown as { execute: ReturnType<typeof vi.fn> };

describe('F&F 2-step flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('approveFF proceeds even when is_ff_provisional = 1 (gate removed)', async () => {
    // SELECT returns a provisional draft record
    mockDb.execute
      .mockResolvedValueOnce([[{ id: 'ff-id', exit_request_id: 'er-id', employee_id: 'emp-id', status: 'draft', is_ff_provisional: 1, approved_by: null }]]) // SELECT by id
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE approve
      .mockResolvedValueOnce([[{ id: 'ff-id', exit_request_id: 'er-id', employee_id: 'emp-id', status: 'approved', is_ff_provisional: 1, approved_by: 'approver-id', approved_at: new Date().toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }]]) // getFF SELECT
      .mockResolvedValueOnce([[]]); // getPayrollAlreadyPaid

    await expect(ffService.approveFF('ff-id', 'approver-id')).resolves.not.toThrow();
  });

  it('setProvisionalFalse without reason throws 400', async () => {
    await expect(ffService.setProvisionalFalse('ff-id', 'user-id', ''))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('setProvisionalFalse with reason writes audit columns', async () => {
    mockDb.execute
      .mockResolvedValueOnce([[{ id: 'ff-id', exit_request_id: 'er-id', employee_id: 'emp-id', status: 'draft', is_ff_provisional: 1 }]]) // SELECT ff record
      .mockResolvedValueOnce([[{ full_name: 'Test Verifier' }]]) // SELECT employee name
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE
      .mockResolvedValueOnce([[{ id: 'ff-id', exit_request_id: 'er-id', employee_id: 'emp-id', status: 'draft', is_ff_provisional: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }]]) // getFF SELECT
      .mockResolvedValueOnce([[]]); // getPayrollAlreadyPaid

    await expect(ffService.setProvisionalFalse('ff-id', 'verifier-id', 'Verified OK')).resolves.not.toThrow();

    // The UPDATE call (3rd execute call, index 2) must contain the audit columns
    const updateCall = mockDb.execute.mock.calls[2];
    expect(updateCall[0]).toContain('verified_by');
    expect(updateCall[0]).toContain('verified_by_name');
    expect(updateCall[0]).toContain('verified_at');
    expect(updateCall[0]).toContain('verification_reason');
    expect(updateCall[1]).toContain('verifier-id');
    expect(updateCall[1]).toContain('Verified OK');
  });
});
