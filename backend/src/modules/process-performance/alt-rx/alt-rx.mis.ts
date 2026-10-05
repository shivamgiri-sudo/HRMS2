import ExcelJS from "exceljs";
import {
  WEEKS, dayKey, toDate, toFacts, type Counts, type DumpRow, type MisModel,
} from "./alt-rx.engine.js";

/**
 * ALT RX MIS workbook. Sheets, in order:
 *   Dashboard   - headline KPIs (MTD and Week-1 comparison), date-wise and week-wise trends,
 *                 TAT performance and FRT % trend: the figures behind the on-screen dashboard.
 *   Agent Wise  - day, MTD and Week-1..5 for Inflow, Closure, Closure %, Within TAT, Out of TAT, FRT %.
 *   Sheet1      - Agents and Comments tables (MTD, week by week) and Agent Wise Open.
 *   Brand Wise  - Brand Wise Performance (Inflow), Brand Wise Closure, Brand Wise Closure %,
 *                 each by MTD, Week-1..5 and day.
 *   Dump        - the uploaded rows as they came, plus the helper columns the source adds.
 * Values are written as numbers, so the file reads the same everywhere.
 */

/** Brand labels the source Brand Wise sheet always lists, so the layout matches even for a brand with no tickets. */
export const KNOWN_BRANDS = [
  "AltRx", "AltRx Health", "altrx.care", "altrx.life", "altrxcare", "Get Trinity Meds", "Get.altrx", "Join Trinity Meds",
  "Leanmeds", "LeanMeds Care", "LeanMeds Life+", "leanmeds.signup", "next.meds", "NextMeds", "Nextmeds Care",
  "NextMeds Life+", "nextmeds.care", "Trinity Meds", "Trinity Meds Company", "Trinity Meds Health", "Trinity Meds Online",
  "Trinity Meds Telehealth", "trinitymeds.join", "trinitymeds.now", "trinitymeds.wellness", "Try AltRx", "your.glp1", "YourGlp1",
] as const;

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" } };
const BOLD: Partial<ExcelJS.Font> = { bold: true };
const PCT = "0.0%";
const DATE_FMT = "dd-mmm-yy";
const DATETIME_FMT = "dd/mm/yyyy hh:mm";

const ratio = (n: number, d: number) => (d ? n / d : null);
const zero = (): Counts => ({ inflow: 0, closure: 0, within: 0, out: 0 });
const sum = (list: Counts[]): Counts => list.reduce((s, c) => ({
  inflow: s.inflow + c.inflow, closure: s.closure + c.closure, within: s.within + c.within, out: s.out + c.out,
}), zero());

type Metric = "inflow" | "closure" | "closurePct" | "open" | "within" | "out" | "frtPct";

/** One cell value for a metric from a set of counts. */
function metricValue(c: Counts, m: Metric): number | null {
  switch (m) {
    case "inflow": return c.inflow;
    case "closure": return c.closure;
    case "closurePct": return ratio(c.closure, c.inflow);
    case "open": return c.inflow - c.closure;
    case "within": return c.within;
    case "out": return c.out;
    case "frtPct": return ratio(c.within, c.inflow);
  }
}

const isPct = (m: Metric) => m === "closurePct" || m === "frtPct";

function header(ws: ExcelJS.Worksheet, row: number, values: Array<string | number | Date>) {
  const r = ws.getRow(row);
  values.forEach((v, i) => {
    const c = r.getCell(i + 1);
    c.value = v;
    c.fill = HEADER_FILL;
    c.font = HEADER_FONT;
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    if (v instanceof Date) c.numFmt = DATE_FMT;
  });
  r.commit();
}

function title(ws: ExcelJS.Worksheet, row: number, text: string) {
  ws.getCell(row, 1).value = text;
  ws.getCell(row, 1).font = { bold: true, size: 12, color: { argb: "FF1F3A5F" } };
}

/** Writes name, MTD, Week-1..5 and (optionally) each day for one metric. Returns the next free row. */
function metricGrid(
  ws: ExcelJS.Worksheet, startRow: number, heading: string, nameHeader: string,
  rows: Array<{ key: string; mtd: Counts; weeks: Counts[]; daily: Counts[] }>,
  days: string[], metric: Metric, withDays: boolean,
): number {
  let row = startRow;
  title(ws, row, heading);
  row += 1;
  const dayHeaders = withDays ? days.map((d) => new Date(`${d}T00:00:00Z`)) : [];
  header(ws, row, [nameHeader, "MTD", ...WEEKS, ...dayHeaders]);
  row += 1;
  const fill = (name: string, mtd: Counts, weeks: Counts[], daily: Counts[], bold: boolean) => {
    ws.getCell(row, 1).value = name;
    if (bold) ws.getRow(row).font = BOLD;
    const cells = [mtd, ...weeks, ...(withDays ? daily : [])].map((c) => metricValue(c, metric));
    cells.forEach((v, i) => {
      const cell = ws.getCell(row, 2 + i);
      cell.value = v ?? "";
      if (isPct(metric)) cell.numFmt = PCT;
    });
    row += 1;
  };
  for (const r of rows) fill(r.key, r.mtd, r.weeks, r.daily, false);
  const total = sum(rows.map((r) => r.mtd));
  const weekTotals = WEEKS.map((_, w) => sum(rows.map((r) => r.weeks[w])));
  const dayTotals = days.map((_, i) => sum(rows.map((r) => r.daily[i])));
  fill("Grand Total", total, weekTotals, dayTotals, true);
  return row + 1;
}

function headlineCounts(m: MisModel): Counts { return { inflow: m.headline.inflow, closure: m.headline.closure, within: m.headline.within, out: m.headline.out }; }

/** Week totals across all tickets, for the Dashboard sheet's trend tables. */
function weekTotalsOverall(m: MisModel): Counts[] {
  return WEEKS.map((_, w) => sum(m.days.flatMap((d, i) => (weekOf(d) === WEEKS[w] ? [m.daily[i]] : []))));
}
const weekOf = (day: string) => WEEKS[Math.min(4, Math.ceil(Number(day.slice(8, 10)) / 7) - 1)];

function sheetDashboard(wb: ExcelJS.Workbook, m: MisModel) {
  const ws = wb.addWorksheet("Dashboard");
  const h = headlineCounts(m);
  const weeks = weekTotalsOverall(m);
  const wk1 = weeks[0];
  title(ws, 1, "AltRx Process Performance Dashboard");
  ws.getCell(2, 1).value = `Period: ${m.days[0] ?? "-"} to ${m.days[m.days.length - 1] ?? "-"} · Tickets: ${m.headline.tickets}`;

  header(ws, 4, ["KPI", "MTD", "Week-1", "vs Week-1 (%)", "Note"]);
  const kpis: Array<[string, number | null, number | null, string]> = [
    ["Total Inflow", h.inflow, wk1.inflow, "Tickets created"],
    ["Total Closure", h.closure, wk1.closure, "Resolved or Closed, by resolved day"],
    ["Closure %", ratio(h.closure, h.inflow), ratio(wk1.closure, wk1.inflow), "Closure ÷ Inflow"],
    ["Within TAT", h.within, wk1.within, "First response within 30 minutes"],
    ["Out of TAT", h.out, wk1.out, "Slow or no first response"],
    ["FRT %", ratio(h.within, h.inflow), ratio(wk1.within, wk1.inflow), "Within TAT ÷ Inflow"],
  ];
  kpis.forEach(([label, mtd, w1, note], i) => {
    const r = 5 + i;
    ws.getCell(r, 1).value = label;
    ws.getCell(r, 2).value = mtd ?? "";
    ws.getCell(r, 3).value = w1 ?? "";
    const change = mtd !== null && w1 ? (mtd - w1) / w1 : null;
    ws.getCell(r, 4).value = change ?? "";
    ws.getCell(r, 5).value = note;
    if (label.includes("%") || label === "FRT %") { ws.getCell(r, 2).numFmt = PCT; ws.getCell(r, 3).numFmt = PCT; }
    ws.getCell(r, 4).numFmt = PCT;
  });

  let row = 13;
  title(ws, row, "Daily trend (Inflow vs Closure, FRT %)");
  row += 1;
  header(ws, row, ["Date", "Inflow", "Closure", "FRT %"]);
  row += 1;
  m.days.forEach((d, i) => {
    ws.getCell(row, 1).value = new Date(`${d}T00:00:00Z`);
    ws.getCell(row, 1).numFmt = DATE_FMT;
    ws.getCell(row, 2).value = m.daily[i].inflow;
    ws.getCell(row, 3).value = m.daily[i].closure;
    ws.getCell(row, 4).value = ratio(m.daily[i].within, m.daily[i].inflow) ?? "";
    ws.getCell(row, 4).numFmt = PCT;
    row += 1;
  });
  row += 1;

  title(ws, row, "Weekly trend (Inflow vs Closure) and TAT performance");
  row += 1;
  header(ws, row, ["Week", "Inflow", "Closure", "Within TAT", "Out of TAT", "FRT %", "Closure %"]);
  row += 1;
  WEEKS.forEach((w, i) => {
    ws.getCell(row, 1).value = w;
    ws.getCell(row, 2).value = weeks[i].inflow;
    ws.getCell(row, 3).value = weeks[i].closure;
    ws.getCell(row, 4).value = weeks[i].within;
    ws.getCell(row, 5).value = weeks[i].out;
    ws.getCell(row, 6).value = ratio(weeks[i].within, weeks[i].inflow) ?? "";
    ws.getCell(row, 6).numFmt = PCT;
    ws.getCell(row, 7).value = ratio(weeks[i].closure, weeks[i].inflow) ?? "";
    ws.getCell(row, 7).numFmt = PCT;
    row += 1;
  });
  ws.getColumn(1).width = 22;
  ws.getColumn(5).width = 36;
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 0 }];
}

function sheetAgentWise(wb: ExcelJS.Workbook, m: MisModel) {
  const ws = wb.addWorksheet("Agent Wise");
  header(ws, 3, ["Date", "MTD", ...WEEKS, ...m.days.map((d) => new Date(`${d}T00:00:00Z`))]);
  const labels: Metric[] = ["inflow", "closure", "closurePct", "within", "out", "frtPct"];
  const names = ["Inflow", "Closure", "Closure%", "Within TAT", "Out of TAT", "FRT%"];
  labels.forEach((metric, i) => {
    const row = 4 + i;
    ws.getCell(row, 1).value = names[i];
    ws.getCell(row, 1).font = BOLD;
    const weeks = WEEKS.map((_, w) => sum(m.days.flatMap((d, j) => (weekOf(d) === WEEKS[w] ? [m.daily[j]] : []))));
    const values = [headlineCounts(m), ...weeks, ...m.daily].map((c) => metricValue(c, metric));
    values.forEach((v, j) => {
      const cell = ws.getCell(row, 2 + j);
      cell.value = v ?? "";
      if (isPct(metric)) cell.numFmt = PCT;
    });
  });
  ws.getColumn(1).width = 14;
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: 3 }];
}

function sheetSheet1(wb: ExcelJS.Workbook, m: MisModel) {
  const ws = wb.addWorksheet("Sheet1");
  let row = 1;
  // Agents and comments: the source's six-metric tables, MTD and week by week.
  const sixMetric = (heading: string, nameHeader: string, rows: typeof m.agents.rows) => {
    title(ws, row, heading);
    row += 1;
    const headers = [nameHeader, "Inflow", "Closure", "Closure%", "Within TAT", "Out of TAT", "FRT%"];
    header(ws, row, headers);
    row += 1;
    const write = (name: string, c: Counts, bold: boolean) => {
      ws.getCell(row, 1).value = name;
      if (bold) ws.getRow(row).font = BOLD;
      [c.inflow, c.closure, ratio(c.closure, c.inflow) ?? "", c.within, c.out, ratio(c.within, c.inflow) ?? ""].forEach((v, i) => {
        const cell = ws.getCell(row, 2 + i);
        cell.value = v;
        if (i === 2 || i === 5) cell.numFmt = PCT;
      });
      row += 1;
    };
    for (const r of rows) write(r.key, r.mtd, false);
    write("Grand Total", headlineCounts(m), true);
    row += 1;
  };
  sixMetric("Agents Wise (MTD)", "Agent", m.agents.rows);
  sixMetric("Comments Wise (MTD)", "Comment Type", m.types.rows);
  // Agent Wise Open = tickets created but not yet closed (Inflow − Closure).
  row = metricGrid(ws, row, "Agent Wise Open (not closed)", "Agent", m.agents.rows, m.days, "open", false);
  row = metricGrid(ws, row, "Agent Wise Closure (week by week)", "Agent", m.agents.rows, m.days, "closure", false);
  row = metricGrid(ws, row, "Comments Wise Performance (Inflow, by day)", "Comment Type", m.types.rows, m.days, "inflow", true);
  ws.getColumn(1).width = 26;
}

function sheetBrandWise(wb: ExcelJS.Workbook, m: MisModel) {
  const ws = wb.addWorksheet("Brand Wise");
  const byKey = new Map(m.brands.rows.map((r) => [r.key, r] as const));
  const rows = [
    ...KNOWN_BRANDS.map((key) => byKey.get(key) ?? { key, mtd: zero(), weeks: WEEKS.map(zero), daily: m.days.map(zero) }),
    ...m.brands.rows.filter((r) => !(KNOWN_BRANDS as readonly string[]).includes(r.key)),
  ];
  let row = 1;
  row = metricGrid(ws, row, "Brand Wise Performance (All Metrics, Inflow)", "Over All Brands", rows, m.days, "inflow", true);
  row = metricGrid(ws, row, "Brand Wise Closure", "Over All Brands", rows, m.days, "closure", true);
  row = metricGrid(ws, row, "Brand Wise Closure %", "Over All Brands", rows, m.days, "closurePct", true);
  ws.getColumn(1).width = 30;
}

function sheetDump(wb: ExcelJS.Workbook, rows: DumpRow[], columns: string[]) {
  const ws = wb.addWorksheet("Dump");
  const helpers = [
    "Creation Date", "Creation Time", "FRT Date", "FRT Time", "Resolved Date", "Resolved Time",
    "FRT Duration (min)", "TAT", "Status", "Brand", "Week",
  ];
  header(ws, 1, [...columns, ...helpers]);
  rows.forEach((r, i) => {
    const f = toFacts(r);
    const created = toDate(r["Created time"]);
    const response = toDate(r["Initial response time"]);
    const resolved = toDate(r["Resolved time"]);
    const line = i + 2;
    columns.forEach((c, j) => {
      const v = r[c];
      const cell = ws.getCell(line, j + 1);
      if (v instanceof Date) { cell.value = v; cell.numFmt = DATETIME_FMT; }
      else cell.value = (v ?? null) as ExcelJS.CellValue;
    });
    const base = columns.length;
    const put = (k: number, v: ExcelJS.CellValue, fmt?: string) => {
      const cell = ws.getCell(line, base + k + 1);
      cell.value = v;
      if (fmt) cell.numFmt = fmt;
    };
    put(0, created ? new Date(`${dayKey(created)}T00:00:00Z`) : "", DATE_FMT);
    put(1, created ? created.getUTCHours() : "");
    put(2, response ? new Date(`${dayKey(response)}T00:00:00Z`) : "", DATE_FMT);
    put(3, response ? response.getUTCHours() : "");
    put(4, resolved ? new Date(`${dayKey(resolved)}T00:00:00Z`) : "", DATE_FMT);
    put(5, resolved ? resolved.getUTCHours() : "");
    put(6, created && response && response >= created ? Math.round((response.getTime() - created.getTime()) / 60000) : "");
    put(7, f?.tat === "within" ? "Within TAT" : "Out of TAT");
    put(8, f?.status === "closed" ? "Resolved" : (String(r["Status"] ?? "") || "Open"));
    put(9, f?.brand ?? "");
    put(10, created ? WEEKS[Math.min(4, Math.ceil(created.getUTCDate() / 7) - 1)] : "");
  });
  ws.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length + helpers.length } };
}

export async function buildAltRxMisWorkbook(
  model: MisModel, rows: DumpRow[], columns: string[],
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MAS Callnet HRMS";
  wb.created = new Date();
  sheetDashboard(wb, model);
  sheetAgentWise(wb, model);
  sheetSheet1(wb, model);
  sheetBrandWise(wb, model);
  sheetDump(wb, rows, columns);
  return wb;
}
