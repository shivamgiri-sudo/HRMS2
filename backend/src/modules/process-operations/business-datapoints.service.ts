import type { RowDataPacket } from "mysql2";
import {
  card,
  hasAny,
  iso,
  round1,
  series,
  type DatapointCard,
  type DatapointGroup,
  type DatapointTheme,
  type DatapointUnit,
  type FunnelStage,
  type Loose,
} from "./business-datapoints.shared.js";
export type {
  DatapointCard,
  DatapointGroup,
  DatapointTheme,
  DatapointUnit,
  FunnelStage,
} from "./business-datapoints.shared.js";
import { db } from "../../db/mysql.js";
import { readableProcessIds } from "./process-operations.service.js";
import { getBellavitaSaleDashboard } from "../process-performance/bellavita-sale-dashboard.service.js";
import { getGncSaleDashboard } from "../process-performance/gnc-sale-dashboard.service.js";
import { getNeemansPerformanceDashboard } from "../process-performance/neemans-performance-dashboard.service.js";
import { getDashboard as getBlaDashboard } from "../bla-bli-blu-dashboard/bla-bli-blu-dashboard.service.js";
import { getHousingOwnerDashboard } from "../process-performance/housing-owner-dashboard.service.js";
import { getHousingPremiumOverview } from "../process-performance/housing-premium-dashboard.service.js";
import { getBirlanuDashboard } from "../process-performance/birlanu-dashboard.service.js";
import { getDalmiaDashboard } from "../process-performance/dalmia-dashboard.service.js";
import {
  getAppreciateWealthDashboard,
  parseFilters as parseAwFilters,
} from "../process-performance/appreciate-wealth-dashboard.service.js";
import { getLpFeedbackDashboard } from "../process-performance/lp-feedback-dashboard.service.js";
import { getLpOnboardingDashboard } from "../process-performance/lp-onboarding-dashboard.service.js";
import { getProjectOverview } from "../call-master/inbound.service.js";
import {
  appreciateWealthCentres,
  bellavitaCart,
  bellavitaChat,
  cloviaChannels,
  dalmiaExtras,
  gncAbandonCart,
  gncChat,
  inboundHourly,
  satyaRetail,
} from "./business-datapoints.more.js";

/**
 * Business datapoints for the KPI Metrics page: the sales / revenue / payment-mix / RTO / funnel
 * figures that the sales dashboards already compute but that were never surfaced as KPI metrics.
 *
 * Read-only and additive: each adapter calls the existing dashboard service for that sales system
 * (nothing is written, no KPI definition or data source is created in production). The result is
 * cached for five minutes per process+window because these services scan large upload tables
 * (Bella-Vita's sale dashboard alone takes ~20-45s on production).
 */

export interface BusinessDatapoints {
  supported: boolean;
  available: boolean;
  reason: string | null;
  processCode: string | null;
  window: { from: string; to: string; label: string } | null;
  groups: DatapointGroup[];
  /** Sources that could not be read while others could (the page still shows what worked). */
  notes?: string[];
}

export const SUPPORTED_PROCESS_CODES = [
  "BELLA_VITA",
  "BLA_BLI_BLU",
  "NEEMANS",
  "GNC",
  "HOUSING_OWNER",
  "HOUSING_PREMIUM",
  "CLOVIA",
  "BIRLANU",
  "DALMIA_CEMENT",
  "APPRICIATE_WEALTH",
  "ERESOLUTION",
  "DU_DIGITAL",
  "EXICOM",
  "VIEGA",
  "SATYA_RETAIL",
] as const;

/** Satya Retail has no fixed process code; a process whose name contains "satya" maps to it. */
export function adapterKeyFor(
  code: string | null,
  name: string | null,
): string | null {
  if (code && ADAPTERS[code]) return code;
  return name && /satya/i.test(name) ? "SATYA_RETAIL" : null;
}
type Period = "trend" | "today" | "wtd" | "mtd";

export function windowFor(
  period: Period,
  now = new Date(),
): { from: string; to: string; label: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = iso(today);
  if (period === "today") return { from: to, to, label: "Today" };
  if (period === "wtd") {
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    return { from: iso(monday), to, label: "Week to date" };
  }
  if (period === "mtd")
    return {
      from: iso(new Date(today.getFullYear(), today.getMonth(), 1)),
      to,
      label: "Month to date",
    };
  const from = new Date(today);
  from.setDate(today.getDate() - 29);
  return { from: iso(from), to, label: "Last 30 days" };
}

async function bella(from: string, to: string): Promise<DatapointGroup[]> {
  const sale = await getBellavitaSaleDashboard(from, to);
  const h = sale.headline;
  const groups: DatapointGroup[] = [
    {
      key: "sales",
      title: "Sales and revenue",
      source: "Bella-Vita sale upload (deduplicated orders)",
      cards: [
        card("turnover", "Turnover", h.turnover, "currency", {
          direction: "higher_is_better",
          hero: true,
          trend: series(sale.dateWiseTrend, (x) => x.turnover),
        }),
        card(
          "netTurnover",
          "Net turnover (excl. RTO)",
          h.netTurnover,
          "currency",
          { direction: "higher_is_better" },
        ),
        card("saleCount", "Sales", h.saleCount, "count", {
          direction: "higher_is_better",
          hero: true,
          trend: series(sale.dateWiseTrend, (x) => x.saleCount),
        }),
        card("aov", "Average order value", h.aov, "currency", {
          direction: "higher_is_better",
          hero: true,
        }),
        card("prepaid", "Prepaid share", h.prepaidPct, "percentage", {
          direction: "higher_is_better",
        }),
        card("rto", "RTO rate", h.rtoPct, "percentage", {
          direction: "lower_is_better",
          hero: true,
          hint: `orders up to ${h.rtoPctThrough}`,
        }),
        card("agents", "Active agents", h.activeAgents, "count"),
      ],
    },
  ];
  const lobs = sale.lobRevenue.filter((l) => l.saleCount > 0);
  if (lobs.length) {
    groups.push({
      key: "lob",
      title: "By line of business",
      source: "Bella-Vita sale upload, split by LOB",
      cards: lobs.flatMap((l) => [
        card(`${l.lob}-rev`, `${l.lob} revenue`, l.turnover, "currency", {
          target: l.target,
          direction: "higher_is_better",
          hint:
            l.achievementPct === null
              ? undefined
              : `${l.achievementPct}% of target`,
        }),
        card(`${l.lob}-rto`, `${l.lob} RTO`, l.rtoPct, "percentage", {
          direction: "lower_is_better",
          hint: `${l.rtoCount} of ${l.saleCount} orders`,
        }),
      ]),
    });
  }
  return groups;
}

async function bla(from: string, to: string): Promise<DatapointGroup[]> {
  const d = await getBlaDashboard(from, to);
  return d.blocks
    .filter((b) => b.mtd.realTimeSale > 0 || b.mtd.freshWorkable > 0)
    .map((b): DatapointGroup => {
      const m = b.mtd;
      return {
        key: `bla-${b.lob}`,
        title: `${b.lob}`,
        source: "Bla Bli Blu Overall Sales upload + Received Data",
        cards: [
          card("sales", "Real-time sales", m.realTimeSale, "count", {
            hero: true,
            target: b.hasTarget ? Math.round(m.targetSale) : null,
            direction: "higher_is_better",
            hint: b.hasTarget
              ? `${Math.round(m.saleAchievement * 100)}% of target`
              : "no target set",
          }),
          card("revenue", "Revenue", m.revenue, "currency", {
            hero: true,
            target: b.hasTarget ? Math.round(m.targetRevenue) : null,
            direction: "higher_is_better",
          }),
          card("aov", "Average order value", m.aov, "currency", {
            target: b.hasTarget ? m.targetAov : null,
            direction: "higher_is_better",
          }),
          card(
            "prepaid",
            "Prepaid share",
            m.deliveryPrepaid * 100,
            "percentage",
            {
              target: b.hasTarget ? m.prepaidTarget * 100 : null,
              direction: "higher_is_better",
            },
          ),
          card("rto", "RTO rate", m.deliveryRto * 100, "percentage", {
            target: b.hasTarget ? m.rtoTarget * 100 : null,
            direction: "lower_is_better",
          }),
          card(
            "conv",
            "Delivery conversion",
            m.cappedData > 0 ? m.deliveryConversion * 100 : null,
            "percentage",
            {
              target:
                b.hasTarget && m.cappedData > 0
                  ? m.conversionTarget * 100
                  : null,
              direction: "higher_is_better",
              hint: m.cappedData > 0 ? undefined : "needs Received Data",
            },
          ),
          card("ptp", "Same-day PTP sales", m.ptp, "count"),
          card("h24", "24-hour sales", m.h24, "count"),
        ],
      };
    });
}

async function neemans(from: string, to: string): Promise<DatapointGroup[]> {
  const d = await getNeemansPerformanceDashboard(from, to);
  const s = d.sale.headline,
    o = d.overview;
  const ch: Loose = d.chat.headline,
    ct: Loose = d.cart.headline,
    pr: Loose = d.productivity.headline;
  return [
    {
      key: "sales",
      title: "Sales and revenue",
      source: "Neemans sale upload",
      cards: [
        card("revenue", "Revenue", s.revenue, "currency", {
          target: s.target || null,
          direction: "higher_is_better",
          hero: true,
          trend: series(d.sale.dateWiseTrend as Loose[], (x) => x.revenue),
          hint: s.target ? `${s.achievementPct}% of target` : undefined,
        }),
        card("sales", "Sales", s.saleCount, "count", {
          direction: "higher_is_better",
          hero: true,
          trend: series(d.sale.dateWiseTrend as Loose[], (x) => x.saleCount),
        }),
        card("aov", "Average order value", s.aov, "currency", {
          direction: "higher_is_better",
        }),
        card("prepaid", "Prepaid share", s.prepaidPct, "percentage", {
          direction: "higher_is_better",
        }),
        card("cod", "COD share", s.codPct, "percentage"),
        card("rto", "RTO rate", s.rtoPct, "percentage", {
          direction: "lower_is_better",
          hero: true,
        }),
        card("agents", "Active agents", s.activeAgents, "count"),
      ],
    },
    {
      key: "ops",
      title: "Allocation, chat and productivity",
      source: "Neemans allocation, chat and APR uploads",
      cards: [
        card("alloc", "Total allocation", o.totalAllocation, "count"),
        card(
          "allocConn",
          "Allocation connected",
          o.allocationConnectedPct,
          "percentage",
          { direction: "higher_is_better" },
        ),
        card("tickets", "Chat tickets", o.totalChatTickets, "count"),
        card("resolved", "Chat resolved", o.chatResolvedPct, "percentage", {
          direction: "higher_is_better",
        }),
        card("occ", "Average occupancy", o.avgOccupancyPct, "percentage", {
          direction: "higher_is_better",
        }),
      ],
    },
    {
      key: "chat",
      title: "Chat performance",
      source: "Neemans chat upload",
      theme: "quality",
      cards: [
        card("ch-tickets", "Chat tickets", ch.totalTickets, "count", {
          hero: true,
          trend: series(d.chat.dateWiseTrend as Loose[], (x) => x.tickets),
        }),
        card("ch-resolved", "Resolved", ch.resolvedPct, "percentage", {
          direction: "higher_is_better",
          hero: true,
        }),
        card(
          "ch-frt",
          "First response within target",
          ch.frtTatCompliancePct,
          "percentage",
          { direction: "higher_is_better" },
        ),
        card(
          "ch-res",
          "Resolution within target",
          ch.resolutionTatCompliancePct,
          "percentage",
          { direction: "higher_is_better" },
        ),
        card("ch-csat", "Customer rating", ch.avgCsat, "rating", {
          direction: "higher_is_better",
        }),
      ],
    },
    {
      key: "cart",
      title: "Abandoned-cart calling",
      source: "Neemans cart upload",
      theme: "leads",
      cards: [
        card("ct-total", "Carts", ct.totalCarts, "count", {
          hero: true,
          trend: series(d.cart.dateWiseTrend as Loose[], (x) => x.cartCount),
        }),
        card("ct-value", "Cart value", ct.totalCartValue, "currency", {
          hero: true,
        }),
        card("ct-avg", "Average cart value", ct.avgCartValue, "currency"),
        card("ct-cust", "Unique customers", ct.uniqueCustomers, "count"),
        card("ct-agents", "Agents", ct.activeAgents, "count"),
      ],
    },
    {
      key: "prod",
      title: "Productivity",
      source: "Neemans agent productivity (APR) upload",
      theme: "workforce",
      cards: [
        card("pr-calls", "Calls logged", pr.totalCalls, "count", {
          trend: series(
            d.productivity.dateWiseTrend as Loose[],
            (x) => x.calls,
          ),
        }),
        card("pr-agents", "Active agents", pr.activeAgents, "count"),
        card("pr-occ", "Average occupancy", pr.avgOccupancyPct, "percentage", {
          direction: "higher_is_better",
        }),
        card("pr-days", "Attendance days", pr.attendanceDays, "count"),
        card("pr-login", "Average net login", pr.avgNetLoginSec, "seconds"),
        card("pr-break", "Average break time", pr.avgTotalBreakSec, "seconds"),
      ],
    },
  ];
}

async function gnc(from: string, to: string): Promise<DatapointGroup[]> {
  const d = await getGncSaleDashboard(from, to);
  const h = d.headline;
  return [
    {
      key: "sales",
      title: "Sales, revenue and allocation",
      source: "GNC sale and allocation uploads",
      cards: [
        card("turnover", "Turnover", h.turnover, "currency", {
          direction: "higher_is_better",
          hero: true,
          trend: series(d.dateWiseTrend as Loose[], (x) => x.turnover),
        }),
        card("sales", "Sales", h.saleCount, "count", {
          direction: "higher_is_better",
          hero: true,
          trend: series(d.dateWiseTrend as Loose[], (x) => x.saleCount),
        }),
        card("aov", "Average order value", h.aov, "currency", {
          direction: "higher_is_better",
          hero: true,
        }),
        card("prepaid", "Prepaid share", h.prepaidPct, "percentage", {
          direction: "higher_is_better",
        }),
        card("cod", "COD share", h.codPct, "percentage"),
        card("alloc", "Total allocation", h.totalAllocation, "count"),
        card(
          "sameDay",
          "Same-day connected",
          h.sameDayConnectedPct,
          "percentage",
          { direction: "higher_is_better" },
        ),
        card("agents", "Active agents", h.activeAgents, "count"),
      ],
      funnel: d.funnel,
    },
  ];
}

/** Shared dialler inbound figures (offered / answered / answer level / service level / handle time / staffing). */
function inboundAdapter(projectKey: string, title = "Inbound calls") {
  return async (from: string, to: string): Promise<DatapointGroup[]> => {
    const r = await getProjectOverview(
      { startDate: from, endDate: to } as Parameters<
        typeof getProjectOverview
      >[0],
      projectKey,
    );
    const s: Loose = r.summary;
    const t: Loose[] = r.trend as Loose[];
    const cards = [
      card("in-offered", "Calls offered", s.total, "count", {
        trend: series(t, (d) => d.offered),
        hero: true,
      }),
      card("in-answered", "Calls answered", s.answered, "count", {
        direction: "higher_is_better",
      }),
      card("in-al", "Answer level", s.ans_pct, "percentage", {
        direction: "higher_is_better",
        hint: "answered ÷ offered",
      }),
      card("in-sl", "Service level", s.sl_pct, "percentage", {
        direction: "higher_is_better",
        hint: "answered within the threshold ÷ answered",
      }),
      card("in-aht", "Average handle time", s.avg_handle, "seconds", {
        direction: "lower_is_better",
        trend: series(t, (d) => d.acht),
      }),
      card("in-agents", "Agents logged in (peak day)", s.login_count, "count", {
        target: s.required ?? null,
        direction: "higher_is_better",
        hint: s.required ? `${s.required} required` : undefined,
      }),
      card(
        "in-phones",
        "Unique callers (sum of daily)",
        s.unique_phones,
        "count",
      ),
      ...(s.hasFCR
        ? [
            card(
              "in-fcr",
              "First-contact resolution",
              s.fcr_pct,
              "percentage",
              { direction: "higher_is_better" },
            ),
          ]
        : []),
    ];
    return [
      {
        key: `inbound-${projectKey}`,
        title,
        source: "Dialler inbound call records",
        theme: "calls",
        cards,
      },
    ];
  };
}

async function housingOwner(
  from: string,
  to: string,
): Promise<DatapointGroup[]> {
  const d = await getHousingOwnerDashboard(from, to, "", "");
  const h = d.headline;
  return [
    {
      key: "ho-sales",
      title: "Sales and calling",
      source: "Housing Owner sale, CDR and agent uploads",
      theme: "sales",
      cards: [
        card("ho-rev", "Revenue", h.totalRevenue, "currency", {
          target: h.totalTarget || null,
          direction: "higher_is_better",
          hero: true,
          trend: series(d.dailyTrend, (x) => x.revenue),
          hint: h.totalTarget
            ? `${round1(h.achievementPct)}% of target`
            : undefined,
        }),
        card("ho-sales", "Sales", h.totalSaleCount, "count", {
          direction: "higher_is_better",
          hero: true,
          trend: series(d.dailyTrend, (x) => x.saleCount),
        }),
        card("ho-aov", "Average sale value", h.aov, "currency", {
          direction: "higher_is_better",
        }),
        card("ho-rpa", "Revenue per agent", h.revenuePerAgent, "currency", {
          direction: "higher_is_better",
        }),
        card("ho-calls", "Calls made", h.totalCalls, "count", {
          trend: series(d.dailyTrend, (x) => x.totalCalls),
        }),
        card("ho-conn", "Connected", h.connectedPct, "percentage", {
          direction: "higher_is_better",
          hero: true,
          hint: `${h.connectedCalls.toLocaleString("en-IN")} of ${h.totalCalls.toLocaleString("en-IN")} calls`,
        }),
        card("ho-talk", "Average talk time", h.avgTalkTimeSec, "seconds"),
        card("ho-agents", "Active agents", h.activeAgents, "count"),
      ],
    },
  ];
}

async function housingPremium(
  from: string,
  to: string,
): Promise<DatapointGroup[]> {
  const d = await getHousingPremiumOverview(from, to);
  const v: Loose = d.overall.mtd ?? Object.values(d.overall)[0];
  if (!v) return [];
  const cdrNote = d.cdrAvailable
    ? "calling covers the last 5 days of the range"
    : "no call records uploaded";
  return [
    {
      key: "hp-sales",
      title: "Sales and calling",
      source: "Housing Premium sale and CDR uploads",
      theme: "sales",
      cards: [
        card("hp-rev", "Revenue", v.revenue, "currency", {
          target: v.target || null,
          direction: "higher_is_better",
          hero: true,
          hint: v.target ? `${round1(v.achievedPct)}% of target` : undefined,
        }),
        card("hp-sales", "Sales", v.saleCount, "count", {
          direction: "higher_is_better",
          hero: true,
        }),
        card("hp-aov", "Average sale value", v.aov, "currency", {
          direction: "higher_is_better",
        }),
        card("hp-avg", "Avg sales per agent", v.avgSalePerAgent, "count"),
        card(
          "hp-calls",
          "Calls made",
          d.cdrAvailable ? v.totalCalls : null,
          "count",
          { hint: cdrNote },
        ),
        card(
          "hp-conn",
          "Connected",
          d.cdrAvailable ? v.connectedPct : null,
          "percentage",
          { direction: "higher_is_better", hero: true, hint: cdrNote },
        ),
        card(
          "hp-talk",
          "Avg talk per agent per day",
          d.cdrAvailable ? v.avgTalkPerAgentSec : null,
          "seconds",
          { hint: cdrNote },
        ),
        card(
          "hp-dial",
          "Dials per agent per day",
          d.cdrAvailable ? v.perAgentDialCount : null,
          "count",
          { hint: cdrNote },
        ),
      ],
    },
  ];
}

async function birlanu(from: string, to: string): Promise<DatapointGroup[]> {
  const d: Loose = await getBirlanuDashboard();
  const h = d.headline;
  const window = (d.dailyTrend as Loose[] | undefined)?.filter(
    (r) => String(r.date) >= from && String(r.date) <= to,
  );
  const latest = (d.monthlyFunnel as Loose[] | undefined)?.slice(-1)[0];
  const allTime = "all uploaded data, not limited to the window";
  const funnel = latest
    ? [
        {
          stage: `Enquiries (${latest.month})`,
          count: latest.enquiriesReceived,
          pctOfBase: 100,
        },
        {
          stage: "Connected",
          count: latest.connected,
          pctOfBase: latest.enquiriesReceived
            ? (round1((100 * latest.connected) / latest.enquiriesReceived) ?? 0)
            : 0,
        },
        {
          stage: "Validated",
          count: latest.validated,
          pctOfBase: latest.enquiriesReceived
            ? (round1((100 * latest.validated) / latest.enquiriesReceived) ?? 0)
            : 0,
        },
        {
          stage: "Qualified",
          count: latest.qualified,
          pctOfBase: latest.enquiriesReceived
            ? (round1((100 * latest.qualified) / latest.enquiriesReceived) ?? 0)
            : 0,
        },
        {
          stage: "Converted",
          count: latest.converted,
          pctOfBase: latest.enquiriesReceived
            ? (round1((100 * latest.converted) / latest.enquiriesReceived) ?? 0)
            : 0,
        },
      ]
    : undefined;
  return [
    {
      key: "bl-leads",
      title: "Leads to conversion",
      source: `Birlanu lead upload (${allTime})`,
      theme: "leads",
      cards: [
        card("bl-leads", "Total leads", h.totalLeads, "count", {
          hero: true,
          trend: series(window, (r) => r.leads),
          hint: allTime,
        }),
        card("bl-conn", "Connected", h.connectedPct, "percentage", {
          direction: "higher_is_better",
        }),
        card("bl-int", "Interested", h.interestedPct, "percentage", {
          direction: "higher_is_better",
        }),
        card("bl-conv", "Converted", h.conversionPct, "percentage", {
          direction: "higher_is_better",
          hero: true,
          hint: `${h.converted} leads`,
        }),
        card("bl-val", "Sale value", h.totalSaleValue, "currency", {
          direction: "higher_is_better",
          hero: true,
          trend: series(window, (r) => r.saleValue),
        }),
        card("bl-aov", "Average order value", h.avgOrderValue, "currency"),
        card(
          "bl-tat",
          "Within turnaround time",
          h.tatCompliancePct,
          "percentage",
          { direction: "higher_is_better" },
        ),
        card("bl-vol", "Volume (metric tonnes)", h.totalVolumeMt, "count"),
      ],
      funnel,
    },
  ];
}

async function dalmia(from: string, to: string): Promise<DatapointGroup[]> {
  const month = to.slice(0, 7);
  const start = from < `${month}-01` ? `${month}-01` : from; // one calendar month at a time
  const d: Loose = await getDalmiaDashboard(month, start, to);
  const ib = d.inbound?.byBucket?.MTD;
  const ob = d.outbound?.byBucket?.MTD;
  const lead = d.leads?.MTD?.total;
  const pct = (f: unknown) =>
    f === null || f === undefined ? null : Number(f) * 100; // Dalmia returns fractions 0-1
  const groups: DatapointGroup[] = [];
  if (ib)
    groups.push({
      key: "dl-in",
      title: "Inbound calls",
      source: "Dalmia dialler inbound + dial-desk uploads",
      theme: "calls",
      cards: [
        card("dl-off", "Calls offered", ib.offered, "count", {
          hero: true,
          trend: series(d.inbound.daily, (x) => x.offered),
        }),
        card("dl-ans", "Calls answered", ib.answered, "count"),
        card("dl-al", "Answer level", pct(ib.alPct), "percentage", {
          direction: "higher_is_better",
          hero: true,
        }),
        card("dl-sl", "Service level", pct(ib.slPct), "percentage", {
          direction: "higher_is_better",
        }),
        card("dl-abn", "Abandon rate", pct(ib.abnPct), "percentage", {
          direction: "lower_is_better",
        }),
        card("dl-acht", "Average handle time", ib.achtSec, "seconds", {
          direction: "lower_is_better",
        }),
        card("dl-rep", "Repeat callers", pct(ib.repeatPct), "percentage", {
          direction: "lower_is_better",
        }),
        card("dl-tag", "Calls tagged", pct(ib.taggingPct), "percentage", {
          direction: "higher_is_better",
        }),
      ],
    });
  if (ob || lead)
    groups.push({
      key: "dl-lead",
      title: "Outbound and leads",
      source: "Dalmia outbound and lead uploads",
      theme: "leads",
      cards: [
        card("dl-out", "Outbound calls", ob?.overall, "count"),
        card("dl-outc", "Outbound connected", pct(ob?.conPct), "percentage", {
          direction: "higher_is_better",
        }),
        card("dl-lr", "Leads received", lead?.dataReceived, "count", {
          hero: true,
        }),
        card("dl-lc", "Leads connected", lead?.connected, "count"),
        card("dl-lq", "Leads qualified", lead?.qualified, "count", {
          direction: "higher_is_better",
        }),
      ],
      funnel:
        lead && lead.dataReceived
          ? [
              {
                stage: "Data received",
                count: lead.dataReceived,
                pctOfBase: 100,
              },
              {
                stage: "Connected",
                count: lead.connected,
                pctOfBase:
                  round1((100 * lead.connected) / lead.dataReceived) ?? 0,
              },
              {
                stage: "Qualified",
                count: lead.qualified,
                pctOfBase:
                  round1((100 * lead.qualified) / lead.dataReceived) ?? 0,
              },
            ]
          : undefined,
    });
  return groups;
}

async function appreciateWealth(
  from: string,
  to: string,
): Promise<DatapointGroup[]> {
  const d: Loose = await getAppreciateWealthDashboard(
    from,
    to,
    parseAwFilters({}),
  );
  const k: Loose = d.overview?.kpis ?? {};
  const sk: Loose = d.sales?.kpis ?? {};
  const daily = d.overview?.daily as Loose[] | undefined;
  return [
    {
      key: "aw-sales",
      title: "Sales by product",
      source: "Appreciate Wealth outbound sales upload",
      theme: "sales",
      cards: [
        card("aw-total", "Total sales", k.salesTotal, "currency", {
          hero: true,
          direction: "higher_is_better",
          trend: series(daily, (x) => x.sales),
        }),
        card("aw-lrs", "LRS", k.lrsA, "currency", {
          direction: "higher_is_better",
          hint:
            sk.lrsAttain != null
              ? `${round1(sk.lrsAttain)}% of target`
              : undefined,
        }),
        card("aw-tr", "Trade", k.trA, "currency", {
          direction: "higher_is_better",
          hint:
            sk.trAttain != null
              ? `${round1(sk.trAttain)}% of target`
              : undefined,
        }),
        card("aw-mf", "Mutual funds", k.mfA, "currency", {
          direction: "higher_is_better",
          hint:
            sk.mfAttain != null
              ? `${round1(sk.mfAttain)}% of target`
              : undefined,
        }),
        card("aw-cv", "Contract value", k.contractValue, "currency"),
      ],
    },
    {
      key: "aw-calls",
      title: "Calling and productivity",
      source: "Appreciate Wealth billing and call uploads",
      theme: "workforce",
      cards: [
        card("aw-calls", "Calls", k.calls, "count", {
          hero: true,
          trend: series(daily, (x) => x.calls),
        }),
        card("aw-conn", "Connected", k.connectPct, "percentage", {
          direction: "higher_is_better",
          hero: true,
        }),
        card("aw-acht", "Average call time", k.acht, "seconds"),
        card("aw-occ", "Net occupancy", k.netOccPct, "percentage", {
          direction: "higher_is_better",
        }),
        card("aw-late", "Late logins", k.latePct, "percentage", {
          direction: "lower_is_better",
        }),
        card("aw-agents", "Agents", k.agents, "count"),
        card("aw-inb", "Inbound answered", k.inboundAnswerPct, "percentage", {
          direction: "higher_is_better",
          hint: `${Number(k.inboundAnswered ?? 0).toLocaleString("en-IN")} of ${Number(k.inboundOffered ?? 0).toLocaleString("en-IN")}`,
        }),
      ],
    },
  ];
}

async function lawyerPanel(
  from: string,
  to: string,
): Promise<DatapointGroup[]> {
  const [fb, ob] = await Promise.all([
    getLpFeedbackDashboard(from, to),
    getLpOnboardingDashboard(from, to),
  ]);
  const one = (
    key: string,
    title: string,
    d: Loose,
    onboarding: boolean,
  ): DatapointGroup => {
    const h: Loose = d.headline;
    const daily = d.daily as Loose[] | undefined;
    return {
      key,
      title,
      source: `Lawyer Panel ${onboarding ? "onboarding" : "feedback"} call and agent uploads`,
      theme: "leads",
      cards: [
        card(`${key}-calls`, "Calls", h.overallCalls, "count", {
          hero: true,
          trend: series(daily, (x) => x.calls),
        }),
        card(`${key}-leads`, "Unique leads", h.uniqueLeadset, "count"),
        card(`${key}-conn`, "Connected", h.overallConnectedPct, "percentage", {
          direction: "higher_is_better",
          hero: true,
        }),
        card(
          `${key}-uconn`,
          "Unique leads connected",
          h.uniqueConnectivityPct,
          "percentage",
          { direction: "higher_is_better" },
        ),
        card(
          `${key}-talk`,
          "Average talk per connected call",
          h.avgTalkPerConnectedSec,
          "seconds",
        ),
        card(`${key}-occ`, "Occupancy", h.occupancyPct, "percentage", {
          direction: "higher_is_better",
        }),
        card(`${key}-shr`, "Shrinkage", h.shrinkagePct, "percentage", {
          direction: "lower_is_better",
        }),
        card(`${key}-agents`, "Agents", h.loginCount, "count"),
        ...(onboarding
          ? [
              card(
                `${key}-adv`,
                "Allocated to an advisor",
                h.advisorAllocatedLeads,
                "count",
              ),
            ]
          : []),
      ],
    };
  };
  return [
    one("lp-fb", "Lawyer Panel: feedback calling", fb as Loose, false),
    one("lp-ob", "Lawyer Panel: onboarding calling", ob as Loose, true),
  ];
}

type Adapter = (from: string, to: string) => Promise<DatapointGroup[]>;
const ADAPTERS: Record<string, Adapter[]> = {
  BELLA_VITA: [
    bella,
    bellavitaChat,
    bellavitaCart,
    inboundAdapter("bellavita"),
    inboundHourly("bellavita"),
  ],
  BLA_BLI_BLU: [bla],
  NEEMANS: [neemans, inboundAdapter("neemans"), inboundHourly("neemans")],
  GNC: [
    gnc,
    gncAbandonCart,
    gncChat,
    inboundAdapter("gnc"),
    inboundHourly("gnc"),
  ],
  HOUSING_OWNER: [housingOwner],
  HOUSING_PREMIUM: [housingPremium],
  CLOVIA: [inboundAdapter("clovia"), inboundHourly("clovia"), cloviaChannels],
  BIRLANU: [birlanu],
  DALMIA_CEMENT: [dalmia, dalmiaExtras, inboundHourly("dalmia")],
  APPRICIATE_WEALTH: [appreciateWealth, appreciateWealthCentres],
  SATYA_RETAIL: [satyaRetail],
  ERESOLUTION: [lawyerPanel],
  DU_DIGITAL: [inboundAdapter("dubangladesh"), inboundHourly("dubangladesh")],
  EXICOM: [inboundAdapter("exicom"), inboundHourly("exicom")],
  VIEGA: [inboundAdapter("viega"), inboundHourly("viega")],
};

/** Newest date the sales system holds, so a stopped upload shows its last real month instead of an empty window. */
const LATEST_DATE: Record<string, () => Promise<string | null>> = {
  BLA_BLI_BLU: async () => {
    const [r] = await db.execute<RowDataPacket[]>(
      "SELECT MAX(report_date) d FROM bla_bli_blu_overall_sales_raw",
    );
    return r[0]?.d ? iso(new Date(r[0].d as string)) : null;
  },
};

const LATEST_DATA_FALLBACK_OK = true;
const CACHE_MS = 5 * 60_000;
/** A finished result older than CACHE_MS is still served (instantly) for this long while a fresh one is computed in the background. */
const STALE_OK_MS = 6 * 60 * 60_000;
interface CacheEntry {
  at: number;
  p: Promise<BusinessDatapoints>;
  value?: BusinessDatapoints;
  refreshing?: boolean;
}
const cache = new Map<string, CacheEntry>();

async function runAdapters(
  processCode: string,
  from: string,
  to: string,
): Promise<{ groups: DatapointGroup[]; notes: string[] }> {
  const settled = await Promise.allSettled(
    ADAPTERS[processCode].map((fn) => fn(from, to)),
  );
  const groups: DatapointGroup[] = [];
  let failed = 0;
  for (const r of settled) {
    if (r.status === "fulfilled") groups.push(...r.value);
    else {
      failed++;
      // The technical reason (database host, credentials, SQL) is for administrators: it goes to the server log, never to the page.
      console.warn(
        `[business-datapoints] ${processCode} source failed:`,
        r.reason instanceof Error ? r.reason.message : String(r.reason),
      );
    }
  }
  const notes = failed
    ? [
        `${failed} source${failed === 1 ? "" : "s"} could not be loaded right now, so those figures are missing. Everything else is shown.`,
      ]
    : [];
  groups.forEach((g) => {
    g.theme ??=
      g.key.startsWith("cart") || g.key === "ops" ? "workforce" : "sales";
  });
  const keep = groups.filter(
    (g) => hasAny(g.cards) || (g.funnel?.length ?? 0) > 0,
  );
  return { groups: keep, notes };
}

async function compute(
  processCode: string,
  w: { from: string; to: string; label: string },
): Promise<BusinessDatapoints> {
  const base = { supported: true, processCode, window: w };
  try {
    let { groups, notes } = await runAdapters(processCode, w.from, w.to);
    if (!groups.length && LATEST_DATE[processCode]) {
      const latest = await LATEST_DATE[processCode]();
      if (latest && latest < w.from) {
        const end = new Date(latest + "T00:00:00");
        const start = new Date(end);
        start.setDate(end.getDate() - 29);
        const fw = {
          from: iso(start),
          to: latest,
          label: `Last 30 days to ${latest} (latest upload, not today)`,
        };
        const again = await runAdapters(processCode, fw.from, fw.to);
        if (again.groups.length)
          return {
            supported: true,
            processCode,
            window: fw,
            available: true,
            reason: null,
            groups: again.groups,
            notes: again.notes,
          };
      }
    }
    return groups.length
      ? {
          ...base,
          available: true,
          reason: null,
          groups,
          notes: notes.length ? notes : undefined,
        }
      : {
          ...base,
          available: false,
          reason:
            notes[0] ??
            `The sales system for this process has no rows between ${w.from} and ${w.to}. Its uploads may have stopped; try a longer window.`,
          groups: [],
        };
  } catch (e) {
    console.warn(
      `[business-datapoints] ${processCode} failed:`,
      (e as Error).message,
    );
    return {
      ...base,
      available: false,
      reason:
        "The sales and calling systems could not be read right now. Please try again in a moment.",
      groups: [],
    };
  }
}

export async function getBusinessDatapoints(
  userId: string,
  processId: string,
  period: Period,
): Promise<BusinessDatapoints | null> {
  const allowed = await readableProcessIds(userId);
  if (!allowed.has(processId)) return null;
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT process_code, process_name FROM process_master WHERE id = ? LIMIT 1",
    [processId],
  );
  const rawCode = rows[0]?.process_code ? String(rows[0].process_code) : null;
  const code = adapterKeyFor(
    rawCode,
    rows[0]?.process_name ? String(rows[0].process_name) : null,
  );
  if (!code) {
    return {
      supported: false,
      available: false,
      reason: "No sales-system connection is set up for this process yet.",
      processCode: rawCode,
      window: null,
      groups: [],
    };
  }
  return cachedCompute(code, windowFor(period));
}

/**
 * Stale-while-revalidate: these adapters scan large upload tables (10-35 s cold), so a fresh result is reused for
 * CACHE_MS, then for up to STALE_OK_MS it is served immediately while a new one computes behind it. The window
 * label/dates travel with the result, so a stale answer is never passed off as today's.
 */
function cachedCompute(
  code: string,
  w: { from: string; to: string; label: string },
): Promise<BusinessDatapoints> {
  const key = `${code}|${w.from}|${w.to}`;
  const hit = cache.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && age < CACHE_MS) return hit.p;
  if (hit?.value && age < STALE_OK_MS) {
    if (!hit.refreshing) {
      hit.refreshing = true;
      compute(code, w)
        .then((r) => {
          if (r.available)
            cache.set(key, { at: Date.now(), p: Promise.resolve(r), value: r });
          else hit.refreshing = false;
        })
        .catch(() => {
          hit.refreshing = false;
        });
    }
    return hit.p;
  }
  const entry: CacheEntry = { at: Date.now(), p: compute(code, w) };
  cache.set(key, entry);
  entry.p
    .then((r) => {
      if (r.available) entry.value = r;
      else cache.delete(key);
    })
    .catch(() => cache.delete(key));
  if (cache.size > 100) {
    const k = cache.keys().next().value;
    if (k) cache.delete(k);
  }
  return entry.p;
}

/** Warm the default (Last 30 days) view for every wired process, one at a time, so the first person to open one does not wait 30+ s. */
export async function warmBusinessDatapoints(): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT process_code, process_name FROM process_master WHERE active_status = 1",
  );
  const codes = new Set<string>();
  for (const r of rows) {
    const c = adapterKeyFor(
      r.process_code ? String(r.process_code) : null,
      r.process_name ? String(r.process_name) : null,
    );
    if (c) codes.add(c);
  }
  for (const code of codes) {
    try {
      await cachedCompute(code, windowFor("trend"));
    } catch {
      /* a failed warm-up is harmless */
    }
  }
}
if (
  process.env.BUSINESS_DATAPOINTS_WARM !== "false" &&
  !process.env.VITEST &&
  process.env.NODE_ENV !== "test"
) {
  setTimeout(() => {
    void warmBusinessDatapoints().catch(() => undefined);
  }, 90_000).unref();
  setInterval(
    () => {
      void warmBusinessDatapoints().catch(() => undefined);
    },
    4 * 60 * 60_000,
  ).unref();
}
