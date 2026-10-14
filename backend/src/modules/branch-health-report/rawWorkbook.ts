/**
 * Branch Health Report — raw-data workbook attached to every emailed report.
 *
 * Dumps the full BranchHealthRawData the report was built from (every scalar, every row of every
 * list) plus the escalations with their sources, so the team can validate any figure in the email.
 * The structure is walked generically: a field added to the raw data shows up here automatically.
 */
import ExcelJS from "exceljs";
import type { BranchHealthReport } from "./metrics.js";

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);

const isScalar = (v: unknown): boolean => v === null || v === undefined || typeof v !== "object" || v instanceof Date;

function cell(v: unknown): string | number | boolean | Date | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return Number(v);
  if (v instanceof Date || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  return JSON.stringify(v);
}

/** Excel sheet names: max 31 chars, none of  : \ / ? * [ ]  and unique. */
function sheetName(path: string, used: Set<string>): string {
  const base = path.replace(/[:\\/?*[\]]/g, "-").slice(0, 31) || "data";
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 28)}~${i}`;
  used.add(name.toLowerCase());
  return name;
}

interface Collected {
  scalars: Array<[string, unknown]>;
  tables: Array<[string, unknown[]]>;
}

function walk(value: unknown, path: string, out: Collected): void {
  if (Array.isArray(value)) {
    if (value.every(isScalar)) out.tables.push([path, value.map((v) => ({ value: v }))]);
    else out.tables.push([path, value]);
    return;
  }
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k, out);
    return;
  }
  out.scalars.push([path, value]);
}

function addTable(wb: ExcelJS.Workbook, name: string, rows: unknown[]): void {
  const ws = wb.addWorksheet(name);
  if (!rows.length) {
    ws.addRow(["(no rows)"]);
    return;
  }
  const keys: string[] = [];
  for (const r of rows) {
    if (!isPlainObject(r)) continue;
    for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  }
  ws.addRow(keys);
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    const o = isPlainObject(r) ? r : { value: r };
    ws.addRow(keys.map((k) => cell(o[k])));
  }
  ws.views = [{ state: "frozen", ySplit: 1 }];
  keys.forEach((_, i) => (ws.getColumn(i + 1).width = 18));
}

export async function buildRawWorkbook(report: BranchHealthReport, generatedAt?: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MAS Callnet HRMS";
  wb.created = new Date();
  const used = new Set<string>();

  const readme = wb.addWorksheet(sheetName("README", used));
  readme.columns = [{ width: 110 }];
  readme.addRows([
    [`Branch Health Report — raw data — ${report.branch} — ${report.reportDate}`],
    [`Overall status: ${report.overallStatus}${generatedAt ? ` · generated ${generatedAt}` : ""}`],
    [""],
    ["Every figure in the emailed report is computed from the sheets in this workbook."],
    ["'Metrics' lists every single value (path = field name in the report data). Each list in the report has its own sheet, named after its path."],
    ["'Escalations' and 'Critical points' show what was flagged, with the source line used in the email."],
    ["Amounts are as stored (budget / GRN / P&L figures are ex-GST where the email says so)."],
  ]);
  readme.getRow(1).font = { bold: true, size: 13 };

  const esc = wb.addWorksheet(sheetName("Escalations", used));
  esc.addRow(["Key", "Label", "Detail", "Owner", "Days red", "Since", "Source"]);
  esc.getRow(1).font = { bold: true };
  for (const e of report.escalations) esc.addRow([e.key, e.label, e.detail, e.owner, e.days ?? "", e.since ?? "", e.source ?? ""]);
  [18, 50, 70, 16, 10, 12, 70].forEach((w, i) => (esc.getColumn(i + 1).width = w));

  const cp = wb.addWorksheet(sheetName("Critical points", used));
  cp.addRow(["Severity", "Label", "Detail"]);
  cp.getRow(1).font = { bold: true };
  for (const p of report.criticalPoints) cp.addRow([p.severity, p.label, p.detail]);
  [12, 50, 90].forEach((w, i) => (cp.getColumn(i + 1).width = w));

  const collected: Collected = { scalars: [], tables: [] };
  walk(report.raw, "", collected);

  const metrics = wb.addWorksheet(sheetName("Metrics", used));
  metrics.addRow(["Path", "Value"]);
  metrics.getRow(1).font = { bold: true };
  for (const [p, v] of collected.scalars) metrics.addRow([p, cell(v)]);
  metrics.columns = [{ width: 60 }, { width: 40 }];

  for (const [p, rows] of collected.tables) addTable(wb, sheetName(p, used), rows);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function rawWorkbookFilename(branch: string, reportDate: string): string {
  return `branch-health-raw-data_${branch.replace(/[^a-zA-Z0-9-]+/g, "_")}_${reportDate}.xlsx`;
}
