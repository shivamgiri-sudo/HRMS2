import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildSecureXlsxBuffer } from '../xlsx-secure-builder.js';

const base = { reportName: 'Employee Master', requestReference: 'RPT-2026-000001', requesterEmployeeCode: 'E1', scopeSummary: 'ALL BRANCHES' };

async function load(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

describe('buildSecureXlsxBuffer (streaming writer)', () => {
  it('writes header, data and metadata sheets and escapes formulas', async () => {
    const rows = [
      { employee_code: '000123', name: '=HYPERLINK("x")', salary: 42 },
      { employee_code: '000124', name: 'Asha', salary: null },
    ];
    const wb = await load(await buildSecureXlsxBuffer({ ...base, filters: { branch: 'NOIDA' }, rows, totalRows: rows.length }));
    const data = wb.getWorksheet('REPORT DATA')!;
    expect(data.rowCount).toBe(3);
    expect(data.getRow(1).getCell(1).value).toBe('EMPLOYEE_CODE');
    expect(data.getRow(1).font?.bold).toBe(true);
    expect(data.getRow(2).getCell(1).value).toBe('000123'); // leading zeros kept
    expect(String(data.getRow(2).getCell(2).value)).toBe(`'=HYPERLINK("x")`); // formula escaped
    const meta = wb.getWorksheet('REPORT METADATA')!;
    expect(meta.getRow(2).getCell(2).value).toBe('Employee Master');
    expect(JSON.stringify(meta.getSheetValues())).toContain('BRANCH');
  });

  it('handles tens of thousands of rows quickly without holding the whole workbook', async () => {
    const rows = Array.from({ length: 30_000 }, (_, i) => ({ employee_code: String(i).padStart(6, '0'), a: `v${i}`, b: i }));
    const started = Date.now();
    const buf = await buildSecureXlsxBuffer({ ...base, filters: {}, rows, totalRows: rows.length, skipSizeCap: true });
    expect(Date.now() - started).toBeLessThan(15_000);
    const wb = await load(buf);
    expect(wb.getWorksheet('REPORT DATA')!.rowCount).toBe(30_001);
  }, 60_000);

  it('still writes a notice sheet when there are no rows', async () => {
    const wb = await load(await buildSecureXlsxBuffer({ ...base, filters: {}, rows: [], totalRows: 0 }));
    expect(String(wb.getWorksheet('REPORT DATA')!.getRow(1).getCell(1).value)).toContain('NO DATA');
  });
});
