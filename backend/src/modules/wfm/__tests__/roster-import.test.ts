/**
 * Task 5: Roster Import Service Tests
 * All DB calls are mocked — no live database required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';

// ── Hoist shared state so vi.mock factory can reference it ──────────────
// vi.mock() is hoisted to the top of the file, so any vars it references
// must also be hoisted via vi.hoisted().
const { mockExecute, state } = vi.hoisted(() => {
  const state = {
    batchAutoId: 1,
    insertedRows: [] as any[][],
    batchRecord: null as any,
  };

  const mockExecute = vi.fn(async (sql: string, _params?: any[]) => {
    const s = (sql as string).trim().toUpperCase();

    if (s.startsWith('INSERT INTO WFM_ROSTER_IMPORT_BATCH')) {
      const id = state.batchAutoId++;
      state.batchRecord = { id, status: 'PARSING' };
      return [{ insertId: id, affectedRows: 1 }];
    }

    if (s.startsWith('INSERT INTO WFM_ROSTER_IMPORT_ROW')) {
      state.insertedRows.push(_params ?? []);
      return [{ insertId: state.insertedRows.length, affectedRows: 1 }];
    }

    if (s.startsWith('UPDATE WFM_ROSTER_IMPORT_BATCH')) {
      if (state.batchRecord) state.batchRecord.status = 'PREVIEW';
      return [{ affectedRows: 1 }];
    }

    // Leave check — default: no approved leave found
    if (s.includes('FROM LEAVE_REQUEST')) {
      return [[]];
    }

    return [[]];
  });

  return { mockExecute, state };
});

vi.mock('../../../db/mysql.js', () => ({
  db: { execute: mockExecute },
}));

// ── Import service AFTER mock registration ───────────────────────────────
import { createImportBatch } from '../roster-import.service.js';

// ── Helper: build a minimal XLSX buffer ─────────────────────────────────

function buildXlsxBuffer(headerRow: string[], dataRows: string[][]): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
  XLSX.utils.book_append_sheet(wb, ws, 'Roster');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

// ── Test suite ───────────────────────────────────────────────────────────

describe('roster-import service', () => {
  beforeEach(() => {
    state.batchAutoId = 1;
    state.insertedRows.length = 0;
    state.batchRecord = null;
    mockExecute.mockClear();
  });

  describe('createImportBatch', () => {
    it('parses WIDE format and returns PREVIEW status', async () => {
      const buffer = buildXlsxBuffer(
        ['Employee ID', 'Name', '01-Aug-26', '02-Aug-26'],
        [
          ['EMP001', 'Alice', 'WO', '9-6'],
          ['EMP002', 'Bob', 'L', 'WO'],
        ]
      );

      const { batchId, summary } = await createImportBatch({
        processId: 'proc-1',
        importMode: 'NEW',
        fileBuffer: buffer,
        fileName: 'roster.xlsx',
        createdBy: 'user-1',
      });

      expect(batchId).toBeGreaterThan(0);
      expect(summary.totalEmployees).toBe(2);
      expect(summary.totalAssignments).toBe(4); // 2 employees × 2 dates
      // L → LEAVE → warning (no approved leave in mock)
      expect(summary.warnings).toBeGreaterThanOrEqual(1);
      expect(summary.dateRangeStart).toBe('2026-08-01');
      expect(summary.dateRangeEnd).toBe('2026-08-02');
    });

    it('returns HARD_ERROR for literal 0 cell', async () => {
      // Two date columns required for header detection
      const buffer = buildXlsxBuffer(
        ['Employee ID', '01-Aug-26', '02-Aug-26'],
        [['EMP001', '0', 'WO']]
      );

      const { summary } = await createImportBatch({
        processId: 'proc-1',
        importMode: 'NEW',
        fileBuffer: buffer,
        fileName: 'roster.xlsx',
        createdBy: 'user-1',
      });

      expect(summary.errors).toBeGreaterThanOrEqual(1);
      const errorRow = state.insertedRows.find((p) => p[7] === 'ERROR');
      expect(errorRow).toBeDefined();
      const msgs: string[] = JSON.parse(errorRow![8]);
      expect(msgs.some((m) => m.includes('Literal 0'))).toBe(true);
    });

    it('returns NEEDS_MAPPING for unrecognized shift string', async () => {
      const buffer = buildXlsxBuffer(
        ['Employee ID', '01-Aug-26', '02-Aug-26'],
        [['EMP001', 'XYZUNKNOWN', 'WO']]
      );

      const { summary } = await createImportBatch({
        processId: 'proc-1',
        importMode: 'NEW',
        fileBuffer: buffer,
        fileName: 'roster.xlsx',
        createdBy: 'user-1',
      });

      expect(summary.errors).toBeGreaterThanOrEqual(1);
      const errorRow = state.insertedRows.find((p) => p[7] === 'ERROR');
      expect(errorRow).toBeDefined();
      const msgs: string[] = JSON.parse(errorRow![8]);
      expect(msgs.some((m) => m.includes('not recognized'))).toBe(true);
    });

    it('returns UNASSIGNED for blank cell in NEW mode', async () => {
      const buffer = buildXlsxBuffer(
        ['Employee ID', '01-Aug-26', '02-Aug-26'],
        [['EMP001', '', 'WO']]
      );

      const { summary } = await createImportBatch({
        processId: 'proc-1',
        importMode: 'NEW',
        fileBuffer: buffer,
        fileName: 'roster.xlsx',
        createdBy: 'user-1',
      });

      expect(summary.unassigned).toBeGreaterThanOrEqual(1);
      expect(summary.warnings).toBeGreaterThanOrEqual(1);
      const warnRow = state.insertedRows.find((p) => p[7] === 'WARNING');
      expect(warnRow).toBeDefined();
      const msgs: string[] = JSON.parse(warnRow![8]);
      expect(msgs.some((m) => m.includes('blank'))).toBe(true);
    });

    it('returns NO_CHANGE for blank cell in UPDATE mode', async () => {
      const buffer = buildXlsxBuffer(
        ['Employee ID', '01-Aug-26', '02-Aug-26'],
        [['EMP001', '', 'WO']]
      );

      const { summary } = await createImportBatch({
        processId: 'proc-1',
        importMode: 'UPDATE',
        fileBuffer: buffer,
        fileName: 'roster.xlsx',
        createdBy: 'user-1',
      });

      // Blank in UPDATE mode → NO_CHANGE → VALID (no warning)
      const noChangeRow = state.insertedRows.find((p) => p[6] === 'NO_CHANGE');
      expect(noChangeRow).toBeDefined();
      expect(noChangeRow![7]).toBe('VALID');
    });

    it('deduplicates same employee+date+same value with WARNING', async () => {
      // Two rows for EMP001 on 01-Aug, both WO
      const buffer = buildXlsxBuffer(
        ['Employee ID', '01-Aug-26', '02-Aug-26'],
        [
          ['EMP001', 'WO', 'WO'],
          ['EMP001', 'WO', 'L'],
        ]
      );

      await createImportBatch({
        processId: 'proc-1',
        importMode: 'NEW',
        fileBuffer: buffer,
        fileName: 'roster.xlsx',
        createdBy: 'user-1',
      });

      // EMP001 + 01-Aug appears twice with same value (WO): second should be WARNING with "deduplicated"
      const warnRow = state.insertedRows.find(
        (p) =>
          p[7] === 'WARNING' &&
          JSON.parse(p[8]).some((m: string) => m.includes('deduplicated'))
      );
      expect(warnRow).toBeDefined();
    });

    it('marks same employee+date+different value as ERROR', async () => {
      // Two rows for EMP001 on 01-Aug with different values
      const buffer = buildXlsxBuffer(
        ['Employee ID', '01-Aug-26', '02-Aug-26'],
        [
          ['EMP001', 'WO', 'WO'],
          ['EMP001', 'L', 'WO'],
        ]
      );

      const { summary } = await createImportBatch({
        processId: 'proc-1',
        importMode: 'NEW',
        fileBuffer: buffer,
        fileName: 'roster.xlsx',
        createdBy: 'user-1',
      });

      // Both EMP001+01-Aug rows should be ERROR due to conflict
      expect(summary.errors).toBeGreaterThanOrEqual(2);
      const errorRows = state.insertedRows.filter((p) => p[7] === 'ERROR');
      const allMsgs = errorRows.flatMap((p) => JSON.parse(p[8]) as string[]);
      expect(allMsgs.some((m) => m.includes('Conflicting'))).toBe(true);
    });

    it('throws when no header row detected', async () => {
      // Sheet with no date columns
      const buffer = buildXlsxBuffer(
        ['Employee ID', 'Name', 'Process', 'Status'],
        [['EMP001', 'Alice', 'Process A', 'Active']]
      );

      await expect(
        createImportBatch({
          processId: 'proc-1',
          importMode: 'NEW',
          fileBuffer: buffer,
          fileName: 'no-dates.xlsx',
          createdBy: 'user-1',
        })
      ).rejects.toThrow('Could not detect header row');
    });
  });
});
