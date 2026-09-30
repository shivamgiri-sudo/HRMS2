/**
 * Outbound dashboard metrics (pure, no DB). One source row = one dial attempt.
 *
 * Definitions (zero or missing denominator gives null):
 *  dials                rows
 *  connects             rows whose disposition is listed in connected_dispositions (case/space-insensitive)
 *  connect rate %       connects / dials
 *  unique leads         rows flagged by unique_lead_flag when that column is mapped, else distinct lead_id; null when neither is mapped
 *  contact penetration %  distinct leads with at least one connect / distinct leads dialed (needs lead_id; null otherwise)
 *  attempts per lead    dials / unique leads
 *  talk time            sum of talk_time (else duration_sec) over CONNECTED rows; avg talk = talk time / connected rows that carry a duration
 *  disposition mix      rows per raw disposition with its share of dials
 *  hourly heat          dials and connect rate by weekday x hour (needs a DATETIME date column or a call_time column)
 */
import { div, pct, r2, topBottom, weekday } from "../shared/ext.math.js";
import { norm, num } from "../shared/ext.source.js";

export interface OutCaps { duration: boolean; talk: boolean; lead: boolean; uniqueFlag: boolean; campaign: boolean; tl: boolean; hour: boolean }
export interface OutRow { date: string; hour: number | null; agent: string; tl: string | null; campaign: string | null; disposition: string; connected: boolean; talkSec: number | null; leadId: string | null; firstAttempt: boolean | null }

const txt = (v: unknown): string | null => { const s = String(v ?? "").trim(); return s ? s : null; };
const truthy = (v: unknown): boolean | null => { if (v === null || v === undefined || String(v).trim() === "") return null; const s = norm(v); return s === "1" || s === "true" || s === "y" || s === "yes"; };

export function normalizeCalls(raw: Array<Record<string, unknown>>, connectedDispositions: string[], caps: OutCaps): { rows: OutRow[]; badDurations: number } {
  const conn = new Set(connectedDispositions.map(norm)); const rows: OutRow[] = []; let badDurations = 0;
  for (const r of raw) {
    const date = txt(r.date); const agent = txt(r.agent_code)?.toUpperCase();
    if (!date || !agent) continue;
    const disposition = txt(r.disposition) ?? "(blank)";
    const connected = conn.has(norm(disposition));
    let talkSec: number | null = null;
    const src = caps.talk ? r.talk_time : caps.duration ? r.duration_sec : null;
    if (src !== null && src !== undefined && String(src).trim() !== "") { const n = num(src); if (n === null || n < 0) badDurations += 1; else talkSec = n; }
    const h = r.hour === null || r.hour === undefined ? null : Number(r.hour);
    rows.push({ date, hour: caps.hour && h !== null && Number.isInteger(h) && h >= 0 && h <= 23 ? h : null, agent, tl: caps.tl ? txt(r.tl_name) : null, campaign: caps.campaign ? txt(r.campaign) : null,
      disposition, connected, talkSec, leadId: caps.lead ? txt(r.lead_id) : null, firstAttempt: caps.uniqueFlag ? truthy(r.unique_lead_flag) : null });
  }
  return { rows, badDurations };
}

export interface OutKpis {
  dials: number; connects: number; connectRate: number | null; uniqueLeads: number | null; contactPenetrationPct: number | null;
  attemptsPerLead: number | null; talkSec: number | null; avgTalkSec: number | null;
}

export function computeOutKpis(rows: OutRow[], caps: OutCaps): OutKpis {
  const dials = rows.length; let connects = 0, talk = 0, talkN = 0;
  const leads = new Set<string>(); const contacted = new Set<string>(); let flagged = 0;
  for (const r of rows) {
    if (r.connected) { connects += 1; if (r.talkSec !== null) { talk += r.talkSec; talkN += 1; } }
    if (r.leadId) { leads.add(r.leadId); if (r.connected) contacted.add(r.leadId); }
    if (r.firstAttempt) flagged += 1;
  }
  const uniqueLeads = caps.uniqueFlag ? flagged : caps.lead ? leads.size : null;
  return {
    dials, connects, connectRate: pct(connects, dials), uniqueLeads,
    contactPenetrationPct: caps.lead ? pct(contacted.size, leads.size) : null,
    attemptsPerLead: div(dials, uniqueLeads),
    talkSec: caps.duration || caps.talk ? r2(talk) : null, avgTalkSec: caps.duration || caps.talk ? div(talk, talkN) : null,
  };
}

export interface DispositionRow { disposition: string; connected: boolean; calls: number; pct: number | null }
export function dispositionMix(rows: OutRow[]): DispositionRow[] {
  const by = new Map<string, { n: number; c: boolean }>();
  for (const r of rows) { const e = by.get(r.disposition) ?? by.set(r.disposition, { n: 0, c: r.connected }).get(r.disposition)!; e.n += 1; }
  return [...by].map(([disposition, e]) => ({ disposition, connected: e.c, calls: e.n, pct: pct(e.n, rows.length) })).sort((a, b) => b.calls - a.calls || a.disposition.localeCompare(b.disposition));
}

export interface HeatCell { weekday: number; hour: number; dials: number; connects: number; connectRate: number | null }
/** Sparse weekday x hour grid (only cells with dials). Empty when no row carries an hour. */
export function hourlyHeat(rows: OutRow[]): HeatCell[] {
  const by = new Map<string, { w: number; h: number; d: number; c: number }>();
  for (const r of rows) {
    if (r.hour === null) continue;
    const w = weekday(r.date); const k = `${w}|${r.hour}`;
    const e = by.get(k) ?? by.set(k, { w, h: r.hour, d: 0, c: 0 }).get(k)!;
    e.d += 1; if (r.connected) e.c += 1;
  }
  return [...by.values()].map((e) => ({ weekday: e.w, hour: e.h, dials: e.d, connects: e.c, connectRate: pct(e.c, e.d) })).sort((a, b) => a.weekday - b.weekday || a.hour - b.hour);
}
export interface HourRow { hour: number; dials: number; connects: number; connectRate: number | null }
export function byHour(rows: OutRow[]): HourRow[] {
  const by = new Map<number, { d: number; c: number }>();
  for (const r of rows) { if (r.hour === null) continue; const e = by.get(r.hour) ?? by.set(r.hour, { d: 0, c: 0 }).get(r.hour)!; e.d += 1; if (r.connected) e.c += 1; }
  return [...by].sort((a, b) => a[0] - b[0]).map(([hour, e]) => ({ hour, dials: e.d, connects: e.c, connectRate: pct(e.c, e.d) }));
}

export interface OutDay extends OutKpis { date: string }
export function dailyOut(rows: OutRow[], caps: OutCaps): OutDay[] {
  const by = new Map<string, OutRow[]>();
  for (const r of rows) (by.get(r.date) ?? by.set(r.date, []).get(r.date)!).push(r);
  return [...by].sort((a, b) => a[0].localeCompare(b[0])).map(([date, rs]) => ({ date, ...computeOutKpis(rs, caps) }));
}

export interface OutGroup extends OutKpis { key: string }
export function groupOut(rows: OutRow[], caps: OutCaps, keyOf: (r: OutRow) => string | null): OutGroup[] {
  const by = new Map<string, OutRow[]>();
  for (const r of rows) { const k = keyOf(r) ?? "Unassigned"; (by.get(k) ?? by.set(k, []).get(k)!).push(r); }
  return [...by].map(([key, rs]) => ({ key, ...computeOutKpis(rs, caps) })).sort((a, b) => b.dials - a.dials || a.key.localeCompare(b.key));
}
export interface OutAgent extends OutKpis { agent: string; tl: string | null }
export function agentOut(rows: OutRow[], caps: OutCaps): OutAgent[] {
  const by = new Map<string, OutRow[]>();
  for (const r of rows) (by.get(r.agent) ?? by.set(r.agent, []).get(r.agent)!).push(r);
  return [...by].map(([agent, rs]) => ({ agent, tl: rs.find((r) => r.tl)?.tl ?? null, ...computeOutKpis(rs, caps) })).sort((a, b) => b.dials - a.dials || a.agent.localeCompare(b.agent));
}
export const rankOutAgents = (rows: OutAgent[], minDials = 1, n = 5) => topBottom(rows.filter((r) => r.dials >= minDials), (r) => r.connectRate, n);
