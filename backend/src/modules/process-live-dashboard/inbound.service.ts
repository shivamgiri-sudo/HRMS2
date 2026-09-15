/**
 * BLA BLI BLU Inbound (B-3 IB) live dashboard service.
 *
 * Source tables  : cdr_in_10_4 (CDR), vicidial_agent_log_10_4 (APR), data_master_in (Disposition)
 * Client filter  : ClientId = 487 (data_master_in only)
 * Handled logic  : AgentName IS NOT NULL AND AgentName != '' AND AgentName != 'Inbound No Agent'
 * SL logic       : calls20 / (offered - abndWithin) * 100  [GAS finalMetric_() exact replica]
 *
 * All data points match the GAS B-3 IB dashboard exactly:
 *   KPIs: offered, handled, calls20, abandoned, abndWithin, abndAfter, talkTime, SL%, AL%,
 *         AHT, callDurationSec, acwTime, holdTime, loginCount, cpa
 *   Executive signals: answerRate, within20Rate, abandonRate, dailyAverage, healthScore
 *   Matrix: AL%, SL%, offered, handled, calls20, abandoned, abndWithin, abndAfter, talkTime,
 *           callDurationSec, AHT — grouped by day/month
 *   Slot: Interval, Offered, Answered, Abandoned, Ans≤20s, SL%, AL%, AHT, WrapSec, LoginHC,
 *         CPA, Abnd≤20s, Abnd>20s, TalkTime, TalkSec, HoldSec, Repeat, Repeat%
 *   Agent: AgentName, Offered, Handled, Calls20, CDR Talk, SL%, AL%, AHT,
 *          APR merged: APRCalls, NetLoginTime, Utilization%, Wait, AprTalk, Pause, LB, TB, WB
 *   Disposition: Complaint, Query, Request, Sales, Other totals + daily + sub-disposition
 *   Repeat: unique/repeat by phone number per day
 */

import type { RowDataPacket } from 'mysql2';
import { dialerQuery } from '../../db/dialerDb.js';
import { db } from '../../db/mysql.js';
import { n, pct, round, fmtSec, finalMetric, parseRange, type MetricResult } from './dialler-utils.js';

/**
 * The dialler's agent log identifies agents only by employee code (its `user`
 * column, e.g. MAS62353); it carries no name. Names live in HRMS, so resolve
 * them from mas_hrms.employees. Codes with no HRMS record resolve to null.
 */
async function resolveEmployeeNames(codes: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(codes.map(c => c.trim().toUpperCase()).filter(Boolean))];
  const names = new Map<string, string>();
  if (unique.length === 0) return names;
  // employee_code is compared bare so its index is used — wrapping it in
  // UPPER()/TRIM() forces a full scan. Dialler codes are already upper-case;
  // the JS side normalises both sides for the lookup.
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT employee_code AS code,
            TRIM(COALESCE(NULLIF(TRIM(full_name), ''), CONCAT_WS(' ', first_name, last_name))) AS name
       FROM employees
      WHERE employee_code IN (?)`,
    [unique],
  );
  for (const r of rows) if (r.name) names.set(String(r.code).trim().toUpperCase(), String(r.name));
  return names;
}

const CDR_TABLE = 'cdr_in_10_4';
const APR_TABLE = 'vicidial_agent_log_10_4';
const DISPO_TABLE = 'data_master_in';
const CLIENT_ID = 487;
const NO_AGENT = 'Inbound No Agent';

const HANDLED_EXPR = `(AgentName IS NOT NULL AND AgentName != '' AND LOWER(TRIM(AgentName)) != '${NO_AGENT.toLowerCase()}')`;

// Full CDR SELECT — matches every field GAS buildCdrMetricSelect_() computes.
// Talkduration, Acwduration, HoldTime are stored as HH:MM:SS varchar(45)
// — CAST to UNSIGNED gives 0. TIME_TO_SEC() converts correctly.
// Call20Sec is stored as '1'/'0' varchar so CAST(AS UNSIGNED) works fine.
const CDR_SELECT = `
  COUNT(*)                                                                   AS offered,
  SUM(CASE WHEN ${HANDLED_EXPR} THEN 1 ELSE 0 END)                          AS handled,
  SUM(CAST(Call20Sec AS UNSIGNED))                                           AS calls20,
  SUM(CASE WHEN NOT (${HANDLED_EXPR}) AND CAST(Call20Sec AS UNSIGNED)=1 THEN 1 ELSE 0 END) AS abndWithin,
  SUM(TIME_TO_SEC(Talkduration))                                             AS talkSecTotal,
  SUM(CASE WHEN ${HANDLED_EXPR} THEN TIME_TO_SEC(Talkduration) ELSE 0 END)  AS handledTalkSec,
  SUM(TIME_TO_SEC(Acwduration))                                              AS acwSecTotal,
  SUM(CASE WHEN ${HANDLED_EXPR} THEN TIME_TO_SEC(Acwduration) ELSE 0 END)   AS handledAcwSec,
  SUM(CASE WHEN TIME_TO_SEC(HoldTime) > 0 THEN TIME_TO_SEC(HoldTime) ELSE 0 END) AS holdSec,
  SUM(CASE WHEN TIME_TO_SEC(HoldTime) > 0 THEN 1 ELSE 0 END)                AS holdCount,
  COUNT(DISTINCT CASE WHEN ${HANDLED_EXPR} THEN AgentName ELSE NULL END)     AS loginCount
`;

function buildFullRow(r: RowDataPacket): MetricResult & {
  talkSecTotal: number; talkTime: string;
  acwSecTotal: number; acwTime: string;
  callDurationSec: number;
  abandonRate: number; within20Rate: number;
} {
  const offered = n(r.offered);
  const handled = n(r.handled);
  const calls20 = n(r.calls20);
  const abndWithin = n(r.abndWithin);
  const handledTalkSec = n(r.handledTalkSec);
  const handledAcwSec = n(r.handledAcwSec);
  const holdSec = n(r.holdSec);
  const holdCount = n(r.holdCount);
  const loginCount = n(r.loginCount);
  const talkSecTotal = n(r.talkSecTotal);
  const acwSecTotal = n(r.acwSecTotal);

  const base = finalMetric({ offered, handled, calls20, abndWithin, handledTalkSec, handledAcwSec, holdSec, holdCount, loginCount });
  return {
    ...base,
    talkSecTotal: Math.round(talkSecTotal),
    talkTime: fmtSec(talkSecTotal),
    acwSecTotal: Math.round(acwSecTotal),
    acwTime: fmtSec(acwSecTotal),
    callDurationSec: offered > 0 ? round(talkSecTotal / offered, 2) : 0,
    abandonRate: pct(offered - handled, offered),
    within20Rate: handled > 0 ? pct(calls20, handled) : 0,
  };
}

// ── Summary (overall KPIs + executive signals) ─────────────────────────────────

export interface InboundSummary extends ReturnType<typeof buildFullRow> {
  from: string;
  to: string;
  dailyAverage: number;
  healthScore: number;
  healthStatus: 'Healthy' | 'Watch' | 'Critical' | 'No Data';
  generatedAt: string;
}

export async function getInboundSummary(rawFilters: { from?: string; to?: string }): Promise<InboundSummary> {
  const { from, to } = parseRange(rawFilters);

  const [overallRows, dayRows] = await Promise.all([
    dialerQuery<RowDataPacket>(`SELECT ${CDR_SELECT} FROM ${CDR_TABLE} WHERE CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)`, [from, to]),
    dialerQuery<RowDataPacket>(`SELECT DATE(CallDate) AS date, COUNT(*) AS offered FROM ${CDR_TABLE} WHERE CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY) GROUP BY DATE(CallDate)`, [from, to]),
  ]);

  const r = overallRows[0] ?? {};
  const row = buildFullRow(r);
  const activeDays = (dayRows || []).filter(d => n(d.offered) > 0).length;
  const dailyAverage = activeDays > 0 ? round(row.offered / activeDays, 1) : 0;

  // Health score: SL 35% + AL 30% + Within20 15% + AbandonScore 20%
  let healthScore = 0;
  if (row.offered > 0) {
    const target = (v: number, t: number) => Math.min(100, t > 0 ? (v * 100) / t : 0);
    const abandScore = row.abandonRate <= 5 ? 100 : Math.max(0, 100 - (row.abandonRate - 5) * 8);
    healthScore = Math.round(
      target(row.sl, 80) * 0.35 + target(row.al, 80) * 0.30 + target(row.within20Rate, 80) * 0.15 + abandScore * 0.20
    );
  }
  const healthStatus: InboundSummary['healthStatus'] = row.offered === 0 ? 'No Data'
    : healthScore >= 90 ? 'Healthy'
    : healthScore >= 75 ? 'Watch'
    : 'Critical';

  return { ...row, from, to, dailyAverage, healthScore, healthStatus, generatedAt: new Date().toISOString() };
}

// ── Monthly aggregation (matrix) ──────────────────────────────────────────────

export type InboundMonthRow = ReturnType<typeof buildFullRow> & { month: string };

export async function getInboundMonthly(rawFilters: { from?: string; to?: string }): Promise<InboundMonthRow[]> {
  const { from, to } = parseRange(rawFilters);
  const sql = `SELECT DATE_FORMAT(CallDate, '%Y-%m') AS month, ${CDR_SELECT} FROM ${CDR_TABLE} WHERE CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY) GROUP BY month ORDER BY month`;
  const rows = await dialerQuery<RowDataPacket>(sql, [from, to]);
  return rows.filter(r => n(r.offered) > 0).map(r => ({ month: String(r.month ?? ''), ...buildFullRow(r) }));
}

// ── Day-wise breakdown (matrix) ───────────────────────────────────────────────

export type InboundDayRow = ReturnType<typeof buildFullRow> & { date: string };

export async function getInboundDaily(rawFilters: { from?: string; to?: string }): Promise<InboundDayRow[]> {
  const { from, to } = parseRange(rawFilters);
  const sql = `SELECT DATE(CallDate) AS date, ${CDR_SELECT} FROM ${CDR_TABLE} WHERE CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY) GROUP BY DATE(CallDate) ORDER BY date`;
  const rows = await dialerQuery<RowDataPacket>(sql, [from, to]);
  return rows.map(r => ({ date: String(r.date ?? ''), ...buildFullRow(r) }));
}

// ── Hourly slot breakdown (full slot table with all GAS columns) ──────────────

export interface InboundSlotRow extends ReturnType<typeof buildFullRow> {
  slot: string;
  loginCount: number;
  repeatCalls: number;
  repeatPct: number;
}

export async function getInboundHourly(rawFilters: { date?: string }): Promise<InboundSlotRow[]> {
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const date = rawFilters.date && dateRe.test(rawFilters.date) ? rawFilters.date : new Date().toISOString().slice(0, 10);

  // Main slot aggregates
  const sql = `
    SELECT
      COALESCE(HoursSlot, 'Unknown') AS slot,
      ${CDR_SELECT},
      COUNT(DISTINCT PhoneNumber) AS uniquePhones
    FROM ${CDR_TABLE}
    WHERE DATE(CallDate) = ?
    GROUP BY HoursSlot
    ORDER BY slot
  `;
  const rows = await dialerQuery<RowDataPacket>(sql, [date]);

  return rows.map(r => {
    const base = buildFullRow(r);
    const phoneCalls = n(r.handled);
    const uniquePhones = n(r.uniquePhones);
    const repeatCalls = Math.max(0, phoneCalls - uniquePhones);
    return {
      slot: String(r.slot ?? ''),
      ...base,
      repeatCalls,
      repeatPct: phoneCalls > 0 ? pct(repeatCalls, phoneCalls) : 0,
    };
  });
}

// ── Agent-wise table with APR merge ──────────────────────────────────────────

export interface InboundAgentRow {
  agentName: string;
  offered: number;
  handled: number;
  calls20: number;
  talkSec: number;
  talk: string;
  sl: number;
  al: number;
  ahtSec: number;
  aht: string;
  // APR fields (null if no APR data)
  aprCalls: number;
  netLoginSec: number;
  netLoginTime: string;
  utilization: number;
  waitTime: string;
  aprTalkTime: string;
  pauseTime: string;
  lbTime: string;
  tbTime: string;
  wbTime: string;
}

export async function getInboundAgents(rawFilters: { from?: string; to?: string }): Promise<InboundAgentRow[]> {
  const { from, to } = parseRange(rawFilters);

  const [cdrRows, aprRows] = await Promise.all([
    dialerQuery<RowDataPacket>(`
      SELECT AgentName AS agentName,
        COUNT(*) AS offered,
        SUM(CASE WHEN ${HANDLED_EXPR} THEN 1 ELSE 0 END) AS handled,
        SUM(CAST(Call20Sec AS UNSIGNED)) AS calls20,
        SUM(CASE WHEN ${HANDLED_EXPR} THEN TIME_TO_SEC(Talkduration) ELSE 0 END) AS handledTalkSec,
        SUM(CASE WHEN ${HANDLED_EXPR} THEN TIME_TO_SEC(Acwduration) ELSE 0 END) AS handledAcwSec,
        SUM(CASE WHEN ${HANDLED_EXPR} THEN TIME_TO_SEC(HoldTime) ELSE 0 END) AS holdSec
      FROM ${CDR_TABLE}
      WHERE CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)
        AND ${HANDLED_EXPR}
      GROUP BY AgentName ORDER BY handled DESC LIMIT 200
    `, [from, to]),
    dialerQuery<RowDataPacket>(`
      SELECT user,
        SUM(wait_sec) AS waitSec, SUM(talk_sec) AS talkSec,
        SUM(dispo_sec) AS dispoSec, SUM(pause_sec) AS pauseSec,
        SUM(CASE WHEN UPPER(sub_status)='LB' THEN pause_sec ELSE 0 END) AS lbSec,
        SUM(CASE WHEN UPPER(sub_status)='TB' THEN pause_sec ELSE 0 END) AS tbSec,
        SUM(CASE WHEN UPPER(sub_status) IN ('WB','WC','WASHR') THEN pause_sec ELSE 0 END) AS wbSec,
        COUNT(*) AS aprCalls
      FROM ${APR_TABLE}
      WHERE DATE(event_time) >= ? AND DATE(event_time) <= ?
      GROUP BY user LIMIT 200
    `, [from, to]),
  ]);

  // Build APR map keyed by user (uppercase trimmed)
  const aprMap: Record<string, RowDataPacket> = {};
  for (const r of aprRows) aprMap[String(r.user ?? '').toUpperCase().trim()] = r;

  return cdrRows.map(r => {
    const agentName = String(r.agentName ?? '');
    const offered = n(r.offered);
    const handled = n(r.handled);
    const calls20 = n(r.calls20);
    const handledTalkSec = n(r.handledTalkSec);
    const handledAcwSec = n(r.handledAcwSec);
    const holdSec = n(r.holdSec);
    const ahtSec = handled > 0 ? Math.round((handledTalkSec + holdSec + handledAcwSec) / handled) : 0;

    // Try to find matching APR row (agent IDs may differ; match by uppercase trim)
    const apr = aprMap[agentName.toUpperCase().trim()] ?? null;
    const waitSec = apr ? n(apr.waitSec) : 0;
    const aprTalkSec = apr ? n(apr.talkSec) : 0;
    const dispoSec = apr ? n(apr.dispoSec) : 0;
    const pauseSec = apr ? n(apr.pauseSec) : 0;
    const lbSec = apr ? n(apr.lbSec) : 0;
    const tbSec = apr ? n(apr.tbSec) : 0;
    const wbSec = apr ? n(apr.wbSec) : 0;
    const aprCalls = apr ? n(apr.aprCalls) : 0;
    const netLoginSec = waitSec + aprTalkSec + dispoSec + pauseSec;

    return {
      agentName,
      offered, handled, calls20,
      talkSec: Math.round(handledTalkSec),
      talk: fmtSec(handledTalkSec),
      sl: pct(calls20, handled),
      al: pct(handled, offered),
      ahtSec, aht: fmtSec(ahtSec),
      aprCalls,
      netLoginSec: Math.round(netLoginSec),
      netLoginTime: fmtSec(netLoginSec),
      utilization: netLoginSec > 0 ? pct(waitSec + aprTalkSec, netLoginSec) : 0,
      waitTime: fmtSec(waitSec),
      aprTalkTime: fmtSec(aprTalkSec),
      pauseTime: fmtSec(pauseSec),
      lbTime: fmtSec(lbSec),
      tbTime: fmtSec(tbSec),
      wbTime: fmtSec(wbSec),
    };
  });
}

// ── APR (Agent Productivity Report) with LB/TB/WB breakdown ──────────────────

export interface AprAgentRow {
  user: string;
  /** Employee name from HRMS; null when the code has no HRMS record. */
  agentName: string | null;
  aprCalls: number;
  netLoginSec: number; netLoginTime: string;
  talkSec: number; talk: string;
  waitSec: number; wait: string;
  dispoSec: number; dispo: string;
  pauseSec: number; pause: string;
  lbTime: string; tbTime: string; wbTime: string;
  utilization: number;
  loginStart: string;
  logout: string;
}

export async function getInboundApr(rawFilters: { from?: string; to?: string }): Promise<AprAgentRow[]> {
  const { from, to } = parseRange(rawFilters);
  const sql = `
    SELECT user,
      SUM(wait_sec) AS waitSec, SUM(talk_sec) AS talkSec,
      SUM(dispo_sec) AS dispoSec, SUM(pause_sec) AS pauseSec,
      SUM(CASE WHEN UPPER(sub_status)='LB' THEN pause_sec ELSE 0 END) AS lbSec,
      SUM(CASE WHEN UPPER(sub_status)='TB' THEN pause_sec ELSE 0 END) AS tbSec,
      SUM(CASE WHEN UPPER(sub_status) IN ('WB','WC','WASHR') THEN pause_sec ELSE 0 END) AS wbSec,
      COUNT(*) AS aprCalls,
      MIN(event_time) AS loginStart, MAX(event_time) AS logout
    FROM ${APR_TABLE}
    WHERE DATE(event_time) >= ? AND DATE(event_time) <= ?
    GROUP BY user ORDER BY talkSec DESC LIMIT 200
  `;
  const rows = await dialerQuery<RowDataPacket>(sql, [from, to]);
  const names = await resolveEmployeeNames(rows.map(r => String(r.user ?? '')));
  return rows.map(r => {
    const waitSec = n(r.waitSec), talkSec = n(r.talkSec), dispoSec = n(r.dispoSec), pauseSec = n(r.pauseSec);
    const lbSec = n(r.lbSec), tbSec = n(r.tbSec), wbSec = n(r.wbSec);
    const netLoginSec = waitSec + talkSec + dispoSec + pauseSec;
    const user = String(r.user ?? '');
    return {
      user,
      agentName: names.get(user.trim().toUpperCase()) ?? null,
      aprCalls: n(r.aprCalls),
      netLoginSec: Math.round(netLoginSec), netLoginTime: fmtSec(netLoginSec),
      talkSec: Math.round(talkSec), talk: fmtSec(talkSec),
      waitSec: Math.round(waitSec), wait: fmtSec(waitSec),
      dispoSec: Math.round(dispoSec), dispo: fmtSec(dispoSec),
      pauseSec: Math.round(pauseSec), pause: fmtSec(pauseSec),
      lbTime: fmtSec(lbSec), tbTime: fmtSec(tbSec), wbTime: fmtSec(wbSec),
      utilization: netLoginSec > 0 ? pct(waitSec + talkSec, netLoginSec) : 0,
      loginStart: r.loginStart ? String(r.loginStart) : '',
      logout: r.logout ? String(r.logout) : '',
    };
  });
}

// ── Disposition breakdown with sub-dispositions (Category1 + Category2) ───────

export interface DispositionTotals {
  complaint: number; query: number; request: number; sales: number; other: number; total: number;
}
export interface DispositionDayRow extends DispositionTotals { date: string }
export interface SubDispositionRow { scenario: string; subDisposition: string; count: number }
export interface InboundDisposition {
  totals: DispositionTotals;
  daily: DispositionDayRow[];
  subDisposition: SubDispositionRow[];
  rowCount: number;
}

function dispositionKey(sc: string): keyof DispositionTotals {
  const s = sc.toLowerCase().trim();
  if (s === 'complaint') return 'complaint';
  if (s === 'query') return 'query';
  if (s === 'request') return 'request';
  if (s === 'sale done' || s === 'sale' || s === 'sales') return 'sales';
  return 'other';
}

export async function getInboundDisposition(rawFilters: { from?: string; to?: string }): Promise<InboundDisposition> {
  const { from, to } = parseRange(rawFilters);

  const [mainRows, subRows] = await Promise.all([
    // DATE_FORMAT, not DATE(): the dialler pool does not set `dateStrings`, so a
    // DATE column arrives as a JS Date and stringifies to "Mon Sep 01 2026 ...".
    // The daily rows are keyed and then sorted by that string, which sorts
    // alphabetically by weekday name — Fri, Mon, Sat, Sun, Thu... — scrambling
    // the day-wise disposition charts. An ISO string sorts chronologically.
    dialerQuery<RowDataPacket>(`
      SELECT DATE_FORMAT(CallDate,'%Y-%m-%d') AS date, LOWER(TRIM(Category1)) AS scenario, COUNT(*) AS cnt
      FROM ${DISPO_TABLE}
      WHERE ClientId = ? AND CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY date, LOWER(TRIM(Category1)) ORDER BY date
    `, [CLIENT_ID, from, to]),
    dialerQuery<RowDataPacket>(`
      SELECT LOWER(TRIM(Category1)) AS scenario, TRIM(Category2) AS subDispo, COUNT(*) AS cnt
      FROM ${DISPO_TABLE}
      WHERE ClientId = ? AND CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)
        AND Category2 IS NOT NULL AND Category2 != ''
      GROUP BY LOWER(TRIM(Category1)), TRIM(Category2)
      ORDER BY scenario, cnt DESC
    `, [CLIENT_ID, from, to]),
  ]);

  const dailyMap: Record<string, DispositionDayRow> = {};
  const totals: DispositionTotals = { complaint: 0, query: 0, request: 0, sales: 0, other: 0, total: 0 };
  let rowCount = 0;

  for (const r of mainRows) {
    const date = String(r.date ?? '');
    const key = dispositionKey(String(r.scenario ?? ''));
    const cnt = n(r.cnt);
    if (!dailyMap[date]) dailyMap[date] = { date, complaint: 0, query: 0, request: 0, sales: 0, other: 0, total: 0 };
    dailyMap[date][key] += cnt;
    dailyMap[date].total += cnt;
    totals[key] += cnt;
    totals.total += cnt;
    rowCount += cnt;
  }

  const subDisposition: SubDispositionRow[] = subRows.map(r => ({
    scenario: String(r.scenario ?? ''),
    subDisposition: String(r.subDispo ?? ''),
    count: n(r.cnt),
  }));

  return {
    totals,
    daily: Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date)),
    subDisposition,
    rowCount,
  };
}

// ── Repeat analysis (phone-based dedup per GAS logic) ─────────────────────────

export interface RepeatDayRow {
  date: string;
  total: number;
  unique: number;
  repeat: number;
  repeatPct: number;
}

export interface RepeatAgentRow {
  agentName: string;
  total: number;
  unique: number;
  repeat: number;
  repeatPct: number;
}

export interface RepeatAnalysis {
  daily: RepeatDayRow[];
  agents: RepeatAgentRow[];
  totals: { total: number; unique: number; repeat: number; repeatPct: number };
}

export async function getInboundRepeat(rawFilters: { from?: string; to?: string }): Promise<RepeatAnalysis> {
  const { from, to } = parseRange(rawFilters);

  const [dayRows, agentRows] = await Promise.all([
    dialerQuery<RowDataPacket>(`
      SELECT DATE(CallDate) AS date,
        COUNT(*) AS total,
        COUNT(DISTINCT PhoneNumber) AS uniquePhones
      FROM ${CDR_TABLE}
      WHERE CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)
        AND ${HANDLED_EXPR}
      GROUP BY DATE(CallDate) ORDER BY date
    `, [from, to]),
    dialerQuery<RowDataPacket>(`
      SELECT AgentName AS agentName,
        COUNT(*) AS total,
        COUNT(DISTINCT PhoneNumber) AS uniquePhones
      FROM ${CDR_TABLE}
      WHERE CallDate >= ? AND CallDate < DATE_ADD(?, INTERVAL 1 DAY)
        AND ${HANDLED_EXPR}
      GROUP BY AgentName ORDER BY total DESC LIMIT 100
    `, [from, to]),
  ]);

  const daily: RepeatDayRow[] = dayRows.map(r => {
    const total = n(r.total), unique = n(r.uniquePhones);
    const repeat = Math.max(0, total - unique);
    return { date: String(r.date ?? ''), total, unique, repeat, repeatPct: pct(repeat, total) };
  });

  const agents: RepeatAgentRow[] = agentRows.map(r => {
    const total = n(r.total), unique = n(r.uniquePhones);
    const repeat = Math.max(0, total - unique);
    return { agentName: String(r.agentName ?? ''), total, unique, repeat, repeatPct: pct(repeat, total) };
  });

  const tot = daily.reduce((acc, d) => ({ total: acc.total + d.total, unique: acc.unique + d.unique }), { total: 0, unique: 0 });
  const totalRepeat = Math.max(0, tot.total - tot.unique);

  return {
    daily, agents,
    totals: { total: tot.total, unique: tot.unique, repeat: totalRepeat, repeatPct: pct(totalRepeat, tot.total) },
  };
}
