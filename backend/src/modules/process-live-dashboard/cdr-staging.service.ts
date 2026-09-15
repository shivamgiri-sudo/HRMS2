/**
 * CDR Staging Dashboard service — reads from mas_hrms.inbound_cdr_daily_actual.
 *
 * The inbound-cdr-sync job runs daily and writes pre-aggregated daily KPIs for
 * GNC, Bella-Vita Organic, Clovia, Neemans, Viega, Exicom, and DU Digital into
 * inbound_cdr_daily_actual with a client_code discriminator. This service
 * provides the read side for those process Live Dashboard tabs.
 *
 * Columns available (per inbound_cdr_daily_actual schema 1712):
 *   call_date, login_count, call_offered, call_answered,
 *   answer_rate_pct, service_level_pct, acht_seconds,
 *   repeat_pct, fcr_pct
 *
 * Note: service_level_pct, repeat_pct, fcr_pct are stored pre-computed with
 * client-specific denominators. Multi-day summaries AVG these values.
 */

import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { n, pct, round, fmtSec, parseRange } from './dialler-utils.js';

export type CdrClientCode = 'GNC' | 'BELLAVITA' | 'CLOVIA' | 'NEEMANS' | 'VIEGA' | 'EXICOM' | 'DU_BANGLADESH';

export interface CdrStagingSummary {
  clientCode: CdrClientCode;
  from: string;
  to: string;
  totalOffered: number;
  totalAnswered: number;
  alPct: number;
  slPct: number;
  achtSec: number;
  aht: string;
  repeatPct: number;
  fcrPct: number;
  avgLoginCount: number;
  dayCount: number;
  generatedAt: string;
}

export interface CdrStagingDayRow {
  date: string;
  offered: number;
  answered: number;
  alPct: number;
  slPct: number;
  achtSec: number;
  aht: string;
  repeatPct: number;
  fcrPct: number;
  loginCount: number;
}

export interface CdrStagingMonthRow {
  month: string;
  offered: number;
  answered: number;
  alPct: number;
  slPct: number;
  achtSec: number;
  aht: string;
}

export async function getCdrStagingSummary(
  clientCode: CdrClientCode,
  rawFilters: { from?: string; to?: string },
): Promise<CdrStagingSummary> {
  const { from, to } = parseRange(rawFilters);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT
       SUM(call_offered)                          AS totalOffered,
       SUM(call_answered)                         AS totalAnswered,
       AVG(COALESCE(service_level_pct, 0))       AS slPct,
       AVG(COALESCE(acht_seconds, 0))            AS achtSec,
       AVG(COALESCE(repeat_pct, 0))              AS repeatPct,
       AVG(COALESCE(fcr_pct, 0))                 AS fcrPct,
       AVG(COALESCE(login_count, 0))             AS avgLoginCount,
       COUNT(*)                                   AS dayCount
     FROM inbound_cdr_daily_actual
     WHERE client_code = ? AND call_date BETWEEN ? AND ?`,
    [clientCode, from, to],
  );
  const r = rows[0] ?? {};
  const totalOffered  = n(r.totalOffered);
  const totalAnswered = n(r.totalAnswered);
  const achtSec       = round(n(r.achtSec));
  return {
    clientCode,
    from,
    to,
    totalOffered,
    totalAnswered,
    alPct:         round(pct(totalAnswered, totalOffered)),
    slPct:         round(n(r.slPct)),
    achtSec,
    aht:           fmtSec(achtSec),
    repeatPct:     round(n(r.repeatPct)),
    fcrPct:        round(n(r.fcrPct)),
    avgLoginCount: round(n(r.avgLoginCount)),
    dayCount:      n(r.dayCount),
    generatedAt:   new Date().toISOString(),
  };
}

export async function getCdrStagingDaily(
  clientCode: CdrClientCode,
  rawFilters: { from?: string; to?: string },
): Promise<CdrStagingDayRow[]> {
  const { from, to } = parseRange(rawFilters);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT
       DATE_FORMAT(call_date, '%Y-%m-%d')          AS date,
       call_offered                                AS offered,
       call_answered                               AS answered,
       COALESCE(answer_rate_pct, 0)                AS alPct,
       COALESCE(service_level_pct, 0)              AS slPct,
       COALESCE(acht_seconds, 0)                   AS achtSec,
       COALESCE(repeat_pct, 0)                     AS repeatPct,
       COALESCE(fcr_pct, 0)                        AS fcrPct,
       COALESCE(login_count, 0)                    AS loginCount
     FROM inbound_cdr_daily_actual
     WHERE client_code = ? AND call_date BETWEEN ? AND ?
     ORDER BY call_date`,
    [clientCode, from, to],
  );
  return rows.map(r => {
    const achtSec = round(n(r.achtSec));
    return {
      date:       String(r.date ?? ''),
      offered:    n(r.offered),
      answered:   n(r.answered),
      alPct:      round(n(r.alPct)),
      slPct:      round(n(r.slPct)),
      achtSec,
      aht:        fmtSec(achtSec),
      repeatPct:  round(n(r.repeatPct)),
      fcrPct:     round(n(r.fcrPct)),
      loginCount: n(r.loginCount),
    };
  });
}

export async function getCdrStagingMonthly(
  clientCode: CdrClientCode,
  rawFilters: { from?: string; to?: string },
): Promise<CdrStagingMonthRow[]> {
  const { from, to } = parseRange(rawFilters);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT
       DATE_FORMAT(call_date, '%b-%y')             AS month,
       SUM(call_offered)                           AS offered,
       SUM(call_answered)                          AS answered,
       AVG(COALESCE(service_level_pct, 0))         AS slPct,
       AVG(COALESCE(acht_seconds, 0))              AS achtSec
     FROM inbound_cdr_daily_actual
     WHERE client_code = ? AND call_date BETWEEN ? AND ?
     GROUP BY DATE_FORMAT(call_date, '%Y-%m')
     ORDER BY MIN(call_date)`,
    [clientCode, from, to],
  );
  return rows.map(r => {
    const achtSec = round(n(r.achtSec));
    const offered  = n(r.offered);
    const answered = n(r.answered);
    return {
      month:   String(r.month ?? ''),
      offered,
      answered,
      alPct:   round(pct(answered, offered)),
      slPct:   round(n(r.slPct)),
      achtSec,
      aht:     fmtSec(achtSec),
    };
  });
}
