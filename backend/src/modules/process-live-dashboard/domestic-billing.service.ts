/**
 * Domestic Billing Dashboard Service
 *
 * Computes monthly billing metrics for each active process/LOB combination
 * defined in domestic_billing_approved_hc.
 *
 * GAS Billing Rules:
 *  - SEAT_HOURS = 192  (1 approved seat = 192 monthly payable hours)
 *  - Daily cap  = 8 hrs per analyst-day  min(daily_hours, 8)
 *  - targetHrs  = approvedHC × 192
 *  - deliveredHrs comes from APR tables (vicidial_agent_log_10_4 / _10_25)
 *      Net login = wait_sec + talk_sec + dispo_sec + pause_sec  (sum per analyst-day, capped at 8h)
 *  - billingHrs  = min(deliveredHrs, targetHrs)
 *  - billingAmount = billingHrs × (fteRate / 192)
 *  - deliveredFTE  = deliveredHrs / 192  (display only; not capped)
 *  - variance      = deliveredFTE - approvedHC
 *  - utilization   = deliveredHrs / targetHrs * 100
 *  - needHcPerDay  = max(0, (targetHrs - deliveredHrs) / remainingWorkingDays)
 *
 * Campaign / table routing (mirrors GAS CAMPAIGN_GROUP_MAPPING):
 *  - Bla Bli Blu / Inbound   → vicidial_agent_log_10_4  (no campaign filter)
 *  - All others              → vicidial_agent_log_10_25 with campaign filter:
 *      Reginald / Abandon Cart → IN ('abandon','ABANDON','KANNADA','KERALA','TAMIL','TELUGU')
 *      Reginald / Email        → campaign_id = 'EMAIL'
 *      Molecular / MEmail      → campaign_id = 'MOEMAIL'
 *      Reginald / RTO          → IN ('RTO','NDRMO','NDRRM')
 *      Finnable / Finnable     → campaign_id = 'FINNABLE'  (fallback: no campaign filter)
 *      GS1 / GS1               → campaign_id = 'GS1'       (fallback: no campaign filter)
 */

import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { dialerQuery } from '../../db/dialerDb.js';
import { round } from './dialler-utils.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const SEAT_HOURS = 192;
const DAILY_CAP_HRS = 8;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BillingRow {
  process: string;
  lob: string;
  approvedHC: number;
  fteRate: number;
  planningRule: string;
  targetHrs: number;
  deliveredHrs: number;
  deliveredFTE: number;
  billingHrs: number;
  billingAmount: number;
  variance: number;
  utilization: number;
  needHcPerDay: number;
  planningDays: number;
  agentCount: number;
}

export interface BillingDashboard {
  month: string;
  dataTillDate: string;
  generatedAt: string;
  rows: BillingRow[];
}

// ─── Campaign routing ─────────────────────────────────────────────────────────

interface CampaignRoute {
  table: 'vicidial_agent_log_10_4' | 'vicidial_agent_log_10_25';
  /** undefined = no campaign filter (all campaigns in that table) */
  campaignFilter?: string[];
}

function getCampaignRoute(process: string, lob: string): CampaignRoute {
  const p = process.toLowerCase();
  const l = lob.toLowerCase();

  // Bla Bli Blu Inbound → _10_4, no filter
  if (p.includes('bla') || p.includes('bli') || p.includes('blu')) {
    return { table: 'vicidial_agent_log_10_4' };
  }

  // Reginald Abandon Cart
  if (p.includes('reginald') && l.includes('abandon')) {
    return {
      table: 'vicidial_agent_log_10_25',
      campaignFilter: ['abandon', 'ABANDON', 'KANNADA', 'KERALA', 'TAMIL', 'TELUGU'],
    };
  }

  // Reginald Email
  if (p.includes('reginald') && l.includes('email')) {
    return { table: 'vicidial_agent_log_10_25', campaignFilter: ['EMAIL'] };
  }

  // Molecular MEmail
  if (p.includes('molecular') || l.includes('memail') || l.includes('moemail')) {
    return { table: 'vicidial_agent_log_10_25', campaignFilter: ['MOEMAIL'] };
  }

  // Reginald RTO
  if (p.includes('reginald') && l.includes('rto')) {
    return { table: 'vicidial_agent_log_10_25', campaignFilter: ['RTO', 'NDRMO', 'NDRRM'] };
  }

  // Finnable — use campaign_id = 'FINNABLE' if it exists; otherwise no filter
  if (p.includes('finnable') || l.includes('finnable')) {
    return { table: 'vicidial_agent_log_10_25', campaignFilter: ['FINNABLE'] };
  }

  // GS1
  if (p.includes('gs1') || l.includes('gs1')) {
    return { table: 'vicidial_agent_log_10_25', campaignFilter: ['GS1'] };
  }

  // Default: _10_25, no filter
  return { table: 'vicidial_agent_log_10_25' };
}

// ─── Planning day helpers ─────────────────────────────────────────────────────

/** Count working days in [from, to] range per planning rule. */
function countWorkingDays(from: Date, to: Date, rule: string): number {
  let count = 0;
  const cur = new Date(from);
  while (cur <= to) {
    if (rule === 'SUNDAY_OFF') {
      if (cur.getDay() !== 0) count++;
    } else {
      count++;
    }
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/** Total planning days in whole month. */
function monthPlanningDays(year: number, month: number, rule: string): number {
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0); // last day of month
  return countWorkingDays(from, to, rule);
}

/** Remaining planning days from tomorrow through end of month (for needHcPerDay). */
function remainingPlanningDays(today: Date, year: number, month: number, rule: string): number {
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const endOfMonth = new Date(year, month, 0);
  if (tomorrow > endOfMonth) return 0;
  return countWorkingDays(tomorrow, endOfMonth, rule);
}

// ─── APR helpers ─────────────────────────────────────────────────────────────

interface DailyAgentRow extends RowDataPacket {
  agent: string;
  day: string;
  netLoginSec: number;
}

/**
 * Fetch per-analyst-per-day net login seconds from the APR table.
 * Net login = wait_sec + talk_sec + dispo_sec + pause_sec
 * Capped at DAILY_CAP_HRS × 3600 per analyst-day.
 */
async function fetchDeliveredHours(
  route: CampaignRoute,
  monthStart: string, // YYYY-MM-DD
  monthEnd: string,   // YYYY-MM-DD
): Promise<{ deliveredHrs: number; agentCount: number; latestDate: string }> {
  const { table, campaignFilter } = route;

  let campaignClause = '';
  const params: (string | string[])[] = [monthStart, monthEnd];

  if (campaignFilter && campaignFilter.length > 0) {
    const placeholders = campaignFilter.map(() => '?').join(', ');
    campaignClause = `AND UPPER(campaign_id) IN (${placeholders})`;
    params.push(...campaignFilter.map(c => c.toUpperCase()));
  }

  const sql = `
    SELECT
      user                                AS agent,
      DATE(event_time)                    AS day,
      SUM(wait_sec + talk_sec + dispo_sec + pause_sec) AS netLoginSec,
      MAX(DATE(event_time))               AS latestDate
    FROM ${table}
    WHERE DATE(event_time) >= ? AND DATE(event_time) <= ?
    ${campaignClause}
    GROUP BY user, DATE(event_time)
  `;

  let rows: DailyAgentRow[];
  try {
    rows = await dialerQuery<DailyAgentRow>(sql, params as never);
  } catch (err) {
    // If table/campaign doesn't exist in this environment, return zeros
    console.warn(`[domestic-billing] APR query failed for ${table}: ${err instanceof Error ? err.message : err}`);
    return { deliveredHrs: 0, agentCount: 0, latestDate: '' };
  }

  let totalSec = 0;
  let latestDate = '';
  const agents = new Set<string>();

  for (const row of rows) {
    const capped = Math.min(Number(row.netLoginSec ?? 0), DAILY_CAP_HRS * 3600);
    totalSec += capped;
    agents.add(String(row.agent ?? ''));
    const d = String(row.day ?? '');
    if (d > latestDate) latestDate = d;
  }

  return {
    deliveredHrs: round(totalSec / 3600, 4),
    agentCount: agents.size,
    latestDate,
  };
}

// ─── Config loader ────────────────────────────────────────────────────────────

interface HcConfigRow extends RowDataPacket {
  process: string;
  lob: string;
  approved_headcount: number;
  fte_rate: string;
  planning_rule: string;
}

async function loadHcConfig(month: string): Promise<HcConfigRow[]> {
  const [rows] = await db.execute<HcConfigRow[]>(
    `SELECT process, lob, approved_headcount, fte_rate, planning_rule
     FROM domestic_billing_approved_hc
     WHERE month = ? AND active = 1
     ORDER BY process, lob`,
    [month],
  );
  return rows;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function getBillingDashboard(
  filters: { month?: string },
): Promise<BillingDashboard> {
  // Resolve month
  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const monthStr = filters.month && /^\d{4}-\d{2}$/.test(filters.month)
    ? filters.month
    : defaultMonth;

  const [yearStr, monStr] = monthStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monStr, 10);

  // Month date bounds
  const monthStart = `${monthStr}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const monthEnd = `${monthStr}-${String(lastDay).padStart(2, '0')}`;

  // Load approved HC config
  const configs = await loadHcConfig(monthStr);

  // Build rows
  const billingRows: BillingRow[] = [];
  let globalLatestDate = '';

  for (const cfg of configs) {
    const approvedHC = Number(cfg.approved_headcount ?? 0);
    const fteRate = parseFloat(String(cfg.fte_rate ?? 35000));
    const planningRule = cfg.planning_rule || 'ALL_DAYS';

    const targetHrs = approvedHC * SEAT_HOURS;

    // Planning days for whole month
    const planDays = monthPlanningDays(year, month, planningRule);

    // Remaining planning days (for needHcPerDay projection)
    const remDays = remainingPlanningDays(today, year, month, planningRule);

    // Fetch APR delivered hours
    const route = getCampaignRoute(cfg.process, cfg.lob);
    const { deliveredHrs, agentCount, latestDate } = await fetchDeliveredHours(
      route, monthStart, monthEnd,
    );

    if (latestDate > globalLatestDate) globalLatestDate = latestDate;

    // Billing computations
    const billingHrs = Math.min(deliveredHrs, targetHrs);
    const billingAmount = targetHrs > 0 ? round(billingHrs * (fteRate / SEAT_HOURS), 2) : 0;
    const deliveredFTE = round(deliveredHrs / SEAT_HOURS, 4);
    const variance = round(deliveredFTE - approvedHC, 4);
    const utilization = targetHrs > 0 ? round((deliveredHrs / targetHrs) * 100, 2) : 0;

    // Need HC/day: only meaningful if deliveredHrs < targetHrs and days remain
    let needHcPerDay = 0;
    if (deliveredHrs < targetHrs && remDays > 0) {
      const remainingHrs = targetHrs - deliveredHrs;
      // remaining hours / remaining days / 8 hrs per seat-day
      needHcPerDay = round(remainingHrs / (remDays * DAILY_CAP_HRS), 2);
    }

    billingRows.push({
      process: cfg.process,
      lob: cfg.lob,
      approvedHC,
      fteRate,
      planningRule,
      targetHrs: round(targetHrs, 2),
      deliveredHrs: round(deliveredHrs, 2),
      deliveredFTE: round(deliveredFTE, 2),
      billingHrs: round(billingHrs, 2),
      billingAmount: round(billingAmount, 2),
      variance: round(variance, 2),
      utilization: round(utilization, 2),
      needHcPerDay,
      planningDays: planDays,
      agentCount,
    });
  }

  return {
    month: monthStr,
    dataTillDate: globalLatestDate || monthEnd,
    generatedAt: new Date().toISOString(),
    rows: billingRows,
  };
}
