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
