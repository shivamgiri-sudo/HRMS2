/**
 * Task 6: Roster Import Commit Tests
 * All DB calls are mocked — no live database required.
 *
 * Rewritten 2026-08-22 alongside commitImportBatch itself: the function no longer runs the whole
 * batch in one transaction on one connection — it now goes through withEmployeeRosterLock per
 * employee (same guard roster.service.ts::assignEmployee uses), plus checkEmployeeDateNotLocked and
 * the minimum-rest guard, none of which existed here before. Those three guards have their own
 * dedicated test suites (rest-policy*.test.ts, the lock-guard contract tests) — this file mocks them
 * at the function boundary rather than re-deriving their internals, same pattern
 * roster-builder-assign.test.ts already uses for the same guards.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist shared state ───────────────────────────────────────────────────────
const { mockExecute, mockConn, mockGetConnection, notifyConn, state } = vi.hoisted(() => {
  const state = {
    batch: null as any,
    importRows: [] as any[],
    assignmentInserts: [] as any[],
    batchUpdates: [] as any[],
    errorCount: 0,
    warnCount: 0,
    committed: false,
    approvedLeaveRows: [] as any[],
    nightTemplateRows: [] as any[],
    lockBlocked: false,
    restActive: false,
    restBlocked: false, // when restActive: does validateMinimumRest report INSUFFICIENT_REST?
    restWarnMode: true, // applyRestDecision allows-through when the resolved policy is 'warn'
    unresolvableCodes: new Set<string>(), // codes the employee-lookup query pretends not to find
    batchCycleId: null as string | null, // notifyEmployeesForImportBatch's cycle_id short-circuit
    notifyMovedCount: 0, // rows the notify UPDATE claims to have moved to pending_employee_ack
    notifyInsertedCount: 0, // work_inbox_item rows the notify INSERT claims to have created
  };

  const mockConnExecute = vi.fn(async (sql: string, params?: any[]) => {
    const s = (sql as string).trim().toUpperCase();
    if (s.startsWith('INSERT IGNORE INTO WFM_ROSTER_ASSIGNMENT')) {
      state.assignmentInserts.push({ sql, params, mode: 'IGNORE' });
      return [{ affectedRows: 1, insertId: state.assignmentInserts.length }];
    }
    if (s.startsWith('INSERT INTO WFM_ROSTER_ASSIGNMENT')) {
      state.assignmentInserts.push({ sql, params, mode: 'UPSERT' });
      return [{ affectedRows: 1, insertId: state.assignmentInserts.length }];
    }
    return [[]];
  });
  const mockConn = { execute: mockConnExecute };

  // Separate connection for notifyEmployeesForImportBatch — a real transaction, distinct from the
  // per-employee-lock mockConn above, matching how the function itself opens its own connection.
  const notifyConnExecute = vi.fn(async (sql: string) => {
    const s = (sql as string).trim().toUpperCase();
    if (s.startsWith('SELECT CYCLE_ID FROM WFM_ROSTER_IMPORT_BATCH')) {
      return [[{ cycle_id: state.batchCycleId }]];
    }
    if (s.startsWith('UPDATE WFM_ROSTER_ASSIGNMENT')) {
      return [{ affectedRows: state.notifyMovedCount }];
    }
    if (s.startsWith('INSERT INTO WORK_INBOX_ITEM')) {
      return [{ affectedRows: state.notifyInsertedCount }];
    }
    return [[]];
  });
  const notifyConn = {
    execute: notifyConnExecute,
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    release: vi.fn(),
  };
  const mockGetConnection = vi.fn(async () => notifyConn);

  const mockExecute = vi.fn(async (sql: string, params?: any[]) => {
    const s = (sql as string).trim().toUpperCase();

    if (s.startsWith('SELECT ID FROM WFM_SHIFT_TEMPLATE')) {
      return [state.nightTemplateRows];
    }
    if (s.startsWith('SELECT ID, EMPLOYEE_CODE, PROCESS_ID, BRANCH_ID FROM EMPLOYEES')) {
      return [(params ?? [])
        .filter((code) => !state.unresolvableCodes.has(code))
        .map((code) => ({ id: `uuid-${code}`, employee_code: code, process_id: null, branch_id: null }))];
    }
    if (s.startsWith('SELECT * FROM WFM_ROSTER_IMPORT_BATCH')) {
      return state.batch ? [[state.batch]] : [[]];
    }
    if (s.includes('COUNT(*) AS CNT') && s.includes("VALIDATION_STATE = 'ERROR'")) {
      return [[{ cnt: state.errorCount }]];
    }
    if (s.includes('COUNT(*) AS CNT') && s.includes("VALIDATION_STATE = 'WARNING'")) {
      return [[{ cnt: state.warnCount }]];
    }
    if (s.startsWith('SELECT * FROM WFM_ROSTER_IMPORT_ROW')) {
      return [state.importRows];
    }
    if (s.startsWith('SELECT EMPLOYEE_ID, FROM_DATE, TO_DATE, TOTAL_DAYS')) {
      return [state.approvedLeaveRows]; // loadApprovedLeave — real function, mocked DB underneath
    }
    if (s.startsWith('UPDATE WFM_ROSTER_IMPORT_BATCH')) {
      state.batchUpdates.push({ sql, params });
      state.committed = true;
      return [{ affectedRows: 1 }];
    }
    return [[]];
  });

  return { mockExecute, mockConn, mockGetConnection, notifyConn, state };
});

vi.mock('../../../db/mysql.js', () => ({
  db: { execute: mockExecute, getConnection: mockGetConnection },
}));

// withEmployeeRosterLock just runs fn against the shared mockConn, bypassing the real MySQL named
// lock — that lock's own correctness is rest-policy.test.ts's job, not this file's.
vi.mock('../rest-policy.service.js', () => ({
  withEmployeeRosterLock: vi.fn(async (_employeeId: string, fn: (conn: any) => Promise<any>) => fn(mockConn)),
  isRestPolicyFeatureActive: vi.fn(async () => state.restActive),
  validateMinimumRest: vi.fn(async () =>
    state.restBlocked
      ? { ok: false, reason: 'INSUFFICIENT_REST', policy: { enforcementMode: state.restWarnMode ? 'warn' : 'block' }, actualRestMinutes: 30, requiredRestMinutes: 660 }
      : { ok: true, requiredRestMinutes: 660 }
  ),
  applyRestDecision: vi.fn(async (result: any) => {
    if (result.ok) return { allowed: true, warned: false };
    if (result.policy?.enforcementMode === 'warn') return { allowed: true, warned: true };
    return { allowed: false, warned: false };
  }),
}));

vi.mock('../../roster/roster-lock-guard.js', () => ({
  checkEmployeeDateNotLocked: vi.fn(async () =>
    state.lockBlocked ? { blocked: true, error: 'locked for payroll' } : { blocked: false }
  ),
}));

// Import service AFTER mock registration
import { commitImportBatch } from '../roster-import.service.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBatch(overrides: Partial<{
  id: number;
  status: string;
  created_by: string;
  import_mode: string;
}> = {}) {
  return {
    id: 1,
    status: 'PREVIEW',
    created_by: 'uploader-1',
    import_mode: 'NEW',
    ...overrides,
  };
}

function makeImportRow(overrides: Partial<{
  id: number;
  employee_id_raw: string;
  roster_date: string;
  normalized_type: string;
  validation_state: string;
  raw_value: string;
}> = {}) {
  return {
    id: 1,
    employee_id_raw: 'EMP001',
    roster_date: '2026-08-01',
    normalized_type: 'WO',
    validation_state: 'VALID',
    raw_value: 'WO',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('commitImportBatch', () => {
  beforeEach(() => {
    state.batch = null;
    state.importRows = [];
    state.assignmentInserts = [];
    state.batchUpdates = [];
    state.errorCount = 0;
    state.warnCount = 0;
    state.committed = false;
    state.approvedLeaveRows = [];
    state.nightTemplateRows = [];
    state.lockBlocked = false;
    state.restActive = false;
    state.restBlocked = false;
    state.restWarnMode = true;
    state.unresolvableCodes = new Set();
    state.batchCycleId = null;
    state.notifyMovedCount = 0;
    state.notifyInsertedCount = 0;
    mockExecute.mockClear();
    mockConn.execute.mockClear();
    mockGetConnection.mockClear();
    notifyConn.execute.mockClear();
  });

  it('throws when batch not found', async () => {
    state.batch = null;
    await expect(
      commitImportBatch(99, 'approver-1', {})
    ).rejects.toThrow('Import batch not found');
  });

  it('throws when batch not in PREVIEW state', async () => {
    state.batch = makeBatch({ status: 'COMMITTED' });
    await expect(
      commitImportBatch(1, 'approver-1', {})
    ).rejects.toThrow('Batch is not in a committable state');
  });

  it('throws when batch has hard errors and overrideWarnings not set', async () => {
    state.batch = makeBatch();
    state.errorCount = 3;
    await expect(
      commitImportBatch(1, 'approver-1', {})
    ).rejects.toThrow('Batch has 3 errors — resolve or use overrideWarnings');
  });

  it('throws when batch has warnings and overrideWarnings not set', async () => {
    state.batch = makeBatch();
    state.errorCount = 0;
    state.warnCount = 2;
    await expect(
      commitImportBatch(1, 'approver-1', {})
    ).rejects.toThrow('Batch has warnings — pass overrideWarnings: true to proceed');
  });

  it('succeeds when overrideWarnings=true despite warnings', async () => {
    state.batch = makeBatch();
    state.errorCount = 0;
    state.warnCount = 2;
    state.importRows = [makeImportRow({ validation_state: 'WARNING' })];

    const result = await commitImportBatch(1, 'approver-1', { overrideWarnings: true });

    expect(result.assignmentsCreated).toBe(1);
    expect(state.committed).toBe(true);
  });

  it('throws on maker-checker violation (same created_by and committedBy)', async () => {
    state.batch = makeBatch({ created_by: 'same-user' });
    state.errorCount = 0;
    state.warnCount = 0;
    await expect(
      commitImportBatch(1, 'same-user', {})
    ).rejects.toThrow('Uploader cannot approve their own import (maker-checker policy)');
  });

  it('super_admin CAN approve their own import — maker-checker exemption', async () => {
    state.batch = makeBatch({ created_by: 'same-user' });
    state.errorCount = 0;
    state.warnCount = 0;
    state.importRows = [makeImportRow({ validation_state: 'VALID' })];

    const result = await commitImportBatch(1, 'same-user', { committerIsSuperAdmin: true });

    expect(result.assignmentsCreated).toBe(1);
    expect(state.committed).toBe(true);
  });

  it('creates assignments for valid rows in NEW mode', async () => {
    state.batch = makeBatch({ import_mode: 'NEW' });
    state.errorCount = 0;
    state.warnCount = 0;
    state.importRows = [
      makeImportRow({ employee_id_raw: 'EMP001', roster_date: '2026-08-01', validation_state: 'VALID' }),
      makeImportRow({ id: 2, employee_id_raw: 'EMP002', roster_date: '2026-08-01', validation_state: 'VALID' }),
    ];

    const result = await commitImportBatch(1, 'approver-1', {});

    expect(result.assignmentsCreated).toBe(2);
    expect(result.skipped).toBe(0);
    expect(state.committed).toBe(true);
    expect(state.assignmentInserts.every((r) => r.mode === 'IGNORE')).toBe(true);
  });

  it('uses ON DUPLICATE KEY UPDATE for UPDATE mode', async () => {
    state.batch = makeBatch({ import_mode: 'UPDATE' });
    state.errorCount = 0;
    state.warnCount = 0;
    state.importRows = [
      makeImportRow({ validation_state: 'VALID' }),
    ];

    const result = await commitImportBatch(1, 'approver-1', {});

    expect(result.assignmentsCreated + result.assignmentsUpdated).toBeGreaterThanOrEqual(1);
    expect(state.assignmentInserts[0].mode).toBe('UPSERT');
    expect(state.assignmentInserts[0].sql.toUpperCase()).toContain('ON DUPLICATE KEY UPDATE');
  });

  it('skips NO_CHANGE and NEEDS_MAPPING rows', async () => {
    state.batch = makeBatch({ import_mode: 'NEW' });
    state.errorCount = 0;
    state.warnCount = 0;
    // These rows are excluded by the SELECT query (NOT IN NO_CHANGE, NEEDS_MAPPING, HARD_ERROR)
    // Mock returns empty because the service filters them at the SQL level
    state.importRows = [];

    const result = await commitImportBatch(1, 'approver-1', {});

    expect(result.assignmentsCreated).toBe(0);
    expect(result.assignmentsUpdated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(state.committed).toBe(true);
  });

  it('counts skipped rows when INSERT IGNORE finds existing assignment', async () => {
    state.batch = makeBatch({ import_mode: 'NEW' });
    state.errorCount = 0;
    state.warnCount = 0;
    state.importRows = [makeImportRow({ validation_state: 'VALID' })];
    mockConn.execute.mockImplementationOnce(async () => [{ affectedRows: 0 }]);

    const result = await commitImportBatch(1, 'approver-1', {});

    expect(result.skipped).toBe(1);
    expect(result.assignmentsCreated).toBe(0);
  });

  it('counts unmatched employees separately from skipped, and still commits the rest of the batch', async () => {
    state.batch = makeBatch({ import_mode: 'NEW' });
    state.errorCount = 0;
    state.warnCount = 0;
    state.unresolvableCodes = new Set(['GHOST']);
    state.importRows = [
      makeImportRow({ employee_id_raw: 'GHOST', roster_date: '2026-08-01', validation_state: 'VALID' }),
      makeImportRow({ id: 2, employee_id_raw: 'EMP001', roster_date: '2026-08-01', validation_state: 'VALID' }),
    ];

    const result = await commitImportBatch(1, 'approver-1', {});

    expect(result.unmatchedEmployees).toBe(1);
    expect(result.assignmentsCreated).toBe(1);
    expect(state.committed).toBe(true);
  });

  it('blocks a row whose roster date is already locked for payroll, and still commits the rest', async () => {
    state.batch = makeBatch({ import_mode: 'NEW' });
    state.errorCount = 0;
    state.warnCount = 0;
    state.lockBlocked = true;
    state.importRows = [makeImportRow({ validation_state: 'VALID' })];

    const result = await commitImportBatch(1, 'approver-1', {});

    expect(result.blockedByLock).toBe(1);
    expect(result.assignmentsCreated).toBe(0);
    expect(state.assignmentInserts.length).toBe(0);
    expect(state.committed).toBe(true); // one locked row doesn't stop the batch reaching COMMITTED
  });

  it('parses a SHIFT row\'s raw value and persists shift_start_time/shift_end_time', async () => {
    state.batch = makeBatch({ import_mode: 'NEW' });
    state.errorCount = 0;
    state.warnCount = 0;
    state.importRows = [
      makeImportRow({ normalized_type: 'SHIFT', raw_value: '10:00 - 19:00', validation_state: 'VALID' }),
    ];

    await commitImportBatch(1, 'approver-1', {});

    expect(state.assignmentInserts.length).toBe(1);
    const params = state.assignmentInserts[0].params;
    // params order: employeeId, rosterDate, normalizedType, shiftStartTime, shiftEndTime, batchId
    expect(params).toContain('10:00');
    expect(params).toContain('19:00');
  });

  it('WARN-mode rest policy: an insufficient-rest SHIFT row still commits (with the warning recorded downstream)', async () => {
    state.batch = makeBatch({ import_mode: 'NEW' });
    state.errorCount = 0;
    state.warnCount = 0;
    state.restActive = true;
    state.restBlocked = true;
    state.restWarnMode = true;
    state.importRows = [
      makeImportRow({ normalized_type: 'SHIFT', raw_value: '10:00 - 19:00', validation_state: 'VALID' }),
    ];

    const result = await commitImportBatch(1, 'approver-1', {});

    expect(result.blockedByRest).toBe(0);
    expect(result.assignmentsCreated).toBe(1);
  });

  it('BLOCK-mode rest policy: an insufficient-rest SHIFT row is refused, rest of batch still commits', async () => {
    state.batch = makeBatch({ import_mode: 'NEW' });
    state.errorCount = 0;
    state.warnCount = 0;
    state.restActive = true;
    state.restBlocked = true;
    state.restWarnMode = false;
    state.importRows = [
      makeImportRow({ employee_id_raw: 'EMP001', normalized_type: 'SHIFT', raw_value: '10:00 - 19:00', validation_state: 'VALID' }),
      makeImportRow({ id: 2, employee_id_raw: 'EMP002', roster_date: '2026-08-01', normalized_type: 'WO', validation_state: 'VALID' }),
    ];

    const result = await commitImportBatch(1, 'approver-1', {});

    expect(result.blockedByRest).toBe(1);
    expect(result.assignmentsCreated).toBe(1); // the WO row for EMP002 still went through
    expect(state.committed).toBe(true);
  });

  it('an unexpected DB error during a row write still surfaces (not silently swallowed) — no big transaction to roll back into anymore', async () => {
    state.batch = makeBatch({ import_mode: 'NEW' });
    state.errorCount = 0;
    state.warnCount = 0;
    state.importRows = [makeImportRow({ validation_state: 'VALID' })];
    mockConn.execute.mockRejectedValueOnce(new Error('DB failure'));

    await expect(
      commitImportBatch(1, 'approver-1', {})
    ).rejects.toThrow('DB failure');
  });

  it('a non-SHIFT row (WEEK_OFF) never triggers the rest-policy check even when the feature is active', async () => {
    state.batch = makeBatch({ import_mode: 'NEW' });
    state.errorCount = 0;
    state.warnCount = 0;
    state.restActive = true;
    state.restBlocked = true; // would block if it were ever checked
    state.restWarnMode = false;
    state.importRows = [makeImportRow({ normalized_type: 'WEEK_OFF', raw_value: 'WO', validation_state: 'VALID' })];

    const result = await commitImportBatch(1, 'approver-1', {});

    expect(result.blockedByRest).toBe(0);
    expect(result.assignmentsCreated).toBe(1);
  });

  it('notifies employees after a plain (no-cycle) commit — the gap the owner reported 2026-08-22', async () => {
    state.batch = makeBatch({ import_mode: 'NEW' });
    state.errorCount = 0;
    state.warnCount = 0;
    state.importRows = [makeImportRow({ validation_state: 'VALID' })];
    state.batchCycleId = null;
    state.notifyMovedCount = 1;
    state.notifyInsertedCount = 1;

    const result = await commitImportBatch(1, 'approver-1', {});

    expect(result.employeesNotified).toBe(1);
    const insertCall = notifyConn.execute.mock.calls.find(([sql]: [string]) => sql.toUpperCase().includes('WORK_INBOX_ITEM'));
    expect(insertCall).toBeTruthy();
    expect(String(insertCall![0])).toContain('ROSTER_ACK_PENDING');
  });

  it('skips notification for a batch already linked to a weekly_roster_cycle — that flow publishes it instead', async () => {
    state.batch = makeBatch({ import_mode: 'NEW' });
    state.errorCount = 0;
    state.warnCount = 0;
    state.importRows = [makeImportRow({ validation_state: 'VALID' })];
    state.batchCycleId = 'cycle-123';
    state.notifyMovedCount = 5; // would notify if the cycle short-circuit weren't respected
    state.notifyInsertedCount = 5;

    const result = await commitImportBatch(1, 'approver-1', {});

    expect(result.employeesNotified).toBe(0);
  });

  it('a commit that moved zero rows still succeeds and reports zero notifications, not an error', async () => {
    state.batch = makeBatch({ import_mode: 'NEW' });
    state.errorCount = 0;
    state.warnCount = 0;
    state.importRows = [];

    const result = await commitImportBatch(1, 'approver-1', {});

    expect(result.employeesNotified).toBe(0);
    expect(state.committed).toBe(true);
  });
});
