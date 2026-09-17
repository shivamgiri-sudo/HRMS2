import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

/**
 * Neemans' "Abandoned Cart" dashboard for Process Performance V2, computed
 * live from db_masmis.neemans_cart -- the exact table NEEMANS_CART_MASMIS
 * (backend/src/modules/bulk-upload/neemans-cart-masmis-bulk.service.ts)
 * writes into. Same "real data only" discipline as the sibling GNC/
 * Bellavita sale dashboards in this folder.
 *
 * Confirmed live 2026-09-16 via SHOW COLUMNS + SELECT COUNT(*): the table
 * currently holds 0 rows (a registered-but-never-used upload type, per
 * backend/sql/1746_bellavita_neemans_masmis_uploaders.sql's own comment).
 * This dashboard will read as all-zero/empty until a real Cart export is
 * uploaded through that upload type -- it is not wired to any other data
 * source, and no numbers here are fabricated to fill that gap.
 *
 * disposition/status/sub_disposition are grouped generically (whatever
 * distinct values the real upload actually contains) rather than mapped to
 * an assumed "Converted"/"Recovered" meaning: with 0 live rows there is no
 * confirmed value domain for those columns to build a fixed category list
 * from, and inventing one would violate this project's no-fabrication rule.
 */

export interface NeemansCartDashboardData {
  headline: {
    totalCarts: number;
    totalCartValue: number;
    avgCartValue: number;
    uniqueCustomers: number;
    activeAgents: number;
  };
  from: string;
  to: string;
  dateWiseTrend: Array<{ date: string; cartCount: number; cartValue: number }>;
  dispositionBreakdown: Array<{ disposition: string; count: number; value: number; pct: number }>;
  statusBreakdown: Array<{ status: string; count: number; pct: number }>;
  agentPerformance: Array<{
    agent: string;
    cartCount: number;
    cartValue: number;
    topDisposition: string;
  }>;
}

interface HeadlineRow extends RowDataPacket {
  total_carts: number;
  total_value: string | null;
  unique_customers: number;
  active_agents: number;
}
interface TrendRow extends RowDataPacket {
  d: string;
  cart_count: number;
  cart_value: string | null;
}
interface DispositionRow extends RowDataPacket {
  disposition: string | null;
  n: number;
  value: string | null;
}
interface StatusRow extends RowDataPacket {
  status: string | null;
  n: number;
}
interface AgentRow extends RowDataPacket {
  agent: string | null;
  cart_count: number;
  cart_value: string | null;
  top_disposition: string | null;
}

const num = (v: string | number | null | undefined): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Local YYYY-MM-DD, deliberately NOT via toISOString(): that converts
 * through UTC, and this host's local clock is IST (UTC+5:30) -- midnight
 * on the 1st of the month, converted to UTC, rolls the range back a day.
 * Same bug class already documented for the GNC/Bellavita sibling services. */
function localDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = localDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
  const to = localDateStr(now);
  return { from, to };
}

export async function getNeemansCartDashboard(fromInput: string, toInput: string): Promise<NeemansCartDashboardData> {
  const fallback = currentMonthRange();
  const from = DATE_RE.test(fromInput) ? fromInput : fallback.from;
  const to = DATE_RE.test(toInput) ? toInput : fallback.to;
  // Upper bound is the day AFTER `to`, so the end date is fully inclusive
  // rather than cutting off at midnight of that day.
  const range = [from, to];

  const [[headlineRow]] = await db.execute<HeadlineRow[]>(
    `SELECT
       COUNT(*) AS total_carts,
       SUM(amount) AS total_value,
       COUNT(DISTINCT NULLIF(phone_number, '')) AS unique_customers,
       COUNT(DISTINCT NULLIF(agent, '')) AS active_agents
     FROM db_masmis.neemans_cart
     WHERE call_date >= ? AND call_date < DATE_ADD(?, INTERVAL 1 DAY)`,
    range,
  );

  const [trendRows] = await db.execute<TrendRow[]>(
    `SELECT call_date AS d, COUNT(*) AS cart_count, SUM(amount) AS cart_value
     FROM db_masmis.neemans_cart
     WHERE call_date >= ? AND call_date < DATE_ADD(?, INTERVAL 1 DAY)
     GROUP BY call_date
     ORDER BY d ASC`,
    range,
  );

  const [dispositionRows] = await db.execute<DispositionRow[]>(
    `SELECT disposition, COUNT(*) AS n, SUM(amount) AS value
     FROM db_masmis.neemans_cart
     WHERE call_date >= ? AND call_date < DATE_ADD(?, INTERVAL 1 DAY) AND disposition IS NOT NULL AND disposition != ''
     GROUP BY disposition
     ORDER BY n DESC`,
    range,
  );

  const [statusRows] = await db.execute<StatusRow[]>(
    `SELECT status, COUNT(*) AS n
     FROM db_masmis.neemans_cart
     WHERE call_date >= ? AND call_date < DATE_ADD(?, INTERVAL 1 DAY) AND status IS NOT NULL AND status != ''
     GROUP BY status
     ORDER BY n DESC`,
    range,
  );

  const [agentRows] = await db.execute<AgentRow[]>(
    `SELECT agent,
       COUNT(*) AS cart_count,
       SUM(amount) AS cart_value,
       SUBSTRING_INDEX(GROUP_CONCAT(disposition ORDER BY disp_count DESC), ',', 1) AS top_disposition
     FROM (
       SELECT agent, disposition, COUNT(*) AS disp_count
       FROM db_masmis.neemans_cart
       WHERE call_date >= ? AND call_date < DATE_ADD(?, INTERVAL 1 DAY) AND agent IS NOT NULL AND agent != ''
       GROUP BY agent, disposition
     ) x
     GROUP BY agent
     ORDER BY cart_count DESC`,
    range,
  );

  const totalCarts = num(headlineRow?.total_carts);
  const totalCartValue = num(headlineRow?.total_value);

  return {
    headline: {
      totalCarts,
      totalCartValue,
      avgCartValue: totalCarts > 0 ? Math.round((totalCartValue / totalCarts) * 100) / 100 : 0,
      uniqueCustomers: num(headlineRow?.unique_customers),
      activeAgents: num(headlineRow?.active_agents),
    },
    from,
    to,
    dateWiseTrend: trendRows.map((r) => ({
      date: String(r.d),
      cartCount: num(r.cart_count),
      cartValue: num(r.cart_value),
    })),
    dispositionBreakdown: dispositionRows.map((r) => ({
      disposition: r.disposition || "Unknown",
      count: num(r.n),
      value: num(r.value),
      pct: pct(num(r.n), totalCarts),
    })),
    statusBreakdown: statusRows.map((r) => ({
      status: r.status || "Unknown",
      count: num(r.n),
      pct: pct(num(r.n), totalCarts),
    })),
    agentPerformance: agentRows.map((r) => ({
      agent: r.agent || "Unknown",
      cartCount: num(r.cart_count),
      cartValue: num(r.cart_value),
      topDisposition: r.top_disposition || "Unknown",
    })),
  };
}
