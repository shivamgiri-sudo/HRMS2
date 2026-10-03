import * as XLSX from "xlsx";

/** Codes whose workbook has one sheet per campaign; the chosen sheet name is injected as a `Campaign` column. */
export const SHEET_NAME_AS_CAMPAIGN_CODES = new Set(["SBI_CARD_DIALER_MIS"]);

export interface PickedSheet { name: string; headerRow: number; score: number }

/** How many leading rows are scanned for the header row (title rows above it are common in MIS workbooks). */
const HEADER_SCAN_ROWS = 10;

/**
 * Picks the sheet whose header row best matches the template's expected columns. Unlike a first-row-only match, the
 * header may sit in any of the first HEADER_SCAN_ROWS rows (row 1 wins ties, so existing templates behave as before).
 * Ties between sheets prefer fewer unknown columns; a sheet with no matching header (e.g. an empty "-" sheet) never
 * beats one that has a match.
 */
export function pickSheetWithHeader(
  workbook: XLSX.WorkBook, expected: Set<string>, normalize: (cell: string) => string,
): PickedSheet {
  const names = workbook.SheetNames;
  if (names.length === 0) throw new Error("The file has no sheets.");
  let best: PickedSheet = { name: names[0]!, headerRow: 0, score: -1 };
  let bestExtra = Infinity;
  if (expected.size === 0) return best;
  for (const name of names) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: true });
    const limit = Math.min(rows.length, HEADER_SCAN_ROWS);
    for (let i = 0; i < limit; i++) {
      const cells = (rows[i] ?? []).map((c) => String(c ?? "").trim()).filter((c) => c !== "").map(normalize);
      const score = cells.filter((h) => expected.has(h)).length;
      const extra = cells.length - score;
      const better = score > best.score || (score === best.score && score > 0 && extra < bestExtra);
      if (better) { best = { name, headerRow: i, score }; bestExtra = extra; }
    }
  }
  return best;
}

/** Every SBI Card template drops rows with no key/required value (blank spacer / sub-header rows). */
export const isSbiCardCode = (code: string | null | undefined): boolean => String(code ?? "").toUpperCase().startsWith("SBI_CARD_");

/**
 * Drops rows in which none of the required columns has a value (e.g. the "Count Of Agents" sub-header row or blank
 * spare rows). With no required columns, drops rows whose every cell is blank. `ignore` names injected columns
 * (Campaign) that must not count as data.
 */
export function dropBlankRows(
  rows: Array<Record<string, unknown>>, required: string[], normalize: (cell: string) => string, ignore: string[] = [],
): { rows: Array<Record<string, unknown>>; dropped: number } {
  const req = new Set(required.map(normalize));
  const skip = new Set(ignore.map(normalize));
  const kept = rows.filter((r) => Object.entries(r).some(([k, v]) => {
    const nk = normalize(k);
    if (skip.has(nk) || (req.size > 0 && !req.has(nk))) return false;
    return String(v ?? "").trim() !== "";
  }));
  return { rows: kept, dropped: rows.length - kept.length };
}

export interface CampaignSheetsResult {
  rows: Array<Record<string, string>>;
  /** Sheets that contributed at least one row. */
  campaigns: number;
  /** Sheets with no matching header or no data rows. */
  sheetsSkipped: number;
  blankRowsDropped: number;
}

/** One-sheet-per-campaign workbooks: reads EVERY sheet whose header row matches the template, tagging each row
 * `Campaign` = its own sheet name (verbatim); header-less/empty sheets are skipped. */
export function readCampaignSheets(
  workbook: XLSX.WorkBook, expected: Set<string>, normalize: (cell: string) => string, required: string[],
): CampaignSheetsResult {
  const out: CampaignSheetsResult = { rows: [], campaigns: 0, sheetsSkipped: 0, blankRowsDropped: 0 };
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const single = sheet ? pickSheetWithHeader({ ...workbook, SheetNames: [name] } as XLSX.WorkBook, expected, normalize) : null;
    if (!sheet || !single || single.score <= 0) { out.sheetsSkipped++; continue; }
    const raw = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "", raw: false, range: single.headerRow });
    const { rows, dropped } = dropBlankRows(raw, required, normalize, ["Campaign"]);
    out.blankRowsDropped += dropped;
    if (rows.length === 0) { out.sheetsSkipped++; continue; }
    out.campaigns++;
    for (const r of rows) out.rows.push({ ...(r as Record<string, string>), Campaign: name });
  }
  return out;
}

export function describeCampaignRead(r: CampaignSheetsResult): string {
  return `${r.rows.length} rows from ${r.campaigns} campaign(s), ${r.sheetsSkipped} empty/unmatched sheet(s) skipped`
    + (r.blankRowsDropped ? `, ${r.blankRowsDropped} blank row(s) dropped` : "");
}

/** The report day printed above the header of a dialer export: "Time range: 2026-09-28 00:00:00 to 2026-09-28 23:59:59" -> "2026-09-28". */
export function detectTimeRangeDate(sheet: XLSX.WorkSheet, scanRows = HEADER_SCAN_ROWS): string | null {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: true });
  for (let i = 0; i < Math.min(rows.length, scanRows); i++) {
    for (const cell of rows[i] ?? []) {
      const m = /time\s*range\s*:?\s*(\d{4}-\d{2}-\d{2})/i.exec(String(cell ?? ""));
      if (m) return m[1]!;
    }
  }
  return null;
}

/** Excel serial (days since 1899-12-30, fraction = time of day) -> "YYYY-MM-DD HH:mm:ss"; null when not a plausible 2010+ date. */
export function serialToDateTime(n: number): string | null {
  if (!Number.isFinite(n) || n < 40179 || n > 80000) return null;
  const secs = Math.round(n * 86400);
  const d = new Date(Date.UTC(1899, 11, 30) + secs * 1000);
  return d.toISOString().replace("T", " ").slice(0, 19);
}

/** Latest "YYYY-MM-DD" among the given date / date-time strings (the snapshot day of an export that carries call times). */
export function latestDay(values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const v of values) {
    const d = typeof v === "string" ? /^(\d{4}-\d{2}-\d{2})/.exec(v)?.[1] : undefined;
    if (d && (!best || d > best)) best = d;
  }
  return best;
}

/** Call-time columns of the SBI account file whose cells are re-read as raw Excel serials so no locale format reaches the importer. */
export const SBI_ACCOUNT_DATETIME_HEADERS = ["CALLBACK_DT", "CALL1_DT", "CALL2_DT", "CALL3_DT", "CALL4_DT", "CALL5_DT", "CALL6_DT"];

/**
 * Extra header spellings used ONLY to find the header row of exports whose headers drift (the backend column plan does the real mapping,
 * see backend report-column-plan.ts). Without these a renamed header row would score too low to be picked over a title row.
 */
export const HEADER_HINTS: Record<string, string[]> = {
  SBI_CARD_ROSTER: ["Dialer Id", "Agent ID", "Employee ID", "Emp ID", "Agent Name", "Employee Name", "Team Name", "Team Lead", "TL", "TL Name", "Supervisor", "Group Head"],
  SBI_CARD_OUTCOME: [
    "Date", "As On", "As At", "Portfolio", "Opening Count", "Allocated Accounts", "Total Accounts", "Resolved", "Normalized", "Normalised", "Rolled Back", "Roll Back",
    "RES %", "NM %", "RB %", "Resolution Rate", "Normalisation Rate", "Rollback Rate",
  ],
  SBI_CARD_APR: [
    "Agent ID", "Employee ID", "Emp ID", "Employee Code", "Agent Code", "User ID", "Agent Name", "Employee Name", "Total Calls", "Calls Handled",
    "Login Duration", "Total Login Time", "Wait Time", "Idle Time", "Talk Time", "Wrap Time", "Dispo Time", "Pause Time", "Break Time", "Dead Time",
    "First Login", "Last Logout", "Avg Handle Time", "AHT",
  ],
};

/**
 * SBI Card day-end exports are named MAS_AHM_FLOW_NEW_DDMMYYYY / MAS_AHM_FLOW_MANUAL_DDMMYYYY (client mail of 24-Sep-2026): the file name
 * carries the report day and which flow it is. The same ddmmyyyy stamp ends the call-table names.
 */
export function parseExportName(fileName: string): { date: string | null; flow: "NEW" | "MANUAL" | null } {
  const base = fileName.replace(/\.[A-Za-z0-9]+$/, "");
  const flow = /FLOW[_-]MANUAL/i.test(base) ? "MANUAL" : /FLOW[_-]NEW/i.test(base) ? "NEW" : null;
  const m = /(\d{2})(\d{2})(\d{4})(?!\d)/.exec(base);
  let date: string | null = null;
  if (m) { const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]; if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 2020 && y <= 2100) date = `${m[3]}-${m[2]}-${m[1]}`; }
  return { date, flow };
}

/** Rows whose phone-like cells hold a full, unmasked 10-digit number (SBI Card requires reporting exports to be masked). */
export function countUnmaskedPhones(rows: Array<Record<string, unknown>>): number {
  let n = 0;
  for (const r of rows) {
    for (const [k, v] of Object.entries(r)) {
      if (/mobile|phone|contact/i.test(k) && /^\+?\d{10,12}$/.test(String(v ?? "").trim())) { n += 1; break; }
    }
  }
  return n;
}
