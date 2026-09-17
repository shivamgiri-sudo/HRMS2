import { db } from "../../db/mysql.js";

/**
 * Shared implementation behind both LP Feedback and LP Onboarding's call-
 * performance dashboards -- their uploaded tables (lp_feedback_apr/cdr and
 * lp_onboarding_apr/cdr) are column-for-column identical (confirmed via
 * SHOW COLUMNS on both pairs), so this factors out the one real
 * implementation instead of duplicating ~250 lines per process. Only the
 * table names differ, and those are a closed whitelist below -- never take
 * a table name from a request.
 *
 * See lp-feedback-dashboard.service.ts for the full KPI-to-column mapping
 * writeup (Login count, Overall Calls, Unique Leadset, service codes,
 * Shrinkage/Occupancy formulas, why there's no TL-wise view). Everything
 * there applies identically to LP Onboarding.
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
  /** Total talk time across every agent in range, divided by Login Count --
   * an average-per-agent figure, not a raw sum (a raw sum across several
   * agents reads misleadingly like one person's talk time). */
  avgTalkTimeSec: number;
  occupancyPct: number;
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
}

export interface LpCallDashboardData {
  headline: LpCallHeadline;
  from: string;
  to: string;
  byService: LpCallServiceRow[];
  byWeek: LpCallWeekRow[];
  agents: LpCallAgentRow[];
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0;
}
function normalizeName(v: unknown): string {
  return String(v ?? "").trim().replace(/\s+/g, " ");
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
  const m = String(v ?? "").trim().match(/^(\d{1,3}):(\d{2}):(\d{2})$/);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
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
  reportDate: string;
  service: string;
  agent: string;
  loginId: string;
  leadId: string;
  connected: boolean;
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
}

export async function getLpCallDashboard(processKey: LpProcessKey, fromInput: string, toInput: string): Promise<LpCallDashboardData> {
  const { from, to } = resolveRange(fromInput, toInput);
  const { apr: aprTable, cdr: cdrTable } = TABLES[processKey];

  const [cdrRaw] = await db.execute<any[]>(
    `SELECT report_date, service, agent, login_id, lead_id, disposition_status
     FROM db_masmis.${cdrTable}`,
  );
  const [aprRaw] = await db.execute<any[]>(
    `SELECT report_date, agent, login_id, total_calls, login_time, net_login_time,
       talk_duration, handle_duration, total_break_duration
     FROM db_masmis.${aprTable}`,
  );

  const calls: CallRow[] = [];
  for (const r of cdrRaw as any[]) {
    const reportDate = parseRowDate(r.report_date);
    if (!reportDate || reportDate < from || reportDate > to) continue;
    calls.push({
      reportDate,
      service: normalizeName(r.service) || "Unknown",
      agent: normalizeName(r.agent) || "Unknown",
      loginId: normalizeName(r.login_id) || normalizeName(r.agent) || "Unknown",
      leadId: String(r.lead_id ?? "").trim(),
      connected: normalizeName(r.disposition_status).toLowerCase() === "connected",
    });
  }

  const aprRows: AprRow[] = [];
  for (const r of aprRaw as any[]) {
    const reportDate = parseRowDate(r.report_date);
    if (!reportDate || reportDate < from || reportDate > to) continue;
    aprRows.push({
      reportDate,
      agent: normalizeName(r.agent) || "Unknown",
      loginId: normalizeName(r.login_id) || normalizeName(r.agent) || "Unknown",
      totalCalls: num(r.total_calls),
      loginTimeSec: durationToSec(r.login_time),
      netLoginTimeSec: durationToSec(r.net_login_time),
      talkDurationSec: durationToSec(r.talk_duration),
      handleDurationSec: durationToSec(r.handle_duration),
      totalBreakDurationSec: durationToSec(r.total_break_duration),
    });
  }

  // ---- Headline ----
  const loginIds = new Set(aprRows.map((r) => r.loginId));
  const loginCount = loginIds.size;
  const overallCalls = calls.length;
  const leadSet = new Set(calls.map((c) => c.leadId).filter(Boolean));
  const uniqueLeadset = leadSet.size;
  const connectedCalls = calls.filter((c) => c.connected);
  const overallConnected = connectedCalls.length;
  const connectedLeadSet = new Set(connectedCalls.map((c) => c.leadId).filter(Boolean));
  const uniqueConnectedCalls = connectedLeadSet.size;

  const sumLogin = aprRows.reduce((s, r) => s + r.loginTimeSec, 0);
  const sumNetLogin = aprRows.reduce((s, r) => s + r.netLoginTimeSec, 0);
  const sumHandle = aprRows.reduce((s, r) => s + r.handleDurationSec, 0);
  const sumBreak = aprRows.reduce((s, r) => s + r.totalBreakDurationSec, 0);
  const sumTalk = aprRows.reduce((s, r) => s + r.talkDurationSec, 0);

  const headline: LpCallHeadline = {
    loginCount,
    overallCalls,
    uniqueLeadset,
    uniqueConnectedCalls,
    uniqueConnectivityPct: pct(uniqueConnectedCalls, uniqueLeadset),
    overallConnected,
    overallConnectedPct: pct(overallConnected, overallCalls),
    shrinkagePct: sumLogin > 0 ? Math.round(((sumLogin - sumNetLogin) / sumLogin) * 10000) / 100 : 0,
    avgLeadPerAgent: loginCount > 0 ? Math.round((uniqueLeadset / loginCount) * 100) / 100 : 0,
    perAgentDialCount: loginCount > 0 ? Math.round((overallCalls / loginCount) * 100) / 100 : 0,
    avgTalkTimeSec: loginCount > 0 ? Math.round(sumTalk / loginCount) : 0,
    occupancyPct: (sumLogin - sumBreak) > 0 ? Math.round((sumHandle / (sumLogin - sumBreak)) * 10000) / 100 : 0,
  };

  // ---- By service (campaign/lead-source code) ----
  const svcMap = new Map<string, { calls: number; connected: number; leads: Set<string> }>();
  for (const c of calls) {
    const cur = svcMap.get(c.service) ?? { calls: 0, connected: 0, leads: new Set<string>() };
    cur.calls += 1;
    if (c.connected) cur.connected += 1;
    if (c.leadId) cur.leads.add(c.leadId);
    svcMap.set(c.service, cur);
  }
  const byService: LpCallServiceRow[] = [...svcMap.entries()]
    .map(([service, v]) => ({
      service, calls: v.calls, connected: v.connected,
      connectedPct: pct(v.connected, v.calls), uniqueLeads: v.leads.size,
    }))
    .sort((a, b) => b.calls - a.calls);

  // ---- By week ----
  const weekMap = new Map<string, { logins: Set<string>; calls: number; leads: Set<string>; connected: number; talkSec: number }>();
  for (const c of calls) {
    const wk = weekLabelFor(c.reportDate);
    const cur = weekMap.get(wk) ?? { logins: new Set<string>(), calls: 0, leads: new Set<string>(), connected: 0, talkSec: 0 };
    cur.calls += 1;
    if (c.leadId) cur.leads.add(c.leadId);
    if (c.connected) cur.connected += 1;
    cur.logins.add(c.loginId);
    weekMap.set(wk, cur);
  }
  for (const r of aprRows) {
    const wk = weekLabelFor(r.reportDate);
    const cur = weekMap.get(wk) ?? { logins: new Set<string>(), calls: 0, leads: new Set<string>(), connected: 0, talkSec: 0 };
    cur.logins.add(r.loginId);
    cur.talkSec += r.talkDurationSec;
    weekMap.set(wk, cur);
  }
  const byWeek: LpCallWeekRow[] = [...weekMap.entries()]
    .map(([weekLabel, v]) => ({
      weekLabel, loginCount: v.logins.size, overallCalls: v.calls, uniqueLeadset: v.leads.size,
      overallConnected: v.connected, overallConnectedPct: pct(v.connected, v.calls), talkTimeSec: v.talkSec,
    }))
    .sort((a, b) => a.weekLabel.localeCompare(b.weekLabel));

  // ---- Agent-wise ----
  const callAggByAgent = new Map<string, { totalCalls: number; connected: number; leads: Set<string> }>();
  for (const c of calls) {
    const cur = callAggByAgent.get(c.agent) ?? { totalCalls: 0, connected: 0, leads: new Set<string>() };
    cur.totalCalls += 1;
    if (c.connected) cur.connected += 1;
    if (c.leadId) cur.leads.add(c.leadId);
    callAggByAgent.set(c.agent, cur);
  }
  const aprByAgent = new Map<string, AprRow>();
  for (const r of aprRows) aprByAgent.set(r.agent, r);

  const agentNames = new Set<string>([...callAggByAgent.keys(), ...aprByAgent.keys()]);
  const agents: LpCallAgentRow[] = [...agentNames].map((agent) => {
    const call = callAggByAgent.get(agent);
    const apr = aprByAgent.get(agent);
    const loginTimeSec = apr?.loginTimeSec ?? 0;
    const netLoginTimeSec = apr?.netLoginTimeSec ?? 0;
    const handleDurationSec = apr?.handleDurationSec ?? 0;
    const breakSec = apr?.totalBreakDurationSec ?? 0;
    return {
      agent,
      loginId: apr?.loginId ?? agent,
      totalCalls: call?.totalCalls ?? 0,
      connectedCalls: call?.connected ?? 0,
      connectedPct: pct(call?.connected ?? 0, call?.totalCalls ?? 0),
      uniqueLeads: call?.leads.size ?? 0,
      talkTimeSec: apr?.talkDurationSec ?? 0,
      loginTimeSec,
      netLoginTimeSec,
      shrinkagePct: loginTimeSec > 0 ? Math.round(((loginTimeSec - netLoginTimeSec) / loginTimeSec) * 10000) / 100 : 0,
      occupancyPct: (loginTimeSec - breakSec) > 0 ? Math.round((handleDurationSec / (loginTimeSec - breakSec)) * 10000) / 100 : 0,
    };
  }).sort((a, b) => b.totalCalls - a.totalCalls);

  return { headline, from, to, byService, byWeek, agents };
}
