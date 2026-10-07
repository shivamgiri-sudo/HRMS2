/**
 * Secure XLSX builder using ExcelJS streaming writer.
 *
 * Security controls enforced here:
 *   - Formula injection: leading =, +, -, @ characters are escaped with a single-quote prefix.
 *   - Leading-zero preservation: employee codes, PF numbers, bank accounts written as text cells.
 *   - Row count cap: throws XlsxRowLimitError when totalRows > MAX_XLSX_ROWS.
 *   - File size cap: throws XlsxFileSizeError when buffer > REPORT_ATTACHMENT_MAX_BYTES.
 *   - Filename sanitisation: strips directory traversal; enforces safe pattern.
 *
 * ExcelJS 4.4.0 supports a true streaming writer (addRow flushes to a stream without
 * accumulating the full workbook in memory). This file uses the streaming API.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import ExcelJS from 'exceljs';
import type { ExecResult } from './executors/types.js';

// ── Configurable thresholds (read from env with defaults) ──────────────────────
const MAX_XLSX_ROWS = Number(process.env.REPORT_MAX_XLSX_ROWS ?? 100_000);
const ATTACHMENT_MAX_BYTES = Number(process.env.REPORT_ATTACHMENT_MAX_BYTES ?? 20_971_520); // 20 MB

// Columns whose values must be preserved as text (leading zeros matter)
const TEXT_COLUMN_PATTERNS = [
  /employee[_\s]code/i,
  /emp[_\s]?code/i,
  /pf[_\s]?number/i,
  /uan/i,
  /esic/i,
  /pan/i,
  /bank[_\s]?acc/i,
  /account[_\s]?number/i,
  /mobile/i,
  /phone/i,
  /ifsc/i,
];

// ── Error classes ──────────────────────────────────────────────────────────────

export class XlsxRowLimitError extends Error {
  constructor(public readonly rowCount: number, public readonly limit: number) {
    super(`Row count ${rowCount} exceeds limit ${limit}`);
    this.name = 'XlsxRowLimitError';
  }
}

export class XlsxFileSizeError extends Error {
  constructor(public readonly bytes: number, public readonly limit: number) {
    super(`File size ${bytes} bytes exceeds limit ${limit} bytes`);
    this.name = 'XlsxFileSizeError';
  }
}

// ── Formula injection sanitiser ────────────────────────────────────────────────

function sanitiseCellValue(value: unknown, columnName: string): unknown {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  const str = String(value);

  // Escape formula injection: leading =, +, -, @, \t, \r
  if (/^[=+\-@\t\r]/.test(str)) return "'" + str;

  return str;
}

function isTextColumn(columnName: string): boolean {
  return TEXT_COLUMN_PATTERNS.some(p => p.test(columnName));
}

// ── Filename sanitiser ─────────────────────────────────────────────────────────

/**
 * Builds the download filename for a report export.
 *
 * `reportName` must be the human-readable report name shown in the UI (e.g.
 * catalogEntry.name / report_name_snapshot) — NOT the internal report code.
 * The file a user downloads must read as the same report they picked on
 * screen; using the code here produced filenames like "PUNCH_RAW_EXPORT_..."
 * for a report the UI labelled "Punch Raw Data Export".
 */
export function buildSecureFilename(reportName: string, requestReference: string): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const name = reportName.toUpperCase().trim().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const ref = requestReference.replace(/[^A-Z0-9_\-]/gi, '_');
  return `${name}_${ref}_${dateStr}.xlsx`;
}

// ── Main builder ───────────────────────────────────────────────────────────────

export interface XlsxBuildParams {
  reportName: string;
  requestReference: string;
  requesterEmployeeCode: string;
  filters: Record<string, unknown>;
  /** isSuperAdmin/branchScope summary for metadata sheet */
  scopeSummary: string;
  /** All data rows; may have been accumulated across keyset chunks */
  rows: Record<string, unknown>[];
  totalRows: number; // matches rows.length for normal runs; may be lower if row-limit hit
  /**
   * Skip the 20 MB size cap. Set true for restricted/link-delivery reports where the file
   * is stored on disk and sent as a download link — the cap only applies to email attachments.
   */
  skipSizeCap?: boolean;
}

export async function buildSecureXlsxBuffer(params: XlsxBuildParams): Promise<Buffer> {
  const { rows, totalRows } = params;

  // Row count guard
  if (totalRows > MAX_XLSX_ROWS) {
    throw new XlsxRowLimitError(totalRows, MAX_XLSX_ROWS);
  }

  // Streaming writer: rows are flushed to a temp file as they are added, so a 60,000-row
  // report does not hold the whole workbook (4M+ cells) in memory or block the event loop.
  // The previous in-memory ExcelJS.Workbook took 20+ minutes on the 59k-row employee master
  // and was killed by the stale-job sweeper before it finished.
  const tmpPath = path.join(os.tmpdir(), `report-${randomUUID()}.xlsx`);
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: tmpPath,
    useStyles: true,
    useSharedStrings: false,
  });
  wb.creator = 'MAS PeopleOS';

  try {
    // ── Sheet 1: REPORT DATA ───────────────────────────────────────────────────
    const dataSheet = wb.addWorksheet('REPORT DATA', {
      views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
    });

    if (rows.length > 0) {
      const columnKeys = Object.keys(rows[0]);

      dataSheet.columns = columnKeys.map(key => ({
        header: key.toUpperCase(),
        key,
        width: Math.max(key.length + 4, 18),
        style: isTextColumn(key)
          ? { numFmt: '@' } // @ = text format — preserves leading zeros
          : undefined,
      }));

      const header = dataSheet.getRow(1);
      header.font = { bold: true };
      header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F0' } };
      header.commit();

      for (const row of rows) {
        const sanitised: Record<string, unknown> = {};
        for (const key of columnKeys) {
          sanitised[key] = sanitiseCellValue(row[key], key);
        }
        dataSheet.addRow(sanitised).commit();
      }
    } else {
      dataSheet.addRow(['NO DATA RETURNED FOR THE SELECTED FILTERS']).commit();
    }
    await dataSheet.commit();

    // ── Sheet 2: REPORT METADATA ───────────────────────────────────────────────
    const metaSheet = wb.addWorksheet('REPORT METADATA');
    metaSheet.columns = [{ width: 36 }, { width: 62 }];

    const now = new Date().toISOString();
    const metaRows: [string, string][] = [
      ['FIELD', 'VALUE'],
      ['REPORT NAME',                  params.reportName],
      ['REQUEST REFERENCE',            params.requestReference],
      ['REQUESTER EMPLOYEE CODE',      params.requesterEmployeeCode],
      ['GENERATED AT (UTC)',           now],
      ['ROW COUNT',                    String(rows.length)],
      ['CONFIDENTIALITY',              'CONFIDENTIAL — DO NOT FORWARD OUTSIDE AUTHORISED RECIPIENTS'],
      ['',                             ''],
      ['DATA SCOPE',                   params.scopeSummary],
    ];

    const filterEntries = Object.entries(params.filters);
    if (filterEntries.length > 0) {
      metaRows.push(['', ''], ['FILTERS APPLIED', '']);
      for (const [k, v] of filterEntries) {
        metaRows.push([k.toUpperCase(), String(sanitiseCellValue(v, k))]);
      }
    }

    metaRows.forEach(([field, value], i) => {
      const r = metaSheet.getRow(i + 1);
      r.values = [field, value];
      if (i === 0) r.font = { bold: true };
      r.commit();
    });
    await metaSheet.commit();

    await wb.commit();
    const buffer = await fs.promises.readFile(tmpPath);

    // File size guard — only applies when the file is delivered as an email attachment.
    // Link-delivery reports (restricted/highly_restricted) bypass this cap because the
    // file is stored on disk and sent as a signed download URL, not an attachment.
    if (!params.skipSizeCap && buffer.length > ATTACHMENT_MAX_BYTES) {
      throw new XlsxFileSizeError(buffer.length, ATTACHMENT_MAX_BYTES);
    }

    return buffer;
  } finally {
    await fs.promises.rm(tmpPath, { force: true }).catch(() => undefined);
  }
}

// ── ExecResult → XlsxBuildParams row accumulator ──────────────────────────────

/**
 * Strip the internal keyset cursor field (_cursor) from executor output rows.
 * Each executor adds _cursor for pagination; it must not appear in XLSX output.
 */
export function stripCursorField(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map(row => {
    const { _cursor: _, ...rest } = row as Record<string, unknown> & { _cursor?: unknown };
    return rest;
  });
}
