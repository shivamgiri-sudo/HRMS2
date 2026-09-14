/**
 * Leave Balance Report — canonical output format.
 *
 * Single source of truth for the 17-column pivoted layout shared by:
 *   - the `leave-balance` executor row shape,
 *   - the backend + frontend report catalog column definitions,
 *   - the XLSX export workbook.
 *
 * The layout below was taken from the business-supplied authority workbook
 * "Leave Balance Format.xlsx" (sheet "Leave Balance July'26 month"), which was
 * inspected cell-by-cell rather than approximated:
 *
 *   merges      A1:D1, F1:I1, J1:M1, N1:Q1   (E1 deliberately blank + unmerged)
 *   row 1       height 15
 *   font        Calibri 11; header rows bold, data rows regular
 *   alignment   headers centre/middle; data centre
 *   borders     thin FF000000 on every populated cell
 *   gridlines   hidden
 *   fills       none (plain white)
 *
 * Presentation rules confirmed from the same workbook's 359 data rows:
 *   - "Current Leave" and "Leave Remain" zeros render as 0
 *   - "Leave Taken"   zeros render as an EMPTY cell
 *   - negative remaining balances are preserved (e.g. -0.5)
 *   - half-days (0.5 / 1.5 / 3.5 / 4.5) are preserved
 *   - employee code is a text cell so leading zeros survive
 */

import ExcelJS from 'exceljs';

// ── Column definitions ─────────────────────────────────────────────────────────

export interface LeaveBalanceColumn {
  key: string;
  /** Header text for worksheet row 2 / table header row 2 */
  label: string;
  format: 'text' | 'number';
  /** Exact column width read from the authority workbook */
  width: number;
  align?: 'left' | 'center' | 'right';
}

/**
 * The 18 output columns: the authority workbook's A → Q, plus employee_status in R.
 *
 * R is APPENDED rather than inserted. The report now reports both populations, so a row's
 * Active/Inactive state has to be on the face of it — but the authority layout above pins
 * A → Q and its four merges (A1:D1, F1:I1, J1:M1, N1:Q1), so inserting the column next to
 * the other employee details would have shifted every leave group one column right and
 * broken every merge. Appending leaves A → Q byte-identical to the supplied workbook.
 *
 * It is also in the catalogs at the same last position, so the screen and this workbook show
 * the same columns in the same order — the two disagreeing is the defect class this whole
 * module exists to prevent.
 */
export const LEAVE_BALANCE_COLUMNS: LeaveBalanceColumn[] = [
  { key: 'emp_code',        label: 'EmpCode',      format: 'text',   width: 10,             align: 'center' },
  { key: 'emp_name',        label: 'EmpName',      format: 'text',   width: 32,             align: 'left'   },
  { key: 'branch_name',     label: 'BranchName',   format: 'text',   width: 12.28515625,    align: 'left'   },
  { key: 'cost_center',     label: 'Cost Center',  format: 'text',   width: 22,             align: 'left'   },
  { key: 'process_name',    label: 'Process Name', format: 'text',   width: 22,             align: 'left'   },

  { key: 'cl_current',      label: 'CL',           format: 'number', width: 3,              align: 'center' },
  { key: 'ml_current',      label: 'ML',           format: 'number', width: 3.7109375,      align: 'center' },
  { key: 'el_current',      label: 'EL',           format: 'number', width: 3,              align: 'center' },
  { key: 'ptl_mtl_current', label: 'PTL/MTL',      format: 'number', width: 8.5703125,      align: 'center' },

  { key: 'cl_taken',        label: 'CL',           format: 'number', width: 3.5703125,      align: 'center' },
  { key: 'ml_taken',        label: 'ML',           format: 'number', width: 3.7109375,      align: 'center' },
  { key: 'el_taken',        label: 'EL',           format: 'number', width: 3,              align: 'center' },
  { key: 'ptl_mtl_taken',   label: 'PTL/MTL',      format: 'number', width: 8.5703125,      align: 'center' },

  { key: 'cl_remain',       label: 'CL',           format: 'number', width: 4.28515625,     align: 'center' },
  { key: 'ml_remain',       label: 'ML',           format: 'number', width: 3.7109375,      align: 'center' },
  { key: 'el_remain',       label: 'EL',           format: 'number', width: 3,              align: 'center' },
  { key: 'ptl_mtl_remain',  label: 'PTL/MTL',      format: 'number', width: 8.5703125,      align: 'center' },

  { key: 'employee_status', label: 'Employee Status', format: 'text', width: 14,            align: 'center' },
];

/** Worksheet row 1 / table header row 1 — grouped spans. Must sum to LEAVE_BALANCE_COLUMNS.length. */
export const LEAVE_BALANCE_HEADER_GROUPS = [
  { label: 'Emp Details',   colSpan: 4 },
  { label: '',              colSpan: 1 }, // E1 stays blank and unmerged
  { label: 'Current Leave', colSpan: 4 },
  { label: 'Leave Taken',   colSpan: 4 },
  { label: 'Leave Remain',  colSpan: 4 },
  { label: '',              colSpan: 1 }, // R1 blank and unmerged, above Employee Status
];

/** Keys whose zero value must render as a blank cell (Leave Taken group only). */
export const LEAVE_BALANCE_BLANK_WHEN_ZERO = new Set([
  'cl_taken', 'ml_taken', 'el_taken', 'ptl_mtl_taken',
]);

export const LEAVE_BALANCE_NUMERIC_KEYS = LEAVE_BALANCE_COLUMNS
  .filter(c => c.format === 'number')
  .map(c => c.key);

// ── Naming helpers ─────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function splitMonth(month: string): { year: number; monthIndex: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) {
    const now = new Date();
    return { year: now.getFullYear(), monthIndex: now.getMonth() };
  }
  return { year: Number(m[1]), monthIndex: Number(m[2]) - 1 };
}

/**
 * Resolve the reporting month (YYYY-MM) in the application's local business
 * timezone, falling back to the current month when absent or malformed.
 *
 * Deliberately avoids `new Date().toISOString().slice(0, 7)`: that is a UTC
 * substring, and in IST (UTC+05:30) it yields the PREVIOUS month for the first
 * 5.5 hours of every month — silently producing a report for the wrong period.
 */
export function businessMonth(value: unknown): string {
  const text = String(value ?? '').trim();
  if (/^\d{4}-\d{2}$/.test(text)) return text;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Worksheet name, e.g. 2026-07 → "Leave Balance July'26 month"
 * (matches the authority workbook's sheet name exactly).
 */
export function leaveBalanceSheetName(month: string): string {
  const { year, monthIndex } = splitMonth(month);
  const yy = String(year % 100).padStart(2, '0');
  return `Leave Balance ${MONTH_NAMES[monthIndex]}'${yy} month`;
}

/** Download filename, e.g. 2026-07 → "Leave_Balance_July_2026.xlsx" */
export function leaveBalanceFileName(month: string): string {
  const { year, monthIndex } = splitMonth(month);
  return `Leave_Balance_${MONTH_NAMES[monthIndex]}_${year}.xlsx`;
}

// ── Workbook builder ───────────────────────────────────────────────────────────

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top:    { style: 'thin', color: { argb: 'FF000000' } },
  left:   { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } },
  right:  { style: 'thin', color: { argb: 'FF000000' } },
};

const BASE_FONT = { name: 'Calibri', size: 11 };

/** Leave values use at most two decimals; never round half-days to integers. */
export function roundLeaveValue(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export interface LeaveBalanceWorkbookParams {
  /** Full filtered dataset — NOT limited to a preview page. */
  rows: Record<string, unknown>[];
  /** Reporting month in YYYY-MM. */
  month: string;
}

/**
 * Build the Leave Balance workbook exactly matching the authority file.
 *
 * Deliberately omits: logo, summary cards, report title row, generated-at
 * timestamp row, grand-total row, styled Excel table and any fill colour.
 */
export async function buildLeaveBalanceWorkbook(
  params: LeaveBalanceWorkbookParams
): Promise<Buffer> {
  const { rows, month } = params;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'MAS PeopleOS';

  const ws = wb.addWorksheet(leaveBalanceSheetName(month), {
    views: [{ showGridLines: false }],
  });

  ws.columns = LEAVE_BALANCE_COLUMNS.map(c => ({ key: c.key, width: c.width }));

  // ── Row 1: grouped headers ───────────────────────────────────────────────────
  const groupRow = ws.getRow(1);
  let col = 1;
  for (const group of LEAVE_BALANCE_HEADER_GROUPS) {
    if (group.label !== '') {
      groupRow.getCell(col).value = group.label;
      if (group.colSpan > 1) {
        ws.mergeCells(1, col, 1, col + group.colSpan - 1);
      }
    }
    col += group.colSpan;
  }
  groupRow.height = 15;

  // ── Row 2: column headers ────────────────────────────────────────────────────
  const headerRow = ws.getRow(2);
  LEAVE_BALANCE_COLUMNS.forEach((c, i) => {
    headerRow.getCell(i + 1).value = c.label;
  });

  // Style both header rows across the full 17-column span.
  for (const rowNumber of [1, 2]) {
    const row = ws.getRow(rowNumber);
    for (let i = 1; i <= LEAVE_BALANCE_COLUMNS.length; i++) {
      const cell = row.getCell(i);
      cell.font = { ...BASE_FONT, bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = { ...THIN_BORDER };
    }
    row.commit?.();
  }

  // ── Data rows ────────────────────────────────────────────────────────────────
  for (const source of rows) {
    const excelRow = ws.addRow([]);

    LEAVE_BALANCE_COLUMNS.forEach((c, i) => {
      const cell = excelRow.getCell(i + 1);
      const raw = source[c.key];

      if (c.format === 'number') {
        const n = roundLeaveValue(raw);
        // Leave Taken zeros must be genuinely blank, matching the attachment.
        if (n === 0 && LEAVE_BALANCE_BLANK_WHEN_ZERO.has(c.key)) {
          cell.value = null;
        } else {
          cell.value = n;
          cell.numFmt = '0.##';
        }
      } else {
        const text = raw === null || raw === undefined ? '' : String(raw);
        cell.value = text;
        // Employee code stored as text so leading zeros are preserved.
        if (c.key === 'emp_code') cell.numFmt = '@';
      }

      cell.font = { ...BASE_FONT };
      cell.alignment = { horizontal: 'center' };
      cell.border = { ...THIN_BORDER };
    });

    excelRow.commit?.();
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
