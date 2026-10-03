/**
 * CSV import for the Utilization tab's WFM inputs. The header row uses the same labels as
 * "Utilization Format.xlsx" (see UTILIZATION_COLUMNS). The hand-entered columns are read, and so are the sheet's
 * calculated columns (Utilization Forecast, with/without Adhoc and their %, POA Answering,
 * Escalated %) - those are stored as the uploaded static values, no formula applied. The report
 * columns (Actual Task, POA Live, AHT, GD%, ...) come from the uploaded reports and are ignored,
 * so a sheet exported from the WFM workbook can be imported as-is.
 */

export interface ImportRow {
  inputDate: string;
  forecastTask: string;
  forecastTaskPoa: string;
  manualFarCases: string;
  adhocTime: string;
  analystQc: string;
  facialChecks: string;
  crossTrainingTaskPoa: string;
  poaLiveAuditsPq: string;
  fixedUtilizationForecast: string;
  fixedUtilizationWithAdhoc: string;
  fixedUtilizationWithoutAdhoc: string;
  fixedUtilizationWithAdhocPct: string;
  fixedUtilizationWithoutAdhocPct: string;
  fixedPoaAnsweringPct: string;
  fixedEscalatedPct: string;
  remarks: string;
}

export interface ImportParse { rows: ImportRow[]; errors: string[] }

/**
 * ONE source of truth for the Utilization sheet's columns: template download, CSV header matching
 * and the page's table all read this list, in this order (column letters follow the sheet's
 * formulas: D Forecasted Task ... Z Escalated Task). `field` is the ImportRow key for columns WFM
 * uploads; `source` columns come from the uploaded Onfido reports and are not imported.
 * NOTE: the order was reconstructed from the sheet's formula column letters; the user's
 * "Utilization Format" file was not available, so confirm it against that file and edit here only.
 */
export type UtilizationColumn =
  | { header: string; field: keyof ImportRow; kind: "num" | "pct" | "date" | "text" }
  | { header: string; source: "month" | "wc" | "actualTask" | "poaLive" | "aht" | "poaAht" | "gd" | "mcn" | "sla" | "aps" | "escalatedTask" };

export const UTILIZATION_COLUMNS: readonly UtilizationColumn[] = [
  { header: "Date", field: "inputDate", kind: "date" },
  { header: "Month", source: "month" },
  { header: "WC", source: "wc" },
  { header: "Forecasted Task", field: "forecastTask", kind: "num" },
  { header: "Forecasted Task POA", field: "forecastTaskPoa", kind: "num" },
  { header: "Utilization Forecast", field: "fixedUtilizationForecast", kind: "num" },
  { header: "Actual Task", source: "actualTask" },
  { header: "Manual FAR Case", field: "manualFarCases", kind: "num" },
  { header: "POA Live", source: "poaLive" },
  { header: "Adhoc Time", field: "adhocTime", kind: "num" },
  { header: "Analyst QC", field: "analystQc", kind: "num" },
  { header: "Facial checks", field: "facialChecks", kind: "num" },
  { header: "Cross training task POA", field: "crossTrainingTaskPoa", kind: "num" },
  { header: "POA Live Audits / POA PQ Audits", field: "poaLiveAuditsPq", kind: "num" },
  { header: "AHT", source: "aht" },
  { header: "POA AHT", source: "poaAht" },
  { header: "GD%", source: "gd" },
  { header: "MCN%", source: "mcn" },
  { header: "SLA", source: "sla" },
  { header: "APS", source: "aps" },
  { header: "Utilization with Adhoc", field: "fixedUtilizationWithAdhoc", kind: "num" },
  { header: "Utilization without Adhoc", field: "fixedUtilizationWithoutAdhoc", kind: "num" },
  { header: "Utilization with Adhoc %", field: "fixedUtilizationWithAdhocPct", kind: "pct" },
  { header: "Utilization without Adhoc %", field: "fixedUtilizationWithoutAdhocPct", kind: "pct" },
  { header: "POA Answering", field: "fixedPoaAnsweringPct", kind: "pct" },
  { header: "Escalated Task", source: "escalatedTask" },
  { header: "Escalated %", field: "fixedEscalatedPct", kind: "pct" },
  { header: "Remarks", field: "remarks", kind: "text" },
];

/** Header row of the downloadable template (exactly the page columns, same order). */
export const UTILIZATION_TEMPLATE_HEADERS: readonly string[] = UTILIZATION_COLUMNS.map((c) => c.header);

export function utilizationTemplateCsv(): string {
  return `${UTILIZATION_TEMPLATE_HEADERS.join(",")}\n`;
}

const normHeader = (h: string) => h.toLowerCase().replace(/\s+/g, " ").trim();

const HEADER_TO_FIELD: Record<string, keyof ImportRow> = {
  ...Object.fromEntries(
    UTILIZATION_COLUMNS.flatMap((c) => ("field" in c ? [[normHeader(c.header), c.field] as const] : [])),
  ),
  // spelling variants seen in the WFM workbook
  "utilization forecaste": "fixedUtilizationForecast",
  "manual far cases": "manualFarCases",
  "poa answering %": "fixedPoaAnsweringPct",
};

/** Any numeric cell: "85.2%" -> "85.2", "1,234" -> "1234", "-" / "N/A" -> blank. Kept as text; no calculation. */
export function cleanNumericCell(v: string): string {
  const t = v.replace(/[\s\u00a0]/g, "");
  if (t === "" || /^(-|--|n\/a|na|null|#n\/a|#div\/0!|#value!|#ref!)$/i.test(t)) return "";
  const neg = /^\(.*\)$/.test(t);
  const num = t.replace(/^\(|\)$/g, "").replace(/%$/, "").replace(/,/g, "").replace(/^[$\u20b9]/, "");
  return Number.isFinite(Number(num)) && num !== "" ? (neg ? `-${num}` : num) : v.trim();
}

/** Splits one CSV record, honouring double-quoted fields and "" escapes. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** 2026-07-01, 01/07/2026 or 01-07-2026 -> 2026-07-01; null when it is not a real date. */
export function normaliseImportDate(raw: string): string | null {
  const t = raw.trim();
  let y: string; let m: string; let d: string;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t);
  if (iso) [, y, m, d] = iso;
  else if (dmy) { d = dmy[1].padStart(2, "0"); m = dmy[2].padStart(2, "0"); y = dmy[3]; }
  else return null;
  const date = new Date(`${y}-${m}-${d}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === `${y}-${m}-${d}` ? `${y}-${m}-${d}` : null;
}

export function parseUtilizationCsv(text: string): ImportParse {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return { rows: [], errors: ["The file needs a header row and at least one data row."] };
  const headers = splitCsvLine(lines[0]).map(normHeader);
  const fieldAt = headers.map((h) => HEADER_TO_FIELD[h]);
  if (!fieldAt.includes("inputDate")) return { rows: [], errors: ["The header row must include a Date column."] };
  if (fieldAt.filter((f) => f && f !== "inputDate" && f !== "remarks").length === 0) {
    return { rows: [], errors: ["None of the input columns (Forecasted Task, Adhoc Time, Utilization Forecast, ...) were found in the header row."] };
  }
  const rows: ImportRow[] = [];
  const errors: string[] = [];
  lines.slice(1).forEach((line, idx) => {
    const cells = splitCsvLine(line);
    const row: ImportRow = {
      inputDate: "", forecastTask: "", forecastTaskPoa: "", manualFarCases: "", adhocTime: "",
      analystQc: "", facialChecks: "", crossTrainingTaskPoa: "", poaLiveAuditsPq: "",
      fixedUtilizationForecast: "", fixedUtilizationWithAdhoc: "", fixedUtilizationWithoutAdhoc: "",
      fixedUtilizationWithAdhocPct: "", fixedUtilizationWithoutAdhocPct: "", fixedPoaAnsweringPct: "", fixedEscalatedPct: "",
      remarks: "",
    };
    fieldAt.forEach((field, col) => {
      if (!field) return;
      const cell = cells[col] ?? "";
      row[field] = field === "inputDate" || field === "remarks" ? cell : cleanNumericCell(cell);
    });
    const date = normaliseImportDate(row.inputDate);
    if (!date) {
      // A blank-date line (a totals row, for instance) is skipped; a non-blank bad date is reported.
      if (row.inputDate.trim() !== "" && row.inputDate.trim().toUpperCase() !== "MTD") errors.push(`Row ${idx + 2}: "${row.inputDate}" is not a valid date.`);
      return;
    }
    rows.push({ ...row, inputDate: date });
  });
  return { rows, errors };
}
