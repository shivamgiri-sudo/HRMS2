/**
 * Reginald Abandoned Cart — management views (Overview, CDR, Monthly,
 * Day-wise target and TPR) over the same sources as reginald-cart.service.ts:
 *
 *   CDR   dialer_db.cdr_ob_25               (cart campaigns only)
 *   APR   dialer_db.vicidial_agent_log_10_25 (talk / wrap / wait / pause / dead)
 *   Sales mas_hrms.reginald_abandoned_cart_sales_raw (one row per unique order id)
 *   Attendance mas_hrms.attendance_daily_record (eligibility for the analyst target)
 *
 * Every view accepts the same filters (from, to, campaign, agent) so a card,
 * its chart and its detail table come from one filtered dataset.
 *
 * Unique metrics count distinct non-blank phone numbers, so repeated attempts
 * to one customer are counted once. The dial log knows only connected / not
 * connected (talk_sec > 0) — it has no disposition that separates "contacted"
 * from "connected", so Unique Contacted is returned as null (N/A), never
 * guessed. "Qualified connect" is a distinct phone with a talk of 30 s or more,
 * the dashboard's existing "quality connection" threshold.
 *
 * Formulas: reginald-metrics.ts.
 */

import type { RowDataPacket } from 'mysql2';
import { dialerQuery } from '../../db/dialerDb.js';
import { db } from '../../db/mysql.js';
import { n, parseRange } from './dialler-utils.js';
import { cachedLive } from './live-cache.js';
import { resolveEmployeeNames, codeKey } from './employee-names.js';
import { CART_CAMPAIGNS } from './reginald-cart.service.js';
import {
  DAILY_ANALYST_TARGET, achievementPct, connectPct, dailyTarget, eligibleDayFraction, gap,
  momPct, monthLabel, monthSlicesUntil, utilizationPct, weightedAvg, ymd,
} from './reginald-metrics.js';

const CDR_TABLE = 'cdr_ob_25';
const APR_TABLE = 'vicidial_agent_log_10_25';
const PHONE = "NULLIF(TRIM(PhoneNumber), '')";

export interface InsightFilters { from: string; to: string; campaign: string | null; agent: string | null }

export function parseInsightFilters(raw: Record<string, string | undefined>): InsightFilters {
  const { from, to } = parseRange(raw);
  const c = String(raw.campaign ?? '').trim().toUpperCase();
  const a = String(raw.agent ?? '').trim().toUpperCase();
  return {
    from, to,
    campaign: CART_CAMPAIGNS.includes(c) ? c : null,
    agent: /^[A-Z0-9_-]{1,30}$/.test(a) ? a : null,
  };
}

function cacheName(kind: string, f: InsightFilters): string {
  return `reg-ins-${kind}:${f.campaign ?? 'all'}:${f.agent ?? 'all'}`;
}

/** WHERE clause + params for the CDR table under the shared filters. */
function cdrWhere(f: InsightFilters): { sql: string; params: (string | number)[] } {
  let sql = `CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)
        AND UPPER(campaign_id) IN (${CART_CAMPAIGNS.map(() => '?').join(',')})`;
  const params: (string | number)[] = [f.from, f.to, ...CART_CAMPAIGNS];
  if (f.campaign) { sql += ' AND UPPER(campaign_id) = ?'; params.push(f.campaign); }
  if (f.agent) { sql += ' AND Agent = ?'; params.push(f.agent); }
  return { sql, params };
}

function aprWhere(f: InsightFilters): { sql: string; params: (string | number)[] } {
  let sql = `event_time >= ? AND event_time < DATE_ADD(?, INTERVAL 1 DAY)
        AND UPPER(campaign_id) IN (${CART_CAMPAIGNS.map(() => '?').join(',')})`;
  const params: (string | number)[] = [f.from, f.to, ...CART_CAMPAIGNS];
  if (f.campaign) { sql += ' AND UPPER(campaign_id) = ?'; params.push(f.campaign); }
  if (f.agent) { sql += ' AND user = ?'; params.push(f.agent); }
  return { sql, params };
}

const CDR_MEASURES = `
        COUNT(*) AS totalCdr,
        SUM(CASE WHEN talk_sec > 0 THEN 1 ELSE 0 END) AS connected,
        COUNT(DISTINCT ${PHONE}) AS uniqueDialed,
        COUNT(DISTINCT CASE WHEN talk_sec > 0 THEN ${PHONE} END) AS uniqueConnected,
        COUNT(DISTINCT CASE WHEN talk_sec >= 30 THEN ${PHONE} END) AS uniqueQualified,
        SUM(CASE WHEN talk_sec > 0 THEN CAST(talk_sec AS UNSIGNED) ELSE 0 END) AS talkSec`;

/** Negative durations are flagged and excluded from the sums rather than netted off. */
const APR_MEASURES = `
        SUM(GREATEST(talk_sec, 0)) AS talkSec, SUM(GREATEST(dispo_sec, 0)) AS dispoSec,
        SUM(GREATEST(wait_sec, 0)) AS waitSec, SUM(GREATEST(pause_sec, 0)) AS pauseSec,
        SUM(GREATEST(dead_sec, 0)) AS deadSec,
        SUM(CASE WHEN talk_sec < 0 OR dispo_sec < 0 OR wait_sec < 0 OR pause_sec < 0 OR dead_sec < 0 THEN 1 ELSE 0 END) AS invalidRows,
        COUNT(DISTINCT user) AS agents`;

export interface CdrBlock {
  totalCdr: number; connected: number;
  uniqueDialed: number; uniqueContacted: null; uniqueConnected: number; uniqueQualified: number;
  connectPct: number; qualifiedPct: number;
  talkSec: number; avgTalkSec: number;
}
export interface AprBlock {
  talkSec: number; wrapSec: number; waitSec: number; pauseSec: number; deadSec: number;
  netLoginSec: number; utilization: number; agents: number; invalidDurationRows: number;
}

function cdrBlock(r: RowDataPacket | undefined): CdrBlock {
  const x = r ?? ({} as RowDataPacket);
  const ud = n(x.uniqueDialed), uc = n(x.uniqueConnected), uq = n(x.uniqueQualified);
  const connected = n(x.connected), talk = n(x.talkSec);
  return {
    totalCdr: n(x.totalCdr), connected,
    uniqueDialed: ud, uniqueContacted: null, uniqueConnected: uc, uniqueQualified: uq,
    connectPct: connectPct(uc, ud), qualifiedPct: connectPct(uq, ud),
    talkSec: Math.round(talk), avgTalkSec: weightedAvg(talk, connected),
  };
}

function aprBlock(r: RowDataPacket | undefined): AprBlock {
  const x = r ?? ({} as RowDataPacket);
  const talk = n(x.talkSec), wrap = n(x.dispoSec), wait = n(x.waitSec), pause = n(x.pauseSec);
  const net = talk + wrap + wait + pause;
  return {
    talkSec: Math.round(talk), wrapSec: Math.round(wrap), waitSec: Math.round(wait),
    pauseSec: Math.round(pause), deadSec: Math.round(n(x.deadSec)),
    netLoginSec: Math.round(net), utilization: utilizationPct(talk, wait, net),
    agents: n(x.agents), invalidDurationRows: n(x.invalidRows),
  };
}

// ── Sales (mas_hrms) ─────────────────────────────────────────────────────────

async function salesBy(f: InsightFilters, groupBy: 'none' | 'date' | 'agentDate'): Promise<RowDataPacket[]> {
  const cols = groupBy === 'date' ? "DATE_FORMAT(order_date,'%Y-%m-%d') AS d,"
    : groupBy === 'agentDate' ? "UPPER(TRIM(emp_id)) AS agent, DATE_FORMAT(order_date,'%Y-%m-%d') AS d," : '';
  const group = groupBy === 'date' ? 'GROUP BY d' : groupBy === 'agentDate' ? 'GROUP BY agent, d' : '';
  const params: (string | number)[] = [f.from, f.to];
  let where = 'order_date >= ? AND order_date < DATE_ADD(?, INTERVAL 1 DAY)';
  if (f.agent) { where += ' AND emp_id = ?'; params.push(f.agent); }
  if (groupBy === 'agentDate') where += " AND emp_id IS NOT NULL AND emp_id <> ''";
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${cols} COUNT(*) AS orders, COALESCE(SUM(amount), 0) AS revenue
       FROM reginald_abandoned_cart_sales_raw WHERE ${where} ${group}`, params);
  return rows;
}

// ── Overview (REG-01 / REG-02) ───────────────────────────────────────────────

export interface InsightOverview {
  filters: InsightFilters;
  cdr: CdrBlock;
  apr: AprBlock;
  sales: { orders: number; revenue: number; splitByCampaign: false };
  hourly: (CdrBlock & { hour: number })[];
  byCampaign: (CdrBlock & { campaign: string })[];
  agents: { code: string; name: string | null }[];
  campaigns: string[];
}

export async function getInsightOverview(raw: Record<string, string>): Promise<InsightOverview> {
  return overviewFor(parseInsightFilters(raw));
}

function overviewFor(f: InsightFilters): Promise<InsightOverview> {
  return cachedLive(cacheName('overview', f), f, () => computeOverview(f));
}

async function computeOverview(f: InsightFilters): Promise<InsightOverview> {
  const c = cdrWhere(f), a = aprWhere(f);
  // Two at a time — the dialler pool is small and shared by every live view.
  const [overall, camps] = await Promise.all([
    dialerQuery<RowDataPacket>(`SELECT ${CDR_MEASURES} FROM ${CDR_TABLE} WHERE ${c.sql}`, c.params),
    dialerQuery<RowDataPacket>(`SELECT UPPER(campaign_id) AS campaign, ${CDR_MEASURES}
      FROM ${CDR_TABLE} WHERE ${c.sql} GROUP BY UPPER(campaign_id) ORDER BY totalCdr DESC`, c.params),
  ]);
  const [hours, apr] = await Promise.all([
    // StartTime is the call clock time (CallDate is date-only). It is present on the
    // sibling cdr_ob_250; if cdr_ob_25 ever lacks it, drop the hourly chart, not the page.
    dialerQuery<RowDataPacket>(`SELECT HOUR(StartTime) AS hr, ${CDR_MEASURES}
      FROM ${CDR_TABLE} WHERE ${c.sql} GROUP BY hr ORDER BY hr`, c.params)
      .catch((err) => { console.warn('[reginald-insights] hourly CDR query failed:', err?.message ?? err); return [] as RowDataPacket[]; }),
    dialerQuery<RowDataPacket>(`SELECT ${APR_MEASURES} FROM ${APR_TABLE} WHERE ${a.sql}`, a.params),
  ]);
  const agentRows = await dialerQuery<RowDataPacket>(
    `SELECT DISTINCT UPPER(TRIM(Agent)) AS code FROM ${CDR_TABLE} WHERE ${c.sql} AND Agent IS NOT NULL AND Agent <> '' LIMIT 300`,
    c.params);
  const [sales] = await salesBy(f, 'none');
  const codes = agentRows.map(r => String(r.code ?? '')).filter(Boolean).sort();
  const names = await resolveEmployeeNames(codes);
  return {
    filters: f,
    cdr: cdrBlock(overall[0]),
    apr: aprBlock(apr[0]),
    sales: { orders: n(sales?.orders), revenue: Math.round(n(sales?.revenue)), splitByCampaign: false },
    hourly: hours.filter(h => h.hr !== null && h.hr !== undefined).map(h => ({ hour: n(h.hr), ...cdrBlock(h) })),
    byCampaign: camps.map(r => ({ campaign: String(r.campaign ?? ''), ...cdrBlock(r) })),
    agents: codes.map(code => ({ code, name: names.get(codeKey(code)) ?? null })),
    campaigns: CART_CAMPAIGNS,
  };
}

// ── Analyst-day targets (REG-04, feeds REG-05 / REG-06) ──────────────────────

export interface AnalystDayRow {
  date: string; agent: string; agentName: string | null;
  attendanceStatus: string; eligibleDays: number; target: number;
  totalCdr: number; uniqueDialed: number; uniqueConnected: number; connectPct: number;
  connected: number; talkSec: number;
  aprTalkSec: number; wrapSec: number; waitSec: number; pauseSec: number; netLoginSec: number; utilization: number;
  orders: number; revenue: number;
  /** Achievement on the default actual basis (Total CDR). null = no target (N/A). */
  achievementPct: number | null; gap: number;
}

export interface TargetsPayload {
  filters: InsightFilters;
  dailyTarget: number;
  actualBasis: string;
  rows: AnalystDayRow[];
  /** Agent-days with dialler activity but no HRMS attendance row (target 0). */
  activityWithoutAttendance: number;
}

export async function getInsightTargets(raw: Record<string, string>): Promise<TargetsPayload> {
  return targetsFor(parseInsightFilters(raw));
}

function targetsFor(f: InsightFilters): Promise<TargetsPayload> {
  return cachedLive(cacheName('targets', f), f, () => computeTargets(f));
}

async function computeTargets(f: InsightFilters): Promise<TargetsPayload> {
  const c = cdrWhere(f), a = aprWhere(f);
  const [cdr, apr] = await Promise.all([
    dialerQuery<RowDataPacket>(`SELECT UPPER(TRIM(Agent)) AS agent, DATE_FORMAT(CallDate,'%Y-%m-%d') AS d, ${CDR_MEASURES}
      FROM ${CDR_TABLE} WHERE ${c.sql} AND Agent IS NOT NULL AND Agent <> ''
      GROUP BY agent, d`, c.params),
    dialerQuery<RowDataPacket>(`SELECT UPPER(TRIM(user)) AS agent, DATE_FORMAT(event_time,'%Y-%m-%d') AS d, ${APR_MEASURES}
      FROM ${APR_TABLE} WHERE ${a.sql} AND user IS NOT NULL AND user <> ''
      GROUP BY agent, d`, a.params),
  ]);
  const sales = await salesBy(f, 'agentDate');

  const key = (agent: string, d: string) => `${agent}|${d}`;
  const cdrMap = new Map(cdr.map(r => [key(String(r.agent), ymd(r.d)), r]));
  const aprMap = new Map(apr.map(r => [key(String(r.agent), ymd(r.d)), r]));
  const salesMap = new Map(sales.map(r => [key(String(r.agent), ymd(r.d)), r]));

  const agents = new Set<string>([...cdr, ...apr].map(r => String(r.agent)).filter(Boolean));
  if (f.agent) agents.add(f.agent);
  const codes = [...agents];

  // HRMS attendance for these analysts. One status per analyst-date: if HRMS
  // ever holds two rows for a day, the more eligible one wins so a target is
  // never counted twice.
  const att = new Map<string, string>();
  if (codes.length) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT e.employee_code AS code, DATE_FORMAT(adr.record_date,'%Y-%m-%d') AS d, adr.attendance_status AS st
         FROM attendance_daily_record adr JOIN employees e ON e.id = adr.employee_id
        WHERE e.employee_code IN (?) AND adr.record_date BETWEEN ? AND ?`,
      [codes, f.from, f.to]);
    for (const r of rows) {
      const k = key(codeKey(r.code), ymd(r.d));
      const prev = att.get(k);
      if (prev === undefined || eligibleDayFraction(r.st) > eligibleDayFraction(prev)) att.set(k, String(r.st ?? ''));
    }
  }

  const keys = new Set<string>([...cdrMap.keys(), ...aprMap.keys()]);
  for (const [k, st] of att) if (eligibleDayFraction(st) > 0) keys.add(k);

  const names = await resolveEmployeeNames(codes);
  let activityWithoutAttendance = 0;
  const rows: AnalystDayRow[] = [...keys].map(k => {
    const [agent, date] = k.split('|');
    const cb = cdrBlock(cdrMap.get(k));
    const ab = aprBlock(aprMap.get(k));
    const s = salesMap.get(k);
    const st = att.get(k);
    if (st === undefined) activityWithoutAttendance++;
    const eligibleDays = eligibleDayFraction(st);
    const target = dailyTarget(st);
    return {
      date, agent, agentName: names.get(agent) ?? null,
      attendanceStatus: st ?? 'no record', eligibleDays, target,
      totalCdr: cb.totalCdr, uniqueDialed: cb.uniqueDialed, uniqueConnected: cb.uniqueConnected,
      connectPct: cb.connectPct, connected: cb.connected, talkSec: cb.talkSec,
      aprTalkSec: ab.talkSec, wrapSec: ab.wrapSec, waitSec: ab.waitSec, pauseSec: ab.pauseSec,
      netLoginSec: ab.netLoginSec, utilization: ab.utilization,
      orders: n(s?.orders), revenue: Math.round(n(s?.revenue)),
      achievementPct: achievementPct(cb.totalCdr, target), gap: gap(cb.totalCdr, target),
    };
  }).sort((x, y) => x.date.localeCompare(y.date) || x.agent.localeCompare(y.agent));

  return {
    filters: f, dailyTarget: DAILY_ANALYST_TARGET,
    actualBasis: 'Total CDR (dial attempts) by the analyst on the cart campaigns',
    rows, activityWithoutAttendance,
  };
}

// ── Day-wise (REG-05) ─────────────────────────────────────────────────────────

export interface InsightDayRow extends CdrBlock, Omit<AprBlock, 'talkSec'> {
  date: string; aprTalkSec: number; orders: number; revenue: number;
  eligibleDays: number; target: number; achievementPct: number | null; gap: number;
}

export async function getInsightDaily(raw: Record<string, string>): Promise<InsightDayRow[]> {
  const f = parseInsightFilters(raw);
  return cachedLive(cacheName('daily', f), f, () => computeDaily(f));
}

async function computeDaily(f: InsightFilters): Promise<InsightDayRow[]> {
  const c = cdrWhere(f), a = aprWhere(f);
  const [cdr, apr] = await Promise.all([
    dialerQuery<RowDataPacket>(`SELECT DATE_FORMAT(CallDate,'%Y-%m-%d') AS d, ${CDR_MEASURES}
      FROM ${CDR_TABLE} WHERE ${c.sql} GROUP BY d ORDER BY d`, c.params),
    dialerQuery<RowDataPacket>(`SELECT DATE_FORMAT(event_time,'%Y-%m-%d') AS d, ${APR_MEASURES}
      FROM ${APR_TABLE} WHERE ${a.sql} GROUP BY d ORDER BY d`, a.params),
  ]);
  const sales = await salesBy(f, 'date');
  const targets = await targetsFor(f);

  const aprMap = new Map(apr.map(r => [ymd(r.d), r]));
  const salesMap = new Map(sales.map(r => [ymd(r.d), r]));
  const cdrMap = new Map(cdr.map(r => [ymd(r.d), r]));
  const tgt = new Map<string, { days: number; target: number }>();
  for (const r of targets.rows) {
    const t = tgt.get(r.date) ?? { days: 0, target: 0 };
    t.days += r.eligibleDays; t.target += r.target;
    tgt.set(r.date, t);
  }
  const dates = [...new Set([...cdrMap.keys(), ...aprMap.keys(), ...salesMap.keys(), ...tgt.keys()])].sort();
  return dates.map(date => {
    const cb = cdrBlock(cdrMap.get(date));
    const { talkSec: aprTalkSec, ...ab } = aprBlock(aprMap.get(date));
    const s = salesMap.get(date);
    const t = tgt.get(date) ?? { days: 0, target: 0 };
    return {
      date, ...cb, ...ab, aprTalkSec,
      orders: n(s?.orders), revenue: Math.round(n(s?.revenue)),
      eligibleDays: t.days, target: t.target,
      achievementPct: achievementPct(cb.totalCdr, t.target), gap: gap(cb.totalCdr, t.target),
    };
  });
}

// ── Monthly (REG-03) ──────────────────────────────────────────────────────────

export interface InsightMonthRow {
  month: string; monthLabel: string; hasData: boolean;
  cdr: CdrBlock; apr: AprBlock;
  orders: number; revenue: number;
  eligibleDays: number; target: number; achievementPct: number | null;
  byCampaign: (CdrBlock & { campaign: string })[];
  mom: { totalCdr: number | null; uniqueConnected: number | null; orders: number | null; revenue: number | null; connectPctPts: number | null };
}

function todayIst(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Months run one after another and are cached individually (see getCartMonthly). */
export async function getInsightMonthly(raw: Record<string, string>): Promise<InsightMonthRow[]> {
  const f = parseInsightFilters(raw);
  const out: InsightMonthRow[] = [];
  for (const slice of monthSlicesUntil(f.from, f.to, todayIst())) {
    const sf: InsightFilters = { ...f, from: slice.from, to: slice.to };
    const ov = await overviewFor(sf);
    const tg = await targetsFor(sf);
    const target = tg.rows.reduce((s, r) => s + r.target, 0);
    const eligibleDays = tg.rows.reduce((s, r) => s + r.eligibleDays, 0);
    out.push({
      month: slice.month, monthLabel: monthLabel(slice.month),
      hasData: ov.cdr.totalCdr > 0 || ov.apr.netLoginSec > 0 || ov.sales.orders > 0,
      cdr: ov.cdr, apr: ov.apr, orders: ov.sales.orders, revenue: ov.sales.revenue,
      eligibleDays, target, achievementPct: achievementPct(ov.cdr.totalCdr, target),
      byCampaign: ov.byCampaign,
      mom: { totalCdr: null, uniqueConnected: null, orders: null, revenue: null, connectPctPts: null },
    });
  }
  for (let i = 1; i < out.length; i++) {
    const cur = out[i], prev = out[i - 1];
    cur.mom = {
      totalCdr: momPct(cur.cdr.totalCdr, prev.cdr.totalCdr),
      uniqueConnected: momPct(cur.cdr.uniqueConnected, prev.cdr.uniqueConnected),
      orders: momPct(cur.orders, prev.orders),
      revenue: momPct(cur.revenue, prev.revenue),
      connectPctPts: prev.cdr.uniqueDialed > 0 ? Math.round((cur.cdr.connectPct - prev.cdr.connectPct) * 100) / 100 : null,
    };
  }
  return out;
}

// ── Per-analyst period totals (TPR view, REG-06) ─────────────────────────────

export interface InsightAgentRow extends CdrBlock {
  agent: string; agentName: string | null; apr: AprBlock;
}

export async function getInsightAgents(raw: Record<string, string>): Promise<InsightAgentRow[]> {
  const f = parseInsightFilters(raw);
  return cachedLive(cacheName('agents', f), f, () => computeAgents(f));
}

/** Uniques are distinct over the whole period per analyst (not summed day by day). */
async function computeAgents(f: InsightFilters): Promise<InsightAgentRow[]> {
  const c = cdrWhere(f), a = aprWhere(f);
  const [cdr, apr] = await Promise.all([
    dialerQuery<RowDataPacket>(`SELECT UPPER(TRIM(Agent)) AS agent, ${CDR_MEASURES}
      FROM ${CDR_TABLE} WHERE ${c.sql} AND Agent IS NOT NULL AND Agent <> ''
      GROUP BY agent ORDER BY totalCdr DESC LIMIT 300`, c.params),
    dialerQuery<RowDataPacket>(`SELECT UPPER(TRIM(user)) AS agent, ${APR_MEASURES}
      FROM ${APR_TABLE} WHERE ${a.sql} AND user IS NOT NULL AND user <> ''
      GROUP BY agent LIMIT 300`, a.params),
  ]);
  const aprMap = new Map(apr.map(r => [String(r.agent), r]));
  const names = await resolveEmployeeNames(cdr.map(r => String(r.agent)));
  return cdr.map(r => {
    const agent = String(r.agent);
    return { agent, agentName: names.get(agent) ?? null, ...cdrBlock(r), apr: aprBlock(aprMap.get(agent)) };
  });
}
