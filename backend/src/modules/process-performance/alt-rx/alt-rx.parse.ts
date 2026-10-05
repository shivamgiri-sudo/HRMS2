import * as XLSX from "xlsx";
import { EXPECTED_COLUMNS, REQUIRED_COLUMNS, type DumpRow } from "./alt-rx.engine.js";

/**
 * Reads an uploaded ALT RX Dump (.xlsx / .xls / .csv) into rows keyed by its own column headers.
 * Only the rules the MIS depends on are enforced here; anything else is kept as uploaded so the
 * MIS "Dump" sheet can reproduce the file. Errors are written for the MIS user, not the developer.
 */

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const ALLOWED_EXT = [".xlsx", ".xls", ".csv"];

export class AltRxParseError extends Error {
  constructor(message: string, readonly detail?: string) { super(message); }
}

export interface ParsedDump {
  fileName: string;
  sheetName: string;
  columns: string[];
  /** Expected Dump columns that are not in the file. Warnings only. */
  missingExpected: string[];
  /** Columns the uploader does not know. Kept as uploaded in the MIS Dump sheet. */
  unexpected: string[];
  rows: DumpRow[];
}

export function parseDump(buffer: Buffer, fileName: string): ParsedDump {
  const lower = fileName.toLowerCase();
  const ext = ALLOWED_EXT.find((e) => lower.endsWith(e));
  if (!ext) throw new AltRxParseError("Wrong file type. Upload the Dump as .xlsx, .xls or .csv.");
  if (!buffer || buffer.length === 0) throw new AltRxParseError("The file is empty.");
  if (buffer.length > MAX_UPLOAD_BYTES) throw new AltRxParseError("The file is larger than 15 MB. Split it or export a smaller date range.");

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "buffer", cellDates: true, dense: false });
  } catch {
    throw new AltRxParseError("The file could not be read. Check that it is not corrupted or password-protected.");
  }
  const sheetName = wb.SheetNames.includes("Dump") ? "Dump" : wb.SheetNames[0];
  if (!sheetName) throw new AltRxParseError("The workbook has no sheets.");
  const sheet = wb.Sheets[sheetName];

  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true });
  const header = (grid[0] ?? []).map((h) => String(h ?? "").trim());
  const columns = header.filter((h) => h.length > 0);
  if (columns.length === 0) throw new AltRxParseError("No column headers found in the first row.");

  const missing = REQUIRED_COLUMNS.filter((c) => !columns.includes(c));
  if (missing.length) {
    throw new AltRxParseError(
      `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`,
      "Recommended correction: re-export the Dump from the ticketing tool with these columns included.",
    );
  }

  const rows: DumpRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const values = grid[r] ?? [];
    if (values.every((v) => v === null || v === "")) continue; // blank line
    const rec: DumpRow = {};
    header.forEach((h, i) => { if (h) rec[h] = values[i] ?? null; });
    rows.push(rec);
  }
  if (rows.length === 0) throw new AltRxParseError("The Dump has headers but no data rows.");

  // The source Dump already carries the helper columns the MIS adds; they are known, not unexpected.
  const HELPERS = ["Creation Date", "Creation Time", "FRT Date", "FRT Time", "Resolved Date", "Resolved Time", "FRT Duration", "TAT", "Status", "Brand", "Week"];
  const known = new Set<string>([...EXPECTED_COLUMNS, ...REQUIRED_COLUMNS, ...HELPERS]);
  const missingExpected = EXPECTED_COLUMNS.filter((c) => !columns.includes(c));
  const unexpected = columns.filter((c) => !known.has(c));
  return { fileName, sheetName, columns, missingExpected, unexpected, rows };
}
