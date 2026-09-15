/**
 * Reginald Men Abandoned Cart live dashboard service.
 *
 * Source tables  : cdr_ob_25 (CDR), vicidial_agent_log_10_25 (APR)
 *                  mas_hrms.reginald_abandoned_cart_sales_raw (Sales — uploaded via REGINALD_ABANDONED_CART_SALES)
 * Campaigns      : ABANDON, KERALA, TAMIL, TELUGU, RTO, NDRMO, NDRRM, NPSRM, RTOMO
 * Handled logic  : talk_sec > 0 (connected = talk happened)
 *
 * All data points match GAS Day-wise / Analyst-wise / Yearly dashboard:
 *   Day KPIs: Total CDR, MTD Unique Dialed (phone dedup), MTD Unique Connected,
 *             Connect %, Avg Daily Login, Avg Talk Time, AHT (Talk+Wrap+Dead/connected),
 *             Avg Wrap Time, Avg Idle Time
 *   Day table columns: Date, Total CDR, Unique Dialed, Unique Connected, Connect%,
 *                      Login Count, Sales/Agent (N/A), Avg Talk, AHT, Avg Wrap, Avg Idle
 *   Yearly: same metrics by month
 *   Analyst table: Analyst, Login Days, Total CDR, Sales (N/A), Connect%, Avg Talk, AHT,
 *                  Avg Wrap, Avg Wait, <30s, ≥30s
 *
 * Note: Sales/Revenue/AOV/Orders data comes from Google Sheets in the GAS version —
 * not available from dialler_db. Only CDR + APR metrics are provided here.
 */

import type { RowDataPacket } from 'mysql2';
import { dialerQuery } from '../../db/dialerDb.js';
import { n, pct, round, fmtSec, fmtDuration, parseRange } from './dialler-utils.js';
import { resolveEmployeeNames, codeKey } from './employee-names.js';
import { cachedLive } from './live-cache.js';
import { db } from '../../db/mysql.js';
import type { RowDataPacket as MasRow } from 'mysql2';

const CDR_TABLE = 'cdr_ob_25';
const APR_TABLE = 'vicidial_agent_log_10_25';

export const CART_CAMPAIGNS = ['ABANDON', 'KERALA', 'TAMIL', 'TELUGU', 'RTO', 'NDRMO', 'NDRRM', 'NPSRM', 'RTOMO'];
const CAMP_IN = CART_CAMPAIGNS.map(() => '?').join(',');

// ── Summary (overall KPIs) ────────────────────────────────────────────────────

export interface CartSummary {
  from: string; to: string;
  offered: number;
  connected: number;
  abandoned: number;
  uniqueDialed: number;
  uniqueConnected: number;
  connectPct: number;
  talkSec: number; talk: string;
  avgTalkSec: number; avgTalk: string;
  ahtSec: number; aht: string;
  avgWrapSec: number; avgWrap: string;
  loginCount: number;
  lt30: number; ge30: number;
  generatedAt: string;
  byCampaign: CampaignRow[];
}

export interface CampaignRow {
  campaign: string; offered: number; connected: number; uniqueDialed: number;
  uniqueConnected: number; connectPct: number; avgTalkSec: number; avgTalk: string;
}

export async function getCartSummary(rawFilters: { from?: string; to?: string }): Promise<CartSummary> {
  const range = parseRange(rawFilters);
  return cachedLive('cart-summary', range, () => computeCartSummary(range));
}

async function computeCartSummary(rawFilters: { from?: string; to?: string }): Promise<CartSummary> {
  const { from, to } = parseRange(rawFilters);

  const [overallRows, campRows, aprRows] = await Promise.all([
    dialerQuery<RowDataPacket>(`
      SELECT COUNT(*) AS offered,
        SUM(CASE WHEN talk_sec > 0 THEN 1 ELSE 0 END) AS connected,
        COUNT(DISTINCT PhoneNumber) AS uniqueDialed,
        COUNT(DISTINCT CASE WHEN talk_sec > 0 THEN PhoneNumber ELSE NULL END) AS uniqueConnected,
        SUM(CAST(talk_sec AS UNSIGNED)) AS talkSec,
        SUM(CASE WHEN talk_sec > 0 AND talk_sec < 30 THEN 1 ELSE 0 END) AS lt30,
        SUM(CASE WHEN talk_sec >= 30 THEN 1 ELSE 0 END) AS ge30,
        COUNT(DISTINCT CASE WHEN talk_sec > 0 THEN Agent ELSE NULL END) AS loginCount
      FROM ${CDR_TABLE}
      WHERE CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)
        AND UPPER(campaign_id) IN (${CAMP_IN})
    `, [from, to, ...CART_CAMPAIGNS]),
    dialerQuery<RowDataPacket>(`
      SELECT UPPER(campaign_id) AS campaign,
        COUNT(*) AS offered,
        SUM(CASE WHEN talk_sec > 0 THEN 1 ELSE 0 END) AS connected,
        COUNT(DISTINCT PhoneNumber) AS uniqueDialed,
        COUNT(DISTINCT CASE WHEN talk_sec > 0 THEN PhoneNumber ELSE NULL END) AS uniqueConnected,
        SUM(CAST(talk_sec AS UNSIGNED)) AS talkSec
      FROM ${CDR_TABLE}
      WHERE CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)
        AND UPPER(campaign_id) IN (${CAMP_IN})
      GROUP BY UPPER(campaign_id) ORDER BY offered DESC
    `, [from, to, ...CART_CAMPAIGNS]),
    dialerQuery<RowDataPacket>(`
      SELECT SUM(talk_sec) AS talkSec, SUM(dispo_sec) AS dispoSec, SUM(dead_sec) AS deadSec, SUM(wait_sec) AS waitSec
      FROM ${APR_TABLE}
      WHERE event_time >= ? AND event_time < DATE_ADD(?, INTERVAL 1 DAY)
        AND UPPER(campaign_id) IN (${CAMP_IN})
    `, [from, to, ...CART_CAMPAIGNS]),
  ]);

  const r = overallRows[0] ?? {};
  const apr = aprRows[0] ?? {};
  const offered = n(r.offered), connected = n(r.connected);
  const talkSec = n(r.talkSec), lt30 = n(r.lt30), ge30 = n(r.ge30);
  const loginCount = n(r.loginCount);
  const avgTalkSec = connected > 0 ? Math.round(talkSec / connected) : 0;

  // AHT = (talk + wrap + dead) / connected (matches GAS Day-wise definition)
  const aprTalkSec = n(apr.talkSec), dispoSec = n(apr.dispoSec), deadSec = n(apr.deadSec);
  const ahtSec = connected > 0 ? Math.round((aprTalkSec + dispoSec + deadSec) / connected) : 0;
  const avgWrapSec = connected > 0 ? Math.round(dispoSec / connected) : 0;

  return {
    from, to,
    offered, connected,
    abandoned: offered - connected,
    uniqueDialed: n(r.uniqueDialed),
    uniqueConnected: n(r.uniqueConnected),
    connectPct: pct(connected, offered),
    talkSec: Math.round(talkSec), talk: fmtSec(talkSec),
    avgTalkSec, avgTalk: fmtSec(avgTalkSec),
    ahtSec, aht: fmtSec(ahtSec),
    avgWrapSec, avgWrap: fmtSec(avgWrapSec),
    loginCount, lt30, ge30,
    generatedAt: new Date().toISOString(),
    byCampaign: campRows.map(cr => {
      const co = n(cr.offered), cc = n(cr.connected), ct = n(cr.talkSec);
      const ca = cc > 0 ? Math.round(ct / cc) : 0;
      return {
        campaign: String(cr.campaign ?? ''),
        offered: co, connected: cc,
        uniqueDialed: n(cr.uniqueDialed), uniqueConnected: n(cr.uniqueConnected),
        connectPct: pct(cc, co),
        avgTalkSec: ca, avgTalk: fmtSec(ca),
      };
    }),
  };
}

// ── Day-wise breakdown ────────────────────────────────────────────────────────

export interface CartDayRow {
  date: string;
  totalDialed: number; uniqueDialed: number; uniqueConnected: number;
  connectPct: number; loginCount: number;
  avgTalkSec: number; avgTalk: string;
  ahtSec: number; aht: string;
  avgWrapSec: number; avgWrap: string;
  avgIdleSec: number; avgIdle: string;
}

export async function getCartDaily(rawFilters: { from?: string; to?: string }): Promise<CartDayRow[]> {
  const range = parseRange(rawFilters);
  return cachedLive('cart-daily', range, () => computeCartDaily(range));
}

async function computeCartDaily(rawFilters: { from?: string; to?: string }): Promise<CartDayRow[]> {
  const { from, to } = parseRange(rawFilters);

  const [cdrRows, aprRows] = await Promise.all([
    dialerQuery<RowDataPacket>(`
      SELECT DATE(CallDate) AS date,
        COUNT(*) AS totalDialed,
        COUNT(DISTINCT PhoneNumber) AS uniqueDialed,
        COUNT(DISTINCT CASE WHEN talk_sec > 0 THEN PhoneNumber ELSE NULL END) AS uniqueConnected,
        SUM(CASE WHEN talk_sec > 0 THEN 1 ELSE 0 END) AS connected,
        SUM(CAST(talk_sec AS UNSIGNED)) AS talkSec,
        COUNT(DISTINCT CASE WHEN talk_sec > 0 THEN Agent ELSE NULL END) AS loginCount
      FROM ${CDR_TABLE}
      WHERE CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)
        AND UPPER(campaign_id) IN (${CAMP_IN})
      GROUP BY DATE(CallDate) ORDER BY date
    `, [from, to, ...CART_CAMPAIGNS]),
    dialerQuery<RowDataPacket>(`
      SELECT DATE(event_time) AS date,
        SUM(talk_sec) AS talkSec, SUM(dispo_sec) AS dispoSec,
        SUM(dead_sec) AS deadSec, SUM(wait_sec) AS waitSec,
        COUNT(DISTINCT user) AS agents
      FROM ${APR_TABLE}
      WHERE event_time >= ? AND event_time < DATE_ADD(?, INTERVAL 1 DAY)
        AND UPPER(campaign_id) IN (${CAMP_IN})
      GROUP BY DATE(event_time) ORDER BY date
    `, [from, to, ...CART_CAMPAIGNS]),
  ]);

  const aprMap: Record<string, RowDataPacket> = {};
  for (const r of aprRows) aprMap[String(r.date ?? '')] = r;

  return cdrRows.map(r => {
    const date = String(r.date ?? '');
    const connected = n(r.connected);
    const cdrTalk = n(r.talkSec);
    const loginCount = n(r.loginCount);
    const apr = aprMap[date] ?? null;
    const aprTalk = apr ? n(apr.talkSec) : 0;
    const dispoSec = apr ? n(apr.dispoSec) : 0;
    const deadSec = apr ? n(apr.deadSec) : 0;
    const waitSec = apr ? n(apr.waitSec) : 0;
    const agents = apr ? n(apr.agents) : loginCount || 1;
    const ahtSec = connected > 0 ? Math.round((aprTalk + dispoSec + deadSec) / connected) : 0;
    const avgWrapSec = connected > 0 ? Math.round(dispoSec / connected) : 0;
    const avgTalkSec = connected > 0 ? Math.round(cdrTalk / connected) : 0;
    const avgIdleSec = agents > 0 ? Math.round(waitSec / agents) : 0;

    return {
      date,
      totalDialed: n(r.totalDialed),
      uniqueDialed: n(r.uniqueDialed),
      uniqueConnected: n(r.uniqueConnected),
      connectPct: pct(n(r.uniqueConnected), n(r.uniqueDialed)),
      loginCount,
      avgTalkSec, avgTalk: fmtSec(avgTalkSec),
      ahtSec, aht: fmtSec(ahtSec),
      avgWrapSec, avgWrap: fmtSec(avgWrapSec),
      avgIdleSec, avgIdle: fmtSec(avgIdleSec),
    };
  });
}

// ── Monthly aggregation ───────────────────────────────────────────────────────

export interface CartMonthRow {
  month: string; monthLabel: string;
  totalDialed: number; uniqueDialed: number; uniqueConnected: number;
  connectPct: number; loginCount: number;
  avgTalkSec: number; avgTalk: string;
  ahtSec: number; aht: string;
  avgWrapSec: number; avgWrap: string;
}

/** Calendar months overlapping [from, to], each clipped to the range — the same
 *  edges the single range query used, so each slice yields that month's row. */
function monthSlices(from: string, to: string): { from: string; to: string }[] {
  const slices: { from: string; to: string }[] = [];
  let [y, m] = from.slice(0, 7).split('-').map(Number);
  for (;;) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    if (ym > to.slice(0, 7)) break;
    const monthEnd = `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
    slices.push({ from: `${ym}-01` < from ? from : `${ym}-01`, to: monthEnd > to ? to : monthEnd });
    if (++m > 12) { m = 1; y++; }
  }
  return slices;
}

/**
 * One calendar month at a time, each cached on its own. A closed month's
 * figures never change, so they are reused across days and users and a
 * multi-month view only pays for months not yet seen. Months run one after
 * another so a wide range cannot take over the five-connection dialler pool —
 * the reason a long range used to leave this tab stuck.
 */
export async function getCartMonthly(rawFilters: { from?: string; to?: string }): Promise<CartMonthRow[]> {
  const { from, to } = parseRange(rawFilters);
  const rows: CartMonthRow[] = [];
  for (const slice of monthSlices(from, to)) {
    rows.push(...await cachedLive('cart-monthly', slice, () => computeCartMonthly(slice)));
  }
  return rows;
}

async function computeCartMonthly(rawFilters: { from?: string; to?: string }): Promise<CartMonthRow[]> {
  const { from, to } = parseRange(rawFilters);

  const [cdrRows, aprRows] = await Promise.all([
    dialerQuery<RowDataPacket>(`
      SELECT DATE_FORMAT(CallDate,'%Y-%m') AS month,
        COUNT(*) AS totalDialed,
        COUNT(DISTINCT PhoneNumber) AS uniqueDialed,
        COUNT(DISTINCT CASE WHEN talk_sec > 0 THEN PhoneNumber ELSE NULL END) AS uniqueConnected,
        SUM(CASE WHEN talk_sec > 0 THEN 1 ELSE 0 END) AS connected,
        SUM(CAST(talk_sec AS UNSIGNED)) AS talkSec,
        COUNT(DISTINCT CASE WHEN talk_sec > 0 THEN Agent ELSE NULL END) AS loginCount
      FROM ${CDR_TABLE}
      WHERE CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)
        AND UPPER(campaign_id) IN (${CAMP_IN})
      GROUP BY month ORDER BY month
    `, [from, to, ...CART_CAMPAIGNS]),
    dialerQuery<RowDataPacket>(`
      SELECT DATE_FORMAT(event_time,'%Y-%m') AS month,
        SUM(talk_sec) AS talkSec, SUM(dispo_sec) AS dispoSec, SUM(dead_sec) AS deadSec
      FROM ${APR_TABLE}
      WHERE event_time >= ? AND event_time < DATE_ADD(?, INTERVAL 1 DAY)
        AND UPPER(campaign_id) IN (${CAMP_IN})
      GROUP BY month ORDER BY month
    `, [from, to, ...CART_CAMPAIGNS]),
  ]);

  const aprMap: Record<string, RowDataPacket> = {};
  for (const r of aprRows) aprMap[String(r.month ?? '')] = r;

  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  return cdrRows.map(r => {
    const month = String(r.month ?? '');
    const connected = n(r.connected);
    const cdrTalk = n(r.talkSec);
    const apr = aprMap[month] ?? null;
    const aprTalk = apr ? n(apr.talkSec) : 0;
    const dispoSec = apr ? n(apr.dispoSec) : 0;
    const deadSec = apr ? n(apr.deadSec) : 0;
    const ahtSec = connected > 0 ? Math.round((aprTalk + dispoSec + deadSec) / connected) : 0;
    const avgWrapSec = connected > 0 ? Math.round(dispoSec / connected) : 0;
    const avgTalkSec = connected > 0 ? Math.round(cdrTalk / connected) : 0;
    const [year, monthNum] = month.split('-');
    const monthLabel = `${MONTH_NAMES[parseInt(monthNum, 10) - 1]}-${year?.slice(2)}`;

    return {
      month, monthLabel,
      totalDialed: n(r.totalDialed),
      uniqueDialed: n(r.uniqueDialed),
      uniqueConnected: n(r.uniqueConnected),
      connectPct: pct(n(r.uniqueConnected), n(r.uniqueDialed)),
      loginCount: n(r.loginCount),
      avgTalkSec, avgTalk: fmtSec(avgTalkSec),
      ahtSec, aht: fmtSec(ahtSec),
      avgWrapSec, avgWrap: fmtSec(avgWrapSec),
    };
  });
}

// ── Analyst-wise table (CDR + APR merged) ─────────────────────────────────────

export interface CartAnalystRow {
  /** Employee code (cdr_ob_25.Agent). */
  analyst: string;
  /** Employee name from HRMS; null when the code has no HRMS record. */
  analystName: string | null;
  loginDays: number;
  totalDialed: number;
  uniqueDialed: number;
  uniqueConnected: number;
  connectPct: number;
  lt30: number; ge30: number;
  avgTalkSec: number; avgTalk: string;
  ahtSec: number; aht: string;
  avgWrapSec: number; avgWrap: string;
  avgWaitSec: number; avgWait: string;
  netLoginSec: number; netLoginTime: string;
  utilization: number;
}

export async function getCartAnalysts(rawFilters: { from?: string; to?: string }): Promise<CartAnalystRow[]> {
  const range = parseRange(rawFilters);
  return cachedLive('cart-analysts', range, () => computeCartAnalysts(range));
}

async function computeCartAnalysts(rawFilters: { from?: string; to?: string }): Promise<CartAnalystRow[]> {
  const { from, to } = parseRange(rawFilters);

  const [cdrRows, aprRows] = await Promise.all([
    dialerQuery<RowDataPacket>(`
      SELECT Agent AS analyst,
        COUNT(*) AS totalDialed,
        COUNT(DISTINCT PhoneNumber) AS uniqueDialed,
        COUNT(DISTINCT CASE WHEN talk_sec > 0 THEN PhoneNumber ELSE NULL END) AS uniqueConnected,
        SUM(CASE WHEN talk_sec > 0 THEN 1 ELSE 0 END) AS connected,
        SUM(CAST(talk_sec AS UNSIGNED)) AS talkSec,
        SUM(CASE WHEN talk_sec > 0 AND talk_sec < 30 THEN 1 ELSE 0 END) AS lt30,
        SUM(CASE WHEN talk_sec >= 30 THEN 1 ELSE 0 END) AS ge30
      FROM ${CDR_TABLE}
      WHERE CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)
        AND UPPER(campaign_id) IN (${CAMP_IN})
        AND Agent IS NOT NULL AND Agent != ''
      GROUP BY Agent ORDER BY totalDialed DESC LIMIT 200
    `, [from, to, ...CART_CAMPAIGNS]),
    dialerQuery<RowDataPacket>(`
      SELECT user,
        SUM(talk_sec) AS talkSec, SUM(dispo_sec) AS dispoSec,
        SUM(dead_sec) AS deadSec, SUM(wait_sec) AS waitSec, SUM(pause_sec) AS pauseSec,
        COUNT(DISTINCT DATE(event_time)) AS loginDays
      FROM ${APR_TABLE}
      WHERE event_time >= ? AND event_time < DATE_ADD(?, INTERVAL 1 DAY)
        AND UPPER(campaign_id) IN (${CAMP_IN})
      GROUP BY user LIMIT 200
    `, [from, to, ...CART_CAMPAIGNS]),
  ]);

  const aprMap: Record<string, RowDataPacket> = {};
  for (const r of aprRows) aprMap[String(r.user ?? '').toUpperCase().trim()] = r;
  const names = await resolveEmployeeNames(cdrRows.map(r => String(r.analyst ?? '')));

  return cdrRows.map(r => {
    const analyst = String(r.analyst ?? '');
    const connected = n(r.connected);
    const cdrTalk = n(r.talkSec);
    const avgTalkSec = connected > 0 ? Math.round(cdrTalk / connected) : 0;

    const apr = aprMap[analyst.toUpperCase().trim()] ?? null;
    const aprTalk = apr ? n(apr.talkSec) : 0;
    const dispoSec = apr ? n(apr.dispoSec) : 0;
    const deadSec = apr ? n(apr.deadSec) : 0;
    const waitSec = apr ? n(apr.waitSec) : 0;
    const pauseSec = apr ? n(apr.pauseSec) : 0;
    const loginDays = apr ? n(apr.loginDays) : 0;
    const netLoginSec = aprTalk + dispoSec + waitSec + pauseSec;
    const ahtSec = connected > 0 ? Math.round((aprTalk + dispoSec + deadSec) / connected) : 0;
    const avgWrapSec = connected > 0 ? Math.round(dispoSec / connected) : 0;
    const avgWaitSec = loginDays > 0 ? Math.round(waitSec / loginDays) : 0;

    return {
      analyst,
      analystName: names.get(codeKey(analyst)) ?? null,
      loginDays,
      totalDialed: n(r.totalDialed),
      uniqueDialed: n(r.uniqueDialed),
      uniqueConnected: n(r.uniqueConnected),
      connectPct: pct(n(r.uniqueConnected), n(r.uniqueDialed)),
      lt30: n(r.lt30), ge30: n(r.ge30),
      avgTalkSec, avgTalk: fmtSec(avgTalkSec),
      ahtSec, aht: fmtSec(ahtSec),
      avgWrapSec, avgWrap: fmtSec(avgWrapSec),
      avgWaitSec, avgWait: fmtSec(avgWaitSec),
      netLoginSec: Math.round(netLoginSec), netLoginTime: fmtSec(netLoginSec),
      utilization: netLoginSec > 0 ? pct(aprTalk + waitSec, netLoginSec) : 0,
    };
  });
}

// ── APR with LB/TB/WB ────────────────────────────────────────────────────────

export interface CartAprRow {
  user: string;
  /** Employee name from HRMS; null when the code has no HRMS record. */
  agentName: string | null;
  aprCalls: number;
  netLoginSec: number; netLoginTime: string;
  talkSec: number; talk: string;
  waitSec: number; wait: string;
  dispoSec: number; dispo: string;
  pauseSec: number; pause: string;
  lbTime: string; tbTime: string; wbTime: string; mbTime: string; qbTime: string;
  utilization: number;
}

export async function getCartApr(rawFilters: { from?: string; to?: string }): Promise<CartAprRow[]> {
  const range = parseRange(rawFilters);
  return cachedLive('cart-apr', range, () => computeCartApr(range));
}

async function computeCartApr(rawFilters: { from?: string; to?: string }): Promise<CartAprRow[]> {
  const { from, to } = parseRange(rawFilters);
  // Break codes are the dialler's own sub_status values: LB lunch, TB tea,
  // WB washroom, MB meeting, QB quality. MB and QB were never broken out;
  // both exist in vicidial_agent_log_10_25 (QB is rare — 15 events in 2026).
  const sql = `
    SELECT user,
      SUM(wait_sec) AS waitSec, SUM(talk_sec) AS talkSec,
      SUM(dispo_sec) AS dispoSec, SUM(pause_sec) AS pauseSec,
      SUM(CASE WHEN UPPER(sub_status)='LB' THEN pause_sec ELSE 0 END) AS lbSec,
      SUM(CASE WHEN UPPER(sub_status)='TB' THEN pause_sec ELSE 0 END) AS tbSec,
      SUM(CASE WHEN UPPER(sub_status) IN ('WB','WC','WASHR') THEN pause_sec ELSE 0 END) AS wbSec,
      SUM(CASE WHEN UPPER(sub_status)='MB' THEN pause_sec ELSE 0 END) AS mbSec,
      SUM(CASE WHEN UPPER(sub_status)='QB' THEN pause_sec ELSE 0 END) AS qbSec,
      COUNT(*) AS aprCalls
    FROM ${APR_TABLE}
    WHERE event_time >= ? AND event_time < DATE_ADD(?, INTERVAL 1 DAY)
      AND UPPER(campaign_id) IN (${CAMP_IN})
    GROUP BY user ORDER BY talkSec DESC LIMIT 200
  `;
  const rows = await dialerQuery<RowDataPacket>(sql, [from, to, ...CART_CAMPAIGNS]);
  const names = await resolveEmployeeNames(rows.map(r => String(r.user ?? '')));
  return rows.map(r => {
    const waitSec = n(r.waitSec), talkSec = n(r.talkSec), dispoSec = n(r.dispoSec), pauseSec = n(r.pauseSec);
    const netLoginSec = waitSec + talkSec + dispoSec + pauseSec;
    const user = String(r.user ?? '');
    // Every duration uses fmtDuration's fixed H:MM:SS so a column never mixes
    // "47:36" (minutes) with "1:40:53" (hours).
    return {
      user,
      agentName: names.get(codeKey(user)) ?? null,
      aprCalls: n(r.aprCalls),
      netLoginSec: Math.round(netLoginSec), netLoginTime: fmtDuration(netLoginSec),
      talkSec: Math.round(talkSec), talk: fmtDuration(talkSec),
      waitSec: Math.round(waitSec), wait: fmtDuration(waitSec),
      dispoSec: Math.round(dispoSec), dispo: fmtDuration(dispoSec),
      pauseSec: Math.round(pauseSec), pause: fmtDuration(pauseSec),
      lbTime: fmtDuration(n(r.lbSec)), tbTime: fmtDuration(n(r.tbSec)), wbTime: fmtDuration(n(r.wbSec)),
      mbTime: fmtDuration(n(r.mbSec)), qbTime: fmtDuration(n(r.qbSec)),
      utilization: netLoginSec > 0 ? pct(waitSec + talkSec, netLoginSec) : 0,
    };
  });
}

// ── Sales data from mas_hrms (uploaded via REGINALD_ABANDONED_CART_SALES) ────


export interface CartSalesDayRow {
  date: string;
  orders: number;
  revenue: number;
  aov: number;
  prepaid: number;
  cod: number;
  prepaidPct: number;
  codPct: number;
}

export interface CartSalesSummary {
  from: string;
  to: string;
  orders: number;
  revenue: number;
  aov: number;
  prepaid: number;
  cod: number;
  prepaidPct: number;
  codPct: number;
  byAgent: { empId: string; agentName: string; orders: number; revenue: number; aov: number }[];
  daily: CartSalesDayRow[];
}

export async function getCartSales(rawFilters: { from?: string; to?: string }): Promise<CartSalesSummary> {
  const { from, to } = parseRange(rawFilters);

  const [summRows] = await db.execute<MasRow[]>(`
    SELECT
      COUNT(*)                                                           AS orders,
      COALESCE(SUM(amount), 0)                                           AS revenue,
      SUM(CASE WHEN UPPER(payment_type)='PREPAID' THEN 1 ELSE 0 END)    AS prepaid,
      SUM(CASE WHEN UPPER(payment_type)='COD'     THEN 1 ELSE 0 END)    AS cod
    FROM reginald_abandoned_cart_sales_raw
    WHERE order_date >= ? AND order_date < DATE_ADD(?, INTERVAL 1 DAY)
  `, [from, to]);

  const [dayRows] = await db.execute<MasRow[]>(`
    SELECT
      DATE(order_date)                                                   AS date,
      COUNT(*)                                                           AS orders,
      COALESCE(SUM(amount), 0)                                           AS revenue,
      SUM(CASE WHEN UPPER(payment_type)='PREPAID' THEN 1 ELSE 0 END)    AS prepaid,
      SUM(CASE WHEN UPPER(payment_type)='COD'     THEN 1 ELSE 0 END)    AS cod
    FROM reginald_abandoned_cart_sales_raw
    WHERE order_date >= ? AND order_date < DATE_ADD(?, INTERVAL 1 DAY)
    GROUP BY DATE(order_date)
    ORDER BY date
  `, [from, to]);

  const [agentRows] = await db.execute<MasRow[]>(`
    SELECT
      COALESCE(emp_id, 'Unknown')                                        AS empId,
      COALESCE(agent_name, emp_id, 'Unknown')                            AS agentName,
      COUNT(*)                                                           AS orders,
      COALESCE(SUM(amount), 0)                                           AS revenue
    FROM reginald_abandoned_cart_sales_raw
    WHERE order_date >= ? AND order_date < DATE_ADD(?, INTERVAL 1 DAY)
      AND agent_name IS NOT NULL AND agent_name != ''
    GROUP BY emp_id, agent_name
    ORDER BY orders DESC
    LIMIT 100
  `, [from, to]);

  const s = summRows[0] ?? {};
  const orders = n(s.orders), revenue = n(s.revenue), prepaid = n(s.prepaid), cod = n(s.cod);
  const aov = orders > 0 ? round(revenue / orders, 2) : 0;

  return {
    from, to,
    orders, revenue: round(revenue, 2), aov,
    prepaid, cod,
    prepaidPct: pct(prepaid, orders),
    codPct: pct(cod, orders),
    byAgent: (agentRows as MasRow[]).map(r => {
      const ao = n(r.orders), ar = n(r.revenue);
      return { empId: String(r.empId ?? ''), agentName: String(r.agentName ?? ''), orders: ao, revenue: round(ar, 2), aov: ao > 0 ? round(ar / ao, 2) : 0 };
    }),
    daily: (dayRows as MasRow[]).map(r => {
      const do_ = n(r.orders), dr = n(r.revenue), dp = n(r.prepaid), dc = n(r.cod);
      return { date: String(r.date ?? ''), orders: do_, revenue: round(dr, 2), aov: do_ > 0 ? round(dr / do_, 2) : 0, prepaid: dp, cod: dc, prepaidPct: pct(dp, do_), codPct: pct(dc, do_) };
    }),
  };
}
