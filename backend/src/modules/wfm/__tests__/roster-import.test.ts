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
      // Rows are inserted in chunked multi-row statements, so params arrive as one flat array
      // covering many rows. Split back into 10-column rows so assertions stay per-row.
      const flat = _params ?? [];
      for (let i = 0; i + 10 <= flat.length; i += 10) {
        state.insertedRows.push(flat.slice(i, i + 10));
      }
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
      ).rejects.toThrow('No sheet in this file looks like a roster');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// Real-file shapes (added 2026-08-20, from two actual files: a 300-agent "Roster Planning"
// sheet and a 7.6 MB 12-sheet weekly WFM workbook).
//
// Every test above builds its header row from hand-typed strings like '01-Aug-26'. A file
// saved by Excel does not look like that: its date headers are date cells, which the sheet
// reader returns as numbers, and the import crashed on the first one with
// `TypeError: (header ?? "").trim is not a function`.
// ═══════════════════════════════════════════════════════════════════════════════════════════

describe('roster-import service — real spreadsheet shapes', () => {
  beforeEach(() => {
    state.batchAutoId = 1;
    state.insertedRows.length = 0;
    state.batchRecord = null;
    mockExecute.mockClear();
  });

  /** A workbook whose date headers are genuine date cells, as Excel writes them. */
  function buildDateHeaderWorkbook(sheets: Array<{ name: string; aoa: unknown[][] }>): Buffer {
    const wb = XLSX.utils.book_new();
    for (const s of sheets) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.aoa, { cellDates: true }), s.name);
    }
    return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true }));
  }

  const REAL_SHAPE: unknown[][] = [
    // The real file's first row is weekday labels above the dates, so the header row is row 2.
    ['', '', '', '', 'Sat', 'Sun'],
    ['MAS ID', 'Agent Name', 'DOJ', 'Shift Timing', new Date(2026, 7, 1), new Date(2026, 7, 2)],
    ['MAS56168', 'KRISHAN KUMAR', new Date(2024, 5, 4), '10:00 - 19:00', '10:00 - 19:00', 'WO'],
    ['MAS60006', 'ANKIT KUMAR', new Date(2025, 6, 17), '09:30 - 18:30', 'WO', '09:30 - 18:30'],
  ];

  it('parses a sheet whose date headers are real Excel date cells', async () => {
    const { summary } = await createImportBatch({
      processId: 'proc-1',
      importMode: 'NEW',
      fileBuffer: buildDateHeaderWorkbook([{ name: 'Roster Planning', aoa: REAL_SHAPE }]),
      fileName: 'Roster.xlsx',
      createdBy: 'user-1',
    });

    expect(summary.totalEmployees).toBe(2);
    expect(summary.totalAssignments).toBe(4); // 2 employees x 2 dates
    expect(summary.dateRangeStart).toBe('2026-08-01');
    expect(summary.dateRangeEnd).toBe('2026-08-02');
    // '10:00 - 19:00' and 'WO' both resolve; nothing lands in NEEDS_MAPPING.
    expect(summary.needsMapping).toBe(0);
  });

  it('skips the weekday-label row above the dates and finds the real header row', async () => {
    const { summary } = await createImportBatch({
      processId: 'proc-1',
      importMode: 'NEW',
      fileBuffer: buildDateHeaderWorkbook([{ name: 'Roster Planning', aoa: REAL_SHAPE }]),
      fileName: 'Roster.xlsx',
      createdBy: 'user-1',
    });
    // 4 assignments, not 6: the 'Sat'/'Sun' row is a header, never an employee.
    expect(summary.totalAssignments).toBe(4);
    expect(summary.totalEmployees).toBe(2);
  });

  it('reads the FIRST sheet of a multi-sheet workbook and ignores the rest', async () => {
    const buffer = buildDateHeaderWorkbook([
      { name: 'Roster Planning', aoa: REAL_SHAPE },
      { name: 'Summary', aoa: [['WC 17th Aug'], ['Req HC', 202.58]] },
      { name: 'Floor Capacity', aoa: [['x', 'y'], [1, 2]] },
    ]);

    const { summary } = await createImportBatch({
      processId: 'proc-1',
      importMode: 'NEW',
      fileBuffer: buffer,
      fileName: 'Shift Roster.xlsx',
      createdBy: 'user-1',
    });

    expect(summary.totalEmployees).toBe(2);
    expect(summary.dateRangeStart).toBe('2026-08-01');
  });

  it('finds the roster when the FIRST sheet is not one — the reported production case', async () => {
    // The real weekly WFM workbook: first tab is an interval capacity grid with no date columns,
    // the roster is on a later tab. This previously threw ROSTER_IMPORT_NO_HEADER_ROW and the
    // roster tab was never opened, so the file could not be imported at all. Reported 2026-08-20.
    const buffer = buildDateHeaderWorkbook([
      { name: 'Planning', aoa: [['', 'BST', 'IST', 'Mon', 'Tue'], ['', '00:00:00', '05:30:00', 22.77, 25.6]] },
      { name: 'Roster Planning', aoa: REAL_SHAPE },
    ]);

    const result = await createImportBatch({
      processId: 'proc-1',
      importMode: 'NEW',
      fileBuffer: buffer,
      fileName: "Shift Roster WC 17 Aug'26.xlsx",
      createdBy: 'user-1',
    });

    expect(result.batchId).toBeGreaterThan(0);
    // Proves it parsed the ROSTER tab, not merely that it stopped erroring: the capacity grid on
    // 'Planning' has no employees or dated assignments to find.
    expect(result.summary.totalEmployees).toBeGreaterThan(0);
    expect(result.summary.totalAssignments).toBeGreaterThan(0);
  });

  it('refuses only when NO sheet is a roster, naming every tab it checked', async () => {
    // The genuine "wrong file" case. The message must list the tabs, because the useful question
    // is no longer "why not the first sheet" but "which of these was meant to be the roster".
    const buffer = buildDateHeaderWorkbook([
      { name: 'Planning', aoa: [['', 'BST', 'IST'], ['', '00:00:00', '05:30:00']] },
      { name: 'Summary', aoa: [['Process', 'HC'], ['Onfido', 42]] },
    ]);

    const err = await createImportBatch({
      processId: 'proc-1',
      importMode: 'NEW',
      fileBuffer: buffer,
      fileName: 'no-roster-anywhere.xlsx',
      createdBy: 'user-1',
    }).catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('ROSTER_IMPORT_NO_HEADER_ROW');
    expect(err.message).toContain("'Planning'");
    expect(err.message).toContain("'Summary'");
  });
});
