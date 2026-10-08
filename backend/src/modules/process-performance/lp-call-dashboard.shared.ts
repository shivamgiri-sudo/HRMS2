import { db } from "../../db/mysql.js";

/**
 * Shared implementation behind both LP Feedback and LP Onboarding's call-
 * performance dashboards -- their uploaded tables (lp_feedback_apr/cdr and
 * lp_onboarding_apr/cdr) are column-for-column identical (confirmed via
 * SHOW COLUMNS on both pairs), so this factors out the one real
 * implementation instead of duplicating it per process. Only the table
 * names differ, and those are a closed whitelist below -- never take a
 * table name from a request.
 *
 * KPI definitions (verified against live data 2026-09-19):
 * - Unique Leadset = number of CDR rows with unique_flag = '1'. unique_flag
 *   is a per-lead, per-day call counter ("1" = the first call to that lead
 *   on that day, "2" = the second ...), so this equals the sum over days of
 *   distinct leads called that day -- SELECT report_date, COUNT(*) FROM
 *   <cdr> WHERE unique_flag = '1' GROUP BY report_date, summed. A lead
 *   worked on five different days counts five times, which is the
 *   process's own definition; distinct lead_id over the whole range (the
 *   previous formula) under-counted it.
 * - Unique Connected Calls uses the same per-day basis: distinct
 *   (report_date, lead_id) pairs that had at least one Connected call, so
 *   Unique Connectivity % compares like with like.
 * - Overall Calls / Overall Connected % count every CDR row;
 *   "connected" = disposition_status 'Connected'.
 * - Login Count = distinct login ids in the APR (agent productivity) file.
 * - Shrinkage = (login - net login) / login. Occupancy = handle / (login -
 *   break). Both from the APR file, summed across every agent-day in range.
 * - Time-of-day comes from start_time, which the source exports in two
 *   shapes: "YYYY-MM-DD HH:MM:SS" text, or (from files Excel saved with a
 *   General format) a bare day-fraction serial such as 46272.40806 -- the
 *   fractional part is the time of day. Both are parsed.
 * There is no TL-wise view: neither source table has a TL column.
 */

export type LpProcessKey = "lp_feedback" | "lp_onboarding";

const TABLES: Record<LpProcessKey, { apr: string; cdr: string }> = {
  lp_feedback: { apr: "lp_feedback_apr", cdr: "lp_feedback_cdr" },
  lp_onboarding: { apr: "lp_onboarding_apr", cdr: "lp_onboarding_cdr" },
};

export interface LpCallHeadline {
  loginCount: number;
  overallCalls: number;
  uniqueLeadset: number;
  uniqueConnectedCalls: number;
  uniqueConnectivityPct: number;
  overallConnected: number;
  overallConnectedPct: number;
  shrinkagePct: number;
  avgLeadPerAgent: number;
  perAgentDialCount: number;
  /** Average talk time of one agent for one day: total APR talk time divided
   * by the number of agent-day rows. (Dividing by Login Count instead gave a
   * whole-range total per agent, e.g. 65 hours, which isn't a figure anyone
   * can compare to a shift.) */
  avgTalkTimeSec: number;
  occupancyPct: number;
  /** Overall calls / unique leadset: how many dials a lead-day needs. */
  avgAttemptsPerLead: number;
  /** Of the first call to each lead-day (unique_flag = 1), the share that connected. */
  firstCallConnectedPct: number;
  /** Average talk time of a connected call. */
  avgTalkPerConnectedSec: number;
  callBackPct: number;
  activeDays: number;
  /** Distinct lead_id values present in the call file for the range -- the
   * closest real "data received" count (the lead-allocation table meant to
   * hold the true figure, mas_hrms.lp_leads_raw, is empty). */
  distinctLeads: number;
  /** Distinct leads with at least one connected call. */
  connectedLeads: number;
  /** Distinct leads with at least one call dispositioned "Allocate to advisor ..."
   * (LP Onboarding's qualified-and-handed-over outcome; 0 for Feedback, which has no such disposition). */
  advisorAllocatedLeads: number;
  /** Calls the customer asked to be called back on: status "Call Back" or a call-back disposition. */
  callBackCalls: number;
}

export interface LpCallServiceRow {
  service: string;
  calls: number;
  connected: number;
  connectedPct: number;
  uniqueLeads: number;
}

export interface LpCallWeekRow {
  weekLabel: string;
  loginCount: number;
  overallCalls: number;
  uniqueLeadset: number;
  overallConnected: number;
  overallConnectedPct: number;
  talkTimeSec: number;
}

export interface LpCallAgentRow {
  agent: string;
  loginId: string;
  totalCalls: number;
  connectedCalls: number;
  connectedPct: number;
  uniqueLeads: number;
  talkTimeSec: number;
  loginTimeSec: number;
  netLoginTimeSec: number;
  shrinkagePct: number;
  occupancyPct: number;
  daysWorked: number;
  /** Days with an APR (productivity) row -- the divisor for this agent's per-day time averages. */
  aprDays: number;
  avgCallsPerDay: number;
  avgTalkPerConnectedSec: number;
  idleSec: number;
  wrapupSec: number;
  breakSec: number;
  firstCallConnectedPct: number;
}

export interface LpDailyRow {
  date: string;
  calls: number;
  uniqueLeads: number;
  connected: number;
  connectedPct: number;
  uniqueConnected: number;
  loginCount: number;
  talkTimeSec: number;
}
export interface LpHourRow { hour: number; calls: number; connected: number; connectedPct: number }
export interface LpStatusRow { status: string; calls: number; pct: number }
export interface LpDispositionRow { disposition: string; calls: number; pct: number }
export interface LpAttemptRow { attempt: string; calls: number; connected: number; connectedPct: number }
export interface LpBucketRow { label: string; calls: number }
export interface LpTimeUse {
  /** Number of agent-day APR rows these sums cover -- divide by it for a
   * per-agent-per-day average. */
  agentDays: number;
  loginSec: number; netLoginSec: number;
  talkSec: number; wrapupSec: number; idleSec: number; holdSec: number; ringSec: number; breakSec: number; otherSec: number;
  breaks: { tea: number; lunch: number; meeting: number; bio: number; unsolicited: number };
  breakCount: number;
}

export interface LpCallDashboardData {
  headline: LpCallHeadline;
  from: string;
  to: string;
  byService: LpCallServiceRow[];
  byWeek: LpCallWeekRow[];
  agents: LpCallAgentRow[];
  daily: LpDailyRow[];
  byHour: LpHourRow[];
  byStatus: LpStatusRow[];
  byDisposition: LpDispositionRow[];
  byAttempt: LpAttemptRow[];
  talkBuckets: LpBucketRow[];
  hangup: LpBucketRow[];
  timeUse: LpTimeUse;
}

export type LpDetailKind = "agent" | "service" | "week" | "day";
export const LP_DETAIL_KINDS: LpDetailKind[] = ["agent", "service", "week", "day"];

export interface LpCallDetail {
  kind: LpDetailKind;
  key: string;
  title: string;
  subtitle: string;
  from: string;
  to: string;
  kpis: {
    calls: number; uniqueLeads: number; connected: number; connectedPct: number;
    uniqueConnected: number; uniqueConnectivityPct: number;
    avgTalkPerConnectedSec: number; firstCallConnectedPct: number; avgAttemptsPerLead: number;
  };
  daily: LpDailyRow[];
  byHour: LpHourRow[];
  byStatus: LpStatusRow[];
  byDisposition: LpDispositionRow[];
  byAttempt: LpAttemptRow[];
  /** Present when the slice has APR (productivity) rows: agent, week, day. */
  timeUse: LpTimeUse | null;
  shrinkagePct: number | null;
  occupancyPct: number | null;
  breakdownLabel: string;
  breakdown: Array<{ name: string; calls: number; connected: number; connectedPct: number; uniqueLeads: number }>;
  recentCalls: Array<{
    reportDate: string; hour: number | null; leadId: string; agent: string; service: string;
    disposition: string; status: string; attempt: number; talkSec: number;
  }>;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function normalizeName(v: unknown): string {
  return String(v ?? "").trim().replace(/\s+/g, " ");
}
/** Identity for "how many agents": the agent's name, not login_id -- login_id
 * is "GunjanTomar" in older APR files but the plain agent name in files
 * without a LoginId column, and the same person must count once. */
function personKey(agent: string): string {
  return agent.toLowerCase();
}

const MONTH_MAP: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** report_date is stored as free text "D-Mon-YY" (e.g. "1-Sep-26"), not a
 * real DATE column -- parsed to YYYY-MM-DD for range filtering and week
 * bucketing, same approach already used for Housing Owner's owner_cdr. */
function parseRowDate(raw: unknown): string | null {
  const m = String(raw ?? "").trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
  if (!m) return null;
  const mon = MONTH_MAP[m[2].toLowerCase()];
  if (!mon) return null;
  return `20${m[3]}-${mon}-${String(m[1]).padStart(2, "0")}`;
}

/** "H:MM:SS" / "HH:MM:SS" duration text -> seconds. */
function durationToSec(v: unknown): number {
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{1,3}):(\d{2}):(\d{2})$/);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  // Files Excel saved with a General format carry a duration as a day-fraction
  // ("0.000416667" = 36 s) instead of "HH:MM:SS" -- 1,853 LP Onboarding rows.
  if (/^\d*\.\d+$/.test(s)) {
    const n = Number(s);
    if (n > 0 && n < 1) return Math.round(n * 86400);
  }
  return 0;
}

/** Hour of day (0-23) from either "YYYY-MM-DD HH:MM:SS" text or a bare
 * Excel day-fraction serial like 46272.40806 (see file header). */
function parseHour(raw: unknown): number | null {
  const s = String(raw ?? "").trim();
  const iso = s.match(/^\d{4}-\d{2}-\d{2}[ T](\d{2}):/);
  if (iso) return Number(iso[1]);
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    const frac = n - Math.floor(n);
    if (frac === 0 && !s.includes(".")) return null;
    return Math.min(23, Math.floor(frac * 24 + 1e-9));
  }
  return null;
}

function normalizeStatus(v: unknown): string {
  const s = normalizeName(v).toLowerCase();
  if (s === "connected") return "Connected";
  if (s === "not connected") return "Not Connected";
  if (s === "call back") return "Call Back";
  return "Unknown";
}

function weekLabelFor(dateStr: string): string {
  const day = Number(dateStr.slice(8, 10));
  const weekNo = Math.min(5, Math.floor((day - 1) / 7) + 1);
  return `W-${weekNo}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function pad2(n: number): string { return String(n).padStart(2, "0"); }

export function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`;
  const to = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  return { from, to };
}

function resolveRange(fromInput: string, toInput: string): { from: string; to: string } {
  const fallback = currentMonthRange();
  const from = DATE_RE.test(fromInput) ? fromInput : fallback.from;
  const to = DATE_RE.test(toInput) ? toInput : fallback.to;
  return from <= to ? { from, to } : { from: to, to: from };
}

interface CallRow {
  id: number;
  reportDate: string;
  service: string;
  agent: string;
  loginId: string;
  leadId: string;
  connected: boolean;
  status: string;
  disposition: string;
  attempt: number;
  firstCall: boolean;
  hour: number | null;
  talkSec: number;
  hangupBy: string;
}

interface AprRow {
  reportDate: string;
  agent: string;
  loginId: string;
  totalCalls: number;
  loginTimeSec: number;
  netLoginTimeSec: number;
  talkDurationSec: number;
  handleDurationSec: number;
  totalBreakDurationSec: number;
  wrapupSec: number;
  idleSec: number;
  holdSec: number;
  ringSec: number;
  tea: number; lunch: number; meeting: number; bio: number; unsolicited: number;
  breakCount: number;
}

async function loadSlices(processKey: LpProcessKey, from: string, to: string): Promise<{ calls: CallRow[]; apr: AprRow[] }> {
  const { apr: aprTable, cdr: cdrTable } = TABLES[processKey];

  const [cdrRaw] = await db.execute<any[]>(
    `SELECT id, call_number, report_date, service, agent, login_id, lead_id, disposition_status, disposition,
            attempt, unique_flag, start_time, talk_duration, hangup_by
     FROM db_masmis.${cdrTable}
     ORDER BY id`,
  );
  const [aprRaw] = await db.execute<any[]>(
    `SELECT report_date, agent, login_id, total_calls, login_time, net_login_time,
       talk_duration, handle_duration, total_break_duration, wrapup_duration, idle_duration,
       hold_duration, ring_duration, tea, lunch, meeting, bio_break, unsolicited, break_count
     FROM db_masmis.${aprTable}
     ORDER BY id`,
  );

  const calls: CallRow[] = [];
  // call_number is the dialer's unique call id. A whole day can be loaded twice (LP Feedback
  // 12-Sep-26: all 2,373 calls appear a second time, later copy carrying a higher unique_flag),
  // which doubled that day's calls -- keep the first row (lowest id) per call_number.
  const seenCalls = new Set<string>();
  for (const r of cdrRaw as any[]) {
    const reportDate = parseRowDate(r.report_date);
    if (!reportDate || reportDate < from || reportDate > to) continue;
    const callNo = String(r.call_number ?? "").trim();
    if (callNo) {
      if (seenCalls.has(callNo)) continue;
      seenCalls.add(callNo);
    }
    const status = normalizeStatus(r.disposition_status);
    calls.push({
      id: num(r.id),
      reportDate,
      service: normalizeName(r.service) || "Unknown",
      agent: normalizeName(r.agent) || "Unknown",
      loginId: normalizeName(r.login_id) || normalizeName(r.agent) || "Unknown",
      leadId: String(r.lead_id ?? "").trim(),
      connected: status === "Connected",
      status,
      disposition: normalizeName(r.disposition) || "Unknown",
      attempt: Math.max(0, Math.trunc(num(r.attempt))),
      firstCall: String(r.unique_flag ?? "").trim() === "1",
      hour: parseHour(r.start_time),
      talkSec: durationToSec(r.talk_duration),
      hangupBy: /agent/i.test(String(r.hangup_by ?? "")) ? "Agent" : /customer/i.test(String(r.hangup_by ?? "")) ? "Customer" : "Unknown",
    });
  }

  // One APR row per agent per day. Overlapping uploads leave the same
  // agent-day in the table more than once (LP Feedback: 155 rows for 109
  // agent-days, confirmed live 2026-09-19), which inflated every total and
  // agent-day count. Rows are read in id order, so a later upload replaces
  // an earlier one for the same agent and date.
  const aprByAgentDay = new Map<string, AprRow>();
  for (const r of aprRaw as any[]) {
    const reportDate = parseRowDate(r.report_date);
    if (!reportDate || reportDate < from || reportDate > to) continue;
    const agentName = normalizeName(r.agent) || "Unknown";
    aprByAgentDay.set(`${personKey(agentName)}|${reportDate}`, {
      reportDate,
      agent: normalizeName(r.agent) || "Unknown",
      loginId: normalizeName(r.login_id) || normalizeName(r.agent) || "Unknown",
      totalCalls: num(r.total_calls),
      loginTimeSec: durationToSec(r.login_time),
      netLoginTimeSec: durationToSec(r.net_login_time),
      talkDurationSec: durationToSec(r.talk_duration),
      handleDurationSec: durationToSec(r.handle_duration),
      totalBreakDurationSec: durationToSec(r.total_break_duration),
      wrapupSec: durationToSec(r.wrapup_duration),
      idleSec: durationToSec(r.idle_duration),
      holdSec: durationToSec(r.hold_duration),
      ringSec: durationToSec(r.ring_duration),
      tea: durationToSec(r.tea), lunch: durationToSec(r.lunch), meeting: durationToSec(r.meeting),
      bio: durationToSec(r.bio_break), unsolicited: durationToSec(r.unsolicited),
      breakCount: num(r.break_count),
    });
  }
  return { calls, apr: [...aprByAgentDay.values()] };
}

/* ---------------------------- pure aggregations --------------------------- */

interface CallKpis {
  calls: number; uniqueLeads: number; connected: number; connectedPct: number;
  uniqueConnected: number; uniqueConnectivityPct: number;
  avgTalkPerConnectedSec: number; firstCallConnectedPct: number; avgAttemptsPerLead: number;
  callBackPct: number;
}

function callKpis(calls: CallRow[]): CallKpis {
  const uniqueLeads = calls.filter((c) => c.firstCall).length;
  const connectedCalls = calls.filter((c) => c.connected);
  const uniqueConnected = new Set(connectedCalls.filter((c) => c.leadId).map((c) => `${c.reportDate}|${c.leadId}`)).size;
  const firstCalls = calls.filter((c) => c.firstCall);
  const talk = connectedCalls.reduce((s, c) => s + c.talkSec, 0);
  return {
    calls: calls.length,
    uniqueLeads,
    connected: connectedCalls.length,
    connectedPct: pct(connectedCalls.length, calls.length),
    uniqueConnected,
    uniqueConnectivityPct: pct(uniqueConnected, uniqueLeads),
    avgTalkPerConnectedSec: connectedCalls.length ? Math.round(talk / connectedCalls.length) : 0,
    firstCallConnectedPct: pct(firstCalls.filter((c) => c.connected).length, firstCalls.length),
    avgAttemptsPerLead: uniqueLeads ? round2(calls.length / uniqueLeads) : 0,
    callBackPct: pct(calls.filter((c) => c.status === "Call Back").length, calls.length),
  };
}

function buildDaily(calls: CallRow[], apr: AprRow[]): LpDailyRow[] {
  const m = new Map<string, { calls: CallRow[]; logins: Set<string>; talk: number }>();
  for (const c of calls) {
    const cur = m.get(c.reportDate) ?? { calls: [], logins: new Set<string>(), talk: 0 };
    cur.calls.push(c);
    m.set(c.reportDate, cur);
  }
  for (const r of apr) {
    const cur = m.get(r.reportDate) ?? { calls: [], logins: new Set<string>(), talk: 0 };
    cur.logins.add(personKey(r.agent));
    cur.talk += r.talkDurationSec;
    m.set(r.reportDate, cur);
  }
  return [...m.entries()]
    .map(([date, v]) => {
      const k = callKpis(v.calls);
      return {
        date, calls: k.calls, uniqueLeads: k.uniqueLeads, connected: k.connected, connectedPct: k.connectedPct,
        uniqueConnected: k.uniqueConnected, loginCount: v.logins.size, talkTimeSec: v.talk,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function buildByHour(calls: CallRow[]): LpHourRow[] {
  const m = new Map<number, { calls: number; connected: number }>();
  for (const c of calls) {
    if (c.hour === null) continue;
    const cur = m.get(c.hour) ?? { calls: 0, connected: 0 };
    cur.calls += 1;
    if (c.connected) cur.connected += 1;
    m.set(c.hour, cur);
  }
  return [...m.entries()]
    .map(([hour, v]) => ({ hour, calls: v.calls, connected: v.connected, connectedPct: pct(v.connected, v.calls) }))
    .sort((a, b) => a.hour - b.hour);
}

function buildByStatus(calls: CallRow[]): LpStatusRow[] {
  const m = new Map<string, number>();
  for (const c of calls) m.set(c.status, (m.get(c.status) ?? 0) + 1);
  const order = ["Connected", "Call Back", "Not Connected", "Unknown"];
  return [...m.entries()]
    .map(([status, n]) => ({ status, calls: n, pct: pct(n, calls.length) }))
    .sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
}

const TOP_DISPOSITIONS = 10;
function buildByDisposition(calls: CallRow[]): LpDispositionRow[] {
  const m = new Map<string, number>();
  for (const c of calls) m.set(c.disposition, (m.get(c.disposition) ?? 0) + 1);
  const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, TOP_DISPOSITIONS);
  const rest = sorted.slice(TOP_DISPOSITIONS).reduce((s, [, n]) => s + n, 0);
  const rows = top.map(([disposition, n]) => ({ disposition, calls: n, pct: pct(n, calls.length) }));
  if (rest > 0) rows.push({ disposition: `Others (${sorted.length - TOP_DISPOSITIONS} more)`, calls: rest, pct: pct(rest, calls.length) });
  return rows;
}

const ATTEMPT_CAP = 8;
function buildByAttempt(calls: CallRow[]): LpAttemptRow[] {
  const m = new Map<number, { calls: number; connected: number }>();
  for (const c of calls) {
    if (c.attempt < 1) continue;
    const key = Math.min(c.attempt, ATTEMPT_CAP);
    const cur = m.get(key) ?? { calls: 0, connected: 0 };
    cur.calls += 1;
    if (c.connected) cur.connected += 1;
    m.set(key, cur);
  }
  return [...m.entries()]
    .map(([a, v]) => ({
      attempt: a >= ATTEMPT_CAP ? `${ATTEMPT_CAP}+` : String(a),
      calls: v.calls, connected: v.connected, connectedPct: pct(v.connected, v.calls),
    }))
    .sort((a, b) => parseInt(a.attempt, 10) - parseInt(b.attempt, 10));
}

function buildTalkBuckets(calls: CallRow[]): LpBucketRow[] {
  const bounds: Array<[string, number, number]> = [
    ["< 30 sec", 0, 30], ["30-60 sec", 30, 60], ["1-2 min", 60, 120], ["2-5 min", 120, 300], ["5+ min", 300, Infinity],
  ];
  const connected = calls.filter((c) => c.connected);
  return bounds.map(([label, lo, hi]) => ({
    label, calls: connected.filter((c) => c.talkSec >= lo && c.talkSec < hi).length,
  }));
}

function buildHangup(calls: CallRow[]): LpBucketRow[] {
  const m = new Map<string, number>();
  for (const c of calls) m.set(c.hangupBy, (m.get(c.hangupBy) ?? 0) + 1);
  return [...m.entries()].map(([label, n]) => ({ label: label === "Unknown" ? "Unknown" : `${label} ended call`, calls: n })).sort((a, b) => b.calls - a.calls);
}

function buildTimeUse(apr: AprRow[]): LpTimeUse {
  const sum = (f: (r: AprRow) => number) => apr.reduce((s, r) => s + f(r), 0);
  const loginSec = sum((r) => r.loginTimeSec);
  const talkSec = sum((r) => r.talkDurationSec);
  const wrapupSec = sum((r) => r.wrapupSec);
  const idleSec = sum((r) => r.idleSec);
  const holdSec = sum((r) => r.holdSec);
  const ringSec = sum((r) => r.ringSec);
  const breakSec = sum((r) => r.totalBreakDurationSec);
  return {
    agentDays: apr.length,
    loginSec, netLoginSec: sum((r) => r.netLoginTimeSec),
    talkSec, wrapupSec, idleSec, holdSec, ringSec, breakSec,
    // Login time the APR's own buckets don't account for -- shown honestly
    // rather than forced to add up.
    otherSec: Math.max(0, loginSec - (talkSec + wrapupSec + idleSec + holdSec + ringSec + breakSec)),
    breaks: {
      tea: sum((r) => r.tea), lunch: sum((r) => r.lunch), meeting: sum((r) => r.meeting),
      bio: sum((r) => r.bio), unsolicited: sum((r) => r.unsolicited),
    },
    breakCount: sum((r) => r.breakCount),
  };
}

function shrinkOf(apr: AprRow[]): number {
  const login = apr.reduce((s, r) => s + r.loginTimeSec, 0);
  const net = apr.reduce((s, r) => s + r.netLoginTimeSec, 0);
  return login > 0 ? round2(((login - net) / login) * 100) : 0;
}
function occupancyOf(apr: AprRow[]): number {
  const login = apr.reduce((s, r) => s + r.loginTimeSec, 0);
  const brk = apr.reduce((s, r) => s + r.totalBreakDurationSec, 0);
  const handle = apr.reduce((s, r) => s + r.handleDurationSec, 0);
  return login - brk > 0 ? round2((handle / (login - brk)) * 100) : 0;
}

function groupCalls(calls: CallRow[], keyOf: (c: CallRow) => string) {
  const m = new Map<string, CallRow[]>();
  for (const c of calls) {
    const k = keyOf(c);
    const arr = m.get(k);
    if (arr) arr.push(c); else m.set(k, [c]);
  }
  return m;
}

/* ------------------------------ dashboard --------------------------------- */

export async function getLpCallDashboard(processKey: LpProcessKey, fromInput: string, toInput: string): Promise<LpCallDashboardData> {
  const { from, to } = resolveRange(fromInput, toInput);
  const { calls, apr } = await loadSlices(processKey, from, to);

  const k = callKpis(calls);
  const loginCount = new Set(apr.map((r) => personKey(r.agent))).size;
  const sumTalk = apr.reduce((s, r) => s + r.talkDurationSec, 0);

  const headline: LpCallHeadline = {
    loginCount,
    overallCalls: k.calls,
    uniqueLeadset: k.uniqueLeads,
    uniqueConnectedCalls: k.uniqueConnected,
    uniqueConnectivityPct: k.uniqueConnectivityPct,
    overallConnected: k.connected,
    overallConnectedPct: k.connectedPct,
    shrinkagePct: shrinkOf(apr),
    avgLeadPerAgent: loginCount > 0 ? round2(k.uniqueLeads / loginCount) : 0,
    perAgentDialCount: loginCount > 0 ? round2(k.calls / loginCount) : 0,
    avgTalkTimeSec: apr.length > 0 ? Math.round(sumTalk / apr.length) : 0,
    occupancyPct: occupancyOf(apr),
    avgAttemptsPerLead: k.avgAttemptsPerLead,
    firstCallConnectedPct: k.firstCallConnectedPct,
    avgTalkPerConnectedSec: k.avgTalkPerConnectedSec,
    callBackPct: k.callBackPct,
    activeDays: new Set(calls.map((c) => c.reportDate)).size,
    distinctLeads: new Set(calls.map((c) => c.leadId)).size,
    connectedLeads: new Set(calls.filter((c) => c.connected).map((c) => c.leadId)).size,
    advisorAllocatedLeads: new Set(calls.filter((c) => /^allocate to advisor/i.test(c.disposition)).map((c) => c.leadId)).size,
    callBackCalls: calls.filter((c) => c.status === "Call Back" || /call ?back/i.test(c.disposition)).length,
  };

  const byService: LpCallServiceRow[] = [...groupCalls(calls, (c) => c.service).entries()]
    .map(([service, rows]) => {
      const kk = callKpis(rows);
      return { service, calls: kk.calls, connected: kk.connected, connectedPct: kk.connectedPct, uniqueLeads: kk.uniqueLeads };
    })
    .sort((a, b) => b.calls - a.calls);

  const weekCalls = groupCalls(calls, (c) => weekLabelFor(c.reportDate));
  const weekApr = new Map<string, AprRow[]>();
  for (const r of apr) {
    const wk = weekLabelFor(r.reportDate);
    const arr = weekApr.get(wk);
    if (arr) arr.push(r); else weekApr.set(wk, [r]);
  }
  const weekKeys = new Set<string>([...weekCalls.keys(), ...weekApr.keys()]);
  const byWeek: LpCallWeekRow[] = [...weekKeys].map((weekLabel) => {
    const rows = weekCalls.get(weekLabel) ?? [];
    const aprRows = weekApr.get(weekLabel) ?? [];
    const kk = callKpis(rows);
    const logins = new Set<string>([...rows.map((c) => personKey(c.agent)), ...aprRows.map((r) => personKey(r.agent))]);
    return {
      weekLabel, loginCount: logins.size, overallCalls: kk.calls, uniqueLeadset: kk.uniqueLeads,
      overallConnected: kk.connected, overallConnectedPct: kk.connectedPct,
      talkTimeSec: aprRows.reduce((s, r) => s + r.talkDurationSec, 0),
    };
  }).sort((a, b) => a.weekLabel.localeCompare(b.weekLabel));

  const callsByAgent = groupCalls(calls, (c) => c.agent);
  const aprByAgent = new Map<string, AprRow[]>();
  for (const r of apr) {
    const arr = aprByAgent.get(r.agent);
    if (arr) arr.push(r); else aprByAgent.set(r.agent, [r]);
  }
  const agentNames = new Set<string>([...callsByAgent.keys(), ...aprByAgent.keys()]);
  const agents: LpCallAgentRow[] = [...agentNames].map((agent) => {
    const rows = callsByAgent.get(agent) ?? [];
    const aprRows = aprByAgent.get(agent) ?? [];
    const kk = callKpis(rows);
    const loginTimeSec = aprRows.reduce((s, r) => s + r.loginTimeSec, 0);
    const days = new Set<string>([...rows.map((c) => c.reportDate), ...aprRows.map((r) => r.reportDate)]).size;
    return {
      agent,
      loginId: aprRows[0]?.loginId ?? rows[0]?.loginId ?? agent,
      totalCalls: kk.calls,
      connectedCalls: kk.connected,
      connectedPct: kk.connectedPct,
      uniqueLeads: kk.uniqueLeads,
      talkTimeSec: aprRows.reduce((s, r) => s + r.talkDurationSec, 0),
      loginTimeSec,
      netLoginTimeSec: aprRows.reduce((s, r) => s + r.netLoginTimeSec, 0),
      shrinkagePct: shrinkOf(aprRows),
      occupancyPct: occupancyOf(aprRows),
      daysWorked: days,
      aprDays: aprRows.length,
      avgCallsPerDay: days ? Math.round(kk.calls / days) : 0,
      avgTalkPerConnectedSec: kk.avgTalkPerConnectedSec,
      idleSec: aprRows.reduce((s, r) => s + r.idleSec, 0),
      wrapupSec: aprRows.reduce((s, r) => s + r.wrapupSec, 0),
      breakSec: aprRows.reduce((s, r) => s + r.totalBreakDurationSec, 0),
      firstCallConnectedPct: kk.firstCallConnectedPct,
    };
  }).sort((a, b) => b.totalCalls - a.totalCalls);

  return {
    headline, from, to, byService, byWeek, agents,
    daily: buildDaily(calls, apr),
    byHour: buildByHour(calls),
    byStatus: buildByStatus(calls),
    byDisposition: buildByDisposition(calls),
    byAttempt: buildByAttempt(calls),
    talkBuckets: buildTalkBuckets(calls),
    hangup: buildHangup(calls),
    timeUse: buildTimeUse(apr),
  };
}

/* ------------------------------- drill-down ------------------------------- */

const RECENT_CALLS_LIMIT = 30;

/** One slice of the dashboard -- a single agent, service, week or day --
 * returned by its own endpoint so a row click opens a full detail drawer
 * instead of reusing the list payload. Returns null when the key matches
 * nothing in range. */
export async function getLpCallDetail(
  processKey: LpProcessKey, kind: LpDetailKind, keyRaw: string, fromInput: string, toInput: string,
): Promise<LpCallDetail | null> {
  const { from, to } = resolveRange(fromInput, toInput);
  const key = String(keyRaw ?? "").trim();
  const { calls: allCalls, apr: allApr } = await loadSlices(processKey, from, to);

  let calls: CallRow[];
  let apr: AprRow[];
  let title = key;
  let subtitle = "";
  let breakdownLabel = "Agents";
  let breakdownKey: (c: CallRow) => string = (c) => c.agent;

  switch (kind) {
    case "agent":
      calls = allCalls.filter((c) => c.agent === key);
      apr = allApr.filter((r) => r.agent === key);
      subtitle = "Agent";
      breakdownLabel = "Lead-source (Service)";
      breakdownKey = (c) => c.service;
      break;
    case "service":
      calls = allCalls.filter((c) => c.service === key);
      apr = [];
      subtitle = "Lead-source (Service)";
      break;
    case "week":
      calls = allCalls.filter((c) => weekLabelFor(c.reportDate) === key);
      apr = allApr.filter((r) => weekLabelFor(r.reportDate) === key);
      subtitle = "Week of month";
      break;
    case "day":
      calls = allCalls.filter((c) => c.reportDate === key);
      apr = allApr.filter((r) => r.reportDate === key);
      subtitle = "Day";
      break;
  }
  if (calls.length === 0 && apr.length === 0) return null;

  const k = callKpis(calls);
  const breakdown = [...groupCalls(calls, breakdownKey).entries()]
    .map(([name, rows]) => {
      const kk = callKpis(rows);
      return { name, calls: kk.calls, connected: kk.connected, connectedPct: kk.connectedPct, uniqueLeads: kk.uniqueLeads };
    })
    .sort((a, b) => b.calls - a.calls);

  const recentCalls = [...calls]
    .sort((a, b) => (a.reportDate === b.reportDate ? b.id - a.id : b.reportDate.localeCompare(a.reportDate)))
    .slice(0, RECENT_CALLS_LIMIT)
    .map((c) => ({
      reportDate: c.reportDate, hour: c.hour, leadId: c.leadId, agent: c.agent, service: c.service,
      disposition: c.disposition, status: c.status, attempt: c.attempt, talkSec: c.talkSec,
    }));

  return {
    kind, key, title, subtitle, from, to,
    kpis: {
      calls: k.calls, uniqueLeads: k.uniqueLeads, connected: k.connected, connectedPct: k.connectedPct,
      uniqueConnected: k.uniqueConnected, uniqueConnectivityPct: k.uniqueConnectivityPct,
      avgTalkPerConnectedSec: k.avgTalkPerConnectedSec, firstCallConnectedPct: k.firstCallConnectedPct,
      avgAttemptsPerLead: k.avgAttemptsPerLead,
    },
    daily: buildDaily(calls, apr),
    byHour: buildByHour(calls),
    byStatus: buildByStatus(calls),
    byDisposition: buildByDisposition(calls),
    byAttempt: buildByAttempt(calls),
    timeUse: apr.length ? buildTimeUse(apr) : null,
    shrinkagePct: apr.length ? shrinkOf(apr) : null,
    occupancyPct: apr.length ? occupancyOf(apr) : null,
    breakdownLabel,
    breakdown,
    recentCalls,
  };
}
