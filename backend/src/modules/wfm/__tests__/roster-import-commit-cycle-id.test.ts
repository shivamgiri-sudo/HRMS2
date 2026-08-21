/**
 * Task 4: Additive cycleId on bulk-upload commit (roster-import.service.ts::commitImportBatch)
 * All DB calls are mocked — no live database required.
 *
 * Rewritten 2026-08-22 alongside commitImportBatch itself (see roster-import-commit.test.ts for
 * the full rationale): mocks are now matched by SQL content rather than call order, and
 * withEmployeeRosterLock/checkEmployeeDateNotLocked are mocked at the function boundary instead of
 * simulating their internal GET_LOCK/RELEASE_LOCK connection calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { executeMock, mockConn } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  mockConn: { execute: vi.fn() },
}));

vi.mock('../../../db/mysql.js', () => ({
  db: { execute: executeMock },
}));

vi.mock('../rest-policy.service.js', () => ({
  withEmployeeRosterLock: vi.fn(async (_employeeId: string, fn: (conn: any) => Promise<any>) => fn(mockConn)),
  isRestPolicyFeatureActive: vi.fn(async () => false),
  validateMinimumRest: vi.fn(async () => ({ ok: true })),
  applyRestDecision: vi.fn(async () => ({ allowed: true, warned: false })),
}));

vi.mock('../../roster/roster-lock-guard.js', () => ({
  checkEmployeeDateNotLocked: vi.fn(async () => ({ blocked: false })),
}));

import { commitImportBatch } from '../roster-import.service.js';

describe('commitImportBatch — additive cycleId', () => {
  beforeEach(() => {
    executeMock.mockReset();
    mockConn.execute.mockReset();

    executeMock.mockImplementation(async (sql: string, params?: any[]) => {
      const s = sql.trim().toUpperCase();
      if (s.startsWith('SELECT * FROM WFM_ROSTER_IMPORT_BATCH')) {
        return [[{ id: 1, status: 'READY', import_mode: 'NEW', created_by: 'uploader-1' }]];
      }
      if (s.includes('COUNT(*) AS CNT')) return [[{ cnt: 0 }]];
      if (s.startsWith('SELECT * FROM WFM_ROSTER_IMPORT_ROW')) {
        return [[{ employee_id_raw: 'emp-1', roster_date: '2026-08-24', normalized_type: 'SHIFT', raw_value: '10:00 - 19:00' }]];
      }
      if (s.startsWith('SELECT ID, EMPLOYEE_CODE, PROCESS_ID, BRANCH_ID FROM EMPLOYEES')) {
        return [(params ?? []).map((code) => ({ id: `uuid-${code}`, employee_code: code, process_id: null, branch_id: null }))];
      }
      if (s.startsWith('SELECT ID FROM WFM_SHIFT_TEMPLATE')) return [[]];
      if (s.startsWith('SELECT EMPLOYEE_ID, FROM_DATE, TO_DATE, TOTAL_DAYS')) return [[]]; // no approved leave
      if (s.startsWith('UPDATE WFM_ROSTER_IMPORT_BATCH')) return [{ affectedRows: 1 }];
      return [[]];
    });

    mockConn.execute.mockImplementation(async (sql: string) => {
      const s = sql.trim().toUpperCase();
      if (s.startsWith('INSERT')) return [{ affectedRows: 1 }];
      return [[]];
    });
  });

  it('includes cycle_id in the insert when cycleId is passed', async () => {
    await commitImportBatch(1, 'reviewer-1', { cycleId: 'cycle-1' });
    const insertCall = mockConn.execute.mock.calls.find(([sql]) => String(sql).includes('INSERT'));
    expect(String(insertCall![0])).toContain('cycle_id');
    expect(insertCall![1]).toContain('cycle-1');
  });

  it('omits cycle_id from the insert when cycleId is not passed (backward compatibility)', async () => {
    await commitImportBatch(1, 'reviewer-1', {});
    const insertCall = mockConn.execute.mock.calls.find(([sql]) => String(sql).includes('INSERT'));
    expect(String(insertCall![0])).not.toContain('cycle_id');
  });
});
