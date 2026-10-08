import ExcelJS from "exceljs";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import {
  A, allocDuplicateIds, allocWhere, fetchDialerCdrRows, getSatyaReport,
  type SatyaCounts, type SatyaReportFilters,
} from "./satya-retail-report.service.js";

/**
 * Satya Retail MIS workbook -- the server-side replica of the ops team's manual
 * "SatyaDashboard" Excel. Same five visible sheets in the same order:
 *
 *   Dashboard   headline tiles, disposition / sub-disposition tables, agent-wise
 *               calling and orders, beat-wise orders
 *   Snap        daily matrix: MTD, W-1..W-5 (day-of-month 1-7, 8-14, ...) and one
 *               column per date, in the workbook's blocks (calls, connect,
 *               orders, pending, connected sub-dispositions)
 *   AGENT-WISE  totals grid by day plus the per-agent table for the range
 *   DD Raw      dialer call rows for the range
 *   Alloction   allocation rows as uploaded (duplicates removed, as the dashboard does)
 *
 * Every figure comes from getSatyaReport() / fetchDialerCdrRows() / the same
 * allocation filters the dashboard uses, so the MIS and the screen cannot drift.
 * The workbook is written as values, not live formulas.
 *
 * Definitions follow the dashboard's (satya-retail-report.service.ts header):
 * Call = allocation - pending; Unique/Repeat by unique_flag; Connect = Connected
 * disposition; Conversion = orders / base.
 */

export interface SatyaMisResult { raw: never[]; sections: string[]; skipped: string[] }

const SHEET_ORDER = ["Dashboard", "Snap", "AGENT-WISE", "DD Raw", "Alloction"] as const;

const C_HEAD = "FF1F2937";
const C_BAND = "FFFEF3C7";
const C_SUB = "FFF3F4F6";

const INT = "#,##0";
const PCT = "0.00%";
const INR = "\"₹\"#,##0";
const DATE_FMT = "dd/mm/yyyy";

const SUB_ORDER = [
  "Stock Available", "Not Interested", "Order Placed", "Call Back", "Shop Not Available",
  "Delivery Issue", "Price Issue", "Shop Closed – Temporary", "Out of Stock",
  "Last Order Undelivered", "Already order", "Shop Closed – Permanent", "Call Drop",
  "Ready to Place Via App", "Feedback",
];

/** Workbook column header -> satya_allocation column, in the workbook's own order. */
const ALLOC_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ["Roster", "roster"], ["Warehouse", "warehouse"], ["Beatname", "beat_name"], ["Shop Name", "shop_name"],
  ["Shop Phone", "shop_phone"], ["MASID", "mas_id"], ["Date", "report_date"], ["UID", "uid"],
  ["Number", "number_val"], ["Unique", "unique_flag"], ["All Date", "all_date"], ["Agent ID", "agent_id"],
  ["Disposition", "disposition"], ["Sub-Disposition", "sub_disposition"], ["Attempt", "attempt"], ["DD", "dd_val"],
  ["Same Day Connected", "same_day_connected"], ["Agent Name", "agent_name"], ["Order Value", "order_value"],
  ["Call Type", "call_type"], ["Order Match (filtered)", "order_match_filtered"], ["Agent Name 2", "agent_name_2"],
];
const ALLOC_HEADERS = ALLOC_COLUMNS.map(([h]) => h);

const DD_RAW_HEADERS = ["Number", "Call Date", "Scenario", "Sub Scenario 1", "Beatname", "Warehouse", "Agent Name", "Attempt"] as const;

/** Day ranges a Snap/AGENT-WISE column can cover. */
interface Col { key: string; label: string; dates: string[] }

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function buildCols(dates: string[]): Col[] {
  const weeks: Col[] = [
    { key: "W-1", label: "W-1", dates: [] }, { key: "W-2", label: "W-2", dates: [] },
    { key: "W-3", label: "W-3", dates: [] }, { key: "W-4", label: "W-4", dates: [] },
    { key: "W-5", label: "W-5", dates: [] },
  ];
  for (const d of dates) {
    const dom = Number(d.slice(8, 10));
    weeks[Math.min(4, Math.floor((dom - 1) / 7))].dates.push(d);
  }
  return [{ key: "MTD", label: "MTD", dates: dates }, ...weeks, ...dates.map((d) => ({ key: d, label: d, dates: [d] }))];
}

const sumOver = (byDate: Map<string, number>, dates: string[]): number =>
  dates.reduce((s, d) => s + (byDate.get(d) ?? 0), 0);

function headerRow(ws: ExcelJS.Worksheet, values: (string | number | Date | null)[], fill = C_HEAD): void {
  const row = ws.addRow(values);
  row.font = { bold: true, color: { argb: fill === C_HEAD ? "FFFFFFFF" : "FF111827" } };
  row.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
}

function titleRow(ws: ExcelJS.Worksheet, text: string, sub: string): void {
  ws.addRow([text]).font = { bold: true, size: 14 };
  ws.addRow([sub]).font = { italic: true, color: { argb: "FF6B7280" } };
  ws.addRow([]);
}

const toDate = (ymd: string): Date => new Date(`${ymd}T00:00:00Z`);
const isDayCol = (c: Col): boolean => c.dates.length === 1 && c.key === c.dates[0];
/** Daily columns carry a real date value (shown dd/mm/yyyy); MTD and weeks carry their label. */
const headerValue = (c: Col): Date | string => (isDayCol(c) ? toDate(c.key) : c.label);
function applyDateFormat(row: ExcelJS.Row, cols: Col[]): void {
  cols.forEach((c, i) => { if (isDayCol(c)) row.getCell(i + 2).numFmt = DATE_FMT; });
}

export async function buildSatyaMisWorkbook(filePath: string, f: SatyaReportFilters): Promise<SatyaMisResult> {
  const report = await getSatyaReport(f);
  const dates = eachDay(f.from, f.to);
  const cols = buildCols(dates);
  const subtitle = `${f.from} to ${f.to}`;

  // Per-date aggregates across rosters, plus Morning / Absentee splits.
  const series = {
    overall: new Map<string, number>(), morning: new Map<string, number>(), absentee: new Map<string, number>(),
    pending: new Map<string, number>(), pendingMorning: new Map<string, number>(), pendingAbsentee: new Map<string, number>(),
    unique: new Map<string, number>(), orders: new Map<string, number>(),
    ordersMorning: new Map<string, number>(), ordersAbsentee: new Map<string, number>(),
    connected: new Map<string, number>(), connectedMorning: new Map<string, number>(), connectedAbsentee: new Map<string, number>(),
    revenue: new Map<string, number>(),
  };
  const add = (m: Map<string, number>, d: string, v: number) => m.set(d, (m.get(d) ?? 0) + v);
  for (const r of report.daily) {
    const c: SatyaCounts = r.counts;
    add(series.overall, r.date, c.allocation);
    add(series.pending, r.date, c.pending);
    add(series.unique, r.date, c.unique);
    add(series.orders, r.date, c.orders);
    add(series.connected, r.date, c.connected);
    add(series.revenue, r.date, c.revenue);
    if (r.roster === "Morning") {
      add(series.morning, r.date, c.allocation); add(series.ordersMorning, r.date, c.orders);
      add(series.connectedMorning, r.date, c.connected); add(series.pendingMorning, r.date, c.pending);
    } else if (r.roster === "Absentee") {
      add(series.absentee, r.date, c.allocation); add(series.ordersAbsentee, r.date, c.orders);
      add(series.connectedAbsentee, r.date, c.connected); add(series.pendingAbsentee, r.date, c.pending);
    }
  }
  const call = new Map<string, number>();
  for (const d of dates) call.set(d, (series.overall.get(d) ?? 0) - (series.pending.get(d) ?? 0));

  const subByDate = new Map<string, Map<string, number>>();
  const subNames = new Set<string>();
  for (const r of report.subDispositionDaily) {
    if (r.disposition !== "Connected") continue;
    subNames.add(r.subDisposition);
    const m = subByDate.get(r.subDisposition) ?? new Map<string, number>();
    m.set(r.date, (m.get(r.date) ?? 0) + r.count);
    subByDate.set(r.subDisposition, m);
  }
  const orderedSubs = [
    ...SUB_ORDER.filter((s) => subNames.has(s)),
    ...[...subNames].filter((s) => !SUB_ORDER.includes(s)).sort(),
  ];

  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  for (const name of SHEET_ORDER) wb.addWorksheet(name);

  /* ---------------------------------- Dashboard ---------------------------------- */
  const dash = wb.getWorksheet("Dashboard")!;
  titleRow(dash, "CALLING & ORDER TRACKING REPORT", `Satya Retail · ${subtitle} · warehouse: ${f.warehouse ?? "All"}`);
  const h = report.headline;
  const calls = h.allocation - h.pending;
  headerRow(dash, ["Overall Allocation", "Calls Made", "Unique Calls", "Repeat Calls", "Connected", "Orders Placed", "Order Revenue"]);
  const tiles = dash.addRow([h.allocation, calls, h.unique, h.repeat, h.connected, h.orders, h.revenue]);
  tiles.font = { bold: true, size: 13 };
  tiles.eachCell((c, i) => { c.numFmt = i === 7 ? INR : INT; c.alignment = { horizontal: "center" }; });
  dash.addRow([]);

  const dispTotal = h.connected + h.notConnected;
  headerRow(dash, ["Disposition", "Count", "%"]);
  for (const [name, n] of [["Connected", h.connected], ["Not Connected", h.notConnected]] as const) {
    const row = dash.addRow([name, n, dispTotal ? n / dispTotal : 0]);
    row.getCell(2).numFmt = INT; row.getCell(3).numFmt = PCT;
  }
  const dispRow = dash.addRow(["Total", dispTotal, 1]);
  dispRow.font = { bold: true }; dispRow.getCell(2).numFmt = INT; dispRow.getCell(3).numFmt = PCT;
  dash.addRow([]);

  headerRow(dash, ["Call Status (Connected sub-disposition)", "Count", "%"]);
  const connectedTotal = h.connected || 1;
  let subTotal = 0;
  for (const s of orderedSubs) {
    const n = sumOver(subByDate.get(s) ?? new Map(), dates);
    subTotal += n;
    const row = dash.addRow([s, n, n / connectedTotal]);
    row.getCell(2).numFmt = INT; row.getCell(3).numFmt = PCT;
  }
  const subRow = dash.addRow(["Total", subTotal, subTotal / connectedTotal]);
  subRow.font = { bold: true }; subRow.getCell(2).numFmt = INT; subRow.getCell(3).numFmt = PCT;
  dash.addRow([]);

  headerRow(dash, ["Agent Name", "Agent ID", "Unique Calls", "Repeat Calls", "Total Calls", "Connected", "Not Connected", "Orders", "Revenue"]);
  for (const a of report.agents) {
    const c = a.counts;
    const row = dash.addRow([a.agentName || "—", a.agentId, c.unique, c.repeat, c.unique + c.repeat, c.connected, c.notConnected, c.orders, c.revenue]);
    row.getCell(9).numFmt = INR;
    for (let i = 3; i <= 8; i++) row.getCell(i).numFmt = INT;
  }
  dash.addRow([]);

  headerRow(dash, ["Beat", "Warehouse", "Shops", "Allocation", "Connected", "Orders", "Revenue"]);
  for (const b of report.beats) {
    const c = b.counts;
    const row = dash.addRow([b.beat, b.warehouse, b.shops, c.allocation, c.connected, c.orders, c.revenue]);
    row.getCell(7).numFmt = INR;
    for (let i = 3; i <= 6; i++) row.getCell(i).numFmt = INT;
  }
  dash.columns = [{ width: 36 }, { width: 18 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 14 }, { width: 16 }];

  /* ------------------------------------ Snap ------------------------------------ */
  const snap = wb.getWorksheet("Snap")!;
  headerRow(snap, ["Data", ...cols.map(headerValue)]);
  applyDateFormat(snap.getRow(1), cols);

  type Row = { label: string; values: number[]; isRatio?: boolean; fmt?: string };
  const countRow = (label: string, m: Map<string, number>): Row => ({ label, values: cols.map((c) => sumOver(m, c.dates)) });
  const ratioRow = (label: string, num: Row, den: Row): Row => ({
    label, isRatio: true, fmt: PCT,
    values: num.values.map((n, i) => (den.values[i] ? n / den.values[i] : 0)),
  });
  const blank = (): Row => ({ label: "", values: [] });
  const subHead = (label: string): Row => ({ label, values: [] });

  const overall = countRow("Overall Allocation", series.overall);
  const morning = countRow("Morning", series.morning);
  const absentee = countRow("Absentee", series.absentee);
  const pending = countRow("Pending", series.pending);
  const callRow = countRow("Call", call);
  const unique = countRow("Unique", series.unique);
  const orders = countRow("Order Placed", series.orders);
  const connect = countRow("Connect", series.connected);
  const connectMorning = countRow("Morning", series.connectedMorning);
  const connectAbsentee = countRow("Absentee", series.connectedAbsentee);
  const ordersMorning = countRow("Morning", series.ordersMorning);
  const ordersAbsentee = countRow("Absentee", series.ordersAbsentee);
  const pendingMorning = countRow("Morning", series.pendingMorning);
  const pendingAbsentee = countRow("Absentee", series.pendingAbsentee);

  const rows: Row[] = [
    overall, morning, absentee, pending, callRow, unique, orders,
    ratioRow("Conversion % on Overall", orders, overall),
    ratioRow("Conversion % on Morning", ordersMorning, morning),
    ratioRow("Conversion % on Absentee", ordersAbsentee, absentee),
    blank(),
    { ...connect, label: "Connect" }, connectMorning, connectAbsentee,
    { ...orders, label: "Order Placed" },
    ratioRow("Conversion % at connect", orders, connect),
    blank(),
    { ...orders, label: "Order Placed" }, ordersMorning, ordersAbsentee,
    blank(),
    { ...pending, label: "Pending" }, pendingMorning, pendingAbsentee,
    blank(),
    subHead("Connected sub-dispositions"),
    ...orderedSubs.map((s) => countRow(s, subByDate.get(s) ?? new Map())),
  ];
  for (const r of rows) {
    if (r.label === "" && r.values.length === 0) { snap.addRow([]); continue; }
    if (r.values.length === 0) { const row = snap.addRow([r.label]); row.font = { bold: true }; row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: C_SUB } }; continue; }
    const row = snap.addRow([r.label, ...r.values]);
    row.getCell(1).font = { bold: true };
    row.eachCell((cell, i) => { if (i > 1) cell.numFmt = r.isRatio ? PCT : INT; });
    if (r.label === "Overall Allocation") row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C_BAND } }; });
  }
  snap.getColumn(1).width = 34;
  snap.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];

  /* -------------------------------- AGENT-WISE -------------------------------- */
  const agentWise = wb.getWorksheet("AGENT-WISE")!;
  headerRow(agentWise, ["Agent wise", ...cols.map(headerValue)]);
  applyDateFormat(agentWise.getRow(1), cols);
  const agentRowSpecs: Array<[string, Map<string, number>]> = [
    ["Allocation", series.overall], ["Order Count", series.orders], ["No. Calls", call],
    ["Unique call", series.unique], ["Unique call morning", series.morning], ["Unique call absentee", series.absentee],
    ["Revenue", series.revenue],
  ];
  for (const [label, m] of agentRowSpecs) {
    const row = agentWise.addRow([label, ...cols.map((c) => sumOver(m, c.dates))]);
    row.getCell(1).font = { bold: true };
    row.eachCell((cell, i) => { if (i > 1) cell.numFmt = label === "Revenue" ? INR : INT; });
  }
  agentWise.addRow([]);
  agentWise.addRow([`Start Date ${f.from}`, `End Date ${f.to}`]).font = { bold: true };
  headerRow(agentWise, ["Agent ID", "EMP Name", "Allocation (all)", "Order Count", "No. Calls", "Unique call", "Unique call morning", "Unique call absentee", "Connected", "Revenue", "Days worked"]);
  for (const a of report.agents) {
    const c = a.counts;
    const row = agentWise.addRow([a.agentId, a.agentName || "—", c.allocation, c.orders, c.allocation - c.pending, c.unique, c.morning, c.absentee, c.connected, c.revenue, a.daysWorked]);
    row.getCell(10).numFmt = INR;
    for (let i = 3; i <= 9; i++) row.getCell(i).numFmt = INT;
  }
  agentWise.getColumn(1).width = 26;

  /* ---------------------------------- DD Raw ---------------------------------- */
  const ddRaw = wb.getWorksheet("DD Raw")!;
  headerRow(ddRaw, [...DD_RAW_HEADERS]);
  const calls2 = await fetchDialerCdrRows(f);
  for (const r of calls2) {
    ddRaw.addRow([r.numberVal, r.callDate, r.scenario, r.subScenario, r.beatName, r.warehouse, r.agentName, r.attempt]);
  }
  ddRaw.getColumn(2).numFmt = "dd/mm/yyyy hh:mm";
  ddRaw.views = [{ state: "frozen", ySplit: 1 }];
  ddRaw.columns = DD_RAW_HEADERS.map((hdr) => ({ header: hdr, width: 18 }));

  /* -------------------------------- Alloction --------------------------------- */
  const alloc = wb.getWorksheet("Alloction")!;
  headerRow(alloc, [...ALLOC_HEADERS]);
  const dup = await allocDuplicateIds();
  const w = allocWhere(f, dup);
  const [allocRows] = await db.execute<RowDataPacket[]>(
    `SELECT ${ALLOC_COLUMNS.map(([, col]) => col).join(", ")} FROM ${A} ${w.sql} ORDER BY id`,
    w.params,
  );
  for (const r of allocRows) {
    alloc.addRow(ALLOC_COLUMNS.map(([, col]) => r[col] ?? null));
  }
  alloc.views = [{ state: "frozen", ySplit: 1 }];
  alloc.columns = ALLOC_HEADERS.map((hdr) => ({ header: hdr, width: 16 }));

  await wb.xlsx.writeFile(filePath);
  return { raw: [], sections: [...SHEET_ORDER], skipped: [] };
}
