import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { AW_SQL_DATE, resolveRange, loadCalls, type CallRec } from "./appreciate-wealth-dashboard.service.js";

/**
 * Appreciate Wealth "CDR Report" slide -- KPI strip, daily trend, call-type mix,
 * call outcomes, call-type performance, talk-time analysis, agent disconnections,
 * the daily call-type detail table and the agent-wise summary, all from
 * db_masmis.aw_new_cdr (the Onboarding team's dialer CDR: Progressive + Manual
 * outbound legs plus the Onboarded inbound DIDs), loaded through the same
 * de-duplicating loadCalls("cdr") the Outbound Dialer tab uses, so totals agree.
 *
 * Definitions
 *  - Call        one de-duplicated CDR leg (call_id + agent + start second). call_id
 *                alone repeats when the dialer writes one leg per agent.
 *  - Answered    status = Answered;  Unanswered = every other leg.
 *  - Avg Talk / Avg Wrap / Avg Hold   Σ over ANSWERED legs / answered legs.
 *  - AHT (w/o pickup)   Σ handling_time over answered legs / answered legs
 *                       (= avg talk + avg wrap + avg hold on the sample rows).
 *  - AHT (with pickup)  AHT + average time_to_answer; only when time_to_answer is
 *                       populated on the answered legs (otherwise null, not guessed).
 *  - Wrap-up total       Σ wrapup_duration over ALL legs (unanswered legs also log wrap-up).
 *  - Agent disconnection legs whose hangup_by = AgentHangup, on the last day with data.
 *
 * NOT computable, so not shown: the mock-up's "within / before / after window"
 * outcome split (no operating-window definition exists in the data) and any
 * ENSER team (the only partner value is "MCN Team").
 */

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

export interface CdrAgg {
  calls: number; answered: number; unanswered: number; answerPct: number; unansweredPct: number;
  talkS: number; wrapS: number; holdS: number;
  avgTalkS: number; avgWrapS: number; avgHoldS: number; ahtS: number; ahtWithPickupS: number | null;
}
export interface CdrTypeRow extends CdrAgg { type: string; pctOfCalls: number; days: number; answeredPerDay: number; unansweredPerDay: number }
export interface CdrDetailRow extends CdrAgg { date: string; type: string }
export interface CdrAgentRow extends CdrAgg { agent: string; agentId: string }
export interface AwCdrCenter {
  from: string; to: string; effectiveTo: string; prevFrom: string; prevTo: string;
  coverage: { from: string | null; to: string | null; teams: string[]; rawRows: number; dedupDropped: number; daysWithData: number; ttaAvailable: boolean };
  kpis: CdrAgg; prev: CdrAgg | null;
  daily: Array<{ date: string; calls: number; answered: number; unanswered: number; answerPct: number }>;
  types: CdrTypeRow[];
  outcomes: { answered: number; unanswered: number; hangup: Array<{ label: string; count: number }> };
  talk: { avgTalkS: number; avgWrapS: number; avgHoldS: number };
  agentDisconnect: { date: string | null; items: Array<{ agent: string; agentId: string; count: number }> };
  details: CdrDetailRow[]; grand: CdrAgg;
  agents: CdrAgentRow[];
}

function aggOf(rows: CallRec[]): CdrAgg {
  const ans = rows.filter((r) => r.answered);
  const calls = rows.length, answered = ans.length, unanswered = calls - answered;
  const sum = (rs: CallRec[], f: (r: CallRec) => number) => rs.reduce((a, r) => a + f(r), 0);
  const talkS = sum(ans, (r) => r.talkS), holdS = sum(ans, (r) => r.holdS), handling = sum(ans, (r) => r.handlingS);
  const wrapAnsS = sum(ans, (r) => r.wrapS);
  const ttaLegs = ans.filter((r) => r.ttaS !== null);
  const avgTta = ttaLegs.length === answered && answered > 0 ? sum(ttaLegs, (r) => r.ttaS ?? 0) / answered : null;
  const ahtS = answered > 0 ? handling / answered : 0;
  return {
    calls, answered, unanswered, answerPct: pct(answered, calls), unansweredPct: pct(unanswered, calls),
    talkS, wrapS: sum(rows, (r) => r.wrapS), holdS,
    avgTalkS: answered > 0 ? Math.round(talkS / answered) : 0, avgWrapS: answered > 0 ? Math.round(wrapAnsS / answered) : 0,
    avgHoldS: answered > 0 ? Math.round(holdS / answered) : 0, ahtS: Math.round(ahtS),
    ahtWithPickupS: avgTta === null ? null : Math.round(ahtS + avgTta),
  };
}

async function cdrCoverage(): Promise<{ from: string | null; to: string | null }> {
  const D = AW_SQL_DATE("call_date");
  const [[r]] = await db.execute<RowDataPacket[]>(`SELECT DATE_FORMAT(MIN(${D}), '%Y-%m-%d') AS mn, DATE_FORMAT(MAX(${D}), '%Y-%m-%d') AS mx FROM db_masmis.aw_new_cdr`);
  return { from: (r?.mn as string | null) ?? null, to: (r?.mx as string | null) ?? null };
}

const TYPE_ORDER = ["Progressive", "Manual", "Inbound"];
const typeRank = (t: string): number => { const i = TYPE_ORDER.indexOf(t); return i < 0 ? TYPE_ORDER.length : i; };

export async function getAwCdrCenter(fromInput: string, toInput: string): Promise<AwCdrCenter> {
  const { from, to } = resolveRange(fromInput, toInput);
  const cov = await cdrCoverage();
  // Compare like with like: same number of DAYS OF DATA, not a long empty tail after the last upload.
  const effectiveTo = cov.to && cov.to >= from && cov.to < to ? cov.to : to;
  const len = dayDiff(from, effectiveTo) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(len - 1));

  const { rows, raw, dropped } = await loadCalls("cdr", [from, prevFrom].sort()[0], to);
  const cur = rows.filter((r) => r.date >= from && r.date <= to);
  const prevRows = rows.filter((r) => r.date >= prevFrom && r.date <= prevTo);

  const dates = [...new Set(cur.map((r) => r.date))].sort();
  const byDate = (d: string) => cur.filter((r) => r.date === d);
  const daily = dates.map((d) => { const a = aggOf(byDate(d)); return { date: d, calls: a.calls, answered: a.answered, unanswered: a.unanswered, answerPct: a.answerPct }; });

  const typeNames = [...new Set(cur.map((r) => r.callType))].sort((a, b) => typeRank(a) - typeRank(b) || a.localeCompare(b));
  const types: CdrTypeRow[] = typeNames.map((t) => {
    const rs = cur.filter((r) => r.callType === t);
    const a = aggOf(rs);
    const days = new Set(rs.map((r) => r.date)).size;
    return { type: t, ...a, pctOfCalls: pct(a.calls, cur.length), days, answeredPerDay: days ? Math.round(a.answered / days) : 0, unansweredPerDay: days ? Math.round(a.unanswered / days) : 0 };
  });

  const kpis = aggOf(cur);
  const hang = (label: string, f: (h: string) => boolean) => ({ label, count: cur.filter((r) => f(r.hangupBy)).length });

  const details: CdrDetailRow[] = [];
  for (const d of dates) {
    const dayRows = byDate(d);
    const tNames = [...new Set(dayRows.map((r) => r.callType))].sort((a, b) => typeRank(a) - typeRank(b) || a.localeCompare(b));
    for (const t of tNames) details.push({ date: d, type: t, ...aggOf(dayRows.filter((r) => r.callType === t)) });
  }

  const byAgent = new Map<string, CallRec[]>();
  for (const r of cur) { const k = r.agentId || r.agent; const l = byAgent.get(k); if (l) l.push(r); else byAgent.set(k, [r]); }
  const agents: CdrAgentRow[] = [...byAgent.entries()].map(([k, rs]) => ({ agent: rs[0].agent === "(no agent)" ? "Not assigned to an agent" : rs[0].agent, agentId: rs[0].agentId || k, ...aggOf(rs) }))
    .sort((a, b) => b.answered - a.answered || b.calls - a.calls);

  const lastDay = dates.length ? dates[dates.length - 1] : null;
  const discMap = new Map<string, { agent: string; agentId: string; count: number }>();
  for (const r of cur) {
    if (r.agent === "(no agent)") continue;
    const k = r.agentId || r.agent;
    const e = discMap.get(k) ?? { agent: r.agent, agentId: r.agentId, count: 0 };
    if (lastDay && r.date === lastDay && r.hangupBy === "AgentHangup") e.count += 1;
    discMap.set(k, e);
  }

  const D = AW_SQL_DATE("call_date");
  const [tRows] = await db.execute<RowDataPacket[]>(`SELECT DISTINCT partner FROM db_masmis.aw_new_cdr WHERE ${D} BETWEEN ? AND ? AND partner IS NOT NULL AND TRIM(partner) <> ''`, [from, to]);

  return {
    from, to, effectiveTo, prevFrom, prevTo,
    coverage: {
      from: cov.from, to: cov.to, teams: tRows.map((r) => String(r.partner).trim()).filter((t) => t.toUpperCase() !== "NA").sort(), rawRows: raw, dedupDropped: dropped, daysWithData: dates.length,
      ttaAvailable: kpis.ahtWithPickupS !== null,
    },
    kpis, prev: prevRows.length ? aggOf(prevRows) : null,
    daily, types,
    outcomes: {
      answered: kpis.answered, unanswered: kpis.unanswered,
      hangup: [hang("Customer hang-up", (h) => h === "UserHangup"), hang("Agent hang-up", (h) => h === "AgentHangup"), hang("System hang-up", (h) => h === "SystemHangup"), hang("No hang-up recorded", (h) => h === "")],
    },
    talk: { avgTalkS: kpis.avgTalkS, avgWrapS: kpis.avgWrapS, avgHoldS: kpis.avgHoldS },
    agentDisconnect: { date: lastDay, items: [...discMap.values()].sort((a, b) => b.count - a.count || a.agent.localeCompare(b.agent)) },
    details, grand: kpis, agents,
  };
}
