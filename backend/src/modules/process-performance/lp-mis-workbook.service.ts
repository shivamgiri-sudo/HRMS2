import ExcelJS from "exceljs";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { getLpCallDashboard, type LpCallDashboardData, type LpProcessKey } from "./lp-call-dashboard.shared.js";

/**
 * LP Feedback and LP Onboarding MIS workbooks -- server-side replicas of the
 * ops team's "Lawyer Panel Feedback Sep'26" and "Lp OnBoarding Sep'26" Excel
 * files. Sheet names and order are the workbooks' own VISIBLE sheets (their
 * hidden helper sheets are not part of the MIS):
 *
 *   LP Feedback:   Dashboard, Overall snap, Agent Performance, Agent Performance ,
 *                  Campaign wise, Raw, APR                        (7 sheets)
 *   LP Onboarding: Dashboard, Overall snap, Agent Performance, Average, Raw, APR
 *                                                                 (6 sheets)
 *
 * Call counts follow the workbook's own formulas, read straight from the raw rows
 * (COUNTIFS on the Raw sheet): Overall = every call row for the date; Unique =
 * unique_flag 1; Connected = disposition_status 'Connected'. The shared dashboard
 * service de-duplicates copied call rows, so its counts are NOT the workbook's --
 * this MIS deliberately does not use them for call counts. Login count, talk time
 * and agent/campaign tables come from the shared service.
 *
 * Raw and APR are the rows in db_masmis for the range. Values, not live formulas.
 */

export const LP_MIS_SHEETS: Record<LpProcessKey, readonly string[]> = {
  lp_feedback: ["Dashboard", "Overall snap", "Agent Performance", "Agent Performance ", "Campaign wise", "Raw", "APR"],
  lp_onboarding: ["Dashboard", "Overall snap", "Agent Performance", "Average", "Raw", "APR"],
};

const TABLES: Record<LpProcessKey, { cdr: string; apr: string }> = {
  lp_feedback: { cdr: "db_masmis.lp_feedback_cdr", apr: "db_masmis.lp_feedback_apr" },
  lp_onboarding: { cdr: "db_masmis.lp_onboarding_cdr", apr: "db_masmis.lp_onboarding_apr" },
};

const TITLES: Record<LpProcessKey, string> = { lp_feedback: "LP Feedback", lp_onboarding: "LP Onboarding" };

const INT = "#,##0";
const PCT = "0.00%";
const DATE_FMT = "dd/mm/yyyy";
const C_HEAD = "FF1F2937";

export interface LpMisResult { raw: never[]; sections: string[]; skipped: string[] }

const hms = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

// report_date is stored as text in the dialer's own format ("1-Oct-26"), not ISO.
const MONTHS: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
function isoOf(v: unknown): string {
  const s = String(v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/.exec(s);
  return m && MONTHS[m[2]] ? `20${m[3]}-${MONTHS[m[2]]}-${m[1].padStart(2, "0")}` : "";
}

function header(ws: ExcelJS.Worksheet, values: (string | number | Date | null)[]): void {
  const row = ws.addRow(values);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C_HEAD } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
}

function title(ws: ExcelJS.Worksheet, text: string, sub: string): void {
  ws.addRow([text]).font = { bold: true, size: 14 };
  ws.addRow([sub]).font = { italic: true, color: { argb: "FF6B7280" } };
  ws.addRow([]);
}

const toDate = (ymd: string): Date => new Date(`${ymd}T00:00:00Z`);

interface RawDay { overall: number; unique: number; connected: number; uniqueConnected: number }

export async function buildLpMisWorkbook(processKey: LpProcessKey, from: string, to: string, filePath: string): Promise<LpMisResult> {
  const d: LpCallDashboardData = await getLpCallDashboard(processKey, from, to);
  const sheets = LP_MIS_SHEETS[processKey];
  const tables = TABLES[processKey];
  const subtitle = `${from} to ${to}`;
  const inRange = (v: unknown) => { const s = isoOf(v); return s !== "" && s >= from && s <= to; };

  // Raw call rows, read once: they feed the Raw sheet and the workbook-equivalent call counts.
  const [cdrRows] = await db.execute<RowDataPacket[]>(`SELECT * FROM ${tables.cdr} ORDER BY id`);
  const cdrRange = cdrRows.filter((r) => inRange(r.report_date));
  const rawByDay = new Map<string, RawDay>();
  for (const r of cdrRange) {
    const day = isoOf(r.report_date);
    const cur = rawByDay.get(day) ?? { overall: 0, unique: 0, connected: 0, uniqueConnected: 0 };
    const isUnique = String(r.unique_flag ?? "").trim() === "1";
    const isConnected = String(r.disposition_status ?? "").trim() === "Connected";
    cur.overall += 1;
    if (isUnique) cur.unique += 1;
    if (isConnected) cur.connected += 1;
    if (isUnique && isConnected) cur.uniqueConnected += 1;
    rawByDay.set(day, cur);
  }
  const rawTotal = [...rawByDay.values()].reduce<RawDay>(
    (t, x) => ({ overall: t.overall + x.overall, unique: t.unique + x.unique, connected: t.connected + x.connected, uniqueConnected: t.uniqueConnected + x.uniqueConnected }),
    { overall: 0, unique: 0, connected: 0, uniqueConnected: 0 },
  );

  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  for (const name of sheets) wb.addWorksheet(name);

  /* -------------------------------- Dashboard -------------------------------- */
  const dash = wb.getWorksheet("Dashboard")!;
  title(dash, `${TITLES[processKey]} -- Call Performance`, subtitle);
  const h = d.headline;
  header(dash, ["KPI", "Value"]);
  const kpis: Array<[string, number | string, string?]> = [
    ["Total Leads (call rows)", rawTotal.overall, INT], ["Unique Leads", rawTotal.unique, INT],
    ["Connected", rawTotal.connected, INT], ["Connectivity % (Connected / Unique)", rawTotal.unique ? rawTotal.connected / rawTotal.unique : 0, PCT],
    ["Login Count", h.loginCount, INT], ["Shrinkage %", h.shrinkagePct / 100, PCT],
    ["Average Lead Per Agent", h.avgLeadPerAgent, "0.0"], ["Per Agent Dial Count", h.perAgentDialCount, "0.0"],
    ["Average Talk Time", hms(h.avgTalkTimeSec)], ["Occupancy %", h.occupancyPct / 100, PCT],
    ["Average Attempts Per Lead", h.avgAttemptsPerLead, "0.00"], ["Call Back %", h.callBackPct / 100, PCT],
  ];
  for (const [k, v, fmt] of kpis) {
    const row = dash.addRow([k, v]);
    if (fmt) row.getCell(2).numFmt = fmt;
  }
  dash.addRow([]);

  // Disposition: counts of the raw disposition_status values, as the workbook's Disposition table counts them.
  const dispCounts = new Map<string, number>();
  for (const r of cdrRange) { const k = String(r.disposition_status ?? "").trim() || "(blank)"; dispCounts.set(k, (dispCounts.get(k) ?? 0) + 1); }
  header(dash, ["Disposition", "Count", "%"]);
  const dispTotal = [...dispCounts.values()].reduce((s, n) => s + n, 0);
  for (const [k, n] of [...dispCounts.entries()].sort((a, b) => b[1] - a[1])) {
    const row = dash.addRow([k, n, dispTotal ? n / dispTotal : 0]); row.getCell(2).numFmt = INT; row.getCell(3).numFmt = PCT;
  }
  dash.addRow([]);

  header(dash, ["Date", "Overall", "Unique Leads", "Connected", "Connected %"]);
  for (const day of eachDay(from, to)) {
    const r = rawByDay.get(day) ?? { overall: 0, unique: 0, connected: 0, uniqueConnected: 0 };
    const row = dash.addRow([toDate(day), r.overall, r.unique, r.connected, r.overall ? r.connected / r.overall : 0]);
    row.getCell(1).numFmt = DATE_FMT; row.getCell(5).numFmt = PCT;
  }
  dash.columns = [{ width: 36 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }];

  /* ------------------------------- Overall snap ------------------------------ */
  const snap = wb.getWorksheet("Overall snap")!;
  const days = eachDay(from, to);
  const byDay = new Map(d.daily.map((r) => [r.date, r]));
  const weekOf = (ymd: string) => Math.min(4, Math.floor((Number(ymd.slice(8, 10)) - 1) / 7));
  const weekNames = ["W-1", "W-2", "W-3", "W-4", "W-5"];
  // Each metric: its value for one day. Weeks and MTD are sums of the day values.
  const sumWeeks = (pick: (day: string) => number) => {
    const bucket = [0, 0, 0, 0, 0];
    for (const day of days) bucket[weekOf(day)] += pick(day);
    return { mtd: bucket.reduce((s, n) => s + n, 0), weeks: bucket, days: days.map(pick) };
  };
  header(snap, ["KPI", "MTD", ...weekNames, ...days.map(toDate)]);
  snap.getRow(1).eachCell((c, i) => { if (i > 6) c.numFmt = DATE_FMT; });
  const raw = (day: string) => rawByDay.get(day) ?? { overall: 0, unique: 0, connected: 0, uniqueConnected: 0 };
  const metrics: Array<[string, (day: string) => number]> = [
    ["Login Count", (day) => byDay.get(day)?.loginCount ?? 0],
    ["Overall Calls", (day) => raw(day).overall],
    ["Unique Leadset", (day) => raw(day).unique],
    ["Unique Connected Calls", (day) => raw(day).uniqueConnected],
    ["Overall Connected", (day) => raw(day).connected],
    ["Talk Time (sec)", (day) => byDay.get(day)?.talkTimeSec ?? 0],
  ];
  for (const [label, pick] of metrics) {
    const s = sumWeeks(pick);
    snap.addRow([label, s.mtd, ...s.weeks, ...s.days]).eachCell((c, i) => { if (i > 1) c.numFmt = INT; });
  }
  const ratioRow = (label: string, num: (day: string) => number, den: (day: string) => number) => {
    const n = sumWeeks(num); const dn = sumWeeks(den);
    const div = (a: number, b: number) => (b ? a / b : 0);
    const row = snap.addRow([label, div(n.mtd, dn.mtd), ...n.weeks.map((x, i) => div(x, dn.weeks[i])), ...n.days.map((x, i) => div(x, dn.days[i]))]);
    row.eachCell((c, i) => { if (i > 1) c.numFmt = PCT; });
  };
  ratioRow("Overall Connected %", (day) => raw(day).connected, (day) => raw(day).overall);
  ratioRow("Unique Connectivity %", (day) => raw(day).uniqueConnected, (day) => raw(day).unique);
  snap.getColumn(1).width = 26;
  snap.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];

  /* ----------------------------- Agent Performance --------------------------- */
  const agentHeader = ["Agent", "Login ID", "Total Calls", "Connected", "Connected %", "Unique Leads", "Talk Time", "Login Time", "Net Login", "Shrinkage %", "Occupancy %", "Days Worked", "Avg Calls/Day", "Idle", "Wrap-up", "Break", "First Call Connected %"];
  for (const name of sheets.filter((s) => s.startsWith("Agent Performance"))) {
    const ws = wb.getWorksheet(name)!;
    title(ws, `${TITLES[processKey]} -- Agent Performance`, subtitle);
    header(ws, agentHeader);
    for (const a of d.agents) {
      const row = ws.addRow([a.agent, a.loginId, a.totalCalls, a.connectedCalls, a.connectedPct / 100, a.uniqueLeads, hms(a.talkTimeSec), hms(a.loginTimeSec), hms(a.netLoginTimeSec), a.shrinkagePct / 100, a.occupancyPct / 100, a.daysWorked, a.avgCallsPerDay, hms(a.idleSec), hms(a.wrapupSec), hms(a.breakSec), a.firstCallConnectedPct / 100]);
      row.getCell(5).numFmt = PCT; row.getCell(10).numFmt = PCT; row.getCell(11).numFmt = PCT; row.getCell(17).numFmt = PCT;
    }
    ws.columns = agentHeader.map(() => ({ width: 16 }));
  }

  /* ------------------------ Campaign wise (LP Feedback) --------------------- */
  if (processKey === "lp_feedback") {
    const camp = wb.getWorksheet("Campaign wise")!;
    title(camp, "LP Feedback -- Campaign (Service) wise", subtitle);
    header(camp, ["Service", "Calls", "Connected", "Connected %", "Unique Leads"]);
    for (const s of d.byService) { const row = camp.addRow([s.service, s.calls, s.connected, s.connectedPct / 100, s.uniqueLeads]); row.getCell(4).numFmt = PCT; }
    camp.columns = [{ width: 30 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }];
  }

  /* ------------------------------ Average (Onboarding) ---------------------- */
  if (processKey === "lp_onboarding") {
    const avg = wb.getWorksheet("Average")!;
    title(avg, "LP Onboarding -- Averages", subtitle);
    header(avg, ["Metric", "Value"]);
    avg.addRow(["Average Talk Time", hms(h.avgTalkTimeSec)]);
    avg.addRow(["Average Talk Per Connected Call", hms(h.avgTalkPerConnectedSec)]);
    avg.addRow(["Average Lead Per Agent", h.avgLeadPerAgent]);
    avg.addRow(["Per Agent Dial Count", h.perAgentDialCount]);
    avg.addRow(["Average Attempts Per Lead", h.avgAttemptsPerLead]);
    avg.addRow(["Occupancy %", h.occupancyPct / 100]).getCell(2).numFmt = PCT;
    avg.addRow(["Shrinkage %", h.shrinkagePct / 100]).getCell(2).numFmt = PCT;
    avg.columns = [{ width: 34 }, { width: 16 }];
  }

  /* -------------------------------- Raw and APR ------------------------------ */
  const writeRows = (ws: ExcelJS.Worksheet, rows: RowDataPacket[]) => {
    if (rows.length > 0) {
      const cols = Object.keys(rows[0]);
      header(ws, cols);
      for (const r of rows) ws.addRow(cols.map((c) => r[c] ?? null));
    } else {
      header(ws, ["No rows loaded for this range"]);
    }
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };
  writeRows(wb.getWorksheet("Raw")!, cdrRange);
  const [aprRows] = await db.execute<RowDataPacket[]>(`SELECT * FROM ${tables.apr} ORDER BY id`);
  writeRows(wb.getWorksheet("APR")!, aprRows.filter((r) => inRange(r.report_date)));

  await wb.xlsx.writeFile(filePath);
  return { raw: [], sections: [...sheets], skipped: [] };
}
