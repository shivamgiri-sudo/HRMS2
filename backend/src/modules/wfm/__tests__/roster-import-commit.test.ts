/**
 * Task 6: Roster Import Commit Tests
 * All DB calls are mocked — no live database required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist shared state ───────────────────────────────────────────────────────
const { mockExecute, mockGetConnection, state } = vi.hoisted(() => {
  const state = {
    batch: null as any,
    importRows: [] as any[],
    assignmentInserts: [] as any[],
    batchUpdates: [] as any[],
    errorCount: 0,
    warnCount: 0,
    committed: false,
    rolledBack: false,
  };

  const mockConnExecute = vi.fn(async (sql: string, params?: any[]) => {
    const s = (sql as string).trim().toUpperCase();

    // Employee code -> id resolution (commitImportBatch maps the spreadsheet CODE to employees.id).
    if (s.startsWith('SELECT ID, EMPLOYEE_CODE FROM EMPLOYEES')) {
      return [(params ?? []).map((code) => ({ id: `uuid-${code}`, employee_code: code }))];
    }

    if (s.startsWith('INSERT IGNORE INTO WFM_ROSTER_ASSIGNMENT')) {
      state.assignmentInserts.push({ sql, params, mode: 'IGNORE' });
      // Simulate successful insert (affectedRows 1 = new row)
      return [{ affectedRows: 1, insertId: state.assignmentInserts.length }];
    }

    if (s.startsWith('INSERT INTO WFM_ROSTER_ASSIGNMENT')) {
      state.assignmentInserts.push({ sql, params, mode: 'UPSERT' });
      // affectedRows=1 means new row, 2 means updated
      return [{ affectedRows: 1, insertId: state.assignmentInserts.length }];
    }

    if (s.startsWith('UPDATE WFM_ROSTER_IMPORT_BATCH')) {
      state.batchUpdates.push({ sql, params });
      state.committed = true;
      return [{ affectedRows: 1 }];
    }

    return [[]];
  });

  const mockConn = {
    execute: mockConnExecute,
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => { state.rolledBack = true; }),
    release: vi.fn(),
  };

  const mockGetConnection = vi.fn(async () => mockConn);

  const mockExecute = vi.fn(async (sql: string, params?: any[]) => {
    const s = (sql as string).trim().toUpperCase();

    // Employee code -> id resolution (commitImportBatch maps the spreadsheet CODE to employees.id).
    if (s.startsWith('SELECT ID, EMPLOYEE_CODE FROM EMPLOYEES')) {
      return [(params ?? []).map((code) => ({ id: `uuid-${code}`, employee_code: code }))];
    }

    // Fetch batch
    if (s.startsWith('SELECT * FROM WFM_ROSTER_IMPORT_BATCH')) {
      if (!state.batch) return [[]];
      return [[state.batch]];
    }

    // Error count
    if (s.includes('COUNT(*) AS CNT') && s.includes("VALIDATION_STATE = 'ERROR'")) {
      return [[{ cnt: state.errorCount }]];
    }

    // Warning count
    if (s.includes('COUNT(*) AS CNT') && s.includes("VALIDATION_STATE = 'WARNING'")) {
      return [[{ cnt: state.warnCount }]];
    }

    // Import rows
    if (s.startsWith('SELECT * FROM WFM_ROSTER_IMPORT_ROW')) {
      return [state.importRows];
    }

    return [[]];
  });

  return { mockExecute, mockGetConnection, state };
});

vi.mock('../../../db/mysql.js', () => ({
  db: {
    execute: mockExecute,
    getConnection: mockGetConnection,
  },
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
}> = {}) {
  return {
    id: 1,
    employee_id_raw: 'EMP001',
    roster_date: '2026-08-01',
    normalized_type: 'WO',
    validation_state: 'VALID',
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
    state.rolledBack = false;
    mockExecute.mockClear();
    mockGetConnection.mockClear();
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

    // Verify INSERT IGNORE was used for NEW mode
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

    // Override connection execute to simulate an existing row (affectedRows=0)
    const conn = await mockGetConnection();
    // the employee code -> id lookup runs on the connection first; let it through
    (conn.execute as ReturnType<typeof vi.fn>).mockImplementationOnce(async (_sql: string, params?: any[]) => [
      (params ?? []).map((code: any) => ({ id: `uuid-${code}`, employee_code: code })),
    ]);
    (conn.execute as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => [{ affectedRows: 0 }]);

    const result = await commitImportBatch(1, 'approver-1', {});

    expect(result.skipped).toBe(1);
    expect(result.assignmentsCreated).toBe(0);
  });

  it('rolls back transaction on error during assignment insert', async () => {
    state.batch = makeBatch({ import_mode: 'NEW' });
    state.errorCount = 0;
    state.warnCount = 0;
    state.importRows = [makeImportRow({ validation_state: 'VALID' })];

    const conn = await mockGetConnection();
    // the employee code -> id lookup runs on the connection first; let it through
    (conn.execute as ReturnType<typeof vi.fn>).mockImplementationOnce(async (_sql: string, params?: any[]) => [
      (params ?? []).map((code: any) => ({ id: `uuid-${code}`, employee_code: code })),
    ]);
    (conn.execute as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('DB failure'));

    await expect(
      commitImportBatch(1, 'approver-1', {})
    ).rejects.toThrow('DB failure');

    expect(state.rolledBack).toBe(true);
  });
});
