/**
 * APR (Agent Productivity Report) service for email-tool processes.
 *
 * Molecular Email : campaign_id = 'MOEMAIL'
 * Reginald Email  : campaign_id = 'EMAIL'
 *
 * Source table: vicidial_agent_log_10_25
 *
 * All GAS APR columns matched:
 *   Analyst, ID, Login Time, Calls, Wait, Talk, Dispo, ACHT (AHT), Total Break,
 *   Net Login Hrs, Utilization%
 *   LB (Lunch Break), TB (Tea Break), WB (Washroom Break) time breakdown
 *
 * Note: Email ticket data (received, closed, pending, reopen, closure%) requires the
 * separate molecular_db_email database on 122.184.128.89 — not accessible here.
 * The GAS dashboard fetches both; this service provides APR/time metrics only.
 */

import type { RowDataPacket } from 'mysql2';
import { dialerQuery } from '../../db/dialerDb.js';
import { n, pct, fmtSec, round, parseRange } from './dialler-utils.js';

const APR_TABLE = 'vicidial_agent_log_10_25';

export type EmailProcess = 'molecular' | 'reginald-email';

const CAMPAIGN_MAP: Record<EmailProcess, string> = {
  molecular: 'MOEMAIL',
  'reginald-email': 'EMAIL',
};

// ── Summary ───────────────────────────────────────────────────────────────────

export interface AprSummary {
  process: string; campaign: string; from: string; to: string;
  totalLoginSec: number; totalLoginTime: string;
  totalTalkSec: number; totalTalk: string;
  totalWaitSec: number; totalWait: string;
  totalPauseSec: number; totalPause: string;
  totalLbSec: number; totalLbTime: string;
  totalTbSec: number; totalTbTime: string;
  totalWbSec: number; totalWbTime: string;
  avgUtilization: number;
  agentCount: number;
  generatedAt: string;
}

export async function getAprSummary(process: EmailProcess, rawFilters: { from?: string; to?: string }): Promise<AprSummary> {
  const { from, to } = parseRange(rawFilters);
  const campaign = CAMPAIGN_MAP[process];
  const sql = `
    SELECT
      SUM(wait_sec) AS waitSec, SUM(talk_sec) AS talkSec,
      SUM(dispo_sec) AS dispoSec, SUM(pause_sec) AS pauseSec,
      SUM(CASE WHEN UPPER(sub_status)='LB' THEN pause_sec ELSE 0 END) AS lbSec,
      SUM(CASE WHEN UPPER(sub_status)='TB' THEN pause_sec ELSE 0 END) AS tbSec,
      SUM(CASE WHEN UPPER(sub_status) IN ('WB','WC','WASHR') THEN pause_sec ELSE 0 END) AS wbSec,
      COUNT(DISTINCT user) AS agentCount
    FROM ${APR_TABLE}
    WHERE DATE(event_time) >= ? AND DATE(event_time) <= ? AND UPPER(campaign_id) = ?
  `;
  const rows = await dialerQuery<RowDataPacket>(sql, [from, to, campaign]);
  const r = rows[0] ?? {};
  const waitSec = n(r.waitSec), talkSec = n(r.talkSec), dispoSec = n(r.dispoSec), pauseSec = n(r.pauseSec);
  const lbSec = n(r.lbSec), tbSec = n(r.tbSec), wbSec = n(r.wbSec);
  const totalLoginSec = waitSec + talkSec + dispoSec + pauseSec;
  return {
    process, campaign, from, to,
    totalLoginSec: Math.round(totalLoginSec), totalLoginTime: fmtSec(totalLoginSec),
    totalTalkSec: Math.round(talkSec), totalTalk: fmtSec(talkSec),
    totalWaitSec: Math.round(waitSec), totalWait: fmtSec(waitSec),
    totalPauseSec: Math.round(pauseSec), totalPause: fmtSec(pauseSec),
    totalLbSec: Math.round(lbSec), totalLbTime: fmtSec(lbSec),
    totalTbSec: Math.round(tbSec), totalTbTime: fmtSec(tbSec),
    totalWbSec: Math.round(wbSec), totalWbTime: fmtSec(wbSec),
    avgUtilization: totalLoginSec > 0 ? pct(waitSec + talkSec, totalLoginSec) : 0,
    agentCount: n(r.agentCount),
    generatedAt: new Date().toISOString(),
  };
}

// ── Daily APR ─────────────────────────────────────────────────────────────────

export interface AprDayRow {
  date: string;
  loginSec: number; loginTime: string;
  talkSec: number; talk: string;
  waitSec: number; wait: string;
  dispoSec: number; dispo: string;
  pauseSec: number; pause: string;
  utilization: number;
  agentCount: number;
}

export async function getAprDaily(process: EmailProcess, rawFilters: { from?: string; to?: string }): Promise<AprDayRow[]> {
  const { from, to } = parseRange(rawFilters);
  const campaign = CAMPAIGN_MAP[process];
  const sql = `
    SELECT DATE(event_time) AS date,
      SUM(wait_sec) AS waitSec, SUM(talk_sec) AS talkSec,
      SUM(dispo_sec) AS dispoSec, SUM(pause_sec) AS pauseSec,
      COUNT(DISTINCT user) AS agentCount
    FROM ${APR_TABLE}
    WHERE DATE(event_time) >= ? AND DATE(event_time) <= ? AND UPPER(campaign_id) = ?
    GROUP BY DATE(event_time) ORDER BY date
  `;
  const rows = await dialerQuery<RowDataPacket>(sql, [from, to, campaign]);
  return rows.map(r => {
    const waitSec = n(r.waitSec), talkSec = n(r.talkSec), dispoSec = n(r.dispoSec), pauseSec = n(r.pauseSec);
    const loginSec = waitSec + talkSec + dispoSec + pauseSec;
    return {
      date: String(r.date ?? ''),
      loginSec: Math.round(loginSec), loginTime: fmtSec(loginSec),
      talkSec: Math.round(talkSec), talk: fmtSec(talkSec),
      waitSec: Math.round(waitSec), wait: fmtSec(waitSec),
      dispoSec: Math.round(dispoSec), dispo: fmtSec(dispoSec),
      pauseSec: Math.round(pauseSec), pause: fmtSec(pauseSec),
      utilization: loginSec > 0 ? pct(waitSec + talkSec, loginSec) : 0,
      agentCount: n(r.agentCount),
    };
  });
}

// ── Agent-wise APR (full GAS columns: Analyst, ID, Login, Calls, Wait, Talk, Dispo, ACHT, Break, LB, TB, WB, Utilization) ─

export interface AprAgentRow {
  user: string;
  aprCalls: number;
  netLoginSec: number; netLoginTime: string;
  talkSec: number; talk: string;
  waitSec: number; wait: string;
  dispoSec: number; dispo: string;
  pauseSec: number; pause: string;
  lbSec: number; lbTime: string;
  tbSec: number; tbTime: string;
  wbSec: number; wbTime: string;
  totalBreakSec: number; totalBreak: string;
  achtSec: number; acht: string;
  utilization: number;
  loginStart: string; logout: string;
}

export async function getAprAgents(process: EmailProcess, rawFilters: { from?: string; to?: string }): Promise<AprAgentRow[]> {
  const { from, to } = parseRange(rawFilters);
  const campaign = CAMPAIGN_MAP[process];
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
    WHERE DATE(event_time) >= ? AND DATE(event_time) <= ? AND UPPER(campaign_id) = ?
    GROUP BY user ORDER BY talkSec DESC LIMIT 200
  `;
  const rows = await dialerQuery<RowDataPacket>(sql, [from, to, campaign]);
  return rows.map(r => {
    const waitSec = n(r.waitSec), talkSec = n(r.talkSec), dispoSec = n(r.dispoSec), pauseSec = n(r.pauseSec);
    const lbSec = n(r.lbSec), tbSec = n(r.tbSec), wbSec = n(r.wbSec);
    const netLoginSec = waitSec + talkSec + dispoSec + pauseSec;
    const aprCalls = n(r.aprCalls);
    const achtSec = aprCalls > 0 ? Math.round((talkSec + dispoSec) / aprCalls) : 0;
    const totalBreakSec = lbSec + tbSec + wbSec;
    return {
      user: String(r.user ?? ''),
      aprCalls,
      netLoginSec: Math.round(netLoginSec), netLoginTime: fmtSec(netLoginSec),
      talkSec: Math.round(talkSec), talk: fmtSec(talkSec),
      waitSec: Math.round(waitSec), wait: fmtSec(waitSec),
      dispoSec: Math.round(dispoSec), dispo: fmtSec(dispoSec),
      pauseSec: Math.round(pauseSec), pause: fmtSec(pauseSec),
      lbSec: Math.round(lbSec), lbTime: fmtSec(lbSec),
      tbSec: Math.round(tbSec), tbTime: fmtSec(tbSec),
      wbSec: Math.round(wbSec), wbTime: fmtSec(wbSec),
      totalBreakSec: Math.round(totalBreakSec), totalBreak: fmtSec(totalBreakSec),
      achtSec, acht: fmtSec(achtSec),
      utilization: netLoginSec > 0 ? pct(waitSec + talkSec, netLoginSec) : 0,
      loginStart: r.loginStart ? String(r.loginStart) : '',
      logout: r.logout ? String(r.logout) : '',
    };
  });
}
