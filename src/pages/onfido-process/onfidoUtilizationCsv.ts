/**
 * CSV import for the Utilization tab's WFM inputs. The header row uses the same labels as
 * "Utilization Format.xlsx". The hand-entered columns are read, and so are the sheet's
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

const HEADER_TO_FIELD: Record<string, keyof ImportRow> = {
  "date": "inputDate",
  "forecasted task": "forecastTask",
  "forecasted task poa": "forecastTaskPoa",
  "manual far case": "manualFarCases",
  "adhoc time": "adhocTime",
  "analyst qc": "analystQc",
  "facial checks": "facialChecks",
  "cross training task poa": "crossTrainingTaskPoa",
  "poa live audits / poa pq audits": "poaLiveAuditsPq",
  "utilization forecast": "fixedUtilizationForecast",
  "utilization forecaste": "fixedUtilizationForecast", // the WFM workbook's own spelling
  "utilization with adhoc": "fixedUtilizationWithAdhoc",
  "utilization without adhoc": "fixedUtilizationWithoutAdhoc",
  "utilization with adhoc %": "fixedUtilizationWithAdhocPct",
  "utilization without adhoc %": "fixedUtilizationWithoutAdhocPct",
  "poa answering": "fixedPoaAnsweringPct",
  "poa answering %": "fixedPoaAnsweringPct",
  "escalated %": "fixedEscalatedPct",
  "remarks": "remarks",
};

/** A "85.2%" cell from the sheet is the number 85.2 (percent columns are stored as percent points). */
const stripPercent = (v: string): string => v.replace(/%\s*$/, "").trim();

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
  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, " ").trim());
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
    fieldAt.forEach((field, col) => { if (field) row[field] = field.endsWith("Pct") ? stripPercent(cells[col] ?? "") : (cells[col] ?? ""); });
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
