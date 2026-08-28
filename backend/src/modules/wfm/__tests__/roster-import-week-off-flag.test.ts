/**
 * commitImportBatch must set `is_week_off` from the row's normalized_type.
 *
 * Regression guard for a live data defect measured 2026-08-28: of the 916 committed
 * `wfm_roster_assignment` rows carrying `assignment_type='WEEK_OFF'`, **zero** had
 * `is_week_off=1`. Every INSERT in commitImportBatch wrote assignment_type but omitted the
 * flag, so it fell to its column default of 0.
 *
 * That matters because `is_week_off` — not `assignment_type` — is the column the rest of the
 * repo reads (112 call sites): payroll's paid-day counting, the WFM compliance engine's
 * shift-vs-violation split, week-off fairness, break management and the WFM report executors
 * all branch on the flag. A committed roster therefore looked like nobody had a day off.
 *
 * All DB calls are mocked, matching the sibling roster-import-commit-cycle-id.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { executeMock, mockConn, notifyConn, getConnectionMock, rowType } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  mockConn: { execute: vi.fn() },
  notifyConn: {
    execute: vi.fn(async () => [[]]),
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    release: vi.fn(),
  },
  getConnectionMock: vi.fn(),
  // Mutable so each test can drive a different normalized_type through the same mock stack.
  rowType: { value: 'WEEK_OFF' as string },
}));

vi.mock('../../../db/mysql.js', () => ({
  db: { execute: executeMock, getConnection: getConnectionMock },
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

/** The value written for is_week_off — the param immediately after normalized_type. */
function weekOffParamFrom(call: [string, any[]]): unknown {
  const [sql, params] = call;
  expect(String(sql)).toContain('is_week_off');
  const typeIdx = params.indexOf(rowType.value);
  expect(typeIdx).toBeGreaterThanOrEqual(0);
  return params[typeIdx + 1];
}

function setupMocks(importMode: 'NEW' | 'UPDATE') {
  executeMock.mockReset();
  mockConn.execute.mockReset();
  getConnectionMock.mockReset();
  getConnectionMock.mockResolvedValue(notifyConn);

  executeMock.mockImplementation(async (sql: string, params?: any[]) => {
    const s = sql.trim().toUpperCase();
    if (s.startsWith('SELECT * FROM WFM_ROSTER_IMPORT_BATCH')) {
      return [[{ id: 1, status: 'READY', import_mode: importMode, created_by: 'uploader-1' }]];
    }
    if (s.includes('COUNT(*) AS CNT')) return [[{ cnt: 0 }]];
    if (s.startsWith('SELECT * FROM WFM_ROSTER_IMPORT_ROW')) {
      return [[{ employee_id_raw: 'emp-1', roster_date: '2026-08-24', normalized_type: rowType.value, raw_value: '10:00 - 19:00' }]];
    }
    if (s.startsWith('SELECT ID, EMPLOYEE_CODE, PROCESS_ID, BRANCH_ID FROM EMPLOYEES')) {
      return [(params ?? []).map((code) => ({ id: `uuid-${code}`, employee_code: code, process_id: null, branch_id: null }))];
    }
    if (s.startsWith('SELECT ID FROM WFM_SHIFT_TEMPLATE')) return [[]];
    if (s.startsWith('SELECT EMPLOYEE_ID, FROM_DATE, TO_DATE, TOTAL_DAYS')) return [[]];
    if (s.startsWith('UPDATE WFM_ROSTER_IMPORT_BATCH')) return [{ affectedRows: 1 }];
    return [[]];
  });

  mockConn.execute.mockImplementation(async (sql: string) => {
    const s = sql.trim().toUpperCase();
    if (s.startsWith('INSERT')) return [{ affectedRows: 1 }];
    return [[]];
  });
}

function insertCall() {
  const call = mockConn.execute.mock.calls.find(([sql]) => String(sql).includes('INSERT'));
  expect(call, 'commitImportBatch made no INSERT').toBeDefined();
  return call as [string, any[]];
}

describe('commitImportBatch — is_week_off is written from normalized_type', () => {
  beforeEach(() => {
    rowType.value = 'WEEK_OFF';
  });

  it('sets is_week_off = 1 for a WEEK_OFF row (NEW mode)', async () => {
    rowType.value = 'WEEK_OFF';
    setupMocks('NEW');
    await commitImportBatch(1, 'reviewer-1', {});
    expect(weekOffParamFrom(insertCall())).toBe(1);
  });

  it('sets is_week_off = 0 for a SHIFT row (NEW mode)', async () => {
    rowType.value = 'SHIFT';
    setupMocks('NEW');
    await commitImportBatch(1, 'reviewer-1', {});
    expect(weekOffParamFrom(insertCall())).toBe(0);
  });

  it('sets is_week_off = 1 for a WEEK_OFF row on the cycle-bound insert', async () => {
    rowType.value = 'WEEK_OFF';
    setupMocks('NEW');
    await commitImportBatch(1, 'reviewer-1', { cycleId: 'cycle-1' });
    const call = insertCall();
    expect(String(call[0])).toContain('cycle_id');
    expect(weekOffParamFrom(call)).toBe(1);
  });

  it('re-imports correct an existing row: UPDATE mode carries is_week_off through ON DUPLICATE KEY', async () => {
    rowType.value = 'WEEK_OFF';
    setupMocks('UPDATE');
    await commitImportBatch(1, 'reviewer-1', {});
    const call = insertCall();
    // Without this the 916 already-committed rows could never be repaired by re-importing —
    // the row would match, skip the insert, and keep is_week_off = 0.
    expect(String(call[0])).toContain('is_week_off = VALUES(is_week_off)');
    expect(weekOffParamFrom(call)).toBe(1);
  });
});
