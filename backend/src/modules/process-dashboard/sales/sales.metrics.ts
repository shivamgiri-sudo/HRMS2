/**
 * Sales dashboard metrics (pure, no DB). One source row = one order.
 *
 * Definitions (all over the selected window and filters; a zero or missing denominator gives null):
 *  orders          rows, after dropping repeats of the same order_id (first row wins; `duplicateOrders` reports how many were dropped)
 *  gross revenue   sum of amount over all orders                          (null when amount is not mapped)
 *  net revenue     sum of amount over orders whose status is not RTO and not cancelled (= gross when status is not mapped)
 *  net orders      orders minus RTO minus cancelled
 *  AOV             gross revenue / orders
 *  prepaid %       prepaid orders / orders with a known payment mode (payment_mode value listed in prepaid_values)
 *  RTO %, cancellation %, delivered %, pending %   orders of that status class / orders (null when status is not mapped)
 *  conversion %    orders / calls from the process's APR (sum of mapped `calls`), only when APR calls exist for the same agents and window
 *  target attainment %  month-to-date achieved (net revenue | gross revenue | orders, per config) / roster target, with linear pacing
 */
import { deltaPct, div, pct, pacing, r2, topBottom, type Pacing } from "../shared/ext.math.js";
import { norm, num } from "../shared/ext.source.js";

export type StatusClass = "delivered" | "rto" | "cancelled" | "pending" | "other";
export interface StatusMap { delivered: string[]; rto: string[]; cancelled: string[]; pending: string[] }
export interface Caps { amount: boolean; status: boolean; payment: boolean; product: boolean; lob: boolean; tl: boolean; orderId: boolean }
export type TargetMetric = "net_revenue" | "gross_revenue" | "orders";

export interface SalesRow { orderId: string | null; date: string; agent: string; tl: string | null; amount: number | null; status: StatusClass; rawStatus: string | null; prepaid: boolean | null; product: string | null; lob: string | null }
export interface NormResult { rows: SalesRow[]; duplicateOrders: number; badAmounts: number; unmappedStatuses: Array<{ value: string; orders: number }> }

export function classifyStatus(raw: unknown, map: StatusMap): StatusClass {
  const v = norm(raw);
  if (!v) return "other";
  for (const k of ["delivered", "rto", "cancelled", "pending"] as const) if (map[k].some((x) => norm(x) === v)) return k;
  return "other";
}

const txt = (v: unknown): string | null => { const s = String(v ?? "").trim(); return s ? s : null; };

export function normalizeOrders(raw: Array<Record<string, unknown>>, statusMap: StatusMap, prepaidValues: string[], caps: Caps): NormResult {
  const seen = new Set<string>(); const rows: SalesRow[] = []; const unmapped = new Map<string, number>();
  let duplicateOrders = 0, badAmounts = 0;
  const prepaid = new Set(prepaidValues.map(norm));
  for (const r of raw) {
    const date = txt(r.date); const agent = txt(r.agent_code)?.toUpperCase();
    if (!date || !agent) continue;
    const orderId = caps.orderId ? txt(r.order_id) : null;
    if (orderId) { if (seen.has(orderId)) { duplicateOrders += 1; continue; } seen.add(orderId); }
    let amount: number | null = null;
    if (caps.amount) { amount = num(r.amount); if (amount === null && r.amount !== null && r.amount !== undefined && String(r.amount).trim() !== "") badAmounts += 1; }
    const rawStatus = caps.status ? txt(r.status) : null;
    const status = caps.status ? classifyStatus(rawStatus, statusMap) : "other";
    if (caps.status && status === "other") { const k = rawStatus ?? "(blank)"; unmapped.set(k, (unmapped.get(k) ?? 0) + 1); }
    const pm = caps.payment ? txt(r.payment_mode) : null;
    rows.push({ orderId, date, agent, tl: caps.tl ? txt(r.tl_name) : null, amount, status, rawStatus, prepaid: pm === null ? null : prepaid.has(norm(pm)),
      product: caps.product ? txt(r.product) : null, lob: caps.lob ? txt(r.lob) : null });
  }
  return { rows, duplicateOrders, badAmounts, unmappedStatuses: [...unmapped].map(([value, orders]) => ({ value, orders })).sort((a, b) => b.orders - a.orders).slice(0, 50) };
}

export interface SalesKpis {
  orders: number; netOrders: number | null; grossRevenue: number | null; netRevenue: number | null; aov: number | null;
  prepaidPct: number | null; rtoPct: number | null; cancellationPct: number | null; deliveredPct: number | null; pendingPct: number | null;
  calls: number | null; conversionPct: number | null;
}

export function computeKpis(rows: SalesRow[], caps: Caps, calls: number | null = null): SalesKpis {
  const orders = rows.length;
  let gross = 0, net = 0, rto = 0, canc = 0, del = 0, pend = 0, pm = 0, pre = 0;
  for (const r of rows) {
    const bad = r.status === "rto" || r.status === "cancelled";
    if (r.amount !== null) { gross += r.amount; if (!bad) net += r.amount; }
    if (r.status === "rto") rto += 1; else if (r.status === "cancelled") canc += 1; else if (r.status === "delivered") del += 1; else if (r.status === "pending") pend += 1;
    if (r.prepaid !== null) { pm += 1; if (r.prepaid) pre += 1; }
  }
  const s = caps.status;
  return {
    orders, netOrders: s ? orders - rto - canc : orders,
    grossRevenue: caps.amount ? r2(gross) : null, netRevenue: caps.amount ? r2(s ? net : gross) : null,
    aov: caps.amount ? div(gross, orders) : null,
    prepaidPct: caps.payment ? pct(pre, pm) : null,
    rtoPct: s ? pct(rto, orders) : null, cancellationPct: s ? pct(canc, orders) : null, deliveredPct: s ? pct(del, orders) : null, pendingPct: s ? pct(pend, orders) : null,
    calls, conversionPct: pct(orders, calls),
  };
}

export const kpiDeltas = (cur: SalesKpis, prev: SalesKpis): Record<keyof SalesKpis, number | null> => {
  const out = {} as Record<keyof SalesKpis, number | null>;
  for (const k of Object.keys(cur) as Array<keyof SalesKpis>) out[k] = deltaPct(cur[k], prev[k]);
  return out;
};

export interface FunnelStep { status: StatusClass; label: string; orders: number; revenue: number | null; pct: number | null }
const LABEL: Record<StatusClass, string> = { delivered: "Delivered", pending: "Pending", rto: "RTO (returned)", cancelled: "Cancelled", other: "Unmapped status" };
/** Orders by status class; percentages are of all orders. Empty when status is not mapped. */
export function funnel(rows: SalesRow[], caps: Caps): FunnelStep[] {
  if (!caps.status) return [];
  const total = rows.length;
  return (["delivered", "pending", "rto", "cancelled", "other"] as const).map((status) => {
    const sub = rows.filter((r) => r.status === status);
    return { status, label: LABEL[status], orders: sub.length, revenue: caps.amount ? r2(sub.reduce((a, r) => a + (r.amount ?? 0), 0)) : null, pct: pct(sub.length, total) };
  });
}

export interface DayPoint extends SalesKpis { date: string }
export function dailyTrend(rows: SalesRow[], caps: Caps): DayPoint[] {
  const by = new Map<string, SalesRow[]>();
  for (const r of rows) (by.get(r.date) ?? by.set(r.date, []).get(r.date)!).push(r);
  return [...by].sort((a, b) => a[0].localeCompare(b[0])).map(([date, rs]) => ({ date, ...computeKpis(rs, caps) }));
}

export interface GroupRow extends SalesKpis { key: string }
export function groupBy(rows: SalesRow[], caps: Caps, keyOf: (r: SalesRow) => string | null, calls?: (key: string) => number | null): GroupRow[] {
  const by = new Map<string, SalesRow[]>();
  for (const r of rows) { const k = keyOf(r) ?? "Unassigned"; (by.get(k) ?? by.set(k, []).get(k)!).push(r); }
  return [...by].map(([key, rs]) => ({ key, ...computeKpis(rs, caps, calls?.(key) ?? null) }))
    .sort((a, b) => (b.netRevenue ?? b.orders) - (a.netRevenue ?? a.orders) || a.key.localeCompare(b.key));
}

export interface RosterEntry { agent: string; tl: string | null; target: number | null }
export interface AgentRow extends SalesKpis { agent: string; tl: string | null; target: number | null; achieved: number | null; attainmentPct: number | null; pacingPct: number | null; projectedAttainmentPct: number | null }

export const achievedOf = (k: SalesKpis, metric: TargetMetric): number | null => (metric === "orders" ? k.orders : metric === "gross_revenue" ? k.grossRevenue : k.netRevenue);

/**
 * Per-agent rows. `rows` = the selected window; `mtdRows` = the same agents' rows from the 1st of the month of `asOf` to `asOf` (target pacing basis).
 * Agents that are only on the roster appear with zero orders. The TL comes from the order's tl_name, else the roster.
 */
export function agentRows(rows: SalesRow[], mtdRows: SalesRow[], roster: RosterEntry[], caps: Caps, metric: TargetMetric, asOf: string, callsByAgent?: Map<string, number>): AgentRow[] {
  const rosterBy = new Map(roster.map((r) => [r.agent, r]));
  const ag = new Map<string, SalesRow[]>(); const mtd = new Map<string, SalesRow[]>();
  for (const r of rows) (ag.get(r.agent) ?? ag.set(r.agent, []).get(r.agent)!).push(r);
  for (const r of mtdRows) (mtd.get(r.agent) ?? mtd.set(r.agent, []).get(r.agent)!).push(r);
  for (const r of roster) if (!ag.has(r.agent)) ag.set(r.agent, []);
  return [...ag].map(([agent, rs]) => {
    const k = computeKpis(rs, caps, callsByAgent ? callsByAgent.get(agent) ?? null : null);
    const ro = rosterBy.get(agent);
    const tl = rs.find((r) => r.tl)?.tl ?? ro?.tl ?? null;
    const achieved = achievedOf(computeKpis(mtd.get(agent) ?? [], caps), metric);
    const p = ro?.target != null && achieved !== null ? pacing(ro.target, achieved, asOf) : null;
    return { agent, tl, ...k, target: ro?.target ?? null, achieved, attainmentPct: p?.attainmentPct ?? null, pacingPct: p?.pacingPct ?? null, projectedAttainmentPct: p?.projectedAttainmentPct ?? null };
  }).sort((a, b) => (b.netRevenue ?? b.orders) - (a.netRevenue ?? a.orders) || a.agent.localeCompare(b.agent));
}

/** Team pacing: sum of roster targets (agents in scope) against month-to-date achieved of the same scope. Null without any target. */
export function teamPacing(mtdRows: SalesRow[], roster: RosterEntry[], caps: Caps, metric: TargetMetric, asOf: string): Pacing | null {
  const withTarget = roster.filter((r) => r.target !== null && r.target > 0);
  if (!withTarget.length) return null;
  const inScope = new Set(withTarget.map((r) => r.agent));
  const achieved = achievedOf(computeKpis(mtdRows.filter((r) => inScope.has(r.agent)), caps), metric);
  if (achieved === null) return null;
  return pacing(withTarget.reduce((a, r) => a + (r.target as number), 0), achieved, asOf);
}

export const rankAgents = (rows: AgentRow[], n = 5) => topBottom(rows, (r) => r.netRevenue ?? (r.orders > 0 || r.target !== null ? r.orders : null), n);
