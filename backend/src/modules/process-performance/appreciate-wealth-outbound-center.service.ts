import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { AW_SQL_DATE, secs, resolveRange } from "./appreciate-wealth-dashboard.service.js";

/**
 * Appreciate Wealth "Outbound Performance Dashboard" slide -- every figure is
 * computed from db_masmis.aw_out (the Outbound agent-day uploader).
 *
 * How aw_out is read
 *  - One agent-day is uploaded more than once (Excel-serial date row, text-date
 *    row, and a bare "incomplete" row without uuid). Rows are grouped by
 *    (date, agent_id), ordered complete-first then newest-first, and each field
 *    takes its first NON-BLANK value across the group -- the text-date rows lack
 *    actual_mandays, the serial-date rows carry it. Duplicates agree on calls,
 *    so nothing is double counted.
 *  - Only agent-days with login time > 0 are "active". An agent-day with no
 *    login (a placeholder row: 1 call, 0 login) is left out of every total,
 *    target and average and reported in coverage.excluded instead.
 *
 * Definitions (each reproduces the uploader's own derived column on sample rows)
 *  - Calling achievement   Σ calls / Σ calling_target.
 *  - Connectivity %        connected / calls.
 *  - AHT (w/o pick)        Σ(talk + wrap) / Σ connected           (= uploader `acht`).
 *  - AHT (with pick)       Σ(talk + wrap + pickup) / Σ calls      (= uploader `acht_with_picked_up_time`).
 *  - Occupancy (calling)   Σ(talk + wrap + pickup) / Σ(talk + wrap + pickup + idle)   (= `occupancy_on_calls`).
 *  - Occupancy (net login) Σ(talk + wrap) / Σ net login                                (= `net_occupancy`).
 *  - Occupancy (overall)   Σ(talk + wrap + pickup) / Σ gross login.
 *  - Late login %          agent-days flagged late_login_status = YES / active agent-days.
 *  - Wrap / Break exceed   agent-days with the uploader's exceed flag set (wrap > 1 h / a break > 1 h).
 *  - Product achievement   Σ amount / Σ target for LRS, Trade and Mutual Funds (INR).
 *
 * NOT available in the data, so not shown: a US SIP product (no columns), a
 * "MAS Tele" process split, and conversion % from the uploader's `conversion`
 * columns (all zero). Sale-count / connected calls is shown instead.
 */

type Row = RowDataPacket;
const num = (v: unknown): number => {
  const n = Number(String(v ?? "").replace(/,/g, "").replace(/%$/, "").trim());
  return Number.isFinite(n) ? n : 0;
};
const blank = (v: unknown): boolean => { const s = String(v ?? "").trim(); return s === "" || s.toLowerCase() === "null"; };
const round1 = (v: number): number => Math.round(v * 10) / 10;
const pct = (part: number, whole: number): number => (whole > 0 ? round1((part / whole) * 100) : 0);
const p2 = (n: number): string => String(n).padStart(2, "0");
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`;
}
function dayDiff(a: string, b: string): number {
  const p = (s: string) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(b) - p(a)) / 86400000);
}

const AUX_FIELDS: Array<{ key: string; label: string }> = [
  { key: "bio", label: "Bio" }, { key: "lunch", label: "Lunch" }, { key: "tea", label: "Tea" },
  { key: "meeting_aux", label: "Meeting" }, { key: "training", label: "Training" },
  { key: "sip_disconnected", label: "SIP disconnected" }, { key: "sip_unregistered", label: "SIP unregistered" },
  { key: "technical_issue_dialer", label: "Tech issue (dialer)" }, { key: "technical_issue_cc", label: "Tech issue (CC)" },
  { key: "technical_issue_crm", label: "Tech issue (CRM)" }, { key: "change_mode", label: "Change mode" }, { key: "qa_feedback", label: "QA feedback" },
];
const FIELDS = [
  "total_calls", "connected_calls", "not_connected_calls", "total_talk_time", "total_wrapup_time", "total_pause_time", "total_idle_time",
  "pickup_time", "total_login_time", "net_login_hrs", "actual_mandays", "late_login_status", "calling_target",
  "break_exceed_count", "wrap_exceed_count", "customer_disconnect", "agent_disconnect", "centre_mcn_or_enser",
  "lrs_target", "lrs_count", "lrs_amount", "trade_target", "trade_count", "trade_amount", "mf_target", "mf_count", "mf_amount",
  ...AUX_FIELDS.map((a) => a.key),
];

interface AgentDay {
  date: string; agentId: string; agentName: string; empId: string; team: string;
  calls: number; connected: number; notConnected: number;
  talkS: number; wrapS: number; pauseS: number; idleS: number; pickS: number; loginS: number; netS: number;
  mandays: number | null; late: boolean | null; target: number; wrapExceed: boolean; breakExceed: boolean;
  custDisc: number; agentDisc: number;
  lrsT: number; lrsC: number; lrsA: number; trT: number; trC: number; trA: number; mfT: number; mfC: number; mfA: number;
  aux: Record<string, number>;
  rawRows: number;
}

async function loadAgentDays(from: string, to: string): Promise<{ rows: AgentDay[]; rawRows: number }> {
  const D = AW_SQL_DATE("call_date");
  const [rs] = await db.execute<Row[]>(
    `SELECT id, agent_id, agent_name, emp_id, (uuid IS NOT NULL AND uuid <> '') AS complete, DATE_FORMAT(${D}, '%Y-%m-%d') AS d,
            ${FIELDS.map((f) => `\`${f}\``).join(", ")}
       FROM db_masmis.aw_out WHERE ${D} BETWEEN ? AND ?`,
    [from, to],
  );
  const groups = new Map<string, Row[]>();
  for (const r of rs) {
    const k = `${r.d}|${r.agent_id}`;
    const l = groups.get(k);
    if (l) l.push(r); else groups.set(k, [r]);
  }
  const rows: AgentDay[] = [];
  for (const [k, arr] of groups) {
    arr.sort((a, b) => Number(b.complete) - Number(a.complete) || Number(b.id) - Number(a.id));
    const pick = (f: string): unknown => { for (const r of arr) if (!blank(r[f])) return r[f]; return null; };
    const sec = (f: string): number => secs(pick(f)) ?? 0;
    const head = arr[0];
    const calls = num(pick("total_calls"));
    const connected = num(pick("connected_calls"));
    const nc = pick("not_connected_calls");
    const lateRaw = String(pick("late_login_status") ?? "").trim().toUpperCase();
    const aux: Record<string, number> = {};
    for (const a of AUX_FIELDS) aux[a.key] = sec(a.key);
    const md = pick("actual_mandays");
    rows.push({
      date: k.split("|")[0], agentId: String(head.agent_id), agentName: blank(head.agent_name) ? String(head.agent_id) : String(head.agent_name).trim(),
      empId: String(head.emp_id ?? ""), team: String(pick("centre_mcn_or_enser") ?? "").trim(),
      calls, connected, notConnected: nc === null ? Math.max(0, calls - connected) : num(nc),
      talkS: sec("total_talk_time"), wrapS: sec("total_wrapup_time"), pauseS: sec("total_pause_time"), idleS: sec("total_idle_time"),
      pickS: sec("pickup_time"), loginS: sec("total_login_time"), netS: sec("net_login_hrs"),
      mandays: md === null ? null : num(md), late: lateRaw === "YES" ? true : lateRaw === "NO" ? false : null,
      target: num(pick("calling_target")), wrapExceed: num(pick("wrap_exceed_count")) > 0, breakExceed: num(pick("break_exceed_count")) > 0,
      custDisc: num(pick("customer_disconnect")), agentDisc: num(pick("agent_disconnect")),
      lrsT: num(pick("lrs_target")), lrsC: num(pick("lrs_count")), lrsA: num(pick("lrs_amount")),
      trT: num(pick("trade_target")), trC: num(pick("trade_count")), trA: num(pick("trade_amount")),
      mfT: num(pick("mf_target")), mfC: num(pick("mf_count")), mfA: num(pick("mf_amount")),
      aux, rawRows: arr.length,
    });
  }
  return { rows, rawRows: rs.length };
}

export interface OutKpis {
  agentDays: number; agents: number; calls: number; target: number; achPct: number;
  connected: number; notConnected: number; connectedPct: number;
  avgConnectedPerAgentDay: number; avgNotConnectedPerAgentDay: number;
  talkS: number; avgTalkS: number; ahtNoPickS: number; ahtWithPickS: number;
  mandays: number; mandaysMissing: number;
  lateDays: number; latePct: number;
  occCallingPct: number; occNetPct: number; occOverallPct: number;
  wrapExceedDays: number; breakExceedDays: number;
  loginS: number; netS: number; wrapS: number; pauseS: number; idleS: number; pickS: number;
  agentDisc: number; custDisc: number; belowTargetDays: number;
  lrsT: number; lrsC: number; lrsA: number; trT: number; trC: number; trA: number; mfT: number; mfC: number; mfA: number;
  salesT: number; salesA: number; salesC: number;
}
export interface OutAgent extends OutKpis { agentId: string; name: string; empId: string; callsPerHr: number }
export interface OutDay extends OutKpis { date: string }
export interface AwOutboundCenter {
  from: string; to: string; effectiveTo: string; prevFrom: string; prevTo: string;
  coverage: {
    from: string | null; to: string | null; agentsInFile: number; teams: string[];
    excluded: { agentDays: number; calls: number };
  };
  kpis: OutKpis; prev: OutKpis | null;
  daily: OutDay[];
  agents: OutAgent[];
  status: { active: number; inactive: number; inactiveAgents: Array<{ agentId: string; name: string }>; activeAgents: Array<{ agentId: string; name: string }> };
  products: Array<{ key: "lrs" | "trade" | "mf"; label: string; target: number; achieved: number; count: number; effPct: number; avgTicket: number; salesPerConnectedPct: number }>;
  time: Array<{ key: string; label: string; seconds: number; pctOfLogin: number }>;
}

function kpisOf(rows: AgentDay[]): OutKpis {
  const s = (f: (r: AgentDay) => number): number => rows.reduce((a, r) => a + f(r), 0);
  const calls = s((r) => r.calls), connected = s((r) => r.connected), notConnected = s((r) => r.notConnected);
  const talkS = s((r) => r.talkS), wrapS = s((r) => r.wrapS), pickS = s((r) => r.pickS), idleS = s((r) => r.idleS);
  const loginS = s((r) => r.loginS), netS = s((r) => r.netS), pauseS = s((r) => r.pauseS);
  const target = s((r) => r.target);
  const lateKnown = rows.filter((r) => r.late !== null);
  const lateDays = lateKnown.filter((r) => r.late).length;
  const lrsT = s((r) => r.lrsT), lrsC = s((r) => r.lrsC), lrsA = s((r) => r.lrsA);
  const trT = s((r) => r.trT), trC = s((r) => r.trC), trA = s((r) => r.trA);
  const mfT = s((r) => r.mfT), mfC = s((r) => r.mfC), mfA = s((r) => r.mfA);
  const withMandays = rows.filter((r) => r.mandays !== null);
  const n = rows.length;
  return {
    agentDays: n, agents: new Set(rows.map((r) => r.agentId)).size, calls, target, achPct: pct(calls, target),
    connected, notConnected, connectedPct: pct(connected, calls),
    avgConnectedPerAgentDay: n ? round1(connected / n) : 0, avgNotConnectedPerAgentDay: n ? round1(notConnected / n) : 0,
    talkS, avgTalkS: connected > 0 ? Math.round(talkS / connected) : 0,
    ahtNoPickS: connected > 0 ? Math.round((talkS + wrapS) / connected) : 0,
    ahtWithPickS: calls > 0 ? Math.round((talkS + wrapS + pickS) / calls) : 0,
    mandays: Math.round(withMandays.reduce((a, r) => a + (r.mandays ?? 0), 0) * 10) / 10, mandaysMissing: n - withMandays.length,
    lateDays, latePct: pct(lateDays, lateKnown.length),
    occCallingPct: pct(talkS + wrapS + pickS, talkS + wrapS + pickS + idleS),
    occNetPct: pct(talkS + wrapS, netS), occOverallPct: pct(talkS + wrapS + pickS, loginS),
    wrapExceedDays: rows.filter((r) => r.wrapExceed).length, breakExceedDays: rows.filter((r) => r.breakExceed).length,
    loginS, netS, wrapS, pauseS, idleS, pickS,
    agentDisc: s((r) => r.agentDisc), custDisc: s((r) => r.custDisc),
    belowTargetDays: rows.filter((r) => r.target > 0 && r.calls < r.target).length,
    lrsT, lrsC, lrsA, trT, trC, trA, mfT, mfC, mfA,
    salesT: lrsT + trT + mfT, salesA: lrsA + trA + mfA, salesC: lrsC + trC + mfC,
  };
}

async function coverage(): Promise<{ from: string | null; to: string | null }> {
  const D = AW_SQL_DATE("call_date");
  const [[r]] = await db.execute<RowDataPacket[]>(`SELECT DATE_FORMAT(MIN(${D}), '%Y-%m-%d') AS mn, DATE_FORMAT(MAX(${D}), '%Y-%m-%d') AS mx FROM db_masmis.aw_out`);
  return { from: (r?.mn as string | null) ?? null, to: (r?.mx as string | null) ?? null };
}

export async function getAwOutboundCenter(fromInput: string, toInput: string): Promise<AwOutboundCenter> {
  const { from, to } = resolveRange(fromInput, toInput);
  const cov = await coverage();
  // Compare like with like: same number of DAYS OF DATA, not a long empty tail after the last upload.
  const effectiveTo = cov.to && cov.to >= from && cov.to < to ? cov.to : to;
  const len = dayDiff(from, effectiveTo) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(len - 1));

  const { rows: all } = await loadAgentDays([from, prevFrom].sort()[0], to);
  const inRange = (r: AgentDay, a: string, b: string) => r.date >= a && r.date <= b;
  const curAll = all.filter((r) => inRange(r, from, to));
  const prevAll = all.filter((r) => inRange(r, prevFrom, prevTo));
  const active = (r: AgentDay) => r.loginS > 0;
  const cur = curAll.filter(active);
  const prev = prevAll.filter(active);

  const excludedRows = curAll.filter((r) => !active(r));
  const dates = [...new Set(cur.map((r) => r.date))].sort();
  const daily: OutDay[] = dates.map((d) => ({ date: d, ...kpisOf(cur.filter((r) => r.date === d)) }));

  const byAgent = new Map<string, AgentDay[]>();
  for (const r of cur) { const l = byAgent.get(r.agentId); if (l) l.push(r); else byAgent.set(r.agentId, [r]); }
  const agents: OutAgent[] = [...byAgent.entries()].map(([agentId, rs]) => {
    const k = kpisOf(rs);
    return { ...k, agentId, name: rs[0].agentName, empId: rs[0].empId, callsPerHr: k.netS > 0 ? round1(k.calls / (k.netS / 3600)) : 0 };
  }).sort((a, b) => b.calls - a.calls);

  const seen = new Map<string, string>();
  for (const r of curAll) seen.set(r.agentId, r.agentName);
  const activeIds = new Set(cur.map((r) => r.agentId));
  const status = {
    active: activeIds.size,
    inactive: [...seen.keys()].filter((id) => !activeIds.has(id)).length,
    activeAgents: [...seen.entries()].filter(([id]) => activeIds.has(id)).map(([agentId, name]) => ({ agentId, name })),
    inactiveAgents: [...seen.entries()].filter(([id]) => !activeIds.has(id)).map(([agentId, name]) => ({ agentId, name })),
  };

  const k = kpisOf(cur);
  const prod = (key: "lrs" | "trade" | "mf", label: string, t: number, a: number, c: number) => ({
    key, label, target: t, achieved: a, count: c, effPct: pct(a, t), avgTicket: c > 0 ? Math.round(a / c) : 0, salesPerConnectedPct: pct(c, k.connected),
  });
  const products = [prod("lrs", "LRS", k.lrsT, k.lrsA, k.lrsC), prod("trade", "Trade", k.trT, k.trA, k.trC), prod("mf", "Mutual Funds", k.mfT, k.mfA, k.mfC)];

  const auxTotals = AUX_FIELDS.map((a) => ({ key: a.key, label: a.label, seconds: cur.reduce((x, r) => x + (r.aux[a.key] ?? 0), 0) }));
  const time = [
    { key: "login", label: "Gross login", seconds: k.loginS }, { key: "net", label: "Net login", seconds: k.netS },
    { key: "talk", label: "Talk", seconds: k.talkS }, { key: "wrap", label: "Wrap-up", seconds: k.wrapS },
    { key: "pickup", label: "Pickup", seconds: k.pickS }, { key: "idle", label: "Idle", seconds: k.idleS },
    { key: "pause", label: "Pause (all AUX)", seconds: k.pauseS }, ...auxTotals,
  ].map((t) => ({ ...t, pctOfLogin: pct(t.seconds, k.loginS) }));

  return {
    from, to, effectiveTo, prevFrom, prevTo,
    coverage: {
      from: cov.from, to: cov.to, agentsInFile: seen.size,
      teams: [...new Set(curAll.map((r) => r.team).filter((t) => t !== ""))].sort(),
      excluded: { agentDays: excludedRows.length, calls: excludedRows.reduce((a, r) => a + r.calls, 0) },
    },
    kpis: k, prev: prev.length ? kpisOf(prev) : null,
    daily, agents, status, products, time,
  };
}
