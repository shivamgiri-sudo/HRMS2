/**
 * Task 4: Additive cycleId on bulk-upload commit (roster-import.service.ts::commitImportBatch)
 * All DB calls are mocked — no live database required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist shared mocks ───────────────────────────────────────────────────────
// NOTE: vi.mock() factories are hoisted above imports by vitest. Referencing
// plain `const` bindings declared later in the module inside that factory hits
// the temporal dead zone ("Cannot access 'executeMock' before initialization").
// Declaring them via vi.hoisted() (as the sibling roster-import-commit.test.ts
// already does) avoids that.
const { executeMock, getConnectionMock, connExecuteMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  getConnectionMock: vi.fn(),
  connExecuteMock: vi.fn(),
}));

vi.mock('../../../db/mysql.js', () => ({
  db: {
    execute: executeMock,
    getConnection: getConnectionMock,
  },
}));

import { commitImportBatch } from '../roster-import.service.js';

describe('commitImportBatch — additive cycleId', () => {
  beforeEach(() => {
    executeMock.mockReset();
    connExecuteMock.mockReset();
    getConnectionMock.mockReset();
    getConnectionMock.mockResolvedValue({
      beginTransaction: vi.fn(),
      commit: vi.fn(),
      rollback: vi.fn(),
      release: vi.fn(),
      execute: connExecuteMock,
    });
    // batch fetch: status READY, import_mode NEW, created_by != committedBy
    executeMock.mockResolvedValueOnce([[{ id: 1, status: 'READY', import_mode: 'NEW', created_by: 'uploader-1' }], undefined]);
    executeMock.mockResolvedValueOnce([[{ cnt: 0 }], undefined]); // error count
    executeMock.mockResolvedValueOnce([[{ cnt: 0 }], undefined]); // warning count
    executeMock.mockResolvedValueOnce([[{ employee_id_raw: 'emp-1', roster_date: '2026-08-24', normalized_type: 'SHIFT' }], undefined]); // rows
    connExecuteMock.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]); // INSERT
    connExecuteMock.mockResolvedValueOnce([{}, undefined]); // batch status update
  });

  it('includes cycle_id in the insert when cycleId is passed', async () => {
    await commitImportBatch(1, 'reviewer-1', { cycleId: 'cycle-1' });
    const insertCall = connExecuteMock.mock.calls.find(([sql]) => String(sql).includes('INSERT'));
    expect(String(insertCall![0])).toContain('cycle_id');
    expect(insertCall![1]).toContain('cycle-1');
  });

  it('omits cycle_id from the insert when cycleId is not passed (backward compatibility)', async () => {
    await commitImportBatch(1, 'reviewer-1', {});
    const insertCall = connExecuteMock.mock.calls.find(([sql]) => String(sql).includes('INSERT'));
    expect(String(insertCall![0])).not.toContain('cycle_id');
  });
});
