import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { dedupedSaleSql } from "./bellavita-sale-dashboard.service.js";

/**
 * Per-agent performance report for Bellavita's "Agent Performance" slide,
 * joining db_masmis.bb_apr (attendance/login/talk-time) with db_masmis.
 * bb_sale (sale outcomes) by agent code (bb_apr.noiid = bb_sale.emp_id --
 * confirmed live 2026-09-17: 82 of bb_apr's ~94 September agents also
 * appear in bb_sale for the same window; the rest are agents with zero
 * sales in range, kept in the report via LEFT JOIN rather than dropped).
 *
 * Sale-side aggregates reuse dedupedSaleSql() -- the same Order-ID-unique
 * + calling_status='Sale Made' filter as the Sale Performance dashboard,
 * so a given agent's numbers here always agree with that dashboard's.
 *
 * Columns are a faithful-but-partial match to the reference "Agent
 * Metric" sheet the user supplied: Zecpe/Website/Draft Order counts come
 * straight from bb_sale.sale_source_name (confirmed live: those 3 exact
 * string values, 16262/7300/137 rows respectively). Columns with no real
 * source in this app were deliberately left out rather than fabricated --
 * DOJ, Bucket, per-agent Target/Achiv%, TQ/MQ/BQ, Compliance%, Man Day,
 * Start Date. None of those exist in bb_apr/bb_sale or any employee
 * master this service has access to.
 */

export interface BellavitaAgentPerformanceRow {
  empId: string;
  empName: string;
  teamLeader: string;
  lob: string;
  tenureDays: number | null;
  attendanceDays: number;
  loginHours: number;
  breakHours: number;
  talkHours: number;
  achtSeconds: number;
  saleCount: number;
  zecpeCount: number;
  websiteCount: number;
  draftOrderCount: number;
  codCount: number;
  paidCount: number;
  codPct: number;
  paidPct: number;
  rtoCount: number;
  rtoPct: number;
  revenue: number;
  avgSale: number;
}

interface AprAggRow extends RowDataPacket {
  noiid: string;
  emp_name: string | null;
  team_leader: string | null;
  lob: string | null;
  tenure: number | null;
  attendance_days: string | null;
  login_seconds: number | null;
  break_seconds: number | null;
  talk_seconds: number | null;
  acht_avg: string | null;
}
interface SaleAggRow extends RowDataPacket {
  emp_id: string;
  sale_count: number;
  revenue: string | null;
  paid_count: number;
  cod_count: number;
  rto_count: number;
  zecpe_count: number;
  website_count: number;
  draft_order_count: number;
}

const num = (v: string | number | null | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0);

export async function getBellavitaAgentPerformance(from: string, to: string): Promise<BellavitaAgentPerformanceRow[]> {
  const range = [from, to];

  const [aprRows] = await db.execute<AprAggRow[]>(
    `SELECT
       noiid,
       MAX(emp_name) AS emp_name,
       MAX(team_leader) AS team_leader,
       MAX(lob) AS lob,
       MAX(tenure) AS tenure,
       SUM(CAST(attendance_1 AS DECIMAL(6,2))) AS attendance_days,
       SUM(TIME_TO_SEC(actual_login_hrs)) AS login_seconds,
       SUM(TIME_TO_SEC(total_break)) AS break_seconds,
       SUM(TIME_TO_SEC(talk_time)) AS talk_seconds,
       AVG(acht) AS acht_avg
     FROM db_masmis.bb_apr
     WHERE report_date >= ? AND report_date < DATE_ADD(?, INTERVAL 1 DAY)
       AND noiid IS NOT NULL AND noiid != ''
     GROUP BY noiid`,
    range,
  );

  const [saleRows] = await db.execute<SaleAggRow[]>(
    `SELECT
       ds.emp_id AS emp_id,
       COUNT(*) AS sale_count,
       SUM(CAST(ds.amount AS DECIMAL(14,2))) AS revenue,
       SUM(CASE WHEN ds.payment_status = 'paid' THEN 1 ELSE 0 END) AS paid_count,
       SUM(CASE WHEN ds.payment_status = 'cod' THEN 1 ELSE 0 END) AS cod_count,
       SUM(CASE WHEN ds.final_status = 'RTO' THEN 1 ELSE 0 END) AS rto_count,
       SUM(CASE WHEN ds.sale_source_name = 'Zecpe' THEN 1 ELSE 0 END) AS zecpe_count,
       SUM(CASE WHEN ds.sale_source_name = 'Website' THEN 1 ELSE 0 END) AS website_count,
       SUM(CASE WHEN ds.sale_source_name = 'Draft Order' THEN 1 ELSE 0 END) AS draft_order_count
     FROM ${dedupedSaleSql()}
     WHERE ds.emp_id IS NOT NULL AND ds.emp_id != ''
     GROUP BY ds.emp_id`,
    range,
  );

  const saleByAgent = new Map<string, SaleAggRow>();
  for (const r of saleRows) saleByAgent.set(r.emp_id, r);

  const rows: BellavitaAgentPerformanceRow[] = aprRows.map((a) => {
    const s = saleByAgent.get(a.noiid);
    const saleCount = num(s?.sale_count);
    const revenue = num(s?.revenue);
    const codCount = num(s?.cod_count);
    const paidCount = num(s?.paid_count);
    const rtoCount = num(s?.rto_count);
    return {
      empId: a.noiid,
      empName: a.emp_name || a.noiid,
      teamLeader: a.team_leader || "-",
      lob: a.lob || "-",
      tenureDays: a.tenure ?? null,
      attendanceDays: num(a.attendance_days),
      loginHours: Math.round((num(a.login_seconds) / 3600) * 100) / 100,
      breakHours: Math.round((num(a.break_seconds) / 3600) * 100) / 100,
      talkHours: Math.round((num(a.talk_seconds) / 3600) * 100) / 100,
      achtSeconds: Math.round(num(a.acht_avg)),
      saleCount,
      zecpeCount: num(s?.zecpe_count),
      websiteCount: num(s?.website_count),
      draftOrderCount: num(s?.draft_order_count),
      codCount,
      paidCount,
      codPct: pct(codCount, codCount + paidCount),
      paidPct: pct(paidCount, codCount + paidCount),
      rtoCount,
      rtoPct: pct(rtoCount, saleCount),
      revenue,
      avgSale: saleCount > 0 ? Math.round((revenue / saleCount) * 100) / 100 : 0,
    };
  });

  // Agents who sold but have no bb_apr attendance row in range (e.g. their
  // APR file wasn't uploaded that day) -- included too, rather than
  // silently dropping real sales from the report.
  const aprAgentIds = new Set(aprRows.map((a) => a.noiid));
  for (const s of saleRows) {
    if (aprAgentIds.has(s.emp_id)) continue;
    const saleCount = num(s.sale_count);
    const revenue = num(s.revenue);
    const codCount = num(s.cod_count);
    const paidCount = num(s.paid_count);
    const rtoCount = num(s.rto_count);
    rows.push({
      empId: s.emp_id,
      empName: s.emp_id,
      teamLeader: "-",
      lob: "-",
      tenureDays: null,
      attendanceDays: 0,
      loginHours: 0,
      breakHours: 0,
      talkHours: 0,
      achtSeconds: 0,
      saleCount,
      zecpeCount: num(s.zecpe_count),
      websiteCount: num(s.website_count),
      draftOrderCount: num(s.draft_order_count),
      codCount,
      paidCount,
      codPct: pct(codCount, codCount + paidCount),
      paidPct: pct(paidCount, codCount + paidCount),
      rtoCount,
      rtoPct: pct(rtoCount, saleCount),
      revenue,
      avgSale: saleCount > 0 ? Math.round((revenue / saleCount) * 100) / 100 : 0,
    });
  }

  rows.sort((a, b) => b.revenue - a.revenue);
  return rows;
}
