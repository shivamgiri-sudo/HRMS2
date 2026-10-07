/**
 * Reads a Superbot call report from whatever the portal produced: .xlsx or .xls, a CSV, a tab-separated file, an HTML table saved as .xls, or text pasted
 * from Excel. Looks at every sheet, finds the header row (the one that has "Reference ID" or "Phone Number") even under title rows, and returns the
 * sheet with the most data rows.
 */
export type XlsxLike = { read: (data: unknown, opts: Record<string, unknown>) => { SheetNames: string[]; Sheets: Record<string, unknown> }; utils: { sheet_to_json: <T>(sheet: unknown, opts: Record<string, unknown>) => T[] } };

const norm = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const HEADER_HINTS = new Set(["referenceid", "phonenumber", "uniquecallid", "phone"]);

function gridToRows(grid: unknown[][]): Array<Record<string, unknown>> {
  let h = grid.findIndex((r) => r.some((c) => HEADER_HINTS.has(norm(c))));
  if (h < 0) h = grid.findIndex((r) => r.filter((c) => String(c ?? "").trim() !== "").length >= 3);
  if (h < 0) return [];
  const head = grid[h].map((c) => String(c ?? "").trim());
  return grid.slice(h + 1)
    .filter((r) => r.some((c) => String(c ?? "").trim() !== ""))
    .map((r) => Object.fromEntries(head.map((name, i) => [name || `col${i}`, r[i] ?? ""]).filter(([k]) => k !== "")));
}

function workbookRows(XLSX: XlsxLike, wb: { SheetNames: string[]; Sheets: Record<string, unknown> }): Array<Record<string, unknown>> {
  let best: Array<Record<string, unknown>> = [];
  for (const name of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: "", raw: false });
    const rows = gridToRows(grid);
    if (rows.length > best.length) best = rows;
  }
  return best;
}

/** Text pasted from Excel (tab separated) or a CSV text. */
export function parseReportText(XLSX: XlsxLike, text: string): Array<Record<string, unknown>> {
  const clean = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
  if (!clean) return [];
  const first = clean.split("\n")[0];
  if (first.includes("\t")) return gridToRows(clean.split("\n").map((l) => l.split("\t")));
  return workbookRows(XLSX, XLSX.read(clean, { type: "string", raw: true }));
}

export function parseReportFile(XLSX: XlsxLike, buf: ArrayBuffer, fileName: string): Array<Record<string, unknown>> {
  const bytes = new Uint8Array(buf);
  const looksText = /\.(csv|tsv|txt|html?)$/i.test(fileName) || bytes[0] === 0x3c /* "<" */ || (bytes[0] !== 0x50 && bytes[0] !== 0xd0); // not a zip (xlsx) and not an OLE file (xls)
  if (looksText) {
    const text = new TextDecoder("utf-8").decode(buf);
    try { const asText = parseReportText(XLSX, text); if (asText.length) return asText; } catch { /* not readable as text: try it as a workbook */ }
  }
  try {
    const rows = workbookRows(XLSX, XLSX.read(buf, { type: "array", cellDates: false }));
    if (rows.length) return rows;
  } catch { /* fall through */ }
  try { return parseReportText(XLSX, new TextDecoder("utf-8").decode(buf)); } catch { return []; }
}
