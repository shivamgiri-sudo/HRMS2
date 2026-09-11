/**
 * Escapes a single cell value for safe CSV export.
 *
 * Prevents CSV formula injection: cells starting with =, +, -, @, tab, or CR
 * are prefixed with a single quote so Excel/Sheets treat them as text, not
 * formulas. Double quotes are escaped per RFC 4180.
 */
export function safeCsvCell(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  const FORMULA_STARTERS = /^[=+\-@\t\r]/;
  const escaped = str.includes('"') ? str.replace(/"/g, '""') : str;
  const needsQuotes = escaped.includes(",") || escaped.includes("\n") || escaped.includes('"');
  const safeStr = FORMULA_STARTERS.test(str) ? `'${escaped}` : escaped;
  return needsQuotes || FORMULA_STARTERS.test(str) ? `"${safeStr}"` : safeStr;
}

/**
 * Builds a CSV row from an array of values.
 * Each cell is sanitized with safeCsvCell.
 */
export function buildCsvRow(cells: unknown[]): string {
  return cells.map(safeCsvCell).join(",");
}

/**
 * Triggers a CSV file download in the browser.
 */
export function downloadCsv(rows: unknown[][], filename: string): void {
  const csv = rows.map(buildCsvRow).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
