import { getInboundInsights } from "../call-master/inbound-insights.service.js";
import {
  agentName, loadDirectory, loadQuality, num, pct, resolveRange, round1, round2, sum,
  type LobPayload,
} from "./clovia-lob.shared.js";
import { getEmailLob } from "./clovia-lob-email.service.js";
import { getChatLob } from "./clovia-lob-chat.service.js";
import { getOutboundLob } from "./clovia-lob-outbound.service.js";
import { getInboundExtras } from "./clovia-lob-inbound.service.js";

/**
 * Clovia "Customer Support Performance Dashboard" (Overview slide) feed.
 *
 * Composed ONLY from the existing Clovia LOB services, so every number here is
 * the number the Inbound / Email / Chat / Outbound slides show for the same
 * dates:
 *   Inbound   live dialer (shared inbound insights) -- offered, answered, SL, AHT, unique callers
 *   Outbound  cl_outbound       Email  cl_email_raw       Chat  cl_chat
 *   CSAT/DSAT IVR survey (cl_feedback)       Quality  cl_quality (plain mean of audit scores)
 * There is no revenue / sale / AOV / target source for Clovia, so none is returned.
 * The previous period (same length, immediately before `from`) is computed with
 * the same code so the KPI deltas compare like with like.
 */

type Row = Record<string, unknown>;
const m = (p: LobPayload, key: string): number => Number(p.metrics[key] ?? 0);
const rowsOf = (p: LobPayload, tableKey: string): Row[] => p.tables.find((t) => t.key === tableKey)?.rows ?? [];
const nf = (n: number) => n.toLocaleString("en-IN");

function shift(iso: string, days: number): string {
  const [y, mo, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
const utcMs = (iso: string) => { const [y, mo, d] = iso.split("-").map(Number); return Date.UTC(y, mo - 1, d); };
const dayCount = (a: string, b: string) => Math.round((utcMs(b) - utcMs(a)) / 86400000) + 1;

async function snapshot(from: string, to: string, withAgents: boolean) {
  const [ib, em, ch, ob, ex, qAll] = await Promise.all([
    getInboundInsights("clovia", { startDate: from, endDate: to }).catch(() => null),
    getEmailLob(from, to), getChatLob(from, to), getOutboundLob(from, to), getInboundExtras(from, to), loadQuality(from, to, null),
  ]);
  const h = ib?.headline;
  const inbound = h ? {
    offered: h.offered, answered: h.answered, abandoned: h.abandoned,
    // The shared insights return abandonPct equal to answeredPct; recompute from the counts.
    answeredPct: pct(h.answered, h.offered), abandonPct: pct(h.abandoned, h.offered),
    slPct: h.slPct, slThresholdSec: h.slThresholdSec, aht: h.aht, avgTalk: h.avgTalk, avgHold: h.avgHold, avgAcw: h.avgAcw, asa: h.asa,
    uniqueCallers: h.uniqueCallers, repeatCallers: h.repeatCallers, repeatCallerPct: h.repeatCallerPct, agentsActive: h.agentsActive, callsPerAgent: h.callsPerAgent,
    daily: (ib?.daily ?? []).map((d) => ({
      date: d.date, offered: d.offered, answered: d.answered, abandoned: d.abandoned, uniqueCallers: d.uniqueCallers,
      answeredPct: pct(d.answered, d.offered), abandonPct: pct(d.abandoned, d.offered), slPct: d.slPct, aht: d.aht, agents: d.agents,
    })),
  } : null;

  const dailyOf = (p: LobPayload, key: string, fields: string[]) =>
    rowsOf(p, key).map((r) => Object.fromEntries([["date", String(r.date)], ...fields.map((f) => [f, num(r[f])])]) as { date: string } & Record<string, number>);

  const quality = {
    audits: qAll.length,
    avg: qAll.length ? round2(sum(qAll.map((r) => r.score)) / qAll.length) : 0,
    fatal: qAll.filter((r) => r.fatal).length,
    byLob: ["Inbound", "Email", "Chat", "Outbound"].map((lob) => {
      const rs = qAll.filter((r) => r.lob === lob);
      return { lob, audits: rs.length, avg: rs.length ? round2(sum(rs.map((r) => r.score)) / rs.length) : 0, fatal: rs.filter((r) => r.fatal).length };
    }),
    daily: [...new Set(qAll.map((r) => r.date))].sort().map((date) => {
      const rs = qAll.filter((r) => r.date === date);
      return { date, audits: rs.length, avg: round2(sum(rs.map((r) => r.score)) / rs.length) };
    }),
  };

  let agents: Array<Record<string, unknown>> = [];
  let headcount = { inbound: h?.agentsActive ?? 0, email: m(em, "agents"), chat: m(ch, "agents"), outbound: m(ob, "agents"), distinct: 0, multiLob: 0 };
  if (withAgents) {
    const dir = await loadDirectory();
    const mix = new Map<string, { inbound: number; email: number; chat: number; outbound: number }>();
    const bump = (id: string, k: "inbound" | "email" | "chat" | "outbound", n: number) => {
      if (!id || n <= 0) return;
      const e = mix.get(id) ?? { inbound: 0, email: 0, chat: 0, outbound: 0 };
      e[k] += n; mix.set(id, e);
    };
    for (const a of ib?.agents ?? []) bump(a.agentId, "inbound", a.handled);
    for (const r of rowsOf(em, "email_agents_t")) bump(String(r.empId), "email", Number(r.touched));
    for (const r of rowsOf(ch, "chat_agents_t")) bump(String(r._key), "chat", Number(r.chats));
    for (const r of rowsOf(ob, "out_agents_t")) bump(String(r._key), "outbound", Number(r.dials));
    agents = [...mix.entries()].filter(([id]) => id.startsWith("MAS")).map(([id, v]) => {
      const qs = qAll.filter((r) => r.empId === id);
      const lobs = (v.inbound > 0 ? 1 : 0) + (v.email > 0 ? 1 : 0) + (v.chat > 0 ? 1 : 0) + (v.outbound > 0 ? 1 : 0);
      return { empId: id, agent: agentName(dir, id), ...v, total: v.inbound + v.email + v.chat + v.outbound, lobs, quality: qs.length ? round1(sum(qs.map((r) => r.score)) / qs.length) : null, audits: qs.length };
    }).sort((a, z) => Number(z.total) - Number(a.total));
    headcount = { ...headcount, distinct: agents.length, multiLob: agents.filter((a) => Number(a.lobs) >= 2).length };
  }

  return {
    inbound,
    rechurn: { calls: m(ex, "rcN"), unique: m(ex, "rcUnique"), abandon: m(ex, "rcAbandon"), avgDelayMin: m(ex, "rcAvgDelay") },
    outbound: {
      metrics: ob.metrics,
      daily: dailyOf(ob, "out_daily_t", ["dials", "connected", "connectPct", "avgTalk", "agents"]),
    },
    email: {
      metrics: em.metrics,
      daily: dailyOf(em, "email_daily_t", ["assigned", "touched", "closed", "closurePct", "open", "inProcess", "reOpen", "junk", "agents"]),
    },
    chat: {
      metrics: ch.metrics,
      daily: dailyOf(ch, "chat_daily_t", ["chats", "unique", "repeat", "repeatPct", "avgWait", "wait30", "avgDur", "agents"]),
    },
    csat: {
      responses: m(ex, "fbN"), satisfied: m(ex, "satisfied"), notSatisfied: m(ex, "notSatisfied"), csatPct: m(ex, "csatPct"), dsatPct: m(ex, "dsatPct"),
      daily: dailyOf(ex, "in_csat_daily_t", ["responses", "satisfied", "notSatisfied", "csatPct"]),
    },
    quality, agents, headcount,
    latest: { email: em.latestDate, chat: ch.latestDate, outbound: ob.latestDate, csat: ex.latestDate },
    empty: { email: em.empty, chat: ch.empty, outbound: ob.empty, csat: ex.empty },
  };
}

type Snap = Awaited<ReturnType<typeof snapshot>>;
const delta = (cur: number, prev: number | null | undefined, hasPrev: boolean) => (hasPrev && prev && prev > 0 ? round1(((cur - prev) / prev) * 100) : null);
const ppDelta = (cur: number, prev: number | null | undefined, hasPrev: boolean) => (hasPrev && prev !== null && prev !== undefined ? round1(cur - prev) : null);

export async function getCloviaOverviewDashboard(fromIn: string, toIn: string) {
  const { from, to } = resolveRange(fromIn, toIn);
  const span = dayCount(from, to);
  const prevFrom = shift(from, -span);
  const prevTo = shift(from, -1);
  const [cur, prev] = await Promise.all([snapshot(from, to, true), snapshot(prevFrom, prevTo, false).catch(() => null as Snap | null)]);

  const ib = cur.inbound; const pib = prev?.inbound ?? null;
  const hasIb = !!pib && pib.offered > 0;
  const hasOb = !!prev && Number(prev.outbound.metrics.dials ?? 0) > 0;
  const hasEm = !!prev && Number(prev.email.metrics.assigned ?? 0) > 0;
  const hasCh = !!prev && Number(prev.chat.metrics.chats ?? 0) > 0;
  const hasCs = !!prev && prev.csat.responses > 0;
  const hasQa = !!prev && prev.quality.audits > 0;
  const om = cur.outbound.metrics;
  const deltas = {
    offered: delta(ib?.offered ?? 0, pib?.offered, hasIb),
    answered: delta(ib?.answered ?? 0, pib?.answered, hasIb),
    uniqueCallers: delta(ib?.uniqueCallers ?? 0, pib?.uniqueCallers, hasIb),
    slPct: ppDelta(ib?.slPct ?? 0, pib?.slPct, hasIb),
    connectPct: ppDelta(Number(om.connectPct ?? 0), hasOb ? Number(prev!.outbound.metrics.connectPct ?? 0) : null, hasOb),
    emails: delta(Number(cur.email.metrics.assigned ?? 0), hasEm ? Number(prev!.email.metrics.assigned ?? 0) : null, hasEm),
    chats: delta(Number(cur.chat.metrics.chats ?? 0), hasCh ? Number(prev!.chat.metrics.chats ?? 0) : null, hasCh),
    quality: ppDelta(cur.quality.avg, prev?.quality.avg, hasQa),
    csat: ppDelta(cur.csat.csatPct, prev?.csat.csatPct, hasCs),
    dsat: ppDelta(cur.csat.dsatPct, prev?.csat.dsatPct, hasCs),
  };

  const insights: Array<{ tone: "good" | "warn" | "info"; text: string }> = [];
  if (ib) {
    insights.push({ tone: deltas.offered !== null && deltas.offered < 0 ? "info" : "good", text: `Inbound calls offered ${nf(ib.offered)}${deltas.offered !== null ? `, ${deltas.offered >= 0 ? "up" : "down"} ${Math.abs(deltas.offered)}% vs the previous period` : ""}; ${ib.answeredPct}% answered.` });
    insights.push({ tone: ib.slPct >= 80 ? "good" : "warn", text: `Inbound service level is ${ib.slPct}% within ${ib.slThresholdSec}s; abandon rate ${ib.abandonPct}% (${nf(ib.abandoned)} calls).` });
  }
  const conn = Number(om.connectPct ?? 0);
  if (Number(om.dials ?? 0) > 0) insights.push({ tone: conn >= 85 ? "good" : "warn", text: `Outbound connected ${conn}% of ${nf(Number(om.dials))} dials.` });
  if (Number(cur.email.metrics.assigned ?? 0) > 0) insights.push({ tone: Number(cur.email.metrics.closurePct ?? 0) >= 60 ? "good" : "warn", text: `Email closure is ${cur.email.metrics.closurePct}% with ${cur.email.metrics.reopenPct}% re-opened.` });
  if (Number(cur.chat.metrics.chats ?? 0) > 0) insights.push({ tone: Number(cur.chat.metrics.wait30 ?? 0) >= 80 ? "good" : "warn", text: `${cur.chat.metrics.wait30}% of chats were accepted within 30s (avg wait ${cur.chat.metrics.avgWait}s).` });
  if (cur.csat.responses > 0) insights.push({ tone: cur.csat.csatPct >= 90 ? "good" : "warn", text: `C-SAT ${cur.csat.csatPct}% and D-SAT ${cur.csat.dsatPct}% from ${nf(cur.csat.responses)} survey responses.` });
  const lowQ = cur.quality.byLob.filter((q) => q.audits > 0).sort((a, z) => a.avg - z.avg)[0];
  if (lowQ) insights.push({ tone: lowQ.avg >= 90 ? "info" : "warn", text: `Lowest quality LOB is ${lowQ.lob} at ${lowQ.avg}% over ${lowQ.audits} audits; ${cur.quality.fatal} fatal in total.` });
  if (cur.rechurn.calls > 0) insights.push({ tone: "info", text: `${nf(cur.rechurn.calls)} rechurn calls (${nf(cur.rechurn.unique)} unique callers), average re-call gap ${cur.rechurn.avgDelayMin} min.` });

  return { from, to, prevFrom, prevTo, deltas, insights, ...cur };
}
