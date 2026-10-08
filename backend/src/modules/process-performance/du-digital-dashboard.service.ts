import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

/**
 * DU Digital Thailand / Korea "Performance Dashboard" -- reads
 * du_cdr_daily_actual (per-call) and du_apr_daily_actual (per-agent-day),
 * both populated by uploader/du_digital/*.py or the web Uploader page
 * (DU_CDR_KOREA/THAILAND, DU_APR_KOREA/THAILAND). One shared service,
 * parameterized by dashboardLabel, mirroring every other DU Digital file
 * in this module (du-apr-daily-bulk.service.ts, du-cdr-bulk.service.ts) --
 * Thailand and Korea are the same pipeline, not two.
 *
 * KPI formulas confirmed live 2026-10-01 by reverse-engineering the real
 * reference workbook's own numbers against a live CDR pull for the same
 * date (73 real Thailand calls): SL% = Answered-within-20s / Offered
 * (64/73 = 88%), AL% = Answered / Offered (66/73 = 90%), Abandon% =
 * Abandoned / Offered (7/73 = 10%) -- all three share Offered as the
 * denominator, not Answered. status='A' is "Answered" (confirmed: 66 of
 * 73 rows, exactly matching the reference's own "Call Answered"); every
 * other status value (NODISP, DROP, ...) is "Abandoned". "Within 20 Sec"
 * keys off queue_time_sec <= 20, not length_in_sec (confirmed: Answered
 * count 66 vs Answered-within-20 64 differ by exactly the count of
 * answered calls whose queue wait exceeded 20s).
 *
 * Tagging Count / Deficit: the reference workbook's own "Tagging Raw" sheet
 * (a separate, manually-maintained CRM export -- Application Reference
 * Number, Scenario, Call Status, etc.) was empty in the reference workbook
 * and was NOT part of what this session's auto-download/import covers --
 * only CDR and APR were asked for. No tagging data source exists yet, so
 * taggingCount is always 0 and deficit is always answered - 0 = answered,
 * honestly reflecting "nothing tagged yet" rather than fabricating a number.
 */

export type DuDashboardLabel = "KOREA" | "THAILAND";

interface CdrRow extends RowDataPacket {
  call_date: string;
  status: string;
  queue_time_sec: number;
  length_in_sec: number;
  user_group: string | null;
  hour_of_day: number | null;
  agent_user: string | null;
}

const ANSWERED_STATUS = "A";

function isAnswered(status: string): boolean {
  return status === ANSWERED_STATUS;
}

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
}

function hms(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

async function getProcessId(): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT id FROM process_master WHERE process_name = 'DU Digital' AND active_status = 1 LIMIT 1",
  );
  return (rows[0]?.id as string) ?? null;
}

async function loadCdrRows(processId: string, label: DuDashboardLabel, from: string, to: string): Promise<CdrRow[]> {
  const [rows] = await db.execute<CdrRow[]>(
    `SELECT call_date, status, queue_time_sec, length_in_sec, user_group, hour_of_day, agent_user
       FROM db_masmis.du_cdr_daily_actual
      WHERE process_id = ? AND dashboard_label = ? AND call_date BETWEEN ? AND ?`,
    [processId, label, from, to],
  );
  return rows;
}

interface AprRow extends RowDataPacket {
  call_date: string;
  agent_name: string;
  total_calls: number;
  login_seconds: number;
  talk_seconds: number;
}

async function loadAprRows(processId: string, label: DuDashboardLabel, from: string, to: string): Promise<AprRow[]> {
  const [rows] = await db.execute<AprRow[]>(
    `SELECT call_date, agent_name, total_calls, login_seconds, talk_seconds
       FROM db_masmis.du_apr_daily_actual
      WHERE process_id = ? AND dashboard_label = ? AND call_date BETWEEN ? AND ?`,
    [processId, label, from, to],
  );
  return rows;
}

export interface DuKpiBlock {
  offered: number; answered: number; answeredWithin20: number; abandoned: number; abandonedWithin20: number;
  slPct: number; alPct: number; abandonPct: number; ahtSec: number; aht: string;
  agentCount: number; taggingCount: number; deficit: number; taggingPct: number;
}

function kpiFromRows(rows: CdrRow[], agentCount: number): DuKpiBlock {
  const offered = rows.length;
  const answeredRows = rows.filter((r) => isAnswered(r.status));
  const answered = answeredRows.length;
  const abandonedRows = rows.filter((r) => !isAnswered(r.status));
  const abandoned = abandonedRows.length;
  const answeredWithin20 = answeredRows.filter((r) => Number(r.queue_time_sec) <= 20).length;
  const abandonedWithin20 = abandonedRows.filter((r) => Number(r.queue_time_sec) <= 20).length;
  const totalTalk = answeredRows.reduce((s, r) => s + Number(r.length_in_sec), 0);
  const ahtSec = answered > 0 ? totalTalk / answered : 0;
  const taggingCount = 0; // no tagging data source connected yet -- see module doc
  return {
    offered, answered, answeredWithin20, abandoned, abandonedWithin20,
    slPct: pct(answeredWithin20, offered), alPct: pct(answered, offered), abandonPct: pct(abandoned, offered),
    ahtSec, aht: hms(ahtSec),
    agentCount, taggingCount, deficit: Math.max(0, answered - taggingCount), taggingPct: pct(taggingCount, answered),
  };
}

export interface DuDayRow {
  date: string; offered: number; answered: number; answeredWithin20: number; abandoned: number; abandonedWithin20: number;
  slPct: number; alPct: number; abandonPct: number; ahtSec: number; agentCount: number;
}

export interface DuLanguageRow { userGroup: string; offered: number; answered: number; abandoned: number; slPct: number; alPct: number }
export interface DuHourRow { hour: number; offered: number; answered: number; answeredWithin20: number; abandoned: number }

/** One row per (agent, date) -- the richest single export, used both to build the Agent Wise
 * Performance table (summed per agent) and each agent's own drill-down (filtered to one agent)
 * client-side, the same "fetch the real granularity once, slice it in the browser" convention
 * Clovia's own dashboard already uses for its daily/weekly rollups. CDR-side counts (offered/
 * answered/abandoned) are matched to APR-side counts (calls/loginSec/talkSec) by agent identifier
 * -- confirmed live 2026-10-01 that both sources use the same raw vicidial login id (e.g.
 * "Agent7004") for a given agent, so no separate name-mapping table is needed. */
export interface DuAgentDayRow {
  agent: string; date: string; offered: number; answered: number; abandoned: number;
  calls: number; loginSec: number; talkSec: number;
}
export interface DuAgentRow {
  agent: string; offered: number; answered: number; abandoned: number; alPct: number;
  calls: number; loginSec: number; talkSec: number; login: string; talk: string;
}

export interface DuDigitalDashboardData {
  from: string; to: string;
  kpis: DuKpiBlock;
  snapshot: { today: DuKpiBlock & { date: string }; wtd: DuKpiBlock; mtd: DuKpiBlock };
  intraday: DuHourRow[];
  intradayDate: string;
  language: DuLanguageRow[];
  daily: DuDayRow[];
  agents: DuAgentRow[];
  agentDaily: DuAgentDayRow[];
  slots: DuSlotRow[];
  dataAvailable: boolean;
}

/** Slot-wise report: one row per (date, hour-of-day) across the requested range, so the browser
 * can pick any date and render its 24-hour slot table and heat strip without another request. */
export interface DuSlotRow {
  date: string; hour: number; offered: number; answered: number; answeredWithin20: number; abandoned: number;
  slPct: number; alPct: number; ahtSec: number;
}

function agentCountFor(aprRows: AprRow[], cdrRows: CdrRow[], date?: string): number {
  const apr = date ? aprRows.filter((r) => String(r.call_date) === date) : aprRows;
  if (apr.length > 0) return new Set(apr.map((r) => r.agent_name)).size;
  const cdr = date ? cdrRows.filter((r) => String(r.call_date) === date) : cdrRows;
  return new Set(cdr.filter((r) => r.agent_user).map((r) => r.agent_user)).size;
}

/** Defaults to the current month (1st through today) when either bound is missing or
 * unparseable, the same convention every other dashboard's own resolveRange() uses. */
function resolveRange(fromInput: string, toInput: string): { from: string; to: string } {
  const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  const today = new Date().toISOString().slice(0, 10);
  const to = isIso(toInput) ? toInput : today;
  const from = isIso(fromInput) ? fromInput : `${to.slice(0, 7)}-01`;
  return { from, to };
}

export async function getDuDigitalDashboard(label: DuDashboardLabel, fromInput: string, toInput: string): Promise<DuDigitalDashboardData> {
  const { from, to } = resolveRange(fromInput, toInput);
  const processId = await getProcessId();
  if (!processId) {
    const empty = kpiFromRows([], 0);
    return { from, to, kpis: empty, snapshot: { today: { ...empty, date: to }, wtd: empty, mtd: empty }, intraday: [], intradayDate: to, language: [], daily: [], agents: [], agentDaily: [], slots: [], dataAvailable: false };
  }

  const [cdrRows, aprRows] = await Promise.all([
    loadCdrRows(processId, label, from, to),
    loadAprRows(processId, label, from, to),
  ]);

  const kpis = kpiFromRows(cdrRows, agentCountFor(aprRows, cdrRows));

  // Performance Snapshot: Today = `to` itself; Week-to-date = Monday of `to`'s week through `to`;
  // Month-to-date = the 1st of `to`'s month through `to`. All derived from the same already-loaded
  // rows (no extra queries) by filtering call_date client-side.
  const toDate = new Date(`${to}T00:00:00Z`);
  const dow = (toDate.getUTCDay() + 6) % 7; // Monday=0
  const weekStart = new Date(toDate); weekStart.setUTCDate(toDate.getUTCDate() - dow);
  const weekStartIso = weekStart.toISOString().slice(0, 10);
  const monthStartIso = `${to.slice(0, 7)}-01`;

  const rowsBetween = (a: string, b: string) => cdrRows.filter((r) => String(r.call_date) >= a && String(r.call_date) <= b);
  const todayRows = rowsBetween(to, to);
  const wtdRows = rowsBetween(weekStartIso > from ? weekStartIso : from, to);
  const mtdRows = rowsBetween(monthStartIso > from ? monthStartIso : from, to);

  const snapshot = {
    today: { ...kpiFromRows(todayRows, agentCountFor(aprRows, cdrRows, to)), date: to },
    wtd: kpiFromRows(wtdRows, agentCountFor(aprRows, cdrRows)),
    mtd: kpiFromRows(mtdRows, agentCountFor(aprRows, cdrRows)),
  };

  // Intraday Call Flow: hour-of-day breakdown for the most recent date in range (matches the
  // reference dashboard's own "today only" intraday chart).
  const intradayDate = to;
  const hourMap = new Map<number, DuHourRow>();
  for (const r of todayRows) {
    if (r.hour_of_day === null) continue;
    const h = Number(r.hour_of_day);
    const cur = hourMap.get(h) ?? { hour: h, offered: 0, answered: 0, answeredWithin20: 0, abandoned: 0 };
    cur.offered += 1;
    if (isAnswered(r.status)) {
      cur.answered += 1;
      if (Number(r.queue_time_sec) <= 20) cur.answeredWithin20 += 1;
    } else {
      cur.abandoned += 1;
    }
    hourMap.set(h, cur);
  }
  const intraday = [...hourMap.values()].sort((a, b) => a.hour - b.hour);

  // Language / Queue View: grouped by user_group across the full requested range.
  const langMap = new Map<string, DuLanguageRow>();
  for (const r of cdrRows) {
    const key = (r.user_group ?? "").trim() || "(unlabelled)";
    const cur = langMap.get(key) ?? { userGroup: key, offered: 0, answered: 0, abandoned: 0, slPct: 0, alPct: 0 };
    cur.offered += 1;
    if (isAnswered(r.status)) cur.answered += 1; else cur.abandoned += 1;
    langMap.set(key, cur);
  }
  const language = [...langMap.values()].map((l) => ({ ...l, slPct: pct(l.answered, l.offered), alPct: pct(l.answered, l.offered) })).sort((a, b) => b.offered - a.offered);

  // Detailed Metrics Table: one row per date in range.
  const dateSet = new Set(cdrRows.map((r) => String(r.call_date)));
  const daily: DuDayRow[] = [...dateSet].sort().map((date) => {
    const dayRows = cdrRows.filter((r) => String(r.call_date) === date);
    const k = kpiFromRows(dayRows, agentCountFor(aprRows, cdrRows, date));
    return {
      date, offered: k.offered, answered: k.answered, answeredWithin20: k.answeredWithin20,
      abandoned: k.abandoned, abandonedWithin20: k.abandonedWithin20,
      slPct: k.slPct, alPct: k.alPct, abandonPct: k.abandonPct, ahtSec: k.ahtSec, agentCount: k.agentCount,
    };
  }).reverse();

  // Agent Wise Performance: merge CDR (per call, grouped by agent_user+date) with APR (per
  // agent-day, grouped by agent_name+date) by agent identifier -- see DuAgentDayRow's own doc.
  const agentDayMap = new Map<string, DuAgentDayRow>();
  // Real agents are consistently "Agent####" in both CDR and APR (confirmed live 2026-10-01
  // across Thailand and Korea). CDR's own `user` field can also carry "VDCL" -- a dialer/vendor
  // system placeholder on calls that dropped before ever reaching a real agent (confirmed: it
  // never appears in APR, which is per-agent by definition) -- excluded here so it doesn't show
  // up as a fake "agent" row.
  const isRealAgent = (v: string) => /^agent\d+$/i.test(v);
  const keyOf = (agent: string, date: string) => `${agent}|${date}`;
  for (const r of cdrRows) {
    const agent = (r.agent_user ?? "").trim();
    if (!agent || !isRealAgent(agent)) continue;
    const date = String(r.call_date);
    const k = keyOf(agent, date);
    const cur = agentDayMap.get(k) ?? { agent, date, offered: 0, answered: 0, abandoned: 0, calls: 0, loginSec: 0, talkSec: 0 };
    cur.offered += 1;
    if (isAnswered(r.status)) cur.answered += 1; else cur.abandoned += 1;
    agentDayMap.set(k, cur);
  }
  for (const r of aprRows) {
    const agent = (r.agent_name ?? "").trim();
    if (!agent) continue;
    const date = String(r.call_date);
    const k = keyOf(agent, date);
    const cur = agentDayMap.get(k) ?? { agent, date, offered: 0, answered: 0, abandoned: 0, calls: 0, loginSec: 0, talkSec: 0 };
    cur.calls += Number(r.total_calls);
    cur.loginSec += Number(r.login_seconds);
    cur.talkSec += Number(r.talk_seconds);
    agentDayMap.set(k, cur);
  }
  const agentDaily = [...agentDayMap.values()].sort((a, b) => (a.agent === b.agent ? a.date.localeCompare(b.date) : a.agent.localeCompare(b.agent)));

  const agentSummaryMap = new Map<string, DuAgentRow>();
  for (const r of agentDaily) {
    const cur = agentSummaryMap.get(r.agent) ?? { agent: r.agent, offered: 0, answered: 0, abandoned: 0, alPct: 0, calls: 0, loginSec: 0, talkSec: 0, login: "00:00:00", talk: "00:00:00" };
    cur.offered += r.offered; cur.answered += r.answered; cur.abandoned += r.abandoned;
    cur.calls += r.calls; cur.loginSec += r.loginSec; cur.talkSec += r.talkSec;
    agentSummaryMap.set(r.agent, cur);
  }
  const agents = [...agentSummaryMap.values()]
    .map((a) => ({ ...a, alPct: pct(a.answered, a.offered), login: hms(a.loginSec), talk: hms(a.talkSec) }))
    .sort((a, b) => b.offered - a.offered || b.calls - a.calls);

  // Slot-wise: every (date, hour) bucket in range, from the same already-loaded CDR rows.
  const slotMap = new Map<string, DuSlotRow & { _talk: number }>();
  for (const r of cdrRows) {
    if (r.hour_of_day === null) continue;
    const date = String(r.call_date);
    const hour = Number(r.hour_of_day);
    const k = `${date}|${hour}`;
    const cur = slotMap.get(k) ?? { date, hour, offered: 0, answered: 0, answeredWithin20: 0, abandoned: 0, slPct: 0, alPct: 0, ahtSec: 0, _talk: 0 };
    cur.offered += 1;
    if (isAnswered(r.status)) {
      cur.answered += 1;
      cur._talk += Number(r.length_in_sec);
      if (Number(r.queue_time_sec) <= 20) cur.answeredWithin20 += 1;
    } else {
      cur.abandoned += 1;
    }
    slotMap.set(k, cur);
  }
  const slots: DuSlotRow[] = [...slotMap.values()]
    .map(({ _talk, ...s }) => ({ ...s, slPct: pct(s.answeredWithin20, s.offered), alPct: pct(s.answered, s.offered), ahtSec: s.answered > 0 ? Math.round(_talk / s.answered) : 0 }))
    .sort((a, b) => (a.date === b.date ? a.hour - b.hour : a.date.localeCompare(b.date)));

  return { from, to, kpis, snapshot, intraday, intradayDate, language, daily, agents, agentDaily, slots, dataAvailable: cdrRows.length > 0 };
}
