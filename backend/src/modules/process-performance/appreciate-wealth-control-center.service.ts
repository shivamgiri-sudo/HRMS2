import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { AW_SQL_DATE, resolveRange, loadBilling, loadCalls, type BillRec } from "./appreciate-wealth-dashboard.service.js";

/**
 * Appreciate Wealth "Agent-wise Control Center" slide -- the KPI strip, trend,
 * agent productivity, attendance/adherence heat-map and daily snapshot of the
 * supplied mock-up, computed from the SAME de-duplicated agent-day rows
 * (loadBilling) the existing Appreciate Wealth tabs use, so a number here can
 * never disagree with the Agent-wise scorecard or the Overview tab.
 *
 * Definitions (same as the main service header):
 *  - Calls / Connected / Talk: sums over the filtered agent-days. VKYC agents make
 *    no dialer calls, so they add nothing to call metrics.
 *  - Connected % = connected / calls. Avg talk time = talk / connected calls.
 *  - Productive % (the mock-up's "TOS (Productive)") = (talk + wrap-up) / net login,
 *    over Inbound + Outbound agent-days only -- the report's own net-occupancy
 *    formula. There is no column literally called TOS.
 *  - Break time = login - net login (verified against the AUX break codes in the
 *    main service). Average is per agent-day.
 *  - Late login % = agent-days with late_login_status = YES / agent-days.
 *
 * Not available in the data (so not shown, never invented): enquiry channels
 * such as Meta / IndiaMART / ChatBot / Website (no lead-source column exists),
 * and any team other than "MCN Team" (the only value in the team columns).
 * The mock-up's channel panel is replaced by the real CDR call-source mix.
 *
 * Coverage matters: agent-day rows and CDR rows only exist for the dates that
 * were uploaded; `coverage` reports them so the page can say so.
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
/** Monday of the ISO week containing `iso`. */
function mondayOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDays(iso, -dow);
}

export interface CcKpis {
  agentDays: number; calls: number; connected: number; connectedPct: number;
  talkS: number; avgTalkPerCallS: number; latePct: number; lateDays: number;
  productivePct: number; breakAvgS: number; loginS: number;
}
export interface CcDay {
  date: string; agentDays: number; calls: number; connected: number; connectedPct: number;
  talkS: number; productivePct: number; breakS: number; breakAvgS: number; lateDays: number; latePct: number;
}
export interface CcAgent {
  agentId: string; name: string; empId: string; segment: string; agentDays: number;
  calls: number; connected: number; connectedPct: number; talkS: number;
  productivePct: number; latePct: number; lateDays: number; breakAvgS: number;
}
export interface CcSourceItem { name: string; legs: number; answered: number; source: "inbound" | "cdr" }
export interface AwControlCenter {
  from: string; to: string; effectiveTo: string; prevFrom: string; prevTo: string;
  segment: string; segments: string[];
  coverage: { billingFrom: string | null; billingTo: string | null; cdrFrom: string | null; cdrTo: string | null };
  kpis: CcKpis; prev: CcKpis | null;
  daily: CcDay[];
  wtd: { anchor: string | null; from: string; to: string; prevFrom: string; prevTo: string; calls: number; connected: number; prevCalls: number; prevConnected: number } | null;
  agents: CcAgent[];
  /** cell: 0 no agent-day row, 1 logged in on time, 2 late login */
  heat: { dates: string[]; agents: Array<{ name: string; agentId: string; cells: number[] }> };
  sources: { total: number; items: CcSourceItem[] };
}

interface Agg {
  agentDays: number; calls: number; connected: number; talkS: number; loginS: number; breakS: number;
  lateDays: number; prodS: number; callNetS: number;
}
const emptyAgg = (): Agg => ({ agentDays: 0, calls: 0, connected: 0, talkS: 0, loginS: 0, breakS: 0, lateDays: 0, prodS: 0, callNetS: 0 });
function addRow(a: Agg, r: BillRec): void {
  a.agentDays += 1;
  a.calls += r.calls; a.connected += r.connected; a.talkS += r.talkS; a.loginS += r.loginS;
  a.breakS += Math.max(0, r.loginS - r.netS);
  if (r.late) a.lateDays += 1;
  if (r.segment !== "VKYC" && r.netS > 0) { a.prodS += r.talkS + r.wrapS; a.callNetS += r.netS; }
}
const aggOf = (rows: BillRec[]): Agg => { const a = emptyAgg(); for (const r of rows) addRow(a, r); return a; };
const kpisOf = (a: Agg): CcKpis => ({
  agentDays: a.agentDays, calls: a.calls, connected: a.connected, connectedPct: pct(a.connected, a.calls),
  talkS: a.talkS, avgTalkPerCallS: a.connected > 0 ? Math.round(a.talkS / a.connected) : 0,
  latePct: pct(a.lateDays, a.agentDays), lateDays: a.lateDays,
  productivePct: pct(a.prodS, a.callNetS), breakAvgS: a.agentDays > 0 ? Math.round(a.breakS / a.agentDays) : 0, loginS: a.loginS,
});

async function coverage(): Promise<AwControlCenter["coverage"]> {
  const D = AW_SQL_DATE("call_date");
  const one = async (table: string) => {
    const [[r]] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(MIN(${D}), '%Y-%m-%d') AS mn, DATE_FORMAT(MAX(${D}), '%Y-%m-%d') AS mx FROM db_masmis.${table}`,
    );
    return { mn: (r?.mn as string | null) ?? null, mx: (r?.mx as string | null) ?? null };
  };
  const [b, c, i] = await Promise.all([one("aw_billing"), one("aw_new_cdr"), one("aw_inbound")]);
  const mins = [c.mn, i.mn].filter((x): x is string => !!x).sort();
  const maxs = [c.mx, i.mx].filter((x): x is string => !!x).sort();
  return { billingFrom: b.mn, billingTo: b.mx, cdrFrom: mins[0] ?? null, cdrTo: maxs[maxs.length - 1] ?? null };
}

export async function getAwControlCenter(fromInput: string, toInput: string, segmentInput: string): Promise<AwControlCenter> {
  const { from, to } = resolveRange(fromInput, toInput);
  const cov = await coverage();
  // Agent-day rows only exist through the last uploaded day. Compare like with like -- the same number of DAYS OF DATA -- instead of a 24-day range against 4 days of uploads, which would show a false collapse.
  const effectiveTo = cov.billingTo && cov.billingTo >= from && cov.billingTo < to ? cov.billingTo : to;
  const len = dayDiff(from, effectiveTo) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(len - 1));

  // One load covering the range, the previous period and both WTD windows.
  const loadFrom = [from, prevFrom, addDays(mondayOf(effectiveTo), -7)].sort()[0];
  const [{ rows: allRows }, cdr, inb] = await Promise.all([
    loadBilling(loadFrom, to), loadCalls("cdr", from, to), loadCalls("inbound", from, to),
  ]);

  const segments = [...new Set(allRows.map((r) => r.segment))].sort();
  const segment = segmentInput && segments.includes(segmentInput) ? segmentInput : "All";
  const scoped = segment === "All" ? allRows : allRows.filter((r) => r.segment === segment);
  const inWindow = (r: BillRec, a: string, b: string) => r.date >= a && r.date <= b;

  const cur = scoped.filter((r) => inWindow(r, from, to));
  const prevRows = scoped.filter((r) => inWindow(r, prevFrom, prevTo));

  // Daily series (only dates that have agent-day rows).
  const byDate = new Map<string, BillRec[]>();
  for (const r of cur) { const l = byDate.get(r.date); if (l) l.push(r); else byDate.set(r.date, [r]); }
  const dates = [...byDate.keys()].sort();
  const daily: CcDay[] = dates.map((date) => {
    const a = aggOf(byDate.get(date)!);
    return {
      date, agentDays: a.agentDays, calls: a.calls, connected: a.connected, connectedPct: pct(a.connected, a.calls),
      talkS: a.talkS, productivePct: pct(a.prodS, a.callNetS), breakS: a.breakS,
      breakAvgS: a.agentDays > 0 ? Math.round(a.breakS / a.agentDays) : 0, lateDays: a.lateDays, latePct: pct(a.lateDays, a.agentDays),
    };
  });

  // WTD: Monday..latest day with data, against the same number of days the week before.
  let wtd: AwControlCenter["wtd"] = null;
  const anchor = dates.length ? dates[dates.length - 1] : null;
  if (anchor) {
    const wFrom = mondayOf(anchor);
    const span = dayDiff(wFrom, anchor) + 1;
    const pFrom = addDays(wFrom, -7);
    const pTo = addDays(pFrom, span - 1);
    const w = aggOf(scoped.filter((r) => inWindow(r, wFrom, anchor)));
    const pw = aggOf(scoped.filter((r) => inWindow(r, pFrom, pTo)));
    wtd = { anchor, from: wFrom, to: anchor, prevFrom: pFrom, prevTo: pTo, calls: w.calls, connected: w.connected, prevCalls: pw.calls, prevConnected: pw.connected };
  }

  // Agents.
  const byAgent = new Map<string, BillRec[]>();
  for (const r of cur) { const l = byAgent.get(r.agentId); if (l) l.push(r); else byAgent.set(r.agentId, [r]); }
  const agents: CcAgent[] = [...byAgent.entries()].map(([agentId, rs]) => {
    const a = aggOf(rs);
    const latest = rs.reduce((x, y) => (y.date > x.date ? y : x));
    return {
      agentId, name: latest.agentName, empId: latest.empId, segment: latest.segment, agentDays: a.agentDays,
      calls: a.calls, connected: a.connected, connectedPct: pct(a.connected, a.calls), talkS: a.talkS,
      productivePct: pct(a.prodS, a.callNetS), latePct: pct(a.lateDays, a.agentDays), lateDays: a.lateDays,
      breakAvgS: a.agentDays > 0 ? Math.round(a.breakS / a.agentDays) : 0,
    };
  }).sort((x, y) => y.connected - x.connected || y.calls - x.calls || x.name.localeCompare(y.name));

  // Late-login heat-map: the agents with the most late days (ties: most days worked).
  const heatAgents = [...agents].sort((x, y) => y.lateDays - x.lateDays || y.agentDays - x.agentDays || x.name.localeCompare(y.name)).slice(0, 24);
  const dateIdx = new Map(dates.map((d, i) => [d, i]));
  const heat = {
    dates,
    agents: heatAgents.map((ag) => {
      const cells = new Array<number>(dates.length).fill(0);
      for (const r of byAgent.get(ag.agentId) ?? []) cells[dateIdx.get(r.date)!] = r.late ? 2 : 1;
      return { name: ag.name, agentId: ag.agentId, cells };
    }),
  };

  // Call-source mix from the CDR files (all agents -- the CDRs carry no segment).
  const src = new Map<string, CcSourceItem & { perSource: Record<string, number> }>();
  for (const r of [...cdr.rows, ...inb.rows]) {
    const cur2 = src.get(r.campaign) ?? { name: r.campaign, legs: 0, answered: 0, source: r.source, perSource: {} };
    cur2.legs += 1; if (r.answered) cur2.answered += 1;
    cur2.perSource[r.source] = (cur2.perSource[r.source] ?? 0) + 1;
    src.set(r.campaign, cur2);
  }
  const ranked = [...src.values()].map((s) => ({ ...s, source: ((s.perSource.cdr ?? 0) >= (s.perSource.inbound ?? 0) ? "cdr" : "inbound") as "cdr" | "inbound" }))
    .sort((a, b) => b.legs - a.legs);
  const total = ranked.reduce((s, x) => s + x.legs, 0);
  const top = ranked.slice(0, 7).map(({ name, legs, answered, source }) => ({ name, legs, answered, source }));
  const rest = ranked.slice(7);
  if (rest.length) top.push({ name: `Others (${rest.length})`, legs: rest.reduce((s, x) => s + x.legs, 0), answered: rest.reduce((s, x) => s + x.answered, 0), source: "cdr" });

  return {
    from, to, effectiveTo, prevFrom, prevTo, segment, segments, coverage: cov,
    kpis: kpisOf(aggOf(cur)), prev: prevRows.length ? kpisOf(aggOf(prevRows)) : null,
    daily, wtd, agents, heat, sources: { total, items: top },
  };
}
