import * as XLSX from "xlsx";

/**
 * Shared flexible column-mapping parser for the Housing Owner / Housing
 * Premium "Sale Raw + CDR Raw" dashboards -- both prompts explicitly
 * require tolerating column-count mismatches, reordering, extra/missing
 * columns, capitalization and spacing/underscore differences, and refuse
 * to hard-fail an upload for any of that. This is deliberately a
 * different (looser) contract than this codebase's other bulk-upload
 * services, which expect a known exact header set -- these two dashboards
 * were explicitly specified to work against "approximately these fields"
 * from a real-world export that can drift.
 */

/** Normalizes a header string for fuzzy matching: lowercase, strip
 * everything but letters/digits so "Agent_Name", "Agent Name", "AGENT
 * NAME", "agent  name" all collapse to "agentname". */
export function normalizeHeader(raw: unknown): string {
  return String(raw ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface FieldSpec {
  /** Canonical field name used in the normalized row object. */
  key: string;
  /** Every header text this field is known to appear as, real-world variants included. */
  aliases: string[];
}

export interface ParsedSheet {
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  recognizedColumns: string[];
  additionalColumns: string[];
  missingOptionalColumns: string[];
  rows: Record<string, unknown>[];
  /** First 20 rows of the raw (unmapped) sheet, for the upload preview. */
  previewRaw: Record<string, unknown>[];
}

function buildAliasIndex(fields: FieldSpec[]): Map<string, string> {
  const idx = new Map<string, string>();
  for (const f of fields) {
    for (const alias of [f.key, ...f.aliases]) {
      idx.set(normalizeHeader(alias), f.key);
    }
  }
  return idx;
}

/**
 * Parses an uploaded workbook buffer (XLSX/XLS/CSV -- XLSB is read the
 * same way via SheetJS's xlsb codepath) using fuzzy header matching.
 * Never throws on column-count/order mismatches; only genuinely
 * unreadable buffers throw.
 */
export function parseFlexibleSheet(
  buffer: Buffer,
  fields: FieldSpec[],
  dedupeKeyFields: string[],
): ParsedSheet {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, blankrows: false });

  if (raw.length === 0) {
    return {
      totalRows: 0, validRows: 0, duplicateRows: 0,
      recognizedColumns: [], additionalColumns: [], missingOptionalColumns: fields.map((f) => f.key),
      rows: [], previewRaw: [],
    };
  }

  const headerRow = raw[0] as unknown[];
  const aliasIndex = buildAliasIndex(fields);
  // colIndex[fieldKey] = column position in the sheet
  const colIndex = new Map<string, number>();
  const additionalColumns: string[] = [];
  headerRow.forEach((h, i) => {
    const norm = normalizeHeader(h);
    if (!norm) return;
    const fieldKey = aliasIndex.get(norm);
    if (fieldKey && !colIndex.has(fieldKey)) {
      colIndex.set(fieldKey, i);
    } else if (!fieldKey) {
      const label = String(h ?? "").trim();
      if (label) additionalColumns.push(label);
    }
  });

  const recognizedColumns = fields.filter((f) => colIndex.has(f.key)).map((f) => f.key);
  const missingOptionalColumns = fields.filter((f) => !colIndex.has(f.key)).map((f) => f.key);

  const dataRows = raw.slice(1);
  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  let duplicateRows = 0;

  for (const r of dataRows) {
    const arr = r as unknown[];
    if (!arr || arr.every((c) => c === null || c === undefined || String(c).trim() === "")) continue;
    const rec: Record<string, unknown> = {};
    for (const f of fields) {
      const i = colIndex.get(f.key);
      rec[f.key] = i !== undefined ? arr[i] : null;
    }
    const dedupeKey = dedupeKeyFields.map((k) => String(rec[k] ?? "").trim().toLowerCase()).join("|");
    if (dedupeKeyFields.length > 0 && dedupeKey.replace(/\|/g, "") !== "") {
      if (seen.has(dedupeKey)) { duplicateRows++; continue; }
      seen.add(dedupeKey);
    }
    rows.push(rec);
  }

  const previewRaw = dataRows.slice(0, 20).map((r) => {
    const arr = r as unknown[];
    const rec: Record<string, unknown> = {};
    headerRow.forEach((h, i) => { rec[String(h ?? `col${i}`)] = arr?.[i] ?? null; });
    return rec;
  });

  return {
    totalRows: dataRows.filter((r) => (r as unknown[])?.some((c) => c !== null && c !== undefined && String(c).trim() !== "")).length,
    validRows: rows.length,
    duplicateRows,
    recognizedColumns,
    additionalColumns,
    missingOptionalColumns,
    rows,
    previewRaw,
  };
}

/** Excel serial number, "D-M-YYYY", "D-Mon-YY"/"D-Mon-YYYY", or ISO ->
 * "YYYY-MM-DD". Returns null (never guesses) for anything unrecognized. */
export function normalizeDate(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(raw) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const v = String(raw).trim();
  if (!v) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return m[0];
  const MONTHS: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  m = /^(\d{1,2})[-\/]([A-Za-z]{3})[-\/]?(\d{2,4})$/.exec(v);
  if (m && MONTHS[m[2].toLowerCase()]) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  }
  m = /^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})(?:\s|$)/.exec(v);
  if (m) {
    const [, a, b, year] = m;
    // D-M-YYYY is the convention both prompts' own examples use (1-9-2026 = 1 Sep 2026).
    const day = a.padStart(2, "0");
    const month = b.padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return null;
}

/** Excel time fraction, "HH:MM:SS"/"MM:SS", or a bare seconds count -> seconds. */
export function normalizeDurationSeconds(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw > 0 && raw < 1) return Math.round(raw * 86400);
    return Math.round(raw);
  }
  const v = String(raw).trim();
  if (!v) return null;
  let m = /^(\d{1,3}):(\d{2}):(\d{2})$/.exec(v);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  m = /^(\d{1,3}):(\d{2})$/.exec(v);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(v.replace(/,/g, ""));
  if (Number.isFinite(n)) {
    if (n > 0 && n < 1) return Math.round(n * 86400);
    return Math.round(n);
  }
  return null;
}

export function normalizeNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(String(raw).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

export function normalizeText(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  return v || null;
}

/** lowercase, trim, collapse internal whitespace -- the exact normalization
 * both prompts specify for agent/TL name matching. */
export function normalizeName(raw: unknown): string | null {
  const v = String(raw ?? "").trim().replace(/\s+/g, " ");
  return v ? v.toLowerCase() : null;
}
