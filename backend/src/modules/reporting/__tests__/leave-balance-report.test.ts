/**
 * Leave Balance Report — format, catalog and executor contract tests.
 *
 * The expected workbook structure below is taken from the business-supplied
 * authority file "Leave Balance Format.xlsx" (sheet "Leave Balance July'26 month"),
 * which was inspected cell-by-cell rather than approximated.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';

import {
  buildLeaveBalanceWorkbook,
  leaveBalanceSheetName,
  leaveBalanceFileName,
  businessMonth,
  roundLeaveValue,
  LEAVE_BALANCE_COLUMNS,
  LEAVE_BALANCE_HEADER_GROUPS,
} from '../leave-balance-format.js';

import { REPORT_CATALOG } from '../report-catalog.js';

// ── DB mock (shared by the executor tests) ────────────────────────────────────
const executeMock = vi.fn();
vi.mock('../../../db/mysql.js', () => ({
  db: { execute: (...args: unknown[]) => executeMock(...args) },
}));

// Imported after the mock is registered.
const { leaveBalance } = await import('../executors/leave.executor.js');
const { EXECUTOR_MAP } = await import('../executors/index.js');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SAMPLE_ROWS = [
  {
    emp_code: '0071', emp_name: 'A KARTHIK', branch_name: 'NOIDA-2',
    cost_center: 'BSS/OB/NOIDA-2/972', process_name: '',
    cl_current: 1, ml_current: 0, el_current: 0, ptl_mtl_current: 0,
    cl_taken: 0, ml_taken: 0, el_taken: 0, ptl_mtl_taken: 0,
    cl_remain: 1, ml_remain: 0, el_remain: 0, ptl_mtl_remain: 0,
  },
  {
    emp_code: 'MAS63061', emp_name: 'AAKASH GAUR', branch_name: 'NOIDA-2',
    cost_center: 'BSS/BO/NOIDA-2/576', process_name: 'Outbound Sales',
    cl_current: 4, ml_current: 3, el_current: 18, ptl_mtl_current: 180,
    cl_taken: 4.5, ml_taken: 0.5, el_taken: 3.5, ptl_mtl_taken: 0,
    cl_remain: -0.5, ml_remain: 2.5, el_remain: 14.5, ptl_mtl_remain: 180,
  },
];

async function buildAndRead(rows = SAMPLE_ROWS, month = '2026-07') {
  const buffer = await buildLeaveBalanceWorkbook({ rows, month });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return { wb, ws: wb.worksheets[0], buffer };
}

function scope(overrides: Record<string, unknown> = {}) {
  return {
    isSuperAdmin: true,
    roles: ['super_admin'],
    branchScope:     { mode: 'all', ids: [] },
    processScope:    { mode: 'all', ids: [] },
    departmentScope: { mode: 'all', ids: [] },
    costCentreScope: { mode: 'all', ids: [] },
    managerScope:    { mode: 'all', ids: [] },
    ...overrides,
  } as never;
}

const OPTIONS_PREVIEW = { limit: 100, offset: 0, cursor: null, includeTotal: false, mode: 'preview' as const };
const OPTIONS_EXPORT  = { limit: 5001, offset: 0, cursor: null, includeTotal: false, mode: 'export'  as const };

/** Returns the SQL string handed to db.execute for the last non-COUNT query. */
function lastSql(): string {
  const calls = executeMock.mock.calls.filter(c => !String(c[0]).startsWith('SELECT COUNT(*)'));
  return String(calls[calls.length - 1][0]);
}

beforeEach(() => {
  executeMock.mockReset();
  executeMock.mockResolvedValue([[], []]);
});

// ══════════════════════════════════════════════════════════════════════════════
// XLSX workbook structure
// ══════════════════════════════════════════════════════════════════════════════

describe('Leave Balance XLSX — structure', () => {
  it('(13) has exactly the merged ranges from the attachment', async () => {
    const { ws } = await buildAndRead();
    const merges = (ws.model.merges ?? []).slice().sort();
    expect(merges).toEqual(['A1:D1', 'F1:I1', 'J1:M1', 'N1:Q1'].sort());
  });

  it('(14) row 1 group headers match, with E1 blank', async () => {
    const { ws } = await buildAndRead();
    expect(ws.getCell('A1').value).toBe('Emp Details');
    expect(ws.getCell('F1').value).toBe('Current Leave');
    expect(ws.getCell('J1').value).toBe('Leave Taken');
    expect(ws.getCell('N1').value).toBe('Leave Remain');

    const e1 = ws.getCell('E1').value;
    expect(e1 === null || e1 === undefined || e1 === '').toBe(true);
  });

  it('(14) row 2 headers exactly match A2:Q2', async () => {
    const { ws } = await buildAndRead();
    const actual: unknown[] = [];
    for (let c = 1; c <= 17; c++) actual.push(ws.getRow(2).getCell(c).value);

    expect(actual).toEqual([
      'EmpCode', 'EmpName', 'BranchName', 'Cost Center', 'Process Name',
      'CL', 'ML', 'EL', 'PTL/MTL',
      'CL', 'ML', 'EL', 'PTL/MTL',
      'CL', 'ML', 'EL', 'PTL/MTL',
    ]);
  });

  it('(15) contains all 17 columns in the correct order', async () => {
    expect(LEAVE_BALANCE_COLUMNS).toHaveLength(17);
    expect(LEAVE_BALANCE_COLUMNS.map(c => c.key)).toEqual([
      'emp_code', 'emp_name', 'branch_name', 'cost_center', 'process_name',
      'cl_current', 'ml_current', 'el_current', 'ptl_mtl_current',
      'cl_taken', 'ml_taken', 'el_taken', 'ptl_mtl_taken',
      'cl_remain', 'ml_remain', 'el_remain', 'ptl_mtl_remain',
    ]);

    const { ws } = await buildAndRead();
    expect(ws.columnCount).toBe(17);
  });

  it('header group spans sum to the column count', () => {
    const total = LEAVE_BALANCE_HEADER_GROUPS.reduce((n, g) => n + g.colSpan, 0);
    expect(total).toBe(LEAVE_BALANCE_COLUMNS.length);
  });

  it('(16) stores employee code as text so leading zeros survive', async () => {
    const { ws } = await buildAndRead();
    const cell = ws.getCell('A3');
    expect(cell.value).toBe('0071');
    expect(typeof cell.value).toBe('string');
    expect(cell.numFmt).toBe('@');
  });

  it('(17) preserves 0.5 / 3.5 / 4.5 and negative -0.5', async () => {
    const { ws } = await buildAndRead();
    expect(ws.getCell('J4').value).toBe(4.5);   // cl_taken
    expect(ws.getCell('K4').value).toBe(0.5);   // ml_taken
    expect(ws.getCell('L4').value).toBe(3.5);   // el_taken
    expect(ws.getCell('N4').value).toBe(-0.5);  // cl_remain — negative retained
    expect(ws.getCell('N4').numFmt).toBe('0.##');
  });

  it('blanks Leave Taken zeros but keeps Current/Remain zeros as 0', async () => {
    const { ws } = await buildAndRead();
    // Row 3 has every "taken" value at zero.
    for (const addr of ['J3', 'K3', 'L3', 'M3']) {
      const v = ws.getCell(addr).value;
      expect(v === null || v === undefined || v === '').toBe(true);
    }
    expect(ws.getCell('G3').value).toBe(0); // ml_current
    expect(ws.getCell('O3').value).toBe(0); // ml_remain
  });

  it('leaves an unassigned process cell blank rather than a dash placeholder', async () => {
    const { ws } = await buildAndRead();
    expect(ws.getCell('E3').value).toBe('');
    for (const bad of ['—', 'null', 'undefined', 'N/A']) {
      expect(ws.getCell('E3').value).not.toBe(bad);
    }
  });

  it('applies bold centred headers, thin black borders and exact column widths', async () => {
    const { ws } = await buildAndRead();

    const h = ws.getCell('A2');
    expect(h.font?.bold).toBe(true);
    expect(h.font?.name).toBe('Calibri');
    expect(h.font?.size).toBe(11);
    expect(h.alignment?.horizontal).toBe('center');
    expect(h.alignment?.vertical).toBe('middle');
    expect(h.border?.top?.style).toBe('thin');
    expect(h.border?.top?.color?.argb).toBe('FF000000');

    // widths lifted verbatim from the attachment
    expect(ws.getColumn(1).width).toBe(10);
    expect(ws.getColumn(2).width).toBe(32);
    expect(ws.getColumn(4).width).toBe(22);
    expect(ws.getColumn(6).width).toBe(3);

    // data cells are bordered and not bold
    const d = ws.getCell('A3');
    expect(d.border?.left?.style).toBe('thin');
    expect(d.font?.bold).toBeFalsy();
  });

  it('omits title, timestamp, totals and extra sheets', async () => {
    const { wb, ws } = await buildAndRead();
    expect(wb.worksheets).toHaveLength(1);          // no metadata sheet
    expect(ws.rowCount).toBe(2 + SAMPLE_ROWS.length); // no title/total rows
    expect(ws.views?.[0]?.showGridLines).toBe(false);
  });

  it('names the worksheet and file from the selected month', () => {
    expect(leaveBalanceSheetName('2026-07')).toBe("Leave Balance July'26 month");
    expect(leaveBalanceFileName('2026-07')).toBe('Leave_Balance_July_2026.xlsx');
    expect(leaveBalanceSheetName('2026-01')).toBe("Leave Balance January'26 month");
  });

  it('(10) exports every filtered row, not just a preview page', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({
      ...SAMPLE_ROWS[0], emp_code: `E${String(i).padStart(4, '0')}`,
    }));
    const { ws } = await buildAndRead(many);
    expect(ws.rowCount).toBe(2 + 250);
  });

  it('rounds to at most two decimals without flattening half-days', () => {
    expect(roundLeaveValue(0.5)).toBe(0.5);
    expect(roundLeaveValue(1.005)).toBe(1);
    expect(roundLeaveValue(-0.5)).toBe(-0.5);
    expect(roundLeaveValue(2.567)).toBe(2.57);
    expect(roundLeaveValue(null)).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Month handling
// ══════════════════════════════════════════════════════════════════════════════

describe('Leave Balance — reporting month', () => {
  it('accepts a valid month and rejects malformed input', () => {
    expect(businessMonth('2026-07')).toBe('2026-07');
    expect(businessMonth('garbage')).toMatch(/^\d{4}-\d{2}$/);
    expect(businessMonth(undefined)).toMatch(/^\d{4}-\d{2}$/);
  });

  it('defaults to the local business month, not a UTC substring', () => {
    // In IST the UTC substring returns the PREVIOUS month for the first 5.5h
    // of each month; businessMonth() must use local calendar fields instead.
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    expect(businessMonth(null)).toBe(expected);
  });

  it('(9) preview and export resolve the same month for identical filters', () => {
    expect(businessMonth('2026-07')).toBe(businessMonth('2026-07'));
    expect(leaveBalanceSheetName(businessMonth('2026-03')))
      .toBe(leaveBalanceSheetName('2026-03'));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Catalog consolidation
// ══════════════════════════════════════════════════════════════════════════════

describe('Report catalog', () => {
  it('(11) exposes exactly one Leave Balance report', () => {
    const leaveBalanceReports = REPORT_CATALOG.filter(
      r => r.code === 'leave-balance' || r.code === 'leave-balance-export'
    );
    expect(leaveBalanceReports).toHaveLength(1);
    expect(leaveBalanceReports[0].code).toBe('leave-balance');
    expect(leaveBalanceReports[0].name).toBe('Leave Balance Report');
  });

  it('(12) keeps the legacy leave-balance-export code resolvable', () => {
    expect(EXECUTOR_MAP['leave-balance-export']).toBeDefined();
    expect(EXECUTOR_MAP['leave-balance-export']).toBe(EXECUTOR_MAP['leave-balance']);
  });

  it('declares one row per employee keyed on employee code', () => {
    const def = REPORT_CATALOG.find(r => r.code === 'leave-balance')!;
    expect(def.rowGrain).toBe('One row per employee');
    expect(def.primaryKey).toEqual(['emp_code']);
  });

  it('carries the 17 columns and grouped headers', () => {
    const def = REPORT_CATALOG.find(r => r.code === 'leave-balance')!;
    expect(def.columns).toHaveLength(17);
    expect(def.columns.map(c => c.key)).toEqual(LEAVE_BALANCE_COLUMNS.map(c => c.key));
    expect(def.headerGroups?.reduce((n, g) => n + g.colSpan, 0)).toBe(17);
  });

  it('offers Month, Branch and Process — and no Leave Type filter', () => {
    const def = REPORT_CATALOG.find(r => r.code === 'leave-balance')!;
    const keys = def.filters.map(f => f.key);
    expect(keys).toEqual(['month', 'branchId', 'processId']);
    expect(keys).not.toContain('leaveType');
  });

  it('(8) retains role restrictions and row scope', () => {
    const def = REPORT_CATALOG.find(r => r.code === 'leave-balance')!;
    expect(def.branchScoped).toBe(true);
    expect(def.processScoped).toBe(true);
    expect(def.exportRoles.length).toBeGreaterThan(0);
    expect(def.viewRoles).toContain('hr');
    expect(def.exportRoles).not.toContain('employee');
    expect(def.containsPII).toBe(true);
  });

  it('(18) other reports keep a single header row', () => {
    const withGroups = REPORT_CATALOG.filter(r => r.headerGroups);
    expect(withGroups.map(r => r.code)).toEqual(['leave-balance']);
  });

  it('every catalog code is unique', () => {
    const codes = REPORT_CATALOG.map(r => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Route shadowing — regression guard
//
// Three separate handlers used to answer /api/reports/suite/leave-balance, and
// the two ad-hoc ones took precedence over the canonical executor, so the API
// returned the old one-row-per-leave-type shape no matter what the executor did.
// These assertions fail if either shadowing handler is reintroduced.
// ══════════════════════════════════════════════════════════════════════════════

describe('leave-balance route resolution', () => {
  const readSource = async (file: string) => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    return readFile(join(here, '..', file), 'utf8');
  };

  it('is not handled by the high-risk router, which is mounted first', async () => {
    const src = await readSource('report-suite-highrisk.routes.ts');
    expect(src).not.toMatch(/reportSuiteHighRiskRouter\.get\(\s*["']\/leave-balance["']/);
  });

  it('has no ad-hoc SQL case in the report-suite switch', async () => {
    const src = await readSource('report-suite.routes.ts');
    expect(src).not.toMatch(/case\s+["']leave-balance["']\s*:/);
  });

  it('still routes the legacy export code through the shared workbook builder', async () => {
    const src = await readSource('report-suite.routes.ts');
    expect(src).toMatch(/LEAVE_BALANCE_CODES/);
    expect(src).toMatch(/buildLeaveBalanceWorkbook/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Executor behaviour
// ══════════════════════════════════════════════════════════════════════════════

describe('leaveBalance executor', () => {
  it('(1) returns one row per employee with no duplicate codes', async () => {
    executeMock.mockResolvedValue([[
      { _cursor: 1, emp_code: 'A1', cl_current: 1 },
      { _cursor: 2, emp_code: 'A2', cl_current: 2 },
    ], []]);

    const result = await leaveBalance({ month: '2026-07' }, scope(), OPTIONS_PREVIEW);
    const codes = result.rows.map(r => r.emp_code);
    expect(new Set(codes).size).toBe(codes.length);

    // Grain is enforced by grouping on the employee, not by leave type.
    const sql = lastSql();
    expect(sql).toMatch(/GROUP BY\s+e\.id/);
    expect(sql).not.toMatch(/lt\.leave_name\s*,\s*lt\.leave_code/);
  });

  it('strips the internal cursor field from output rows', async () => {
    executeMock.mockResolvedValue([[{ _cursor: 7, emp_code: 'A1' }], []]);
    const result = await leaveBalance({ month: '2026-07' }, scope(), OPTIONS_PREVIEW);
    expect(result.rows[0]).not.toHaveProperty('_cursor');
  });

  it('(2) pivots CL, ML, EL and PTL/MTL into Current, Taken and Remain', async () => {
    await leaveBalance({ month: '2026-07' }, scope(), OPTIONS_PREVIEW);
    const sql = lastSql();
    for (const key of [
      'cl_current', 'ml_current', 'el_current', 'ptl_mtl_current',
      'cl_taken', 'ml_taken', 'el_taken', 'ptl_mtl_taken',
      'cl_remain', 'ml_remain', 'el_remain', 'ptl_mtl_remain',
    ]) {
      expect(sql).toContain(key);
    }
  });

  it('maps maternity and paternity to PTL/MTL, and sick leave to the ML column', async () => {
    await leaveBalance({ month: '2026-07' }, scope(), OPTIONS_PREVIEW);
    const sql = lastSql();

    // Maternity/paternity are classified BEFORE the generic codes so that a
    // leave_code of 'ML' meaning "Maternity Leave" cannot land in the ML column.
    const maternityAt = sql.indexOf("'%matern%'");
    const sickAt = sql.indexOf("'%sick%'");
    expect(maternityAt).toBeGreaterThan(-1);
    expect(sickAt).toBeGreaterThan(-1);
    expect(maternityAt).toBeLessThan(sickAt);

    expect(sql).toContain("'%patern%'");
    expect(sql).toContain("'PTLMTL'");
    expect(sql).toContain("lt.leave_code IN ('SL','MED')");
  });

  it('excludes retired leave types so they are not double-counted', async () => {
    await leaveBalance({ month: '2026-07' }, scope(), OPTIONS_PREVIEW);
    const sql = lastSql();
    // Production keeps retired types that still hold ledger history: 'SL' (Sick,
    // superseded by 'ML' Medical) and 'PL' (Paternity, superseded by 'PTRL').
    // Without this filter SL lands in the ML column on top of ML, and PL in
    // PTL/MTL on top of PTRL/MTRL.
    expect(sql).toMatch(/leave_type_master lt\s+ON lt\.id = lbl\.leave_type_id\s+AND lt\.active_status = 1/);
  });

  it('does not hardcode entitlement values such as 4 or 180', async () => {
    await leaveBalance({ month: '2026-07' }, scope(), OPTIONS_PREVIEW);
    const sql = lastSql();
    expect(sql).not.toMatch(/\b180\b/);
    expect(sql).not.toMatch(/THEN\s+4\b/);
  });

  it('(3) yields zero for employees with no ledger row for a leave type', async () => {
    await leaveBalance({ month: '2026-07' }, scope(), OPTIONS_PREVIEW);
    const sql = lastSql();
    // Employees LEFT JOIN the ledger, and every bucket is COALESCEd to 0.
    expect(sql).toMatch(/LEFT JOIN leave_balance_ledger/);
    expect(sql).toMatch(/COALESCE\(SUM\(/);
    expect(sql).toMatch(/\),0\)/);
  });

  it('(4)(5) keeps two decimals so half-days and negatives survive', async () => {
    await leaveBalance({ month: '2026-07' }, scope(), OPTIONS_PREVIEW);
    const sql = lastSql();
    expect(sql).toMatch(/ROUND\(.*,2\)/s);
    expect(sql).not.toMatch(/ROUND\([^)]*,\s*0\s*\)/);
    // Remain is a signed subtraction, so negative balances are preserved.
    expect(sql).toMatch(/-\s*COALESCE\(lbl\.used_days,0\)/);
  });

  it('(6) reads approved usage from the ledger and never from leave_request', async () => {
    await leaveBalance({ month: '2026-07' }, scope(), OPTIONS_PREVIEW);
    const sql = lastSql();
    expect(sql).toContain('lbl.used_days');
    // Pending / rejected / cancelled requests live in leave_request, which this
    // report must not read — that would also double-count ledger usage.
    expect(sql).not.toMatch(/leave_request/i);
  });

  it('uses allocated + adjusted for Current and subtracts used for Remain', async () => {
    await leaveBalance({ month: '2026-07' }, scope(), OPTIONS_PREVIEW);
    const sql = lastSql();
    expect(sql).toMatch(/COALESCE\(lbl\.allocated_days,0\) \+ COALESCE\(lbl\.adjusted_days,0\)/);
  });

  it('(7) applies branch and process filters', async () => {
    await leaveBalance(
      { month: '2026-07', branchId: 'BR-1', processId: 'PR-9' },
      scope(),
      OPTIONS_PREVIEW
    );
    const sql = lastSql();
    expect(sql).toMatch(/e\.branch_id = \?/);
    expect(sql).toMatch(/e\.process_id = \?/);

    const params = executeMock.mock.calls.at(-1)![1] as unknown[];
    expect(params).toContain('BR-1');
    expect(params).toContain('PR-9');
  });

  it('(8) enforces restricted branch row scope', async () => {
    await leaveBalance(
      { month: '2026-07' },
      scope({ isSuperAdmin: false, roles: ['manager'], branchScope: { mode: 'restricted', ids: ['B1', 'B2'] } }),
      OPTIONS_PREVIEW
    );
    const sql = lastSql();
    expect(sql).toMatch(/e\.branch_id IN \(\?,\?\)/);

    const params = executeMock.mock.calls.at(-1)![1] as unknown[];
    expect(params).toEqual(expect.arrayContaining(['B1', 'B2']));
  });

  it('(8) rejects execution when scope resolution failed', async () => {
    await expect(
      leaveBalance(
        { month: '2026-07' },
        scope({ isSuperAdmin: false, branchScope: { mode: 'none', ids: [] } }),
        OPTIONS_PREVIEW
      )
    ).rejects.toThrow();
  });

  it('restricts to active employees', async () => {
    await leaveBalance({ month: '2026-07' }, scope(), OPTIONS_PREVIEW);
    expect(lastSql()).toContain('e.active_status = 1');
  });

  it('(9) derives the ledger balance year from the selected month', async () => {
    await leaveBalance({ month: '2026-07' }, scope(), OPTIONS_PREVIEW);
    expect(lastSql()).toMatch(/lbl\.balance_year = 2026/);

    executeMock.mockClear();
    await leaveBalance({ month: '2025-02' }, scope(), OPTIONS_PREVIEW);
    expect(lastSql()).toMatch(/lbl\.balance_year = 2025/);
  });

  it('(9) builds identical SQL for preview and export', async () => {
    await leaveBalance({ month: '2026-07' }, scope(), OPTIONS_PREVIEW);
    const previewSql = lastSql().replace(/LIMIT[\s\S]*$/, '');

    executeMock.mockClear();
    await leaveBalance({ month: '2026-07' }, scope(), OPTIONS_EXPORT);
    const exportSql = lastSql().replace(/LIMIT[\s\S]*$/, '');

    expect(exportSql).toBe(previewSql);
  });

  it('sorts deterministically by EmpCode ascending', async () => {
    await leaveBalance({ month: '2026-07' }, scope(), OPTIONS_PREVIEW);
    expect(lastSql()).toMatch(/ORDER BY e\.employee_code ASC, e\.id ASC/);
  });

  it('joins canonical master data for branch, process and cost centre', async () => {
    await leaveBalance({ month: '2026-07' }, scope(), OPTIONS_PREVIEW);
    const sql = lastSql();
    expect(sql).toMatch(/LEFT JOIN branch_master b\s+ON b\.id\s+= e\.branch_id/);
    expect(sql).toMatch(/LEFT JOIN process_master p\s+ON p\.id\s+= e\.process_id/);
    expect(sql).toMatch(/LEFT JOIN cost_centre_master cc ON cc\.id = e\.cost_centre_id/);
  });
});
