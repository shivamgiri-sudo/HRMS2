import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { readableProcessIds } from "./process-operations.service.js";
import { getBellavitaSaleDashboard } from "../process-performance/bellavita-sale-dashboard.service.js";
import { getBellavitaCartSummary as _cartSummary } from "../process-performance/bellavita-cart-dashboard.service.js";
import { getGncSaleDashboard } from "../process-performance/gnc-sale-dashboard.service.js";
import { getNeemansPerformanceDashboard } from "../process-performance/neemans-performance-dashboard.service.js";
import { getDashboard as getBlaDashboard } from "../bla-bli-blu-dashboard/bla-bli-blu-dashboard.service.js";

/**
 * Business datapoints for the KPI Metrics page: the sales / revenue / payment-mix / RTO / funnel
 * figures that the sales dashboards already compute but that were never surfaced as KPI metrics.
 *
 * Read-only and additive: each adapter calls the existing dashboard service for that sales system
 * (nothing is written, no KPI definition or data source is created in production). The result is
 * cached for five minutes per process+window because these services scan large upload tables
 * (Bella-Vita's sale dashboard alone takes ~20-45s on production).
 */

export type DatapointUnit = "currency" | "percentage" | "count";
export interface DatapointCard {
  key: string; label: string; value: number | null; unit: DatapointUnit;
  target?: number | null; direction?: "higher_is_better" | "lower_is_better"; hint?: string;
}
export interface FunnelStage { stage: string; count: number; pctOfBase: number }
export interface DatapointGroup { key: string; title: string; source: string; cards: DatapointCard[]; funnel?: FunnelStage[] }
export interface BusinessDatapoints {
  supported: boolean; available: boolean; reason: string | null;
  processCode: string | null; window: { from: string; to: string; label: string } | null;
  groups: DatapointGroup[];
}

export const SUPPORTED_PROCESS_CODES = ["BELLA_VITA", "BLA_BLI_BLU", "NEEMANS", "GNC"] as const;
type Period = "trend" | "today" | "wtd" | "mtd";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function windowFor(period: Period, now = new Date()): { from: string; to: string; label: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = iso(today);
  if (period === "today") return { from: to, to, label: "Today" };
  if (period === "wtd") {
    const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    return { from: iso(monday), to, label: "Week to date" };
  }
  if (period === "mtd") return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to, label: "Month to date" };
  const from = new Date(today); from.setDate(today.getDate() - 29);
  return { from: iso(from), to, label: "Last 30 days" };
}

const n = (v: unknown): number | null => { const x = Number(v); return v === null || v === undefined || !Number.isFinite(x) ? null : x; };
const card = (key: string, label: string, value: unknown, unit: DatapointUnit, extra: Partial<DatapointCard> = {}): DatapointCard =>
  ({ key, label, value: n(value), unit, ...extra });
const hasAny = (cards: DatapointCard[]) => cards.some((c) => c.value !== null && c.value !== 0);

async function bella(from: string, to: string): Promise<DatapointGroup[]> {
  const [sale, cart] = await Promise.all([getBellavitaSaleDashboard(from, to), _cartSummary(from, to)]);
  const h = sale.headline;
  const groups: DatapointGroup[] = [{
    key: "sales", title: "Sales and revenue", source: "Bella-Vita sale upload (deduplicated orders)",
    cards: [
      card("turnover", "Turnover", h.turnover, "currency", { direction: "higher_is_better" }),
      card("netTurnover", "Net turnover (excl. RTO)", h.netTurnover, "currency", { direction: "higher_is_better" }),
      card("saleCount", "Sales", h.saleCount, "count", { direction: "higher_is_better" }),
      card("aov", "Average order value", h.aov, "currency", { direction: "higher_is_better" }),
      card("prepaid", "Prepaid share", h.prepaidPct, "percentage", { direction: "higher_is_better" }),
      card("rto", "RTO rate", h.rtoPct, "percentage", { direction: "lower_is_better", hint: `orders up to ${h.rtoPctThrough}` }),
      card("agents", "Active agents", h.activeAgents, "count"),
    ],
  }];
  const lobs = sale.lobRevenue.filter((l) => l.saleCount > 0);
  if (lobs.length) {
    groups.push({
      key: "lob", title: "By line of business", source: "Bella-Vita sale upload, split by LOB",
      cards: lobs.flatMap((l) => [
        card(`${l.lob}-rev`, `${l.lob} revenue`, l.turnover, "currency", { target: l.target, direction: "higher_is_better", hint: l.achievementPct === null ? undefined : `${l.achievementPct}% of target` }),
        card(`${l.lob}-rto`, `${l.lob} RTO`, l.rtoPct, "percentage", { direction: "lower_is_better", hint: `${l.rtoCount} of ${l.saleCount} orders` }),
      ]),
    });
  }
  const conv = cart.workableCases > 0 ? Math.round((cart.abandonCartSaleCount / cart.workableCases) * 10000) / 100 : null;
  groups.push({
    key: "cart", title: "Abandon-cart calling", source: "Bella-Vita cart upload",
    cards: [
      card("carts", "Total carts", cart.totalCarts, "count"),
      card("workable", "Workable cases", cart.workableCases, "count"),
      card("cartSales", "Cart sales", cart.abandonCartSaleCount, "count", { direction: "higher_is_better" }),
      card("cartConv", "Conversion on workable", conv, "percentage", { direction: "higher_is_better" }),
    ],
    funnel: cart.totalCarts > 0 ? [
      { stage: "Total carts", count: cart.totalCarts, pctOfBase: 100 },
      { stage: "Workable", count: cart.workableCases, pctOfBase: Math.round((cart.workableCases / cart.totalCarts) * 1000) / 10 },
      { stage: "Sale", count: cart.abandonCartSaleCount, pctOfBase: Math.round((cart.abandonCartSaleCount / cart.totalCarts) * 1000) / 10 },
    ] : undefined,
  });
  return groups;
}

async function bla(from: string, to: string): Promise<DatapointGroup[]> {
  const d = await getBlaDashboard(from, to);
  return d.blocks.filter((b) => b.mtd.realTimeSale > 0 || b.mtd.freshWorkable > 0).map((b): DatapointGroup => {
    const m = b.mtd;
    return {
      key: `bla-${b.lob}`, title: `${b.lob}`, source: "Bla Bli Blu Overall Sales upload + Received Data",
      cards: [
        card("sales", "Real-time sales", m.realTimeSale, "count", { target: b.hasTarget ? Math.round(m.targetSale) : null, direction: "higher_is_better", hint: b.hasTarget ? `${Math.round(m.saleAchievement * 100)}% of target` : "no target set" }),
        card("revenue", "Revenue", m.revenue, "currency", { target: b.hasTarget ? Math.round(m.targetRevenue) : null, direction: "higher_is_better" }),
        card("aov", "Average order value", m.aov, "currency", { target: b.hasTarget ? m.targetAov : null, direction: "higher_is_better" }),
        card("prepaid", "Prepaid share", m.deliveryPrepaid * 100, "percentage", { target: b.hasTarget ? m.prepaidTarget * 100 : null, direction: "higher_is_better" }),
        card("rto", "RTO rate", m.deliveryRto * 100, "percentage", { target: b.hasTarget ? m.rtoTarget * 100 : null, direction: "lower_is_better" }),
        card("conv", "Delivery conversion", m.cappedData > 0 ? m.deliveryConversion * 100 : null, "percentage", { target: b.hasTarget && m.cappedData > 0 ? m.conversionTarget * 100 : null, direction: "higher_is_better", hint: m.cappedData > 0 ? undefined : "needs Received Data" }),
        card("ptp", "Same-day PTP sales", m.ptp, "count"),
        card("h24", "24-hour sales", m.h24, "count"),
      ],
    };
  });
}

async function neemans(from: string, to: string): Promise<DatapointGroup[]> {
  const d = await getNeemansPerformanceDashboard(from, to);
  const s = d.sale.headline, o = d.overview;
  return [
    {
      key: "sales", title: "Sales and revenue", source: "Neemans sale upload",
      cards: [
        card("revenue", "Revenue", s.revenue, "currency", { target: s.target || null, direction: "higher_is_better", hint: s.target ? `${s.achievementPct}% of target` : undefined }),
        card("sales", "Sales", s.saleCount, "count", { direction: "higher_is_better" }),
        card("aov", "Average order value", s.aov, "currency", { direction: "higher_is_better" }),
        card("prepaid", "Prepaid share", s.prepaidPct, "percentage", { direction: "higher_is_better" }),
        card("cod", "COD share", s.codPct, "percentage"),
        card("rto", "RTO rate", s.rtoPct, "percentage", { direction: "lower_is_better" }),
        card("agents", "Active agents", s.activeAgents, "count"),
      ],
    },
    {
      key: "ops", title: "Allocation, chat and productivity", source: "Neemans allocation, chat and APR uploads",
      cards: [
        card("alloc", "Total allocation", o.totalAllocation, "count"),
        card("allocConn", "Allocation connected", o.allocationConnectedPct, "percentage", { direction: "higher_is_better" }),
        card("tickets", "Chat tickets", o.totalChatTickets, "count"),
        card("resolved", "Chat resolved", o.chatResolvedPct, "percentage", { direction: "higher_is_better" }),
        card("occ", "Average occupancy", o.avgOccupancyPct, "percentage", { direction: "higher_is_better" }),
      ],
    },
  ];
}

async function gnc(from: string, to: string): Promise<DatapointGroup[]> {
  const d = await getGncSaleDashboard(from, to);
  const h = d.headline;
  return [{
    key: "sales", title: "Sales, revenue and allocation", source: "GNC sale and allocation uploads",
    cards: [
      card("turnover", "Turnover", h.turnover, "currency", { direction: "higher_is_better" }),
      card("sales", "Sales", h.saleCount, "count", { direction: "higher_is_better" }),
      card("aov", "Average order value", h.aov, "currency", { direction: "higher_is_better" }),
      card("prepaid", "Prepaid share", h.prepaidPct, "percentage", { direction: "higher_is_better" }),
      card("cod", "COD share", h.codPct, "percentage"),
      card("alloc", "Total allocation", h.totalAllocation, "count"),
      card("sameDay", "Same-day connected", h.sameDayConnectedPct, "percentage", { direction: "higher_is_better" }),
      card("agents", "Active agents", h.activeAgents, "count"),
    ],
    funnel: d.funnel,
  }];
}

const ADAPTERS: Record<string, (from: string, to: string) => Promise<DatapointGroup[]>> = {
  BELLA_VITA: bella, BLA_BLI_BLU: bla, NEEMANS: neemans, GNC: gnc,
};

/** Newest date the sales system holds, so a stopped upload shows its last real month instead of an empty window. */
const LATEST_DATE: Record<string, () => Promise<string | null>> = {
  BLA_BLI_BLU: async () => {
    const [r] = await db.execute<RowDataPacket[]>("SELECT MAX(report_date) d FROM bla_bli_blu_overall_sales_raw");
    return r[0]?.d ? iso(new Date(r[0].d as string)) : null;
  },
};

const LATEST_DATA_FALLBACK_OK = true;
const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; p: Promise<BusinessDatapoints> }>();

async function compute(processCode: string, w: { from: string; to: string; label: string }): Promise<BusinessDatapoints> {
  const base = { supported: true, processCode, window: w };
  try {
    const keep = (gs: DatapointGroup[]) => gs.filter((g) => hasAny(g.cards) || (g.funnel?.length ?? 0) > 0);
    let groups = keep(await ADAPTERS[processCode](w.from, w.to));
    if (!groups.length && LATEST_DATA_FALLBACK_OK && LATEST_DATE[processCode]) {
      const latest = await LATEST_DATE[processCode]();
      if (latest && latest < w.from) {
        const end = new Date(latest + "T00:00:00"); const start = new Date(end); start.setDate(end.getDate() - 29);
        const fw = { from: iso(start), to: latest, label: `Last 30 days to ${latest} (latest upload, not today)` };
        groups = keep(await ADAPTERS[processCode](fw.from, fw.to));
        if (groups.length) return { supported: true, processCode, window: fw, available: true, reason: null, groups };
      }
    }
    return groups.length
      ? { ...base, available: true, reason: null, groups }
      : { ...base, available: false, reason: `The sales system for this process has no rows between ${w.from} and ${w.to}. Its uploads may have stopped; try a longer window.`, groups: [] };
  } catch (e) {
    return { ...base, available: false, reason: `Could not read the sales system: ${(e as Error).message}`, groups: [] };
  }
}

export async function getBusinessDatapoints(userId: string, processId: string, period: Period): Promise<BusinessDatapoints | null> {
  const allowed = await readableProcessIds(userId);
  if (!allowed.has(processId)) return null;
  const [rows] = await db.execute<RowDataPacket[]>("SELECT process_code FROM process_master WHERE id = ? LIMIT 1", [processId]);
  const code = rows[0]?.process_code ? String(rows[0].process_code) : null;
  if (!code || !ADAPTERS[code]) {
    return { supported: false, available: false, reason: "No sales-system connection is set up for this process yet.", processCode: code, window: null, groups: [] };
  }
  const w = windowFor(period);
  const key = `${code}|${w.from}|${w.to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.p;
  const p = compute(code, w);
  cache.set(key, { at: Date.now(), p });
  p.then((r) => { if (!r.available) cache.delete(key); }).catch(() => cache.delete(key));
  if (cache.size > 100) { const k = cache.keys().next().value; if (k) cache.delete(k); }
  return p;
}
