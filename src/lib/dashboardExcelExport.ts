/**
 * Generic "export what's on screen" Excel helper for dashboard pages.
 *
 * Requirement: every dashboard page needs an Export/Download to Excel option that
 * captures exactly what is currently displayed — the same figures, tables and
 * calculated numbers a viewer sees — and never a raw/source/backend export. This
 * module only ever turns already-rendered, already-computed values into a
 * workbook; it makes no API calls and touches no database tables of its own. A
 * caller builds `ExcelSheetSpec[]` straight out of the same query results / state
 * that feed the visible cards, tables and charts, so the export can't drift from
 * the screen the user is looking at.
 */
import * as XLSX from "xlsx";

export interface ExcelSheetSpec {
  /** Sheet tab name. Excel caps this at 31 chars — longer names are truncated here. */
  name: string;
  /**
   * Row objects, keyed by the exact column label to show (e.g. "Avg Quality Score (%)").
   * Every row should have the same keys in the same order — build them with a
   * shared `Record<string, string | number>` shape per sheet.
   */
  rows: Record<string, string | number | null>[];
  /** Optional single title line written above the header row (e.g. the KPI summary line). */
  title?: string;
}

function sanitizeSheetName(name: string): string {
  // Excel forbids : \ / ? * [ ] in sheet names and caps length at 31.
  return name.replace(/[:\\/?*[\]]/g, "-").slice(0, 31) || "Sheet";
}

/**
 * Builds one workbook from one or more sheet specs and triggers a browser download.
 * Never writes a formula cell — every value is written as a static string/number,
 * matching the "static values only" requirement used elsewhere for uploads and
 * kept consistent here for exports too.
 */
export function exportDashboardToExcel(fileNamePrefix: string, sheets: ExcelSheetSpec[]) {
  const usableSheets = sheets.filter((s) => s.rows.length > 0);
  if (usableSheets.length === 0) {
    throw new Error("Nothing is currently displayed for this view, so there is nothing to export.");
  }

  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();

  for (const sheet of usableSheets) {
    const aoa: (string | number | null)[][] = [];
    if (sheet.title) aoa.push([sheet.title]);
    const headers = Object.keys(sheet.rows[0]);
    aoa.push(headers);
    for (const row of sheet.rows) aoa.push(headers.map((h) => row[h] ?? null));

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Reasonable default column widths so the export reads like the dashboard
    // instead of Excel's default 8-char columns.
    ws["!cols"] = headers.map((h) => ({ wch: Math.max(12, Math.min(40, h.length + 4)) }));

    let name = sanitizeSheetName(sheet.name);
    let suffix = 2;
    while (usedNames.has(name)) {
      name = sanitizeSheetName(`${sheet.name} (${suffix})`);
      suffix += 1;
    }
    usedNames.add(name);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${fileNamePrefix}_${stamp}.xlsx`);
}
