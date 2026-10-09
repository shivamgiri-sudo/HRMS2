import ExcelJS from "exceljs";
import path from "path";
import { fileURLToPath } from "url";
import { query } from "../../db/mysql.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TPL = path.resolve(__dirname, "../../../templates/sbi-card");

async function loadTemplate(file: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(TPL, file));
  wb.calcProperties.fullCalcOnLoad = true;
  return wb;
}

function copyRowStyle(
  ws: ExcelJS.Worksheet,
  srcRow: number,
  dstRow: number,
  cols: number
) {
  for (let c = 1; c <= cols; c++) {
    const s = ws.getRow(srcRow).getCell(c);
    const d = ws.getRow(dstRow).getCell(c);
    d.style = JSON.parse(JSON.stringify(s.style));
  }
}

function timeFrac(t: string | null | undefined): number | null {
  if (!t) return null;
  const str = String(t);
  const m = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0)) / 86400;
}

async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  return wb.xlsx.writeBuffer() as Promise<Buffer>;
}

function getSbiProcessId(processId: string | null) {
  return processId || "SBI_CARD";
}

// ─── Agent MIS ──────────────────────────────────────────────────────────────

const AGENT_MIS_RAW = [
  "Employee ID",
  "DIALER ID",
  "Name",
  "TEAM",
  "TEAM LEADER",
  "Date",
  "Calls",
  "AOD Calls",
  "ACD Calls",
  "Transfered Calls",
  "Manual Calls",
  "ACW Active count",
  "Contacts",
  "PTP",
  "PAD",
  "Total Promises",
  "No Promise",
  "Amt collected PP",
  "Amt collected PU",
  "Amt collected",
  "First Login Time",
  "Target Time",
  "Last Logout Time",
  "TOS",
  "Talk",
  "Wrap",
  "Idle",
  "Preview",
];

export async function buildAgentMis(params: {
  from: string;
  to: string;
  processId?: string;
  team?: string;
  teamLeader?: string;
  agent?: string;
}): Promise<Buffer> {
  const pid = params.processId;
  const rows = await query<any>(
    `SELECT
      am.employee_id, am.dialer_id, am.agent_name, am.team, am.team_leader,
      am.report_date, am.calls, am.aod_calls, am.acd_calls, am.transferred_calls,
      am.manual_calls, am.acw_active_count, am.contacts, am.ptp, am.pad,
      am.total_promises, am.no_promise, am.amt_collected_pp, am.amt_collected_pu,
      am.amt_collected, am.first_login_time, am.target_time, am.last_logout_time,
      am.tos_hours, am.talk_hours, am.wrap_hours, am.idle_hours, am.leakage_seconds
    FROM sbi_card_agent_mis am
    JOIN process_master pm ON pm.id = am.process_id
    WHERE pm.process_code = ? AND am.report_date BETWEEN ? AND ?
    ORDER BY am.report_date, am.agent_name`,
    [pid || "SBI_CARD", params.from, params.to]
  );

  let filtered = rows;
  const norm = (v: any) =>
    String(v ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  if (params.team)
    filtered = filtered.filter((r) => norm(r.team) === norm(params.team));
  if (params.teamLeader)
    filtered = filtered.filter(
      (r) => norm(r.team_leader) === norm(params.teamLeader)
    );
  if (params.agent)
    filtered = filtered.filter(
      (r) =>
        r.agent_name === params.agent ||
        String(r.employee_id) === params.agent ||
        String(r.dialer_id) === params.agent
    );

  const wb = await loadTemplate("agent_mis.xlsx");
  const ws = wb.getWorksheet("Sheet1");
  if (!ws) throw new Error("agent_mis.xlsx missing Sheet1");

  const col: Record<string, string> = {};
  ws.getRow(1).eachCell((c, n) => {
    col[String(c.value)] = ws.getColumn(n).letter;
  });
  const L = (h: string) => col[h];
  const tos = 7.65;

  filtered.forEach((x, i) => {
    const r = 2 + i;
    if (i > 0) copyRowStyle(ws, 2, r, 49);
    const set = (h: string, v: any) => {
      ws.getCell(`${L(h)}${r}`).value = v;
    };
    const f = (h: string, formula: string) => set(h, { formula });

    const colMap: Record<string, any> = {
      "Employee ID": x.employee_id,
      "DIALER ID": x.dialer_id,
      Name: x.agent_name,
      TEAM: x.team,
      "TEAM LEADER": x.team_leader,
      Date: new Date(x.report_date),
      Calls: x.calls,
      "AOD Calls": x.aod_calls,
      "ACD Calls": x.acd_calls,
      "Transfered Calls": x.transferred_calls,
      "Manual Calls": x.manual_calls,
      "ACW Active count": x.acw_active_count,
      Contacts: x.contacts,
      PTP: x.ptp,
      PAD: x.pad,
      "Total Promises": x.total_promises,
      "No Promise": x.no_promise,
      "Amt collected PP": Number(x.amt_collected_pp) || 0,
      "Amt collected PU": Number(x.amt_collected_pu) || 0,
      "Amt collected": Number(x.amt_collected) || 0,
      "First Login Time": timeFrac(String(x.first_login_time ?? "")),
      "Target Time": timeFrac(String(x.target_time ?? "09:00:00")),
      "Last Logout Time": timeFrac(String(x.last_logout_time ?? "")),
      TOS: Number(x.tos_hours) || 0,
      Talk: Number(x.talk_hours) || 0,
      Wrap: Number(x.wrap_hours) || 0,
      Idle: Number(x.idle_hours) || 0,
      Preview: 0,
    };

    for (const h of AGENT_MIS_RAW) {
      set(h, colMap[h] ?? null);
    }

    const d = (h: string) => `${L(h)}${r}`;
    const safe = (num: string, den: string, alt: any = 0) =>
      `IFERROR(${num}/${den},${alt})`;
    f("Concate", `${L("DIALER ID")}${r}&${L("Date")}${r}`);
    f(
      "Leakage Of Day",
      `MAX(0,TIMEVALUE(${d("First Login Time")})-${d("Target Time")})`
    );
    f("AHT", safe(`(${d("Talk")}+${d("Wrap")})*3600`, d("Calls"), '"-"'));
    f("Talk %", safe(d("Talk"), d("TOS")));
    f("Wrap %", safe(d("Wrap"), d("TOS")));
    f("Idle %", safe(d("Idle"), d("TOS")));
    f("Preview %", safe(d("Preview"), d("TOS")));
    f("PTP Rate", safe(d("PTP"), d("Contacts")));
    f("PAD Rate", safe(d("PAD"), d("Contacts")));
    f("Total Promise Rate", safe(d("Total Promises"), d("Contacts")));
    f("NP Rate", safe(d("No Promise"), d("Contacts")));
    f("Contacts/Call", safe(d("Contacts"), d("Calls")));
    f("Calls/Hr", safe(d("Calls"), d("TOS")));
    f("Contacts / Hr", safe(d("Contacts"), d("TOS")));
    f("TotalPromises/Hr", safe(d("Total Promises"), d("TOS")));
    f("Amt Collected/Hr", safe(`N(${d("Amt collected")})`, d("TOS")));
    set("Days Worked", 1);
    f("Actual Tos", d("TOS"));
    f("Excess Tos", `${d("Actual Tos")}-${tos}`);
    f("TOS deviation", `MAX(0,${tos}-${d("Actual Tos")})`);
    f(
      "Status",
      `IF(TIMEVALUE(${d("First Login Time")})<=${d("Target Time")},"ON TIME","LATE")`
    );
  });

  // TEAM_LIST
  const tl = wb.getWorksheet("TEAM_LIST");
  if (tl) {
    const roster = await query<any>(
      `SELECT r.dialer_id, r.employee_id, r.agent_name, r.team, r.team_leader
       FROM sbi_card_roster r
       JOIN process_master pm ON pm.id = r.process_id
       WHERE pm.process_code = ?`,
      [pid || "SBI_CARD"]
    );
    roster.forEach((m: any, i: number) => {
      const r = 2 + i;
      if (i > 0) copyRowStyle(tl, 2, r, 7);
      tl.getCell(r, 1).value = m.dialer_id;
      tl.getCell(r, 2).value = m.employee_id;
      tl.getCell(r, 3).value = m.agent_name;
      tl.getCell(r, 4).value = m.employee_id;
      tl.getCell(r, 5).value = m.team;
      tl.getCell(r, 6).value = m.team_leader;
      tl.getCell(r, 7).value = null;
    });
  }

  return toBuffer(wb);
}

// ─── Dialer MIS ─────────────────────────────────────────────────────────────

export async function buildDialerMis(params: {
  from: string;
  to: string;
  processId?: string;
  campaign?: string;
}): Promise<Buffer> {
  const pid = params.processId;
  const rows = await query<any>(
    `SELECT dm.campaign, dm.report_date,
      dm.total_accounts, dm.accounts_excluded, dm.accounts_scheduled,
      dm.accounts_called, dm.dials, dm.answers, dm.connects,
      dm.make_calls, dm.aborts, dm.drop_calls, dm.ptp, dm.pad, dm.otp,
      dm.disp, dm.wn, dm.nc, dm.au, dm.voml, dm.ct, dm.tc,
      dm.ews, dm.ws, dm.ds, dm.bctp, dm.dptp, dm.wh, dm.lb, dm.tcbl,
      dm.tpc, dm.rtp, dm.cbl, dm.total_calls, dm.total_contacts,
      dm.total_promises, dm.agent_count, dm.agent_hours,
      dm.ptp_value, dm.total_ptp_value
    FROM sbi_card_dialer_mis dm
    JOIN process_master pm ON pm.id = dm.process_id
    WHERE pm.process_code = ? AND dm.report_date BETWEEN ? AND ? AND dm.is_rollup = 0
    ORDER BY dm.campaign, dm.report_date`,
    [pid || "SBI_CARD", params.from, params.to]
  );

  const wb = await loadTemplate("dialer_mis.xlsx");
  const start = new Date(params.from);
  const monthStart = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)
  );

  // Group rows by campaign
  const byCampaign: Record<string, any[]> = {};
  for (const r of rows) {
    if (!byCampaign[r.campaign]) byCampaign[r.campaign] = [];
    byCampaign[r.campaign].push(r);
  }

  for (const [sheetName, campRows] of Object.entries(byCampaign)) {
    if (params.campaign && params.campaign !== sheetName) continue;
    const ws = wb.getWorksheet(sheetName);
    if (!ws) continue;

    const headers = new Map<string, number>();
    ws.getRow(2).eachCell((cell, col) => {
      if (cell.value != null) headers.set(String(cell.value), col);
    });

    const colMap: Record<string, string> = {
      Date: "report_date",
      "Total Accounts": "total_accounts",
      "Accounts Excluded": "accounts_excluded",
      "Accounts Scheduled": "accounts_scheduled",
      "Accounts Called": "accounts_called",
      Dials: "dials",
      Answers: "answers",
      Connects: "connects",
      "Make Calls": "make_calls",
      Aborts: "aborts",
      "Drop Calls": "drop_calls",
      PTP: "ptp",
      PAD: "pad",
      OTP: "otp",
      DISP: "disp",
      WN: "wn",
      NC: "nc",
      AU: "au",
      VOML: "voml",
      CT: "ct",
      TC: "tc",
      EWS: "ews",
      WS: "ws",
      DS: "ds",
      BCTP: "bctp",
      DPTP: "dptp",
      WH: "wh",
      LB: "lb",
      TCBL: "tcbl",
      TPC: "tpc",
      RTP: "rtp",
      CBL: "cbl",
      "Total Calls": "total_calls",
      "Total Contacts": "total_contacts",
      "Total Promises": "total_promises",
      "Agent Count": "agent_count",
      "Agent Hours": "agent_hours",
    };

    for (const row of campRows) {
      const d = new Date(row.report_date);
      const dayIdx = Math.round(
        (d.getTime() - monthStart.getTime()) / 86400000
      );
      const r = 4 + dayIdx;
      if (r < 4 || r > 34) continue;

      for (const [header, dbCol] of Object.entries(colMap)) {
        const col = headers.get(header);
        if (!col) continue;
        const cell = ws.getRow(r).getCell(col);
        const cv = cell.value;
        if (cv && typeof cv === "object" && ("formula" in cv || "sharedFormula" in cv)) continue;
        if (header === "Date") {
          cell.value = d;
        } else {
          cell.value = row[dbCol] ?? null;
        }
      }
    }
  }

  return toBuffer(wb);
}

// ─── Campaign Performance ────────────────────────────────────────────────────

export async function buildCampaignPerformance(params: {
  from: string;
  to: string;
  processId?: string;
  campaign?: string;
  series?: string;
}): Promise<Buffer> {
  const pid = params.processId;
  let whereExtra = "";
  if (params.series === "1600") whereExtra = " AND dm.campaign LIKE '%1600%'";
  if (params.campaign) whereExtra += ` AND dm.campaign LIKE '%${params.campaign.replace(/'/g, "''")}%'`;

  const rows = await query<any>(
    `SELECT dm.campaign, dm.report_date,
      dm.total_accounts, dm.accounts_called, dm.dials, dm.answers,
      dm.connects, dm.ptp, dm.pad, dm.otp, dm.rtp, dm.aborts,
      dm.ptp_value, dm.total_ptp_value
    FROM sbi_card_dialer_mis dm
    JOIN process_master pm ON pm.id = dm.process_id
    WHERE pm.process_code = ? AND dm.report_date BETWEEN ? AND ? AND dm.is_rollup = 0${whereExtra}
    ORDER BY dm.campaign, dm.report_date`,
    [pid || "SBI_CARD", params.from, params.to]
  );

  // Aggregate across date range per campaign
  const byCampaign: Record<string, any> = {};
  for (const r of rows) {
    const c = r.campaign;
    if (!byCampaign[c]) {
      byCampaign[c] = {
        name: c,
        total_accounts: 0,
        accounts_called: 0,
        dials: 0,
        answers: 0,
        connects: 0,
        ptp: 0,
        pad: 0,
        otp: 0,
        rtp: 0,
        aborts: 0,
        ptp_value: 0,
      };
    }
    const agg = byCampaign[c];
    agg.total_accounts = Math.max(agg.total_accounts, r.total_accounts || 0);
    agg.accounts_called += r.accounts_called || 0;
    agg.dials += r.dials || 0;
    agg.answers += r.answers || 0;
    agg.connects += r.connects || 0;
    agg.ptp += r.ptp || 0;
    agg.pad += r.pad || 0;
    agg.otp += r.otp || 0;
    agg.rtp += r.rtp || 0;
    agg.aborts += r.aborts || 0;
    agg.ptp_value += Number(r.ptp_value) || 0;
  }

  const campaignList = Object.values(byCampaign);
  const wb = await loadTemplate("campaign_performance.xlsx");
  const perfWs = wb.getWorksheet("Performance Report");
  if (!perfWs) throw new Error("campaign_performance.xlsx missing Performance Report sheet");

  let startRow = 3;
  // find first data row by looking for a row with no formula in column A
  for (let r = 2; r <= 200; r++) {
    const v = perfWs.getCell(r, 1).value;
    if (v && typeof v === "string" && v.length > 0) { startRow = r; break; }
    if (r > 10 && !v) { startRow = r; break; }
  }

  const headers = new Map<string, number>();
  if (startRow > 2) {
    perfWs.getRow(startRow - 1).eachCell((cell, col) => {
      if (cell.value != null) headers.set(String(cell.value), col);
    });
  }

  // Write a simple flat table into the Performance Report sheet
  const colLetters = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N"];
  const headRow = [
    "Campaign", "Accounts", "Called", "Dials", "Answers", "Connects",
    "PTP", "PAD", "OTP", "RTP", "Aborts", "Pen%", "Contact%", "PTP%"
  ];

  // Write header
  headRow.forEach((h, i) => {
    perfWs.getCell(1, i + 1).value = h;
  });

  campaignList.forEach((c: any, i) => {
    const r = 2 + i;
    const div = (a: number, b: number) => (b > 0 ? a / b : 0);
    perfWs.getCell(r, 1).value = c.name;
    perfWs.getCell(r, 2).value = c.total_accounts;
    perfWs.getCell(r, 3).value = c.accounts_called;
    perfWs.getCell(r, 4).value = c.dials;
    perfWs.getCell(r, 5).value = c.answers;
    perfWs.getCell(r, 6).value = c.connects;
    perfWs.getCell(r, 7).value = c.ptp;
    perfWs.getCell(r, 8).value = c.pad;
    perfWs.getCell(r, 9).value = c.otp;
    perfWs.getCell(r, 10).value = c.rtp;
    perfWs.getCell(r, 11).value = c.aborts;
    perfWs.getCell(r, 12).value = { formula: `IFERROR(D${r}/B${r},0)`, result: div(c.dials, c.total_accounts) };
    perfWs.getCell(r, 13).value = { formula: `IFERROR(F${r}/D${r},0)`, result: div(c.connects, c.dials) };
    perfWs.getCell(r, 14).value = { formula: `IFERROR(G${r}/F${r},0)`, result: div(c.ptp, c.connects) };
  });

  return toBuffer(wb);
}

// ─── Pen Estimation ──────────────────────────────────────────────────────────

export async function buildPenEstimation(params: {
  date: string;
  processId?: string;
}): Promise<Buffer> {
  const pid = params.processId;
  const rows = await query<any>(
    `SELECT pe.call_table, pe.download_count, pe.penetration, pe.dials_required,
       pe.dph, pe.present_agents, pe.rostered_count, pe.present_agent_hrs,
       pe.dials, pe.estimated_pen, pe.target_penetration, pe.required_agent_hrs,
       pe.excess_deficit_hrs
     FROM sbi_card_pen_estimation pe
     JOIN process_master pm ON pm.id = pe.process_id
     WHERE pm.process_code = ? AND pe.report_date = ?
     ORDER BY pe.call_table`,
    [pid || "SBI_CARD", params.date]
  );

  const wb = await loadTemplate("pen_estimation.xlsx");
  const ws = wb.getWorksheet("Sheet1");
  if (!ws) throw new Error("pen_estimation.xlsx missing Sheet1");

  const n = rows.length;
  const first = 2;
  const last = first + n - 1;
  const t = last + 1;

  for (let r = 2; r <= 12; r++) ws.getRow(r).values = [];
  if (n > 0) copyRowStyle(ws, 8, 200, 14);

  rows.forEach((x: any, i: number) => {
    const r = first + i;
    copyRowStyle(ws, 2, r, 14);
    ws.getCell(`A${r}`).value = x.call_table;
    ws.getCell(`B${r}`).value = x.download_count;
    ws.getCell(`C${r}`).value = Number(x.target_penetration) || 4;
    ws.getCell(`D${r}`).value = {
      formula: `B${r}*C${r}`,
      result: (x.download_count || 0) * (Number(x.target_penetration) || 4),
    };
  });

  if (n > 0) {
    ws.getCell(`F${first}`).value = rows[0].present_agents;
    copyRowStyle(ws, 200, t, 14);
    ws.getRow(200).values = [];
    const set = (c: string, v: any) => {
      ws.getCell(`${c}${t}`).value = v;
    };
    ws.getCell(`A${t}`).value = "GRAND TOTAL";
    set("B", { formula: `SUM(B${first}:B${last})` });
    set("C", { formula: `AVERAGE(C${first}:C${last})` });
    set("D", { formula: `SUM(D${first}:D${last})` });
    set("E", rows[0].dph || 180);
    set("F", { formula: `F${first}` });
    set("G", { formula: `F${t}` });
    set("H", {
      formula: `${Number(rows[0].present_agent_hrs) || 0}*G${t}+0`,
    });
    set("I", { formula: `H${t}*E${t}` });
    set("J", { formula: `I${t}/B${t}` });
    set("K", Number(rows[0].target_penetration) || 4);
    set("L", { formula: `(B${t}*K${t})/E${t}` });
    set("M", { formula: `H${t}-L${t}` });
  }

  return toBuffer(wb);
}

// ─── Downtime Tracker ────────────────────────────────────────────────────────

export async function buildDowntimeTracker(params: {
  from: string;
  to: string;
  processId?: string;
  site?: string;
  status?: string;
}): Promise<Buffer> {
  const pid = params.processId;
  const args: any[] = [pid || "SBI_CARD", params.from, params.to];
  let extra = "";
  if (params.site) { extra += " AND dt.site = ?"; args.push(params.site); }
  if (params.status) { extra += " AND dt.status = ?"; args.push(params.status); }

  const rows = await query<any>(
    `SELECT dt.report_date, dt.start_time, dt.up_time, dt.downtime_minutes,
       dt.impacted_users, dt.responsibility, dt.reason, dt.site, dt.status,
       dt.rca, dt.remarks
     FROM sbi_card_downtime dt
     JOIN process_master pm ON pm.id = dt.process_id
     WHERE pm.process_code = ? AND dt.report_date BETWEEN ? AND ?${extra}
     ORDER BY dt.report_date, dt.start_time`,
    args
  );

  const wb = await loadTemplate("downtime_tracker.xlsx");
  const ws = wb.getWorksheet("Sheet1");
  if (!ws) throw new Error("downtime_tracker.xlsx missing Sheet1");

  rows.forEach((x: any, i: number) => {
    const r = 2 + i;
    if (i > 0) copyRowStyle(ws, 2, r, 18);
    ws.getCell(`A${r}`).value = new Date(x.report_date);
    ws.getCell(`B${r}`).value = timeFrac(String(x.start_time ?? ""));
    ws.getCell(`C${r}`).value = timeFrac(String(x.up_time ?? "")) ?? 0;
    ws.getCell(`D${r}`).value = { formula: `+C${r}-B${r}` };
    ws.getCell(`E${r}`).value = x.impacted_users;
    ws.getCell(`F${r}`).value = { formula: `+E${r}*D${r}` };
    ws.getCell(`G${r}`).value = 0;
    ws.getCell(`H${r}`).value = { formula: `F${r}-G${r}` };
    ws.getCell(`I${r}`).value = x.responsibility;
    ws.getCell(`J${r}`).value = x.reason;
    ws.getCell(`K${r}`).value = x.site;
    ws.getCell(`L${r}`).value = x.status;
    ws.getCell(`M${r}`).value = x.rca;
    ws.getCell(`N${r}`).value = x.site;
    ws.getCell(`O${r}`).value = { formula: `+F${r}*24` };
    ws.getCell(`P${r}`).value = { formula: `+G${r}*24` };
    ws.getCell(`Q${r}`).value = { formula: `+O${r}-P${r}` };
    ws.getCell(`R${r}`).value = x.remarks;
  });

  return toBuffer(wb);
}

// ─── First Call ──────────────────────────────────────────────────────────────

export async function buildFirstCall(params: {
  from: string;
  to: string;
  processId?: string;
}): Promise<Buffer> {
  const pid = params.processId;
  // First call time derived from agent_mis: per portfolio (campaign) per day, earliest first_login_time
  const rows = await query<any>(
    `SELECT dm.campaign AS portfolio, dm.report_date,
       MIN(am.first_login_time) AS shift_start,
       MIN(am.first_login_time) AS first_call_time,
       COUNT(DISTINCT am.agent_name) AS agents_logged_in
     FROM sbi_card_dialer_mis dm
     JOIN process_master pm ON pm.id = dm.process_id
     LEFT JOIN sbi_card_agent_mis am ON am.process_id = dm.process_id AND am.report_date = dm.report_date
     WHERE pm.process_code = ? AND dm.report_date BETWEEN ? AND ? AND dm.is_rollup = 0
     GROUP BY dm.campaign, dm.report_date
     ORDER BY dm.report_date, dm.campaign`,
    [pid || "SBI_CARD", params.from, params.to]
  );

  const wb = await loadTemplate("first_call.xlsx");
  const ws = wb.getWorksheet("Sheet1");
  if (!ws) throw new Error("first_call.xlsx missing Sheet1");

  const portfolios = [...new Set(rows.map((r: any) => r.portfolio))];
  const n = portfolios.length || 1;

  const styles: Record<number, any> = {};
  for (let c = 4; c <= 11; c++) {
    styles[c] = JSON.parse(JSON.stringify(ws.getRow(4).getCell(c).style));
  }
  for (let r = 4; r <= Math.max(ws.rowCount, 4); r++) {
    const row = ws.getRow(r);
    row.values = [];
    for (let c = 4; c <= 11; c++) row.getCell(c).style = {};
  }

  rows.forEach((x: any, i: number) => {
    const r = 4 + i;
    for (let c = 4; c <= 11; c++) {
      ws.getCell(r, c).style = JSON.parse(JSON.stringify(styles[c]));
    }
    ws.getCell(`D${r}`).value =
      i < n
        ? new Date(x.report_date)
        : { formula: `D${r - n}+1` };
    ws.getCell(`E${r}`).value = "Ahmedabad";
    ws.getCell(`F${r}`).value = "Mas Callnet";
    ws.getCell(`G${r}`).value = x.portfolio;
    ws.getCell(`H${r}`).value = x.agents_logged_in || 0;
    ws.getCell(`I${r}`).value = timeFrac(String(x.shift_start ?? "09:00:00")) ?? timeFrac("09:00:00");
    ws.getCell(`J${r}`).value = timeFrac(String(x.first_call_time ?? "09:00:00")) ?? 0;
    ws.getCell(`K${r}`).value = null;
  });

  return toBuffer(wb);
}
