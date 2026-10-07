import {
  card,
  round1,
  series,
  type DatapointGroup,
  type Loose,
} from "./business-datapoints.shared.js";
import { getBellavitaChatOverview } from "../process-performance/bellavita-chat-overview.service.js";
import { getBellavitaCartDashboard } from "../process-performance/bellavita-cart-dashboard.service.js";
import { getGncAbandonCartDashboard } from "../process-performance/gnc-abandon-cart-dashboard.service.js";
import { getGncChatDashboard } from "../process-performance/gnc-chat-dashboard.service.js";
import {
  getSatyaReport,
  normalizeFilters as normalizeSatyaFilters,
} from "../process-performance/satya-retail-report.service.js";
import { getCloviaChannelsDashboard } from "../process-performance/clovia-channels-dashboard.service.js";
import { getAwInboundCenter } from "../process-performance/appreciate-wealth-inbound-center.service.js";
import { getAwOutboundCenter } from "../process-performance/appreciate-wealth-outbound-center.service.js";
import { getAwCdrCenter } from "../process-performance/appreciate-wealth-cdr-center.service.js";
import { getDalmiaDashboard } from "../process-performance/dalmia-dashboard.service.js";
import { getInboundInsights } from "../call-master/inbound-insights.service.js";

/**
 * Second half of the business-datapoint adapters: the V2 dashboards the first pass did not cover (Bellavita chat and
 * abandon cart, GNC abandon cart and chat, Satya Retail, Clovia's channels, Appreciate Wealth's inbound / outbound / CDR
 * centres, Dalmia's query-request-complaint, language and utilization views). Every function here calls an existing
 * read-only dashboard service with the same (from, to) the V2 page sends. Percentages are 0-100 unless noted.
 */

export async function bellavitaChat(
  from: string,
  to: string,
): Promise<DatapointGroup[]> {
  const d: Loose = await getBellavitaChatOverview(from, to, "Overall");
  const v: Loose = d.values?.mtd ?? Object.values(d.values ?? {})[0];
  if (!v) return [];
  const daily = d.daily as Loose[] | undefined;
  const sales = v.saleMade !== null && v.saleMade !== undefined;
  return [
    {
      key: "bella-chat",
      title: "Chat sale performance",
      source: "Bella-Vita chat upload and sale upload (Chat campaign)",
      theme: "sales",
      cards: [
        card("bc-chats", "Chats", v.overallChat, "count", {
          hero: true,
          trend: series(daily, (x) => x.overall),
        }),
        card("bc-unique", "Unique chats", v.unique, "count"),
        card(
          "bc-sales",
          "Sales from chat",
          sales ? v.saleMade : null,
          "count",
          {
            direction: "higher_is_better",
            hero: true,
            trend: series(daily, (x) => x.saleMade),
          },
        ),
        card("bc-rev", "Chat revenue", sales ? v.revenue : null, "currency", {
          direction: "higher_is_better",
          hero: true,
          trend: series(daily, (x) => x.revenue),
        }),
        card(
          "bc-aov",
          "Average order value",
          sales ? v.aov : null,
          "currency",
          { direction: "higher_is_better" },
        ),
        card(
          "bc-conv",
          "Conversion on unique chats",
          sales ? v.convUniquePct : null,
          "percentage",
          {
            direction: "higher_is_better",
            hint: sales
              ? `${round1(v.convOverallPct)}% on all chats`
              : undefined,
          },
        ),
        card("bc-frt", "First response within target", v.frtPct, "percentage", {
          direction: "higher_is_better",
          target: d.frtTarget ?? null,
        }),
        card(
          "bc-cap",
          "Capacity utilisation",
          v.capacityUtilizationPct,
          "percentage",
          {
            direction: "higher_is_better",
            hint: v.plannedCapacity
              ? `${Number(v.plannedCapacity).toLocaleString("en-IN")} planned`
              : undefined,
          },
        ),
        card("bc-rto", "RTO rate", sales ? v.rtoPct : null, "percentage", {
          direction: "lower_is_better",
          hint: sales ? `${v.rtoCount} orders` : undefined,
        }),
        card(
          "bc-res",
          "Average resolution time",
          d.avgResolutionMin === null || d.avgResolutionMin === undefined
            ? null
            : Number(d.avgResolutionMin) * 60,
          "seconds",
          { direction: "lower_is_better" },
        ),
        card(
          "bc-ul",
          "Unplanned leave",
          d.roster?.ulPct ?? null,
          "percentage",
          { direction: "lower_is_better" },
        ),
      ],
    },
  ];
}

export async function bellavitaCart(
  from: string,
  to: string,
): Promise<DatapointGroup[]> {
  const d: Loose = await getBellavitaCartDashboard(from, to);
  const h: Loose = d.headline;
  const daily = d.dateWiseTrend as Loose[] | undefined;
  const funnel =
    h.totalCarts > 0
      ? [
          { stage: "Total carts", count: h.totalCarts, pctOfBase: 100 },
          {
            stage: "Workable (connect or not connect)",
            count: h.workableCases,
            pctOfBase: round1((100 * h.workableCases) / h.totalCarts) ?? 0,
          },
          {
            stage: "Connected",
            count: h.connectedCount,
            pctOfBase: round1((100 * h.connectedCount) / h.totalCarts) ?? 0,
          },
          {
            stage: "Sale",
            count: h.abandonCartSaleCount,
            pctOfBase:
              round1((100 * h.abandonCartSaleCount) / h.totalCarts) ?? 0,
          },
        ]
      : undefined;
  return [
    {
      key: "cart-bella",
      title: "Abandon-cart calling",
      source: "Bella-Vita cart upload and sale upload (Abandon Cart campaign)",
      theme: "leads",
      cards: [
        card("cart-total", "Total carts", h.totalCarts, "count", {
          trend: series(daily, (x) => x.cartCount),
        }),
        card("cart-value", "Cart value", h.cartValue, "currency"),
        card("cart-sales", "Recovered sales", h.abandonCartSaleCount, "count", {
          direction: "higher_is_better",
          hero: true,
          trend: series(daily, (x) => x.abandonCartSaleCount),
        }),
        card(
          "cart-rev",
          "Recovered revenue",
          h.abandonCartRevenue,
          "currency",
          {
            direction: "higher_is_better",
            hero: true,
            target: h.target ?? null,
            trend: series(daily, (x) => x.abandonCartRevenue),
            hint:
              h.achievementPct !== null && h.achievementPct !== undefined
                ? `${round1(h.achievementPct)}% of target`
                : undefined,
          },
        ),
        card(
          "cart-aov",
          "Recovered order value",
          h.abandonCartAov,
          "currency",
          { direction: "higher_is_better" },
        ),
        card("cart-conn", "Connected", h.connectedPct, "percentage", {
          direction: "higher_is_better",
        }),
        card(
          "cart-uconn",
          "Unique calls connected",
          h.uniqueCallConnectedPct,
          "percentage",
          {
            direction: "higher_is_better",
            hint: `${Number(h.uniqueCallConnectedCount).toLocaleString("en-IN")} of ${Number(h.uniqueCallCount).toLocaleString("en-IN")} unique calls`,
          },
        ),
        card(
          "cart-sd",
          "Same-day unique connect",
          h.sameDayUniqueConnectPct,
          "percentage",
          { direction: "higher_is_better", hero: true },
        ),
        card(
          "cart-conv",
          "Conversion on workable",
          h.workableCases
            ? (100 * h.abandonCartSaleCount) / h.workableCases
            : null,
          "percentage",
          { direction: "higher_is_better" },
        ),
        card("cart-cod", "COD orders", h.codOrderCount, "count"),
        card("cart-paid", "Prepaid orders", h.paidOrderCount, "count"),
        card("cart-rto", "RTO orders", h.rtoOrderCount, "count", {
          direction: "lower_is_better",
        }),
      ],
      funnel,
    },
  ];
}

export async function gncAbandonCart(
  from: string,
  to: string,
): Promise<DatapointGroup[]> {
  const d: Loose = await getGncAbandonCartDashboard(from, to);
  const h: Loose = d.headline;
  const dl: Loose = d.deltas ?? {};
  const daily = d.dailyTrend as Loose[] | undefined;
  const vs = (x: unknown) =>
    x === null || x === undefined
      ? undefined
      : `${Number(x) > 0 ? "+" : ""}${round1(x)}% vs previous period`;
  return [
    {
      key: "gnc-cart",
      title: "Abandon-cart calling",
      source: "GNC allocation and sale uploads",
      theme: "leads",
      cards: [
        card("gc-base", "Carts allocated", h.baseCount, "count", {
          trend: series(daily, (x) => x.base),
          hint: vs(dl.baseCount),
        }),
        card("gc-att", "Attempted", h.attempted, "count"),
        card("gc-conn", "Connected", h.connectedPct, "percentage", {
          direction: "higher_is_better",
          hint: `${Number(h.connected).toLocaleString("en-IN")} calls`,
        }),
        card("gc-sales", "Recovered sales", h.saleCount, "count", {
          direction: "higher_is_better",
          hero: true,
          trend: series(daily, (x) => x.saleCount),
          hint: vs(dl.saleCount),
        }),
        card("gc-rev", "Recovered revenue", h.revenue, "currency", {
          direction: "higher_is_better",
          hero: true,
          trend: series(daily, (x) => x.revenue),
          hint: vs(dl.revenue),
        }),
        card("gc-aov", "Average order value", h.aov, "currency", {
          direction: "higher_is_better",
        }),
        card(
          "gc-cbase",
          "Conversion on all carts",
          h.conversionOnBase,
          "percentage",
          { direction: "higher_is_better" },
        ),
        card(
          "gc-cconn",
          "Conversion on connected",
          h.conversionOnConnect,
          "percentage",
          {
            direction: "higher_is_better",
            hero: true,
            hint: vs(dl.conversionOnConnect),
          },
        ),
        card("gc-cod", "COD orders", h.codCount, "count"),
        card("gc-paid", "Prepaid orders", h.paidCount, "count"),
      ],
      funnel: d.funnel,
    },
  ];
}

export async function gncChat(
  from: string,
  to: string,
): Promise<DatapointGroup[]> {
  const d: Loose = await getGncChatDashboard(from, to);
  const h: Loose = d.headline;
  const daily = d.dateWiseTrend as Loose[] | undefined;
  return [
    {
      key: "gnc-chat",
      title: "Chat performance",
      source: "GNC chat and sale uploads",
      theme: "sales",
      cards: [
        card("gch-total", "Chats", h.totalChats, "count", {
          hero: true,
          trend: series(daily, (x) => x.totalChats),
        }),
        card("gch-unique", "Unique chats", h.uniqueChats, "count", {
          hint: `${Number(h.repeatChats).toLocaleString("en-IN")} repeat`,
        }),
        card(
          "gch-frt",
          "First response within 60s",
          h.frtInTatPct,
          "percentage",
          { direction: "higher_is_better" },
        ),
        card(
          "gch-res",
          "Resolved within target",
          h.resolutionInTatPct,
          "percentage",
          { direction: "higher_is_better" },
        ),
        card("gch-orders", "Orders from chat", h.orders, "count", {
          direction: "higher_is_better",
          trend: series(daily, (x) => x.orders),
        }),
        card("gch-conv", "Conversion", h.conversionPct, "percentage", {
          direction: "higher_is_better",
          hero: true,
        }),
        card("gch-rev", "Gross revenue", h.grossRevenue, "currency", {
          direction: "higher_is_better",
          hero: true,
          trend: series(daily, (x) => x.revenue),
        }),
        card("gch-net", "Net revenue (before GST)", h.netRevenue, "currency"),
        card("gch-aov", "Average order value", h.aov, "currency", {
          direction: "higher_is_better",
        }),
        card(
          "gch-csat",
          "Customer rating",
          h.csatResponses ? h.avgCsat : null,
          "rating",
          {
            direction: "higher_is_better",
            hint: h.csatResponses
              ? `${h.csatResponses} responses`
              : "no ratings recorded",
          },
        ),
        card("gch-cod", "COD orders", h.codCount, "count"),
        card("gch-paid", "Prepaid orders", h.paidCount, "count"),
      ],
    },
  ];
}

export async function satyaRetail(
  from: string,
  to: string,
): Promise<DatapointGroup[]> {
  const d: Loose = await getSatyaReport(normalizeSatyaFilters({ from, to }));
  const h: Loose = d.headline;
  const c: Loose = d.calls?.headline ?? {};
  const attempted = Number(h.allocation ?? 0) - Number(h.pending ?? 0);
  // daily is one row per date per roster; sum across rosters for the process trend
  const byDate = new Map<string, number>();
  for (const r of (d.daily as Loose[] | undefined) ?? [])
    byDate.set(
      String(r.date),
      (byDate.get(String(r.date)) ?? 0) + Number(r.counts?.orders ?? 0),
    );
  const orderTrend = [...byDate.entries()]
    .sort()
    .map(([date, value]) => ({ date, value }));
  return [
    {
      key: "satya-alloc",
      title: "Shop allocation and orders",
      source: "Satya Retail allocation upload",
      theme: "sales",
      cards: [
        card("sa-alloc", "Shops allocated", h.allocation, "count"),
        card("sa-pend", "Still pending a call", h.pending, "count", {
          direction: "lower_is_better",
        }),
        card(
          "sa-conn",
          "Connected",
          attempted > 0 ? (100 * Number(h.connected)) / attempted : null,
          "percentage",
          {
            direction: "higher_is_better",
            hero: true,
            hint: `${Number(h.connected).toLocaleString("en-IN")} of ${attempted.toLocaleString("en-IN")} attempted`,
          },
        ),
        card("sa-orders", "Orders placed", h.orders, "count", {
          direction: "higher_is_better",
          hero: true,
          trend: orderTrend,
        }),
        card(
          "sa-uorders",
          "Unique shops that ordered",
          h.ordersUnique,
          "count",
        ),
        card("sa-rev", "Order value", h.revenue, "currency", {
          direction: "higher_is_better",
          hero: true,
        }),
        card(
          "sa-conv",
          "Orders per connected call",
          Number(h.connected) > 0
            ? (100 * Number(h.orders)) / Number(h.connected)
            : null,
          "percentage",
          { direction: "higher_is_better" },
        ),
        card("sa-agents", "Agents", h.agents, "count"),
      ],
    },
    {
      key: "satya-calls",
      title: "Calling",
      source: "Satya Retail call records",
      theme: "calls",
      cards: [
        card("sc-att", "Call attempts", c.attempts, "count", {
          trend: series(
            d.calls?.daily as Loose[] | undefined,
            (x) => x.attempts,
          ),
        }),
        card("sc-conn", "Connected", c.connectedPct, "percentage", {
          direction: "higher_is_better",
        }),
        card("sc-order", "Calls that ended in an order", c.orderCalls, "count"),
        card("sc-shops", "Shops called", c.shops, "count"),
        card("sc-avg", "Attempts per shop", c.avgAttempt, "count"),
      ],
    },
  ];
}

export async function cloviaChannels(
  from: string,
  to: string,
): Promise<DatapointGroup[]> {
  const d: Loose = await getCloviaChannelsDashboard(from, to);
  const e: Loose = d.email ?? {};
  const ch: Loose = d.chat ?? {};
  const fb: Loose = d.feedback ?? {};
  const q: Loose = d.quality ?? {};
  const ob: Loose = d.outbound ?? {};
  const rc: Loose = d.rechurn ?? {};
  const ds: Loose = d.disposition ?? {};
  const pr: Loose = d.productivity ?? {};
  return [
    {
      key: "cl-email-chat",
      title: "Email and chat",
      source: "Clovia email and chat uploads",
      theme: "calls",
      cards: [
        card("cl-em-assigned", "Emails assigned", e.totalAssigned, "count", {
          hero: true,
          trend: series(e.trend, (x) => x.assigned),
        }),
        card(
          "cl-em-closed",
          "Emails closed",
          e.totalAssigned
            ? (100 * Number(e.closed)) / Number(e.totalAssigned)
            : null,
          "percentage",
          {
            direction: "higher_is_better",
            hero: true,
            hint: `${Number(e.closed ?? 0).toLocaleString("en-IN")} closed`,
          },
        ),
        card("cl-em-open", "Emails still open", e.open, "count", {
          direction: "lower_is_better",
        }),
        card("cl-em-reopen", "Re-opened", e.reOpen, "count", {
          direction: "lower_is_better",
        }),
        card("cl-em-junk", "Junk", e.junk, "count"),
        card("cl-ch-total", "Chats", ch.totalChats, "count", {
          trend: series(ch.trend, (x) => x.chats),
        }),
        card("cl-ch-resp", "Chats answered", ch.respondedChats, "count"),
        card("cl-ch-res", "Chats resolved", ch.csatPct, "percentage", {
          direction: "higher_is_better",
          hint: `${Number(ch.resolvedYes ?? 0)} yes, ${Number(ch.resolvedNo ?? 0)} no`,
        }),
        card(
          "cl-ch-dur",
          "Average chat length",
          ch.avgChatDurationSec,
          "seconds",
        ),
      ],
    },
    {
      key: "cl-quality",
      title: "Customer satisfaction and quality",
      source: "Clovia feedback and quality uploads",
      theme: "quality",
      cards: [
        card("cl-fb-csat", "Satisfied customers", fb.csatPct, "percentage", {
          direction: "higher_is_better",
          hero: true,
          hint: `${Number(fb.totalFeedback ?? 0).toLocaleString("en-IN")} responses`,
        }),
        card("cl-fb-dsat", "Dissatisfied customers", fb.dsatPct, "percentage", {
          direction: "lower_is_better",
        }),
        card("cl-q-avg", "Average audit score", q.avgScorePct, "percentage", {
          direction: "higher_is_better",
          hero: true,
          hint: `${Number(q.auditsCount ?? 0).toLocaleString("en-IN")} audits`,
        }),
        card("cl-q-fatal", "Fatal audits", q.fatalCount, "count", {
          direction: "lower_is_better",
        }),
        card("cl-d-ftr", "First-time resolution", ds.ftrPct, "percentage", {
          direction: "higher_is_better",
          hint: `${Number(ds.totalTickets ?? 0).toLocaleString("en-IN")} tickets`,
        }),
        card(
          "cl-p-util",
          "Average utilisation",
          pr.avgUtilizationPct,
          "percentage",
          { direction: "higher_is_better" },
        ),
        card("cl-p-agents", "Agents", pr.agentCount, "count"),
      ],
    },
    {
      key: "cl-out-rechurn",
      title: "Outbound and rechurn",
      source: "Clovia outbound and rechurn call uploads",
      theme: "calls",
      cards: [
        card("cl-ob-calls", "Outbound calls", ob.totalCalls, "count", {
          trend: series(ob.trend, (x) => x.calls),
        }),
        card(
          "cl-ob-conn",
          "Outbound connected",
          ob.connectedPct,
          "percentage",
          { direction: "higher_is_better", hero: true },
        ),
        card(
          "cl-ob-talk",
          "Average outbound talk time",
          ob.avgTalkSec,
          "seconds",
        ),
        card("cl-rc-calls", "Rechurn calls", rc.totalCalls, "count"),
        card(
          "cl-rc-abn",
          "Abandoned before an agent",
          rc.abandonedCount,
          "count",
          { direction: "lower_is_better" },
        ),
      ],
    },
  ];
}

export async function appreciateWealthCentres(
  from: string,
  to: string,
): Promise<DatapointGroup[]> {
  const [inb, out, cdr] = await Promise.allSettled([
    getAwInboundCenter(from, to),
    getAwOutboundCenter(from, to),
    getAwCdrCenter(from, to),
  ]);
  const groups: DatapointGroup[] = [];
  if (inb.status === "fulfilled") {
    const k: Loose = (inb.value as Loose).kpis;
    groups.push({
      key: "aw-inbound",
      title: "Inbound centre",
      source: "Appreciate Wealth inbound call upload",
      theme: "calls",
      cards: [
        card("awi-off", "Calls offered", k.offered, "count", {
          trend: series((inb.value as Loose).daily, (x) => x.offered),
        }),
        card("awi-al", "Answer level", k.alPct, "percentage", {
          direction: "higher_is_better",
        }),
        card("awi-abn", "Abandon rate", k.abnPct, "percentage", {
          direction: "lower_is_better",
          hint: `${Number(k.abn ?? 0)} abandoned`,
        }),
        card("awi-never", "Callers never reached", k.neverReached, "count", {
          direction: "lower_is_better",
        }),
        card("awi-rep", "Repeat calls", k.repeatPct, "percentage", {
          direction: "lower_is_better",
        }),
        card("awi-aht", "Average handle time", k.ahtS, "seconds", {
          direction: "lower_is_better",
        }),
      ],
    });
  }
  if (out.status === "fulfilled") {
    const o: Loose = out.value as Loose;
    const k: Loose = o.kpis;
    groups.push({
      key: "aw-outbound",
      title: "Outbound targets and products",
      source: "Appreciate Wealth outbound upload",
      theme: "sales",
      cards: [
        card("awo-calls", "Calls against target", k.calls, "count", {
          target: k.target || null,
          direction: "higher_is_better",
          hint: k.target ? `${round1(k.achPct)}% of target` : undefined,
        }),
        card("awo-late", "Late logins", k.latePct, "percentage", {
          direction: "lower_is_better",
        }),
        card("awo-occ", "Net occupancy", k.occNetPct, "percentage", {
          direction: "higher_is_better",
        }),
        card(
          "awo-below",
          "Agent-days below target",
          k.belowTargetDays,
          "count",
          { direction: "lower_is_better" },
        ),
        ...((o.products as Loose[] | undefined) ?? []).map((p) =>
          card(`awo-${p.key}`, `${p.label} achieved`, p.achieved, "currency", {
            target: p.target || null,
            direction: "higher_is_better",
            hint: p.target
              ? `${round1(p.effPct)}% of target, ${Number(p.count ?? 0)} sales`
              : `${Number(p.count ?? 0)} sales`,
          }),
        ),
      ],
    });
  }
  if (cdr.status === "fulfilled") {
    const k: Loose = (cdr.value as Loose).kpis;
    groups.push({
      key: "aw-cdr",
      title: "Dialler call legs",
      source: "Appreciate Wealth call-record upload",
      theme: "calls",
      cards: [
        card("awc-calls", "Call legs", k.calls, "count", {
          trend: series((cdr.value as Loose).daily, (x) => x.calls),
        }),
        card("awc-ans", "Answered", k.answerPct, "percentage", {
          direction: "higher_is_better",
        }),
        card("awc-un", "Unanswered", k.unanswered, "count", {
          direction: "lower_is_better",
        }),
        card("awc-aht", "Average handle time", k.ahtS, "seconds", {
          direction: "lower_is_better",
        }),
      ],
    });
  }
  if (!groups.length)
    throw new Error("none of the Appreciate Wealth centres could be read");
  return groups;
}

/** Dalmia's query / request / complaint mix, utilisation, after-hours leads and calls by language (fractions x100). */
export async function dalmiaExtras(
  from: string,
  to: string,
): Promise<DatapointGroup[]> {
  const month = to.slice(0, 7);
  const start = from < `${month}-01` ? `${month}-01` : from;
  const d: Loose = await getDalmiaDashboard(month, start, to);
  const groups: DatapointGroup[] = [];
  const qrc: Loose | undefined = d.qrc?.byBucket?.MTD;
  const util: number | null = d.utilization?.MTD ?? null;
  const afterHours = (d.leads?.MTD?.sources as Loose[] | undefined)?.find(
    (s) => s.source === "Inbound After Hours",
  );
  if (qrc || util !== null || afterHours)
    groups.push({
      key: "dl-qrc",
      title: "Queries, requests, complaints and productivity",
      source: "Dalmia dial-desk and productivity uploads",
      theme: "quality",
      cards: [
        card("dq-total", "Tagged calls", qrc?.total, "count"),
        card("dq-query", "Queries", qrc?.Query, "count"),
        card("dq-req", "Requests", qrc?.Request, "count"),
        card("dq-comp", "Complaints", qrc?.Complain, "count", {
          direction: "lower_is_better",
        }),
        card("dq-util", "Agent utilisation", util, "percentage", {
          direction: "higher_is_better",
        }),
        card(
          "dq-ah",
          "After-hours leads received",
          afterHours?.dataReceived,
          "count",
          {
            hint: afterHours
              ? `${afterHours.connected} connected, ${afterHours.qualified} qualified`
              : undefined,
          },
        ),
      ],
    });
  const langs = (d.languages?.MTD as Loose[] | undefined)?.filter(
    (l) => Number(l.total) > 0,
  );
  if (langs?.length) {
    const total = langs.reduce((s, l) => s + Number(l.total), 0);
    groups.push({
      key: "dl-lang",
      title: "Calls by language line",
      source: "Dalmia inbound call records",
      theme: "calls",
      cards: langs
        .slice(0, 4)
        .map((l) =>
          card(
            `dlang-${l.campaign}`,
            String(l.language || l.campaign),
            l.total,
            "count",
            { hint: `answer level ${round1(Number(l.alPct) * 100)}%` },
          ),
        ),
      funnel: langs
        .slice(0, 10)
        .sort((a, b) => Number(b.total) - Number(a.total))
        .map((l) => ({
          stage: String(l.language || l.campaign),
          count: Number(l.total),
          pctOfBase: round1((100 * Number(l.total)) / total) ?? 0,
        })),
    });
  }
  return groups;
}

/**
 * Hour-by-hour view of a dialler inbound project: which hours carry the calls and which hours the service is weakest.
 * Built from the existing insights service (the same hourly table the inbound dashboards show). Hours with fewer than
 * 5 calls are ignored when naming the weakest hour, so one stray call cannot look like a failing hour.
 */
export function inboundHourly(projectKey: string) {
  return async (from: string, to: string): Promise<DatapointGroup[]> => {
    const d: Loose = await getInboundInsights(projectKey, {
      startDate: from,
      endDate: to,
    });
    const hours = (d.hourly as Loose[] | undefined) ?? [];
    const busy = hours.filter((h) => Number(h.offered) > 0);
    if (!busy.length) return [];
    const total = busy.reduce((s, h) => s + Number(h.offered), 0);
    const peak = [...busy].sort(
      (a, b) => Number(b.offered) - Number(a.offered),
    )[0];
    const solid = busy.filter((h) => Number(h.offered) >= 5);
    const weakAl = [...solid].sort(
      (a, b) => Number(a.answeredPct) - Number(b.answeredPct),
    )[0];
    const weakSl = [...solid].sort(
      (a, b) => Number(a.slPct) - Number(b.slPct),
    )[0];
    return [
      {
        key: `hourly-${projectKey}`,
        title: "Calls by hour of day",
        source: "Dialler inbound call records, grouped by hour",
        theme: "calls",
        cards: [
          card("hr-peak", `Peak hour (${peak.label})`, peak.offered, "count", {
            hint: `${round1((100 * Number(peak.offered)) / total)}% of all calls, ${peak.avgPerDay} a day`,
          }),
          card(
            "hr-weak-al",
            weakAl
              ? `Weakest answer level (${weakAl.label})`
              : "Weakest answer level",
            weakAl?.answeredPct ?? null,
            "percentage",
            {
              direction: "higher_is_better",
              hint: weakAl ? `${weakAl.offered} calls in that hour` : undefined,
            },
          ),
          card(
            "hr-weak-sl",
            weakSl
              ? `Weakest service level (${weakSl.label})`
              : "Weakest service level",
            weakSl?.slPct ?? null,
            "percentage",
            {
              direction: "higher_is_better",
              hint: weakSl
                ? `${weakSl.answered} answered in that hour`
                : undefined,
            },
          ),
          card("hr-active", "Hours with calls", busy.length, "count"),
        ],
        funnel: busy.map((h) => ({
          stage: `${h.label} · AL ${Math.round(Number(h.answeredPct))}% · SL ${Math.round(Number(h.slPct))}%`,
          count: Number(h.offered),
          pctOfBase:
            round1((100 * Number(h.offered)) / Number(peak.offered)) ?? 0,
        })),
      },
    ];
  };
}
