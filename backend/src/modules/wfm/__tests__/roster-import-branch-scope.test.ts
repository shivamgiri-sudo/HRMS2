/**
 * Whole-branch roster upload (migration 1536).
 *
 * createImportBatch already matched employees by employee_code alone, so branchId only
 * needed to (a) reach the INSERT and (b) let getMissingEmployees fall back to scoping by
 * branch when the batch carries no process_id. All DB calls are mocked — no live database
 * required.
 */

import { describe, it, expect, vi } from 'vitest';
import * as XLSX from 'xlsx';

const { mockExecute, state } = vi.hoisted(() => {
  const state = {
    batchAutoId: 1,
    insertedRows: [] as any[][],
    batchInsertParams: null as any[] | null,
  };

  const mockExecute = vi.fn(async (sql: string, params?: any[]) => {
    const s = (sql as string).trim().toUpperCase();

    if (s.startsWith('INSERT INTO WFM_ROSTER_IMPORT_BATCH')) {
      state.batchInsertParams = params ?? null;
      const id = state.batchAutoId++;
      return [{ insertId: id, affectedRows: 1 }];
    }
    if (s.startsWith('INSERT INTO WFM_ROSTER_IMPORT_ROW')) {
      const flat = params ?? [];
      for (let i = 0; i + 10 <= flat.length; i += 10) state.insertedRows.push(flat.slice(i, i + 10));
      return [{ insertId: state.insertedRows.length, affectedRows: 1 }];
    }
    if (s.startsWith('UPDATE WFM_ROSTER_IMPORT_BATCH')) return [{ affectedRows: 1 }];
    if (s.includes('FROM LEAVE_REQUEST')) return [[]];
    return [[]];
  });

  return { mockExecute, state };
});

vi.mock('../../../db/mysql.js', () => ({ db: { execute: mockExecute } }));

import { createImportBatch, getMissingEmployees } from '../roster-import.service.js';

function buildXlsxBuffer(headerRow: string[], dataRows: string[][]): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
  XLSX.utils.book_append_sheet(wb, ws, 'Roster');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

describe('createImportBatch — branch scope', () => {
  it('inserts branch_id and a null process_id when only branchId is given', async () => {
    const buf = buildXlsxBuffer(
      ['Employee Code', 'Employee Name', '01-Aug-26', '02-Aug-26'],
      [['EMP1', 'Ravi Kumar', '10:00 - 19:00', 'WO']]
    );
    await createImportBatch({
      branchId: 'branch-1',
      importMode: 'NEW',
      fileBuffer: buf,
      fileName: 'branch.xlsx',
      createdBy: 'uploader-1',
    });
    expect(state.batchInsertParams).not.toBeNull();
    // (process_id, branch_id, cycle_id, import_mode, file_name, created_by)
    expect(state.batchInsertParams![0]).toBeNull();
    expect(state.batchInsertParams![1]).toBe('branch-1');
  });
});

describe('getMissingEmployees — branch fallback', () => {
  it('scopes by branch_id when the batch has no process_id', async () => {
    mockExecute.mockClear();
    mockExecute.mockImplementation(async (sql: string) => {
      const s = sql.trim().toUpperCase();
      if (s.startsWith('SELECT PROCESS_ID, BRANCH_ID')) {
        return [[{ process_id: null, branch_id: 'branch-1' }]];
      }
      if (s.startsWith('SELECT DISTINCT EMPLOYEE_ID_RAW')) {
        return [[{ employee_id_raw: 'EMP1' }]];
      }
      if (s.includes('FROM EMPLOYEES')) {
        // Assert the query scoped on branch_id, not process_id
        expect(s).toContain('BRANCH_ID = ?');
        expect(s).not.toContain('PROCESS_ID = ?');
        return [[
          { id: 'e1', employee_code: 'EMP1', full_name: 'Ravi Kumar', designation: 'Analyst' },
          { id: 'e2', employee_code: 'EMP2', full_name: 'Priya Singh', designation: 'Analyst' },
        ]];
      }
      return [[]];
    });

    const result = await getMissingEmployees(1);
    expect(result.total).toBe(1);
    expect(result.employees[0].employee_code).toBe('EMP2');
  });

  it('returns empty rather than matching everyone when neither process nor branch is set', async () => {
    mockExecute.mockClear();
    mockExecute.mockImplementation(async (sql: string) => {
      const s = sql.trim().toUpperCase();
      if (s.startsWith('SELECT PROCESS_ID, BRANCH_ID')) {
        return [[{ process_id: null, branch_id: null }]];
      }
      return [[]];
    });
    const result = await getMissingEmployees(1);
    expect(result).toEqual({ employees: [], total: 0 });
  });
});
