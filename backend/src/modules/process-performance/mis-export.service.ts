import {
  appendDashboardToWorkbook, newWorkbookWriter, safeSheetName, isKnownDashboard,
  type DashboardExcelRequest, type ExportSlideInput, type RawSheetResult,
} from "./dashboard-export.service.js";

import { getBellavitaSaleDashboard } from "./bellavita-sale-dashboard.service.js";
import { getBellavitaChatOverview } from "./bellavita-chat-overview.service.js";
import { getBellavitaCartDashboard } from "./bellavita-cart-dashboard.service.js";
import { getGncSaleDashboard, getGncAbandonCartDaily } from "./gnc-sale-dashboard.service.js";
import { getGncChatDashboard } from "./gnc-chat-dashboard.service.js";
import { getNeemansPerformanceDashboard } from "./neemans-performance-dashboard.service.js";
import { getNeemansCartDashboard } from "./neemans-cart-dashboard.service.js";
import { getHousingOwnerDashboard, getHousingOwnerEntityTrend, type HousingOwnerGroupRow } from "./housing-owner-dashboard.service.js";
import { getDuDigitalDashboard, type DuDashboardLabel } from "./du-digital-dashboard.service.js";
import {
  getHousingPremiumOverview, getHousingPremiumDayWise, getHousingPremiumAgentWise, getHousingPremiumSlotWise, type OverviewValues,
} from "./housing-premium-dashboard.service.js";
import { getCloviaChannelsDashboard } from "./clovia-channels-dashboard.service.js";
import { getBirlanuDashboard } from "./birlanu-dashboard.service.js";
import { getLpFeedbackDashboard } from "./lp-feedback-dashboard.service.js";
import { getLpOnboardingDashboard } from "./lp-onboarding-dashboard.service.js";
import { getSatyaRetailDashboard } from "./satya-retail-dashboard.service.js";
import { buildSatyaMisWorkbook } from "./satya-retail-mis-workbook.service.js";
import { buildLpMisWorkbook } from "./lp-mis-workbook.service.js";
import { normalizeFilters } from "./satya-retail-report.service.js";
import { getAppreciateWealthDashboard, parseFilters as parseAwFilters } from "./appreciate-wealth-dashboard.service.js";
import { getInboundInsights, isInsightProject } from "../call-master/inbound-insights.service.js";
import { buildPeriodColumns, proratedTarget, eachDay, type PeriodColumn } from "./mis-period-columns.js";

/**
 * "MIS" -- one consolidated, formatted workbook per process/company, bundling
 * EVERY dashboard that company has (Sale, Chat, Cart, Inbound, ...) into a
 * single file: real KPI summary sheets for each, in the exact same styled
 * format the per-dashboard "Download Excel" button already produces
 * (dashboard-export.service.ts's writeSummarySheet -- reused, not
 * reimplemented), followed by that dashboard's raw source data (reusing the
 * SAME dashboard-export.registry.ts RAW_SOURCES every existing export
 * already uses, so a raw sheet here is identical to one from that
 * dashboard's own export). One combined "Raw Data Notes" sheet at the end
 * covers every raw source across every dashboard in the bundle.
 *
 * Every number in every summary sheet here comes straight from that
 * dashboard's own already-live, already-validated service function -- this
 * module adds NO new metric and NO new query logic; it only reformats what
 * each dashboard already computes into MIS-friendly slides. See each
 * `build...Slides` function below for exactly which fields are shown and,
 * for the handful of dashboards whose data is a matrix/grid rather than a
 * flat headline (Housing Premium, Clovia, Appreciate Wealth), which slice of
 * it is summarised here -- the full grid is still in that dashboard's own
 * "Download Excel" button, and this MIS says so in its own note row.
 */

export interface MisBundleEntry {
  dashboardKey: string;
  title: string;
  build: (from: string, to: string) => Promise<ExportSlideInput[]>;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const fmtNum = (v: unknown): string => num(v).toLocaleString("en-IN");
const fmtInr = (v: unknown): string =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(num(v));
const round1 = (v: number): number => Math.round(v * 10) / 10;
// Several headline percentages this module reads straight off a dashboard service (e.g. Housing
// Owner's connectedPct) are stored unrounded ((part/whole)*100 with no .toFixed of their own -- the
// on-screen React component rounds at render time, but this Excel layer renders the raw number), so
// this formatter always rounds to 1 decimal itself rather than trusting the caller already did.
const fmtPct = (v: unknown): string => `${round1(num(v))}%`;
const round2 = (v: number): number => Math.round(v * 100) / 100;
const pct = (part: number, whole: number): number =>
  whole > 0 ? round1((part / whole) * 100) : 0;
/** Seconds -> "H:MM:SS", for the average-talk-time row of a KPI matrix. */
const fmtHms = (totalSeconds: number): string => {
  const t = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

/**
 * Turns a set of KPI-row definitions + period columns into one "rows = metrics, columns = MTD / week /
 * day" table -- the professional MIS layout every process's KPI Summary sheet below uses, so week-wise
 * and date-wise figures sit in the SAME sheet as the MTD total instead of being spread across separate
 * tabs. `T` is whatever per-column aggregate object the caller already has one of per PeriodColumn key
 * (e.g. Housing Premium's own OverviewValues, or a locally rolled-up object for a dashboard that has
 * no such per-column aggregate yet).
 */
function kpiMatrixTable<T>(
  title: string,
  columns: PeriodColumn[],
  valuesByColumn: Record<string, T>,
  rows: Array<{ label: string; get: (v: T) => string | number }>,
): { title: string; columns: string[]; rows: Array<Array<string | number>> } {
  return {
    title,
    columns: ["KPI", ...columns.map((c) => c.label)],
    rows: rows.map((r) => [
      r.label,
      ...columns.map((c) => r.get(valuesByColumn[c.key])),
    ]),
  };
}

/** Splits camelCase/snake_case into "Title Case" for an auto-generated label. */
function humanize(key: string): string {
  const spaced = key.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function looksLikePct(key: string): boolean {
  return /pct|percent/i.test(key);
}
function looksLikeMoney(key: string): boolean {
  return (
    /revenue|amount|value|turnover|target|aov|price|cost/i.test(key) &&
    !looksLikePct(key)
  );
}

function scalarToKpi(
  key: string,
  value: unknown,
): { label: string; value: string } | null {
  if (value === null || value === undefined)
    return { label: humanize(key), value: "—" };
  if (typeof value === "number")
    return {
      label: humanize(key),
      value: looksLikePct(key)
        ? fmtPct(value)
        : looksLikeMoney(key)
          ? fmtInr(value)
          : fmtNum(value),
    };
  if (typeof value === "string" || typeof value === "boolean")
    return { label: humanize(key), value: String(value) };
  return null;
}

/**
 * Generic, real-data flattener for a dashboard whose payload is a plain
 * object of scalars/sub-objects/arrays (no chart-specific shape assumed):
 * every top-level scalar becomes a KPI row; every array of objects becomes
 * its own table (columns = keys of its first row); every nested object
 * becomes its own KPI block appended after the top-level one. Used for
 * dashboards this module doesn't have a hand-built, chart-matching adapter
 * for yet -- it is still 100% real, live data, just laid out generically
 * rather than mirroring that dashboard's own on-screen slide titles.
 */
function flattenToSlide(
  title: string,
  obj: Record<string, unknown>,
  opts: { skip?: string[] } = {},
): ExportSlideInput {
  const skip = new Set(opts.skip ?? []);
  const kpis: Array<{ label: string; value: string }> = [];
  const tables: Array<{
    title: string;
    columns: string[];
    rows: Array<Array<string | number>>;
  }> = [];

  const addObject = (prefix: string, o: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(o)) {
      if (skip.has(key)) continue;
      if (Array.isArray(value)) {
        if (
          value.length === 0 ||
          typeof value[0] !== "object" ||
          value[0] === null
        )
          continue;
        const rows = value.slice(0, 500) as Array<Record<string, unknown>>;
        const columns = Object.keys(rows[0]);
        tables.push({
          title: humanize(`${prefix}${key}`),
          columns: columns.map(humanize),
          rows: rows.map((r) =>
            columns.map((c) => {
              const v = r[c];
              if (typeof v === "number") return looksLikePct(c) ? `${v}%` : v;
              return v === null || v === undefined ? "" : String(v);
            }),
          ),
        });
      } else if (value && typeof value === "object") {
        addObject(
          `${prefix}${humanize(key)} — `,
          value as Record<string, unknown>,
        );
      } else {
        const kpi = scalarToKpi(key, value);
        if (kpi)
          kpis.push({ label: `${prefix}${kpi.label}`, value: kpi.value });
      }
    }
  };
  addObject("", obj);
  return { title, kpis: kpis.slice(0, 100), tables: tables.slice(0, 15) };
}

/* ------------------------------ per-company bundles ------------------------------ */

async function bellavitaSaleSlides(
  from: string,
  to: string,
): Promise<ExportSlideInput[]> {
  const d = await getBellavitaSaleDashboard(from, to);
  return [
    {
      title: "Overall Dashboard",
      kpis: [
        { label: "Revenue", value: fmtInr(d.headline.turnover) },
        { label: "Net Sale Amount", value: fmtInr(d.headline.netTurnover) },
        { label: "Sale Count", value: fmtNum(d.headline.saleCount) },
        { label: "Prepaid %", value: fmtPct(d.headline.prepaidPct) },
        { label: "RTO %", value: fmtPct(d.headline.rtoPct) },
        { label: "AOV", value: fmtInr(d.headline.aov) },
        { label: "Active Agents", value: fmtNum(d.headline.activeAgents) },
      ],
      tables: [
        {
          title: "LOB-wise Performance",
          columns: [
            "LOB",
            "Sale Count",
            "Revenue",
            "Target",
            "Achievement %",
            "RTO %",
            "AOV",
          ],
          rows: d.lobRevenue.map((r) => [
            r.lob,
            r.saleCount,
            fmtInr(r.turnover),
            r.target != null ? fmtInr(r.target) : "—",
            r.achievementPct != null ? `${r.achievementPct}%` : "—",
            `${r.rtoPct}%`,
            fmtInr(r.aov),
          ]),
        },
        {
          title: "Top Performers",
          columns: ["Agent", "LOB", "Revenue", "RTO %", "Prepaid %"],
          rows: d.topPerformers.map((p) => [
            p.empName,
            p.lob,
            fmtInr(p.turnover),
            `${p.rtoPct}%`,
            `${p.prepaidPct}%`,
          ]),
        },
        {
          title: "State-wise Revenue (Top 10)",
          columns: ["State", "Sale Count", "Revenue", "RTO Count"],
          rows: d.stateRevenue.map((s) => [
            s.state,
            s.saleCount,
            fmtInr(s.turnover),
            s.rtoCount,
          ]),
        },
      ],
    },
  ];
}

async function bellavitaChatSlides(
  from: string,
  to: string,
): Promise<ExportSlideInput[]> {
  const d = await getBellavitaChatOverview(from, to, "Overall");
  const mtd = d.values.mtd;
  return [
    {
      title: "Chat Performance",
      kpis: [
        { label: "Overall Chat Volume (MTD)", value: fmtNum(mtd.overallChat) },
        { label: "Unique Chat Volume (MTD)", value: fmtNum(mtd.unique) },
        { label: "FRT %", value: fmtPct(mtd.frtPct) },
        {
          label: "Sale Made",
          value: mtd.saleMade !== null ? fmtNum(mtd.saleMade) : "—",
        },
        {
          label: "Revenue",
          value: mtd.revenue !== null ? fmtInr(mtd.revenue) : "—",
        },
        { label: "AOV", value: mtd.aov !== null ? fmtInr(mtd.aov) : "—" },
        {
          label: "Conversion % on Unique",
          value: mtd.convUniquePct !== null ? fmtPct(mtd.convUniquePct) : "—",
        },
      ],
      tables: [
        {
          title: "MTD / Weekly / Date-wise",
          columns: ["Metric", ...d.columns.map((c) => c.label)],
          rows: [
            [
              "Overall Chat Volume",
              ...d.columns.map((c) => d.values[c.key]?.overallChat ?? 0),
            ],
            [
              "Unique Chat Volume",
              ...d.columns.map((c) => d.values[c.key]?.unique ?? 0),
            ],
            [
              "FRT %",
              ...d.columns.map((c) => `${d.values[c.key]?.frtPct ?? 0}%`),
            ],
            [
              "Sale Made",
              ...d.columns.map((c) => d.values[c.key]?.saleMade ?? 0),
            ],
            [
              "Revenue",
              ...d.columns.map((c) => fmtInr(d.values[c.key]?.revenue ?? 0)),
            ],
          ],
        },
      ],
    },
  ];
}

async function bellavitaCartSlides(
  from: string,
  to: string,
): Promise<ExportSlideInput[]> {
  const d = await getBellavitaCartDashboard(from, to);
  return [
    {
      title: "Abandon Cart",
      kpis: [
        { label: "Overall Base Count", value: fmtNum(d.headline.totalCarts) },
        { label: "Cart Value", value: fmtInr(d.headline.cartValue) },
        { label: "Connected %", value: fmtPct(d.headline.connectedPct) },
        {
          label: "Abandon Cart Revenue",
          value: fmtInr(d.headline.abandonCartRevenue),
        },
        { label: "Sale Count", value: fmtNum(d.headline.abandonCartSaleCount) },
        {
          label: "Monthly Target",
          value:
            d.headline.target !== null ? fmtInr(d.headline.target) : "Not set",
        },
        {
          label: "Achievement %",
          value:
            d.headline.achievementPct !== null
              ? fmtPct(d.headline.achievementPct)
              : "—",
        },
        { label: "Active Agents", value: fmtNum(d.headline.activeAgents) },
      ],
      tables: [
        {
          title: "Disposition Breakdown",
          columns: ["Disposition", "Count", "Share"],
          rows: d.dispositionBreakdown.map((r) => [
            r.disposition,
            r.count,
            `${r.pct}%`,
          ]),
        },
        {
          title: "Agent-wise",
          columns: ["Agent", "Cart Count", "Cart Value", "Connected %"],
          rows: d.agents.map((a) => [
            a.agent,
            a.cartCount,
            fmtInr(a.cartValue),
            `${a.connectedPct}%`,
          ]),
        },
      ],
    },
  ];
}

async function gncSaleSlides(
  from: string,
  to: string,
): Promise<ExportSlideInput[]> {
  const d = await getGncSaleDashboard(from, to);
  const abandonDaily = await getGncAbandonCartDaily(from, to);
  const abandonSalesByDate = new Map(d.dateWiseBreakdown.map((r) => [r.date, r.byCampaign["Abandon Cart"]?.totalSaleCount ?? 0]));
  return [{
    title: "GNC Abandon Cart Allocation",
    tables: [{
      title: "GNC-Abandon Cart - Overall Allocation Overview",
      columns: [
        "Date", "Total Allocation", "Workable Case", "Gross Target", "Net Target", "Net Revenue", "Net Achv %",
        "Connected", "Connect%", "Same Day Unique Attempt", "Same Day Connected Count", "Same Day Connected %",
        "NC Connected Count", "NC Connected %", "Conversion %", "Total Allocation", "Workable Case", "Connected", "Connect% (L/I)", "Sale Count",
      ],
      rows: abandonDaily.map((r) => {
        const sale = abandonSalesByDate.get(r.date) ?? 0;
        return [
          r.date, r.total, "—", "—", "—", "—", "—",
          r.connected, fmtPct(pct(r.connected, r.total)),
          r.attempted, r.sameDayConnected, fmtPct(pct(r.sameDayConnected, r.attempted)),
          r.ncConnected, fmtPct(pct(r.ncConnected, r.total)), fmtPct(pct(sale, r.total)),
          r.total, "—", r.connected, fmtPct(pct(r.connected, r.attempted)), sale,
        ];
      }),
    }],
  }, {
    title: "GNC Overall",
    kpis: [
      { label: "Sale Count", value: fmtNum(d.headline.saleCount) },
      { label: "Amount", value: fmtNum(d.headline.turnover) },
      { label: "Prepaid %", value: fmtPct(d.headline.prepaidPct) },
      { label: "COD %", value: fmtPct(d.headline.codPct) },
      { label: "Ach %", value: "—" },
      { label: "Total Allocation", value: fmtNum(d.headline.totalAllocation) },
      { label: "Same Day Connected", value: fmtPct(d.headline.sameDayConnectedPct) },
      { label: "Active", value: fmtNum(d.headline.activeAgents) },
    ],
    tables: [
      {
        title: "COD vs Prepaid (date-wise)",
        columns: ["Date", "Prepaid", "COD", "Total Sales"],
        rows: d.dateWiseTrend.map((r) => [r.date, r.prepaidCount, r.codCount, r.saleCount]),
      },
      {
        title: "LOB (campaign-wise sale count)",
        columns: ["Campaign", "Sale Count"],
        rows: d.campaignRevenue.map((c) => [c.campaign, c.saleCount]),
      },
      {
        title: "Revenue top 10 agents",
        columns: ["Agent", "Revenue"],
        rows: [...d.topPerformers].sort((a, b) => b.turnover - a.turnover).slice(0, 10).map((p) => [p.empName, fmtInr(p.turnover)]),
      },
      {
        title: "Allocation funnel",
        columns: ["Stage", "Count", "% of base"],
        rows: d.funnel.map((f) => [f.stage, f.count, `${f.pctOfBase}%`]),
      },
    ],
  }, {
    title: "Date Wise Performance",
    tables: [{
      title: "Date Wise Performance",
      columns: [
        "Date",
        ...d.campaigns.flatMap((c) => [`${c} COD Sale`, `${c} COD Top line`, `${c} Paid Sale`, `${c} Paid Top line`, `${c} Grand Total Sale`, `${c} Grand Total Top line`]),
        "RTD & RTO Sale", "RTD & RTO Top line", "Net Sale", "Net Sale Amount",
      ],
      rows: d.dateWiseBreakdown.map((r) => [
        r.date,
        ...d.campaigns.flatMap((c) => {
          const b = r.byCampaign[c];
          return [b?.codSaleCount ?? 0, b?.codAmount ?? 0, b?.paidSaleCount ?? 0, b?.paidAmount ?? 0, b?.totalSaleCount ?? 0, b?.totalAmount ?? 0];
        }),
        "—", "—", "—", "—",
      ]),
    }],
  }, {
    title: "Sale Performance",
    kpis: [
      { label: "Turn Over", value: fmtInr(d.headline.turnover) },
      { label: "Sale Count", value: fmtNum(d.headline.saleCount) },
      { label: "Prepaid %", value: fmtPct(d.headline.prepaidPct) },
      { label: "AOV", value: fmtInr(d.headline.aov) },
      { label: "Active Agents", value: fmtNum(d.headline.activeAgents) },
    ],
    tables: [
      { title: "Campaign-wise Performance", columns: ["Campaign", "Sale Count", "Revenue", "Prepaid %"], rows: d.campaignRevenue.map((c) => [c.campaign, c.saleCount, fmtInr(c.turnover), `${c.paidPct}%`]) },
      { title: "Top Performers", columns: ["Agent", "Campaign", "Revenue"], rows: d.topPerformers.map((p) => [p.empName, p.campaign, fmtInr(p.turnover)]) },
    ],
  }];
}

async function gncChatSlides(
  from: string,
  to: string,
): Promise<ExportSlideInput[]> {
  const d = await getGncChatDashboard(from, to);
  return [
    {
      title: "Chat Performance",
      kpis: [
        { label: "Total Chats", value: fmtNum(d.headline.totalChats) },
        { label: "Unique Chats", value: fmtNum(d.headline.uniqueChats) },
        { label: "FRT In-TAT %", value: fmtPct(d.headline.frtInTatPct) },
        {
          label: "Resolution In-TAT %",
          value: fmtPct(d.headline.resolutionInTatPct),
        },
        { label: "Orders", value: fmtNum(d.headline.orders) },
        { label: "Conversion %", value: fmtPct(d.headline.conversionPct) },
        { label: "Gross Revenue", value: fmtInr(d.headline.grossRevenue) },
        { label: "Net Revenue", value: fmtInr(d.headline.netRevenue) },
        { label: "Avg CSAT", value: String(d.headline.avgCsat) },
      ],
      tables: [
        {
          title: "Date-wise",
          columns: [
            "Date",
            "Total Chats",
            "Unique Chats",
            "FRT In-TAT %",
            "Orders",
            "Revenue",
          ],
          rows: d.dateWiseTrend.map((r) => [
            r.date,
            r.totalChats,
            r.uniqueChats,
            `${r.frtInTatPct}%`,
            r.orders,
            fmtInr(r.revenue),
          ]),
        },
      ],
    },
  ];
}

async function neemansSlides(
  from: string,
  to: string,
): Promise<ExportSlideInput[]> {
  const d = await getNeemansPerformanceDashboard(from, to);
  return [
    {
      title: "Sale, Allocation & Productivity",
      kpis: [
        { label: "Revenue", value: fmtInr(d.sale.headline.revenue) },
        { label: "Sale Count", value: fmtNum(d.sale.headline.saleCount) },
        { label: "Prepaid %", value: fmtPct(d.sale.headline.prepaidPct) },
        { label: "RTO %", value: fmtPct(d.sale.headline.rtoPct) },
        {
          label: "Total Allocation",
          value: fmtNum(d.allocation.headline.totalAllocation),
        },
        {
          label: "Connected %",
          value: fmtPct(d.allocation.headline.connectedPct),
        },
        {
          label: "Overall Conversion % (Sale / Allocation)",
          value: fmtPct(d.overview.conversionPct),
        },
      ],
      tables: [
        {
          title: "TL-wise Sale",
          columns: ["TL", "Sale Count", "Revenue", "Achievement %"],
          rows: d.sale.byTl.map((t) => [
            t.tlName,
            t.saleCount,
            fmtInr(t.revenue),
            `${t.achievementPct}%`,
          ]),
        },
      ],
    },
  ];
}

// Neemans has no standalone chat-dashboard service -- Chat is one section
// (`.chat`) of the combined Sale/Allocation/Chat performance dashboard.
async function neemansChatSlides(
  from: string,
  to: string,
): Promise<ExportSlideInput[]> {
  const d = (await getNeemansPerformanceDashboard(from, to)).chat;
  return [
    {
      title: "Chat Performance",
      kpis: [
        { label: "Total Tickets", value: fmtNum(d.headline.totalTickets) },
        { label: "Resolved %", value: fmtPct(d.headline.resolvedPct) },
        { label: "Avg FRT (hrs)", value: String(d.headline.avgFrtHrs) },
        {
          label: "Avg Resolution (hrs)",
          value: String(d.headline.avgResolutionHrs),
        },
        { label: "Avg CSAT", value: String(d.headline.avgCsat) },
        {
          label: "FRT TAT Compliance %",
          value: fmtPct(d.headline.frtTatCompliancePct),
        },
        {
          label: "Resolution TAT Compliance %",
          value: fmtPct(d.headline.resolutionTatCompliancePct),
        },
      ],
      tables: [
        {
          title: "LOB-wise",
          columns: ["LOB", "Tickets", "Resolved %"],
          rows: d.byLob.map((r) => [r.lob, r.tickets, `${r.resolvedPct}%`]),
        },
        {
          title: "Channel-wise",
          columns: ["Channel", "Tickets", "Resolved %"],
          rows: d.channelBreakdown.map((r) => [
            r.channel,
            r.tickets,
            `${r.resolvedPct}%`,
          ]),
        },
        {
          title: "Agent-wise",
          columns: ["Agent", "Tickets", "Resolved %", "Avg CSAT"],
          rows: d.agents.map((a) => [
            a.agent,
            a.tickets,
            `${a.resolvedPct}%`,
            a.avgCsat,
          ]),
        },
      ],
    },
  ];
}

async function neemansCartSlides(
  from: string,
  to: string,
): Promise<ExportSlideInput[]> {
  // skipRecords: true -- the individual cart records this dashboard can list are
  // the same rows the neemans_cart raw sheet already attaches in full below.
  const d = await getNeemansCartDashboard(from, to, { skipRecords: true });
  return [
    flattenToSlide("Abandon Cart", d as unknown as Record<string, unknown>, {
      skip: ["from", "to", "records", "recordsTotal", "recordsTruncated"],
    }),
  ];
}

interface OwnerColVals {
  totalCalls: number;
  connected: number;
  notConnected: number;
  connectedPct: number;
  saleCount: number;
  revenue: number;
  target: number;
  achPct: number;
  aov: number;
}
const OWNER_KPI_ROWS: Array<{
  label: string;
  get: (v: OwnerColVals) => string | number;
}> = [
  { label: "Total Calls", get: (v) => v.totalCalls },
  { label: "Connected Calls", get: (v) => v.connected },
  { label: "Not Connected Calls", get: (v) => v.notConnected },
  { label: "Connected %", get: (v) => `${v.connectedPct}%` },
  { label: "Sale Count", get: (v) => v.saleCount },
  { label: "Revenue", get: (v) => fmtInr(v.revenue) },
  { label: "Target", get: (v) => (v.target > 0 ? fmtInr(v.target) : "—") },
  { label: "Achievement %", get: (v) => (v.target > 0 ? `${v.achPct}%` : "—") },
  { label: "AOV", get: (v) => (v.saleCount > 0 ? fmtInr(v.aov) : "—") },
];

/** "3-May-22" -- same DOJ display format the reference MIS workbook uses. Handles both a JS Date
 * (what mysql2 hands back for a real DATE column) and an ISO string (the manual-agent path). */
function fmtDoj(doj: unknown): string {
  if (!doj) return "—";
  const d = doj instanceof Date ? doj : new Date(String(doj));
  if (Number.isNaN(d.getTime())) return String(doj);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getDate()}-${MONTHS[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`;
}
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ownerGroupRows(rows: HousingOwnerGroupRow[], firstColLabel: string): { title: string; columns: string[]; rows: Array<Array<string | number>> } {
  return {
    title: `${firstColLabel}-wise Performance Metrics`,
    columns: [firstColLabel, "Agents", "Total Calls", "Connected %", "Sale Count", "Revenue", "Target", "Achievement %", "RPA", "TQ", "MQ", "BQ"],
    rows: rows.map((r) => [
      r.name, r.agentCount, r.totalCalls, fmtPct(r.connectedPct), r.saleCount, fmtInr(r.revenue),
      r.target > 0 ? fmtInr(r.target) : "—", r.target > 0 ? fmtPct(r.achievementPct) : "—", r.agentCount > 0 ? fmtInr(r.rpa) : "—",
      r.tqCount, r.mqCount, r.bqCount,
    ]),
  };
}

async function housingOwnerSlides(from: string, to: string): Promise<ExportSlideInput[]> {
  const d = await getHousingOwnerDashboard(from, to);

  // getHousingOwnerDashboard has no day/week/MTD column grid of its own (unlike Housing Premium's
  // Overview endpoint) -- built here from its own dailyTrend + roster target total, using the same
  // MTD/Week/Day columns and fair-share-of-the-month target proration every other process's KPI
  // Summary sheet below uses, so all these MIS files read the same way.
  const columns = buildPeriodColumns(from, to);
  const byDate = new Map(d.dailyTrend.map((r) => [r.date, r]));
  const overall: Record<string, OwnerColVals> = {};
  for (const col of columns) {
    const span = eachDay(col.from, col.to);
    let revenue = 0,
      saleCount = 0,
      totalCalls = 0,
      connected = 0;
    for (const day of span) {
      const r = byDate.get(day);
      if (r) {
        revenue += r.revenue;
        saleCount += r.saleCount;
        totalCalls += r.totalCalls;
        connected += r.connectedCalls;
      }
    }
    const target =
      col.kind === "mtd" && col.from.endsWith("-01")
        ? Math.round(d.headline.totalTarget)
        : proratedTarget(d.headline.totalTarget, col.from, col.to);
    const notConnected = totalCalls - connected;
    overall[col.key] = {
      totalCalls,
      connected,
      notConnected,
      connectedPct: pct(connected, totalCalls),
      saleCount,
      revenue: round2(revenue),
      target,
      achPct: pct(revenue, target),
      aov: saleCount > 0 ? Math.round(revenue / saleCount) : 0,
    };
  }

  // One matrix per AM and per TL (same MTD / Week / Day layout as the Overall matrix), each built
  // from that entity's own day-wise trend so its numbers reconcile with its drill-down.
  const ownerEntityTables = async (type: "am" | "tl", names: string[]) => {
    const tables: ReturnType<typeof kpiMatrixTable>[] = [];
    for (const name of names) {
      const t = await getHousingOwnerEntityTrend(from, to, type, name);
      const trendByDate = new Map(t.dailyTrend.map((r) => [r.date, r]));
      const values: Record<string, OwnerColVals> = {};
      for (const col of columns) {
        const span = eachDay(col.from, col.to);
        let revenue = 0, saleCount = 0, totalCalls = 0, connected = 0;
        for (const day of span) {
          const r = trendByDate.get(day);
          if (r) { revenue += r.revenue; saleCount += r.saleCount; totalCalls += r.totalCalls; connected += r.connectedCalls; }
        }
        const target = col.kind === "mtd" && col.from.endsWith("-01")
          ? Math.round(t.target)
          : proratedTarget(t.target, col.from, col.to);
        const notConnected = totalCalls - connected;
        values[col.key] = {
          totalCalls, connected, notConnected, connectedPct: pct(connected, totalCalls),
          saleCount, revenue: round2(revenue), target, achPct: pct(revenue, target), aov: saleCount > 0 ? Math.round(revenue / saleCount) : 0,
        };
      }
      tables.push(kpiMatrixTable(name, columns, values, OWNER_KPI_ROWS));
    }
    return tables;
  };
  const amTables = await ownerEntityTables("am", d.byAm.map((g) => g.name));
  const tlTables = await ownerEntityTables("tl", d.byTl.map((g) => g.name));

  // Page 2: Date Wise Performance -- one row per calendar day (not the pivoted MTD/Week/Day
  // matrix above), each day's own fair-share target from the same proration the matrix uses.
  const dateWiseTable = {
    title: "Date Wise Performance",
    columns: ["Day", "Date", "Target", "Total Calls", "Connected Calls", "Not Connected Call", "Cont%", "Talk time", "Sale Count", "Revenue", "Achi%", "AOV", "Present Count", "Avg Sale per Agent"],
    rows: d.dailyTrend.map((r) => {
      const target = Math.round(proratedTarget(d.headline.totalTarget, r.date, r.date));
      const achPct = target > 0 ? pct(r.revenue, target) : 0;
      const aov = r.saleCount > 0 ? Math.round(r.revenue / r.saleCount) : 0;
      const avgSalePerAgent = r.presentCount > 0 ? round2(r.saleCount / r.presentCount) : 0;
      const dow = WEEKDAYS[new Date(`${r.date}T00:00:00`).getDay()];
      return [
        dow, r.date, target > 0 ? target : "—", r.totalCalls, r.connectedCalls, r.notConnectedCalls, fmtPct(pct(r.connectedCalls, r.totalCalls)),
        fmtHms(r.avgTalkTimeSec), r.saleCount, fmtInr(r.revenue), target > 0 ? fmtPct(achPct) : "—", r.saleCount > 0 ? fmtInr(aov) : "—",
        r.presentCount, avgSalePerAgent,
      ];
    }),
  };

  // Page 3: Agent Wise Performance -- agents are already sorted by revenue descending
  // (getHousingOwnerDashboard's own sort), so index+1 is a real rank, not a re-derived one.
  const totalAgentRevenue = d.agents.reduce((s, a) => s + a.revenue, 0);
  const agentWiseTable = {
    title: "Agent Wise Performance",
    columns: [
      "Overall", "TL Name", "AM", "DOJ", "Tenure", "Bucket", "Status", "Target", "MTD Reported", "Total Calls", "Connected Calls",
      "Not Connected Call", "Cont%", "Avg. Talk time", "Sale Count", "Revenue", "Achi%", "Stage", "Present Count", "Rank", "Cov%",
    ],
    rows: d.agents.map((a, i) => [
      a.name, a.tlName, a.am, fmtDoj(a.doj), a.tenureDays ?? "—", a.bucket ?? "—", a.status,
      a.target > 0 ? fmtInr(a.target) : "—", fmtInr(a.mtdReported), a.totalCalls, a.connectedCalls, a.notConnectedCalls,
      fmtPct(a.connectedPct), fmtHms(a.avgTalkTimeSec), a.saleCount, fmtInr(a.revenue), a.target > 0 ? fmtPct(a.achievementPct) : "—",
      a.stage, a.presentCount, i + 1, totalAgentRevenue > 0 ? fmtPct(pct(a.revenue, totalAgentRevenue)) : "—",
    ]),
  };
  const tqMqBqTable = {
    title: "TQ MQ BQ Summary",
    columns: ["Stage", "Agent Count", "Total Revenue", "Avg Achievement %"],
    rows: (["TQ", "MQ", "BQ", "NA"] as const).map((stage) => {
      const inStage = d.agents.filter((a) => a.stage === stage);
      const targeted = inStage.filter((a) => a.target > 0);
      const avgAch = targeted.length > 0 ? Math.round(targeted.reduce((s, a) => s + a.achievementPct, 0) / targeted.length) : 0;
      return [stage === "NA" ? "No Target" : stage, inStage.length, fmtInr(inStage.reduce((s, a) => s + a.revenue, 0)), targeted.length > 0 ? `${avgAch}%` : "—"];
    }),
  };

  return [
    {
      title: "Performance Summary",
      kpis: [
        { label: "Revenue", value: fmtInr(d.headline.totalRevenue) },
        { label: "Sale Count", value: fmtNum(d.headline.totalSaleCount) },
        { label: "AOV", value: fmtInr(d.headline.aov) },
        { label: "Connected %", value: fmtPct(d.headline.connectedPct) },
        { label: "Achievement %", value: fmtPct(d.headline.achievementPct) },
        { label: "Active Agents", value: fmtNum(d.headline.activeAgents) },
      ],
      tables: [
        kpiMatrixTable("Overall Performance Metrics", columns, overall, OWNER_KPI_ROWS),
        ownerGroupRows(d.byAm, "AM"),
        ownerGroupRows(d.byTl, "TL"),
      ],
    },
    { title: "AM Wise Performance", tables: amTables },
    { title: "TL wise Performance", tables: tlTables },
    { title: "Date Wise Performance", tables: [dateWiseTable] },
    { title: "Agent Wise Performance", tables: [agentWiseTable, tqMqBqTable] },
  ];
}

const PREMIUM_KPI_ROWS: Array<{
  label: string;
  get: (v: OverviewValues) => string | number;
}> = [
  { label: "Total Calls", get: (v) => v.totalCalls },
  { label: "Connected Calls", get: (v) => v.connected },
  { label: "Not Connected Calls", get: (v) => v.notConnected },
  { label: "Unique Connected", get: (v) => v.uniqueConnected },
  { label: "Connected %", get: (v) => `${v.connectedPct}%` },
  { label: "Sale Count", get: (v) => v.saleCount },
  { label: "Revenue", get: (v) => fmtInr(v.revenue) },
  { label: "Target", get: (v) => (v.target > 0 ? fmtInr(v.target) : "—") },
  {
    label: "Achievement %",
    get: (v) => (v.target > 0 ? `${v.achievedPct}%` : "—"),
  },
  { label: "AOV", get: (v) => (v.saleCount > 0 ? fmtInr(v.aov) : "—") },
  { label: "Present Count", get: (v) => v.presentCount },
  { label: "Per Agent Dial Count", get: (v) => v.perAgentDialCount },
  { label: "Avg Sale per Agent", get: (v) => v.avgSalePerAgent },
  { label: "Avg Talk Time / Agent", get: (v) => fmtHms(v.avgTalkPerAgentSec) },
];

async function housingPremiumSlides(from: string, to: string): Promise<ExportSlideInput[]> {
  // fullCdr=true: an MIS export must show real CDR-derived figures (Connected, Not Connected,
  // Present Count, etc.) for the WHOLE requested range, not just the live dashboard's
  // 5-day-clamped window -- see getHousingPremiumOverview's own doc for why that clamp exists
  // and why it must not reach this path.
  const d = await getHousingPremiumOverview(from, to, undefined, true);
  const dayWise = await getHousingPremiumDayWise(from, to);
  const agentWise = await getHousingPremiumAgentWise(from, to);
  const slotWise = await getHousingPremiumSlotWise(from, to);
  const mtdKey = d.columns.find((c) => c.kind === "mtd")?.key ?? d.columns[0]?.key;
  const mtd = mtdKey ? d.overall[mtdKey] : undefined;
  return [{
    title: "Overview",
    kpis: mtd ? [
      { label: "Total Calls (MTD)", value: fmtNum(mtd.totalCalls) },
      { label: "Connected %", value: fmtPct(mtd.connectedPct) },
      { label: "Revenue", value: fmtInr(mtd.revenue) },
      { label: "Sale Count", value: fmtNum(mtd.saleCount) },
      { label: "Target", value: fmtInr(mtd.target) },
      { label: "Achievement %", value: fmtPct(mtd.achievedPct) },
      { label: "AOV", value: fmtInr(mtd.aov) },
    ] : [],
    tables: [
      // Housing Premium's own Overview endpoint already computes this same MTD/Week/Day column grid
      // (buildOverviewColumns / rollUpOverview), so this reuses its real per-column figures rather
      // than re-deriving them -- week-wise and date-wise sit in the same sheet as the MTD total here.
      kpiMatrixTable("KPI Summary (MTD, Weekly & Daily)", d.columns, d.overall, PREMIUM_KPI_ROWS),
      {
        title: "TL-wise (MTD)",
        columns: ["TL", "Agents", "Calls", "Connected %", "Revenue", "Achievement %"],
        rows: d.byTl.map((t) => {
          const v = mtdKey ? t.values[mtdKey] : undefined;
          return [t.tlName, t.agentCount, v?.totalCalls ?? 0, v ? `${v.connectedPct}%` : "—", v ? fmtInr(v.revenue) : "—", v ? `${v.achievedPct}%` : "—"];
        }),
      },
    ],
  }, {
    title: "TL wise Performance",
    tables: d.byTl.map((t) => kpiMatrixTable(t.tlName, d.columns, t.values, PREMIUM_KPI_ROWS)),
  }, {
    title: "Date Wise Performance",
    tables: [{
      title: "Date Wise Performance",
      columns: ["Day", "Date", "Bucket", "Target", "Total Calls", "Unique Connected", "Connected Calls", "Not Connected Call", "Cont%", "Avg. Talk time", "Sale Count", "Revenue", "AOV", "Present Count", "Avg Sale per Agent"],
      rows: dayWise.days.map((r) => [
        r.dayName, r.date, "-", r.target, r.totalCalls, r.uniqueConnected, r.connected, r.notConnected, `${r.connectedPct}%`,
        fmtHms(r.avgTalkTimeSec), r.saleCount, r.revenue, r.aov, r.presentCount, r.avgSalePerAgent,
      ]),
    }],
  }, {
    title: "Agent Wise Performance",
    tables: [{
      title: "Agent Wise Performance",
      columns: ["Emp ID", "Overall", "CRM ID", "TL Name", "DOJ", "Tenure", "Bucket", "Status", "Target", "Total Calls", "Total Unique Calls", "Connected Calls", "Not Connected Call", "Cont%", "Avg. Talk time", "Sale Count", "Revenue", "Present Count", "Avg Sale per day"],
      rows: agentWise.agents.map((a) => [
        a.empId, a.name, a.name, a.tlName, a.doj ?? "—", a.tenureDays ?? "—", a.bucket, a.status, a.target, a.totalCalls, a.uniqueCalls,
        a.connected, a.notConnected, `${a.connectedPct}%`, fmtHms(a.avgTalkTimeSec), a.saleCount, a.revenue, a.presentCount, a.avgSalePerDay,
      ]),
    }],
  }, {
    title: "Slot Wise Performance",
    kpis: [{ label: "Note", value: "Target, Sale Count, Revenue, AOV and Achi% by hour are not captured in the uploaded data -- shown as —." }],
    tables: [{
      title: "Slot Wise Performance",
      columns: ["SLOT", "Bucket", "Target", "Total Calls", "Connected Calls", "Not Connected Call", "Cont%", "Avg. Talk time", "Sale Count", "Revenue", "AOV", "Achi%"],
      rows: [
        ...slotWise.slots.filter((s) => s.totalCalls > 0).map((s) => [
          s.hour, "-", "—", s.totalCalls, s.connected, s.notConnected, `${s.connectedPct}%`, fmtHms(s.avgTalkTimeSec), "—", "—", "—", "—",
        ]),
        [
          "Total", "-", "—", slotWise.slots.reduce((s, x) => s + x.totalCalls, 0), slotWise.slots.reduce((s, x) => s + x.connected, 0),
          slotWise.slots.reduce((s, x) => s + x.notConnected, 0), "—", "—", "—", "—", "—", "—",
        ],
      ],
    }],
  }];
}

async function duDigitalSlides(label: DuDashboardLabel, from: string, to: string): Promise<ExportSlideInput[]> {
  const d = await getDuDigitalDashboard(label, from, to);
  const k = d.kpis;
  return [
    {
      title: "Overview",
      kpis: [
        { label: "Offered", value: fmtNum(k.offered) },
        { label: "Answered", value: fmtNum(k.answered) },
        { label: "Abandoned", value: fmtNum(k.abandoned) },
        { label: "SL %", value: `${k.slPct}%` },
        { label: "AL %", value: `${k.alPct}%` },
        { label: "Abandon %", value: `${k.abandonPct}%` },
        { label: "AHT", value: k.aht },
        { label: "Agents", value: fmtNum(k.agentCount) },
      ],
      tables: [{
        title: "Date Wise Performance",
        columns: ["Date", "Offered", "Answered", "Answered within 20s", "Abandoned", "SL %", "AL %", "Abandon %", "AHT", "Agents"],
        rows: d.daily.map((r) => [r.date, r.offered, r.answered, r.answeredWithin20, r.abandoned, `${r.slPct}%`, `${r.alPct}%`, `${r.abandonPct}%`, fmtHms(r.ahtSec), r.agentCount]),
      }],
    },
    {
      title: "Agent Wise Performance",
      tables: [{
        title: "Agent Wise Performance",
        columns: ["Agent", "Offered", "Answered", "Abandoned", "AL %", "Calls", "Login", "Talk"],
        rows: d.agents.map((a) => [a.agent, a.offered, a.answered, a.abandoned, `${a.alPct}%`, a.calls, a.login, a.talk]),
      }],
    },
    {
      title: "Slot Wise Performance",
      tables: [{
        title: "Slot Wise Performance",
        columns: ["Date", "Slot", "Offered", "Answered", "Answered within 20s", "Abandoned", "SL %", "AL %", "AHT"],
        rows: d.slots.map((s) => [s.date, s.hour, s.offered, s.answered, s.answeredWithin20, s.abandoned, `${s.slPct}%`, `${s.alPct}%`, fmtHms(s.ahtSec)]),
      }],
    },
  ];
}

async function cloviaSlides(from: string, to: string): Promise<ExportSlideInput[]> {
  const d = await getCloviaChannelsDashboard(from, to);
  return [
    flattenToSlide("Email", d.email as unknown as Record<string, unknown>),
    flattenToSlide("Chat", d.chat as unknown as Record<string, unknown>),
    flattenToSlide(
      "Outbound",
      d.outbound as unknown as Record<string, unknown>,
    ),
    flattenToSlide("Feedback & Quality", {
      feedback: d.feedback,
      quality: d.quality,
    } as unknown as Record<string, unknown>),
    flattenToSlide(
      "Productivity",
      d.productivity as unknown as Record<string, unknown>,
    ),
  ];
}

async function birlanuSlides(): Promise<ExportSlideInput[]> {
  const d = await getBirlanuDashboard();
  return [
    {
      title: "Lead-to-Sale Funnel",
      tables: [
        {
          title: "Monthly Funnel",
          columns: [
            "Month",
            "Enquiries",
            "Connected",
            "Validated",
            "Qualified",
            "Converted",
            "Volume (MT)",
            "Value",
          ],
          rows: d.monthlyFunnel.map((r) => [
            r.month,
            r.enquiriesReceived,
            r.connected,
            r.validated,
            r.qualified,
            r.converted,
            r.volMt,
            fmtInr(r.valueInr),
          ]),
        },
      ],
    },
  ];
}

async function lpFeedbackSlides(
  from: string,
  to: string,
): Promise<ExportSlideInput[]> {
  const d = await getLpFeedbackDashboard(from, to);
  return [
    flattenToSlide(
      "Feedback Call Performance",
      d as unknown as Record<string, unknown>,
      { skip: ["from", "to", "columns"] },
    ),
  ];
}
async function lpOnboardingSlides(
  from: string,
  to: string,
): Promise<ExportSlideInput[]> {
  const d = await getLpOnboardingDashboard(from, to);
  return [
    flattenToSlide(
      "Onboarding Call Performance",
      d as unknown as Record<string, unknown>,
      { skip: ["from", "to", "columns"] },
    ),
  ];
}

async function satyaSlides(): Promise<ExportSlideInput[]> {
  const d = await getSatyaRetailDashboard();
  return [
    {
      title: "Beat & Call Performance",
      kpis: [
        {
          label: "Total Allocation",
          value: fmtNum(d.headline.totalAllocation),
        },
        {
          label: "Allocation Connected %",
          value: fmtPct(d.headline.allocationConnectedPct),
        },
        { label: "Active Agents", value: fmtNum(d.headline.activeAgents) },
      ],
      tables: [
        {
          title: "Warehouse-wise",
          columns: ["Warehouse", "Allocation", "Connected %"],
          rows: d.byWarehouse.map((w) => [
            w.warehouse,
            w.allocation,
            `${w.connectedPct}%`,
          ]),
        },
      ],
    },
  ];
}

// AwDashboard types billing/inbound/dialer/sales/agents/health/overview as `unknown`
// (the service builds them as untyped grid/matrix payloads) -- flattened generically
// rather than guessing field names that could silently mismatch the real shape.
async function appreciateWealthSlides(
  from: string,
  to: string,
): Promise<ExportSlideInput[]> {
  const d = await getAppreciateWealthDashboard(from, to, parseAwFilters({}));
  return [
    flattenToSlide("Overview", d.overview as Record<string, unknown>),
    flattenToSlide("Billing & Sales", {
      billing: d.billing,
      sales: d.sales,
    } as Record<string, unknown>),
    flattenToSlide("Inbound & Dialer", {
      inbound: d.inbound,
      dialer: d.dialer,
    } as Record<string, unknown>),
    flattenToSlide("Agents & Health", {
      agents: d.agents,
      health: d.health,
    } as Record<string, unknown>),
  ];
}

async function inboundSlides(
  projectKey: string,
): Promise<(from: string, to: string) => Promise<ExportSlideInput[]>> {
  return async (from: string, to: string) => {
    const d = await getInboundInsights(projectKey, {
      startDate: from,
      endDate: to,
    });
    return [
      {
        title: "Inbound",
        kpis: [
          { label: "Offered", value: fmtNum(d.headline.offered) },
          { label: "Answered", value: fmtNum(d.headline.answered) },
          { label: "Answered %", value: fmtPct(d.headline.answeredPct) },
          { label: "AL %", value: fmtPct(d.headline.abandonPct) },
          {
            label: `Service Level (${d.headline.slThresholdSec}s, of answered)`,
            value: fmtPct(d.headline.slPct),
          },
          { label: "AHT", value: `${d.headline.aht}s` },
          { label: "Unique Callers", value: fmtNum(d.headline.uniqueCallers) },
          { label: "Agents Active", value: fmtNum(d.headline.agentsActive) },
        ],
        tables: [
          {
            title: "Date-wise",
            columns: ["Date", "Offered", "Answered", "AL %", "SL %", "AHT"],
            rows: d.daily.map((r) => [
              r.date,
              r.offered,
              r.answered,
              `${r.abandonPct}%`,
              `${r.slPct}%`,
              `${r.aht}s`,
            ]),
          },
          {
            title: "Agent-wise",
            columns: ["Agent", "Handled", "SL %", "AHT"],
            rows: d.agents.map((a) => [
              a.agentName,
              a.handled,
              `${a.slWithinPct}%`,
              `${a.aht}s`,
            ]),
          },
        ],
      },
    ];
  };
}

/* --------------------------------- registry --------------------------------- */

/** Company key -> the dashboards bundled into its MIS, in display order.
 * Every `dashboardKey` here must already exist in dashboard-export.registry.ts's
 * RAW_SOURCES (checked at request time), so the raw sheets this produces are
 * the exact same ones that dashboard's own "Download Excel" button attaches. */
async function buildRegistry(): Promise<Record<string, MisBundleEntry[]>> {
  const registry: Record<string, MisBundleEntry[]> = {
    bellavita: [
      {
        dashboardKey: "bellavita_sale",
        title: "Overall Dashboard",
        build: bellavitaSaleSlides,
      },
      {
        dashboardKey: "bellavita_chat_overview",
        title: "Chat Performance",
        build: bellavitaChatSlides,
      },
      {
        dashboardKey: "bellavita_cart",
        title: "Abandon Cart",
        build: bellavitaCartSlides,
      },
    ],
    gnc: [
      {
        dashboardKey: "gnc_sale",
        title: "Sale Performance",
        build: gncSaleSlides,
      },
      {
        dashboardKey: "gnc_chat",
        title: "Chat Performance",
        build: gncChatSlides,
      },
    ],
    neemans: [
      {
        dashboardKey: "neemans_performance",
        title: "Sale, Allocation & Productivity",
        build: neemansSlides,
      },
      {
        dashboardKey: "neemans_chat",
        title: "Chat Performance",
        build: neemansChatSlides,
      },
      {
        dashboardKey: "neemans_cart",
        title: "Abandon Cart",
        build: neemansCartSlides,
      },
    ],
    housing_owner: [
      {
        dashboardKey: "housing_owner",
        title: "Overview",
        build: housingOwnerSlides,
      },
    ],
    housing_premium: [
      {
        dashboardKey: "housing_premium",
        title: "Overview",
        build: housingPremiumSlides,
      },
    ],
    du_thailand: [
      { dashboardKey: "du_thailand", title: "DU Digital Thailand", build: (f, t) => duDigitalSlides("THAILAND", f, t) },
    ],
    du_korea: [
      { dashboardKey: "du_korea", title: "DU Digital Korea", build: (f, t) => duDigitalSlides("KOREA", f, t) },
    ],
    clovia: [
      { dashboardKey: "clovia", title: "Channels", build: cloviaSlides },
    ],
    birlanu: [
      {
        dashboardKey: "birlanu",
        title: "Lead-to-Sale Funnel",
        build: birlanuSlides,
      },
    ],
    lp_feedback: [
      {
        dashboardKey: "lp_feedback",
        title: "Feedback Call Performance",
        build: lpFeedbackSlides,
      },
    ],
    lp_onboarding: [
      {
        dashboardKey: "lp_onboarding",
        title: "Onboarding Call Performance",
        build: lpOnboardingSlides,
      },
    ],
    satya_retail: [
      {
        dashboardKey: "satya_retail",
        title: "Beat & Call Performance",
        build: satyaSlides,
      },
    ],
    appreciate_health: [
      {
        dashboardKey: "appreciate_wealth",
        title: "Overview",
        build: appreciateWealthSlides,
      },
    ],
  };

  // Inbound is a shared component across several companies -- append it to
  // each company's bundle that actually has a live inbound project, reusing
  // the exact inbound_<key> RAW_SOURCES entries already registered.
  const inboundCompanies: Array<{ key: string; dashboardKey: string }> = [
    { key: "gnc", dashboardKey: "inbound_gnc" },
    { key: "bellavita", dashboardKey: "inbound_bellavita" },
    { key: "clovia", dashboardKey: "inbound_clovia" },
    { key: "neemans", dashboardKey: "inbound_neemans" },
    { key: "dalmia", dashboardKey: "inbound_dalmia" },
    { key: "dubangladesh", dashboardKey: "inbound_dubangladesh" },
    { key: "viega", dashboardKey: "inbound_viega" },
    { key: "exicom", dashboardKey: "inbound_exicom" },
  ];
  for (const { key, dashboardKey } of inboundCompanies) {
    const projectKey = dashboardKey.replace("inbound_", "");
    if (!isInsightProject(projectKey)) continue;
    const build = await inboundSlides(projectKey);
    registry[key] = [
      ...(registry[key] ?? []),
      { dashboardKey, title: "Inbound", build },
    ];
  }
  for (const key of ["dalmia", "dubangladesh", "viega", "exicom"]) {
    if (!registry[key]) registry[key] = [];
  }

  return registry;
}

export async function getMisCompanies(): Promise<
  Record<string, { title: string }[]>
> {
  const registry = await buildRegistry();
  const out: Record<string, { title: string }[]> = {};
  for (const [key, entries] of Object.entries(registry))
    out[key] = entries.map((e) => ({ title: e.title }));
  return out;
}

export interface MisBuildResult {
  raw: RawSheetResult[];
  sections: string[];
  skipped: string[];
}

export async function buildMisExcel(
  companyKey: string,
  companyLabel: string,
  fromInput: string,
  toInput: string,
  filePath: string,
): Promise<MisBuildResult> {
  // Satya Retail's MIS is the ops team's workbook layout (Dashboard, Snap, AGENT-WISE,
  // DD Raw, Alloction), built from the same report data as the dashboard -- see
  // satya-retail-mis-workbook.service.ts. Every other company keeps the slide bundle below.
  if (companyKey === "satya_retail") {
    return buildSatyaMisWorkbook(filePath, normalizeFilters({ from: fromInput, to: toInput }));
  }
  // LP Feedback / LP Onboarding MIS mirror their own workbooks' visible sheets -- see lp-mis-workbook.service.ts.
  if (companyKey === "lp_feedback" || companyKey === "lp_onboarding") {
    return buildLpMisWorkbook(companyKey, fromInput, toInput, filePath);
  }

  const registry = await buildRegistry();
  const entries = registry[companyKey];
  if (!entries || entries.length === 0)
    throw new Error(`No MIS bundle is configured for "${companyKey}" yet.`);

  const wb = newWorkbookWriter(filePath);
  const used = new Set<string>();
  const allRaw: RawSheetResult[] = [];
  const sections: string[] = [];
  const skipped: string[] = [];
  const deadline = Date.now() + 90_000; // MIS spans several dashboards, so a longer budget than a single-dashboard export
  for (const entry of entries) {
    if (!isKnownDashboard(entry.dashboardKey)) {
      skipped.push(
        `${entry.title}: no raw-source registry entry for "${entry.dashboardKey}"`,
      );
      continue;
    }
    let slides: ExportSlideInput[];
    try {
      slides = await entry.build(fromInput, toInput);
    } catch (err) {
      skipped.push(
        `${entry.title}: ${err instanceof Error ? err.message : String(err)}`.slice(
          0,
          300,
        ),
      );
      continue;
    }
    const req: DashboardExcelRequest = {
      dashboard: entry.dashboardKey,
      reportTitle: `${companyLabel} — ${entry.title}`,
      subtitle: `${fromInput} to ${toInput}`,
      slides,
      from: fromInput,
      to: toInput,
    };
    const raw = await appendDashboardToWorkbook(
      wb,
      req,
      deadline,
      used,
      entry.title,
    );
    allRaw.push(...raw);
    sections.push(entry.title);
  }

  if (skipped.length > 0) {
    const ws = wb.addWorksheet(safeSheetName("Sections Not Included", used));
    ws.columns = [{ width: 100 }];
    ws.addRow([
      "The following sections could not be built for this MIS and were left out (everything else in this file is real, live data):",
    ]).commit();
    for (const s of skipped) ws.addRow([s]).commit();
    ws.commit();
  }
  await wb.commit();
  return { raw: allRaw, sections, skipped };
}
