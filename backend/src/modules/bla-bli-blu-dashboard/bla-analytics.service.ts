import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { resolveRange } from "./bla-bli-blu-dashboard.service.js";

/**
 * Analytics for the BLA / BLI / BLU Sales Dashboard: the cuts the workbook's KPI table cannot show on its own
 * (who sold, when, how it was paid, what happens to the order, what mix of products) plus the manpower view its
 * "Sales MBR" note says needs another source -- HRMS already holds headcount and attendance for the process.
 * Read-only. "Sale" everywhere means the workbook's definition: a Business = 'Real Time Sales' row.
 */

const RTS = "business_type = 'Real Time Sales'";
const n = (v: unknown) => Number(v ?? 0);
const pct = (a: number, b: number) => (b > 0 ? a / b : 0);

export interface Slice { label: string; count: number; revenue: number }
export interface AgentRow {
  empCode: string; empName: string; sales: number; revenue: number; aov: number; prepaidPct: number; rtoPct: number; activeDays: number;
}
export interface BlaAnalytics {
  from: string; to: string;
  totals: { sales: number; revenue: number; agentsSelling: number; sameDayPtp: number; h24: number };
  campaigns: Slice[]; payment: Slice[]; business: Slice[]; orderStatus: Slice[]; channel: Slice[]; callOutcome: Slice[];
  byHour: Array<{ hour: number; sales: number }>;
  byWeekday: Array<{ weekday: number; label: string; sales: number; revenue: number; days: number; avgSales: number }>;
  agents: AgentRow[];
  manpower: {
    available: boolean; activeHeadcount: number; avgPresent: number | null; avgSelling: number | null;
    sellingPerPresent: number | null; salesPerSeller: number | null; salesPerPresent: number | null;
    daily: Array<{ date: string; present: number; selling: number; sales: number }>;
  };
  orderStatusPending: { total: number; withoutStatus: number; rtoOfUpdatedPct: number };
  insights: Array<{ tone: "good" | "warn" | "bad" | "info"; text: string }>;
}

async function slices(sql: string, params: unknown[]): Promise<Slice[]> {
  const [rows] = await db.execute<RowDataPacket[]>(sql, params as never[]);
  return rows.map((r) => ({ label: String(r.label ?? "—"), count: n(r.c), revenue: n(r.rev) }));
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export async function getBlaAnalytics(fromRaw?: string, toRaw?: string): Promise<BlaAnalytics> {
  const { from, to } = resolveRange(fromRaw, toRaw);
  const T = "bla_bli_blu_overall_sales_raw";
  const W = "report_date BETWEEN ? AND ?";
  const P = [from, to];

  const [campaigns, payment, business, orderStatus, channel, callOutcome] = await Promise.all([
    slices(`SELECT campaign label, SUM(${RTS}) c, SUM(CASE WHEN ${RTS} THEN COALESCE(amount,0) ELSE 0 END) rev FROM ${T} WHERE ${W} GROUP BY campaign HAVING c > 0 ORDER BY c DESC`, P),
    slices(`SELECT COALESCE(NULLIF(payment_status,''),'Unknown') label, COUNT(*) c, SUM(COALESCE(amount,0)) rev FROM ${T} WHERE ${W} AND ${RTS} GROUP BY label ORDER BY c DESC`, P),
    slices(`SELECT business_type label, COUNT(*) c, SUM(COALESCE(amount,0)) rev FROM ${T} WHERE ${W} AND business_type IS NOT NULL GROUP BY business_type ORDER BY c DESC`, P),
    slices(`SELECT COALESCE(NULLIF(current_status,''),'Not updated yet') label, COUNT(*) c, SUM(COALESCE(amount,0)) rev FROM ${T} WHERE ${W} AND ${RTS} GROUP BY label ORDER BY c DESC LIMIT 12`, P),
    slices(`SELECT COALESCE(NULLIF(source_channel,''),'Unknown') label, COUNT(*) c, SUM(COALESCE(amount,0)) rev FROM ${T} WHERE ${W} AND ${RTS} GROUP BY label ORDER BY c DESC`, P),
    slices(`SELECT COALESCE(NULLIF(calling_status,''),'Unknown') label, COUNT(*) c, 0 rev FROM ${T} WHERE ${W} GROUP BY label ORDER BY c DESC LIMIT 10`, P),
  ]);

  const [hourRows] = await db.execute<RowDataPacket[]>(
    `SELECT HOUR(call_date_time) h, COUNT(*) c FROM ${T} WHERE ${W} AND ${RTS} AND call_date_time IS NOT NULL GROUP BY h ORDER BY h`, P);
  const byHour = (hourRows as RowDataPacket[]).map((r) => ({ hour: n(r.h), sales: n(r.c) }));

  const [dayRows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(report_date,'%Y-%m-%d') d, WEEKDAY(report_date) wd, COUNT(*) c, SUM(COALESCE(amount,0)) rev, COUNT(DISTINCT emp_code) sellers
       FROM ${T} WHERE ${W} AND ${RTS} GROUP BY d, wd ORDER BY d`, P);
  const wdAgg = WEEKDAYS.map((label, weekday) => ({ weekday, label, sales: 0, revenue: 0, days: 0, avgSales: 0 }));
  for (const r of dayRows) { const w = wdAgg[n(r.wd)]; w.sales += n(r.c); w.revenue += n(r.rev); w.days += 1; }
  wdAgg.forEach((w) => { w.avgSales = w.days ? Math.round(w.sales / w.days) : 0; });

  const [agentRows] = await db.execute<RowDataPacket[]>(
    `SELECT emp_code, MAX(emp_name) emp_name, COUNT(*) sales, SUM(COALESCE(amount,0)) rev,
            SUM(payment_status='Paid') paid, SUM(current_status='RTO') rto, COUNT(DISTINCT report_date) days
       FROM ${T} WHERE ${W} AND ${RTS} AND emp_code IS NOT NULL AND emp_code <> ''
      GROUP BY emp_code ORDER BY sales DESC LIMIT 200`, P);
  const agents: AgentRow[] = (agentRows as RowDataPacket[]).map((r) => ({
    empCode: String(r.emp_code), empName: String(r.emp_name ?? ""), sales: n(r.sales), revenue: n(r.rev),
    aov: pct(n(r.rev), n(r.sales)), prepaidPct: pct(n(r.paid), n(r.sales)), rtoPct: pct(n(r.rto), n(r.sales)), activeDays: n(r.days),
  }));

  const [tot] = await db.execute<RowDataPacket[]>(
    `SELECT SUM(${RTS}) sales, SUM(CASE WHEN ${RTS} THEN COALESCE(amount,0) ELSE 0 END) rev,
            COUNT(DISTINCT CASE WHEN ${RTS} THEN emp_code END) agents,
            SUM(business_type='Same Day PTP') ptp, SUM(business_type='24 Hrs Sale') h24,
            SUM(${RTS} AND (current_status IS NULL OR current_status = '')) pending,
            SUM(${RTS} AND current_status = 'RTO') rto
       FROM ${T} WHERE ${W}`, P);
  const t = tot[0] ?? {};
  const totals = { sales: n(t.sales), revenue: n(t.rev), agentsSelling: n(t.agents), sameDayPtp: n(t.ptp), h24: n(t.h24) };
  const updated = totals.sales - n(t.pending);
  const orderStatusPending = { total: totals.sales, withoutStatus: n(t.pending), rtoOfUpdatedPct: pct(n(t.rto), updated) };

  // Manpower from HRMS: process headcount + attendance, joined to who actually sold.
  const [proc] = await db.execute<RowDataPacket[]>("SELECT id FROM process_master WHERE process_name = 'Bla Bli Blu' AND active_status = 1 LIMIT 1");
  const processId = proc[0]?.id ? String(proc[0].id) : null;
  let manpower: BlaAnalytics["manpower"] = { available: false, activeHeadcount: 0, avgPresent: null, avgSelling: null, sellingPerPresent: null, salesPerSeller: null, salesPerPresent: null, daily: [] };
  if (processId) {
    const [[hc]] = await Promise.all([
      db.execute<RowDataPacket[]>("SELECT COUNT(*) c FROM employees WHERE process_id = ? AND active_status = 1", [processId]).then(([r]) => r),
    ]);
    const [presentRows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(record_date,'%Y-%m-%d') d,
              COUNT(DISTINCT CASE WHEN attendance_status IN ('present','half_day') THEN employee_id END) present_n
         FROM attendance_daily_record WHERE process_id = ? AND record_date BETWEEN ? AND ? GROUP BY d`, [processId, from, to]);
    const presentBy = new Map<string, number>((presentRows as RowDataPacket[]).map((r) => [String(r.d), n(r.present_n)]));
    const daily = (dayRows as RowDataPacket[]).map((r) => ({ date: String(r.d), present: presentBy.get(String(r.d)) ?? 0, selling: n(r.sellers), sales: n(r.c) }));
    const withPresent = daily.filter((d) => d.present > 0);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const avgPresent = avg(withPresent.map((d) => d.present));
    const avgSelling = avg(daily.map((d) => d.selling));
    const sumSales = daily.reduce((a, d) => a + d.sales, 0);
    manpower = {
      available: true, activeHeadcount: n(hc?.c), avgPresent, avgSelling,
      sellingPerPresent: withPresent.length ? pct(withPresent.reduce((a, d) => a + d.selling, 0), withPresent.reduce((a, d) => a + d.present, 0)) : null,
      salesPerSeller: avgSelling ? sumSales / daily.length / avgSelling : null,
      salesPerPresent: withPresent.length ? withPresent.reduce((a, d) => a + d.sales, 0) / withPresent.reduce((a, d) => a + d.present, 0) : null,
      daily,
    };
  }

  const insights: BlaAnalytics["insights"] = [];
  if (!totals.sales) insights.push({ tone: "info", text: "No Real Time Sales in this range, so there is nothing to analyse yet." });
  else {
    const top = campaigns[0];
    if (top) insights.push({ tone: "info", text: `${top.label} drives ${Math.round(pct(top.count, totals.sales) * 100)}% of sales (${top.count.toLocaleString("en-IN")} of ${totals.sales.toLocaleString("en-IN")}).` });
    const paid = payment.find((p) => p.label.toLowerCase() === "paid");
    if (paid) insights.push({ tone: pct(paid.count, totals.sales) >= 0.85 ? "good" : "warn", text: `Prepaid share is ${Math.round(pct(paid.count, totals.sales) * 100)}% against an 85% target; the rest is COD, which carries the RTO risk.` });
    if (orderStatusPending.withoutStatus > 0) insights.push({ tone: "warn", text: `${Math.round(pct(orderStatusPending.withoutStatus, totals.sales) * 100)}% of orders have no delivery status yet, so RTO is understated until they update. Among orders with a status, RTO is ${(orderStatusPending.rtoOfUpdatedPct * 100).toFixed(1)}%.` });
    if (byHour.length) { const pk = byHour.reduce((a, b) => (b.sales > a.sales ? b : a)); insights.push({ tone: "info", text: `Busiest selling hour is ${String(pk.hour).padStart(2, "0")}:00 with ${pk.sales.toLocaleString("en-IN")} sales.` }); }
    const wdOk = wdAgg.filter((w) => w.days >= 2);
    if (wdOk.length >= 4) { const best = wdOk.reduce((a, b) => (b.avgSales > a.avgSales ? b : a)); const worst = wdOk.reduce((a, b) => (b.avgSales < a.avgSales ? b : a)); insights.push({ tone: "info", text: `${best.label} is the strongest day (${best.avgSales}/day); ${worst.label} the weakest (${worst.avgSales}/day).` }); }
    if (agents.length >= 5) { const top5 = agents.slice(0, 5).reduce((a, b) => a + b.sales, 0); insights.push({ tone: "info", text: `The top 5 of ${totals.agentsSelling} selling agents account for ${Math.round(pct(top5, totals.sales) * 100)}% of sales.` }); }
    const highRto = agents.filter((a) => a.sales >= 20 && a.rtoPct >= 0.1).length;
    if (highRto) insights.push({ tone: "bad", text: `${highRto} agent${highRto === 1 ? "" : "s"} with 20+ sales have an RTO rate of 10% or more.` });
  }
  return { from, to, totals, campaigns, payment, business, orderStatus, channel, callOutcome, byHour, byWeekday: wdAgg, agents, manpower, orderStatusPending, insights };
}
