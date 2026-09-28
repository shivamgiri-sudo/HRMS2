import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';

interface DalmiaFilters { from?: string; to?: string; }

function dw(col: string, f: DalmiaFilters) {
  if (f.from && f.to)  return ` AND DATE(${col}) BETWEEN ? AND ?`;
  if (f.from)          return ` AND DATE(${col}) >= ?`;
  if (f.to)            return ` AND DATE(${col}) <= ?`;
  return '';
}
function dp(f: DalmiaFilters): string[] {
  if (f.from && f.to) return [f.from, f.to];
  if (f.from)         return [f.from];
  if (f.to)           return [f.to];
  return [];
}
const n = (v: unknown) => Number(v ?? 0);

export async function getDalmiaOverview(f: DalmiaFilters) {
  const [dd] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN UPPER(nftr_ftr)='FTR' THEN 1 ELSE 0 END) AS ftr,
            SUM(CASE WHEN UPPER(status)='CLOSED' THEN 1 ELSE 0 END) AS closed,
            SUM(CASE WHEN UPPER(converted) IN ('YES','Y') THEN 1 ELSE 0 END) AS converted,
            COUNT(DISTINCT DATE(report_date)) AS days
     FROM dalmia_dd_raw WHERE 1=1${dw('report_date', f)}`, dp(f));
  const [ob] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN UPPER(status) IN ('CONTACT','CONTACTED','DONE','CLOSED') THEN 1 ELSE 0 END) AS contacted
     FROM dalmia_outbound_raw WHERE 1=1${dw('report_date', f)}`, dp(f));
  const [ah] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM dalmia_after_hour_raw WHERE 1=1${dw('report_date', f)}`, dp(f));
  const d = dd[0] ?? {}, o = ob[0] ?? {}, a = ah[0] ?? {};
  const total = n(d.total);
  return {
    dd: { total, ftr: n(d.ftr), closed: n(d.closed), converted: n(d.converted), days: n(d.days),
          ftrPct: total > 0 ? Math.round(n(d.ftr)/total*1000)/10 : 0,
          conversionPct: total > 0 ? Math.round(n(d.converted)/total*1000)/10 : 0 },
    outbound: { total: n(o.total), contacted: n(o.contacted),
                contactPct: n(o.total) > 0 ? Math.round(n(o.contacted)/n(o.total)*1000)/10 : 0 },
    afterHour: { total: n(a.total) },
  };
}

export async function getDalmiaScenarios(f: DalmiaFilters) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COALESCE(scenario,'Unknown') AS name, COUNT(*) AS value
     FROM dalmia_dd_raw WHERE 1=1${dw('report_date', f)}
     GROUP BY scenario ORDER BY value DESC LIMIT 10`, dp(f));
  return rows.map(r => ({ name: String(r.name), value: n(r.value) }));
}

export async function getDalmiaLeadSources(f: DalmiaFilters) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COALESCE(source_of_lead,'Unknown') AS name, COUNT(*) AS value
     FROM dalmia_dd_raw WHERE 1=1${dw('report_date', f)}
     GROUP BY source_of_lead ORDER BY value DESC LIMIT 10`, dp(f));
  return rows.map(r => ({ name: String(r.name), value: n(r.value) }));
}

export async function getDalmiaRegions(f: DalmiaFilters) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COALESCE(region,'Unknown') AS region,
            COUNT(*) AS total,
            SUM(CASE WHEN UPPER(converted) IN ('YES','Y') THEN 1 ELSE 0 END) AS converted
     FROM dalmia_dd_raw WHERE 1=1${dw('report_date', f)}
     GROUP BY region ORDER BY total DESC`, dp(f));
  return rows.map(r => ({ region: String(r.region), total: n(r.total), converted: n(r.converted) }));
}

export async function getDalmiaAfterHourDaily(f: DalmiaFilters) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(report_date,'%Y-%m-%d') AS date, COUNT(*) AS calls
     FROM dalmia_after_hour_raw WHERE 1=1${dw('report_date', f)}
     GROUP BY report_date ORDER BY report_date`, dp(f));
  return rows.map(r => ({ date: String(r.date), calls: n(r.calls) }));
}

export async function getDalmiaOutboundStatus(f: DalmiaFilters) {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COALESCE(status,'Unknown') AS name, COUNT(*) AS value
     FROM dalmia_outbound_raw WHERE 1=1${dw('report_date', f)}
     GROUP BY status ORDER BY value DESC`, dp(f));
  return rows.map(r => ({ name: String(r.name), value: n(r.value) }));
}
