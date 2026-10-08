/**
 * Catalog-driven XLSX builder for single-header-row reports.
 *
 * Writes the report catalog's column labels verbatim, so the exported header
 * reads exactly as the business format specifies ("SR#", "LEAVE TYPE",
 * "LEAVE REQUST DATE") rather than the generic builder's uppercased,
 * underscore-joined row keys ("SR_NO", "LEAVE_TYPE", "LEAVE_REQUEST_DATE").
 *
 * Deliberately omits the metadata sheet, fill colours and the styled Excel
 * table that the generic report workbook adds.
 *
 * Reports needing merged/grouped headers use their own builder — see
 * leave-balance-format.ts.
 */

import ExcelJS from 'exceljs';

export interface CatalogWorkbookColumn {
  key: string;
  label: string;
  format?: string;
  width?: number;
  align?: 'left' | 'center' | 'right';
}

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top:    { style: 'thin', color: { argb: 'FF000000' } },
  left:   { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } },
  right:  { style: 'thin', color: { argb: 'FF000000' } },
};

const BASE_FONT = { name: 'Calibri', size: 11 };

/** Columns whose values must stay text so leading zeros survive. */
const TEXT_KEYS = /employee_code|emp_code|pf_number|uan|esic|pan|bank_acc|account_number|mobile|phone|ifsc/i;

export interface CatalogWorkbookParams {
  rows: Record<string, unknown>[];
  columns: CatalogWorkbookColumn[];
  sheetName: string;
}

/** Escape leading =, +, -, @ so Excel cannot interpret a value as a formula. */
function sanitise(value: unknown): string {
  const str = String(value);
  return /^[=+\-@\t\r]/.test(str) ? "'" + str : str;
}

export async function buildCatalogWorkbook(params: CatalogWorkbookParams): Promise<Buffer> {
  const { rows, columns, sheetName } = params;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'MAS PeopleOS';
  const ws = wb.addWorksheet(sheetName.slice(0, 31), { views: [{ showGridLines: false }] });

  ws.columns = columns.map(c => ({
    key: c.key,
    // Catalog widths are UI pixels; convert to a sensible Excel character width.
    width: Math.max(10, Math.round((c.width ?? 120) / 7)),
  }));

  // ── Header row ───────────────────────────────────────────────────────────────
  const header = ws.getRow(1);
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.label;
    cell.font = { ...BASE_FONT, bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { ...THIN_BORDER };
  });
  header.commit?.();

  // ── Data rows ────────────────────────────────────────────────────────────────
  for (const source of rows) {
    const row = ws.addRow([]);
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const raw = source[c.key];

      if (raw === null || raw === undefined || raw === '') {
        cell.value = '';
      } else if (c.format === 'number' && !TEXT_KEYS.test(c.key)) {
        const n = Number(raw);
        cell.value = Number.isFinite(n) ? Math.round(n * 100) / 100 : sanitise(raw);
        if (Number.isFinite(n)) cell.numFmt = Number.isInteger(Math.round(n * 100) / 100) ? '0' : '0.##';
      } else {
        cell.value = sanitise(raw);
        if (TEXT_KEYS.test(c.key)) cell.numFmt = '@';
      }

      cell.font = { ...BASE_FONT };
      cell.alignment = { horizontal: c.align ?? 'left', vertical: 'middle' };
      cell.border = { ...THIN_BORDER };
    });
    row.commit?.();
  }

  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1, showGridLines: false }];

  return Buffer.from(await wb.xlsx.writeBuffer());
}
