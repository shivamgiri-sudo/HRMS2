import { useMemo, useState, useEffect, useCallback } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  IndianRupee, ShoppingBag, TrendingUp, PhoneCall, Users, Search, ListFilter,
  Target, Trophy, MessageSquare, Gauge, Clock3, Layers, ClipboardList, Footprints,
  ListTree, ShieldCheck, Coffee, LogIn, CalendarDays,
} from "lucide-react";
import {
  Spinner, KpiCard, SectionCard, DashboardHero, DashboardExportMenu, DateRangeToolbar,
  formatINR, formatShortDate, currentMonthRange,
  type ExportSlide,
} from "./DashboardKit";
import { ComboTrend, Donut, RankBars, fmtPct } from "./NeemansCharts";
import { NeemansOverviewTab } from "./NeemansOverviewTab";
import type { NeemansDashboardData } from "./neemansPerformanceTypes";
import { useSortableRows } from "./useSortableRows";
import { FilterSortTh, useColumnFilters, type FilterColumn } from "./ColumnFilterHeader";

/**
 * Neemans' combined dashboard -- Sale, Allocation, Chat, APR (productivity),
 * Inbound and Abandoned Cart in one view, live from GET
 * /api/process-performance/neemans-performance-dashboard?from=&to=. See the
 * backend service's own header comment for the full column mapping, why
 * Target/Achievement comes from nms_Agent_Details.monthly_target rather
 * than neemans_sale_raw's own ambiguous per-row target field, and how the
 * date-range filter parses each table's own mixed date formats
 * (SALE_DATE_EXPR/ALLOC_DATE_EXPR/CHAT_DATE_EXPR).
 *
 * The Overview tab (NeemansOverviewTab) shows every source at once; the
 * Sale/Allocation/Chat/APR tabs are the drill-downs. Defaults to the current
 * month (1st .. today). Sale/APR/Allocation were bulk-uploaded for earlier
 * months, so a fresh month can legitimately read empty until that month's
 * files are uploaded -- widen the range to see history.
 */

const secondsToHms = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
};

/** Target attainment colouring: at/over target green, close amber, far red. */
const attainmentClass = (v: number) => (v >= 100 ? "text-emerald-600" : v >= 70 ? "text-amber-600" : "text-rose-600");
const resolvedClass = (v: number) => (v >= 90 ? "text-emerald-600" : v >= 75 ? "text-amber-600" : "text-rose-600");

type TabKey = "overview" | "sale" | "allocation" | "chat" | "productivity";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "sale", label: "Sale" },
  { key: "allocation", label: "Allocation" },
  { key: "chat", label: "Chat" },
  { key: "productivity", label: "APR" },
];

/** Row types for the per-row tables below, lifted straight off the API response shape. */
type SaleTlRow = NeemansDashboardData["sale"]["byTl"][number];
type OrderStatusRow = NeemansDashboardData["sale"]["orderStatusBreakdown"][number];
type SaleAgentRow = NeemansDashboardData["sale"]["agents"][number];
type AllocAgentRow = NeemansDashboardData["allocation"]["agents"][number];
type ChatLobRow = NeemansDashboardData["chat"]["byLob"][number];
type ChatChannelRow = NeemansDashboardData["chat"]["channelBreakdown"][number];
type ChatAgentRow = NeemansDashboardData["chat"]["agents"][number];
type ProdLobRow = NeemansDashboardData["productivity"]["lobBreakdown"][number];
type ProdAgentRow = NeemansDashboardData["productivity"]["agents"][number];

/** Header-only column definition for an Excel-style sortable/filterable table
 * whose <tbody> is already hand-written below -- `get` is what sort/filter
 * operate on, `className` is copied verbatim from the plain <th> it replaces. */
interface HeadCol<T> {
  key: string;
  label: string;
  get: (r: T) => string | number | null;
  className: string;
}
function filterColsOf<T>(cols: Array<HeadCol<T>>): Array<FilterColumn<T>> {
  return cols.map((c) => ({ key: c.key, get: c.get }));
}
function colGetterOf<T>(cols: Array<HeadCol<T>>) {
  return (r: T, key: string) => cols.find((c) => c.key === key)?.get(r) ?? null;
}

const SALE_TL_COLS: Array<HeadCol<SaleTlRow>> = [
  { key: "tlName", label: "TL Name", get: (r) => r.tlName, className: "py-2 pr-3 font-semibold" },
  { key: "saleCount", label: "Sale Count", get: (r) => r.saleCount, className: "py-2 pr-3 text-right font-semibold" },
  { key: "revenue", label: "Revenue", get: (r) => r.revenue, className: "py-2 pr-3 text-right font-semibold" },
  { key: "rtoPct", label: "RTO %", get: (r) => r.rtoPct, className: "py-2 pr-3 text-right font-semibold" },
  { key: "target", label: "Target", get: (r) => r.target, className: "py-2 pr-3 text-right font-semibold" },
  { key: "achievementPct", label: "Achievement %", get: (r) => r.achievementPct, className: "py-2 pr-0 text-right font-semibold" },
];
const SALE_TL_FILTER_COLS = filterColsOf(SALE_TL_COLS);
const saleTlColGetter = colGetterOf(SALE_TL_COLS);

const ORDER_STATUS_COLS: Array<HeadCol<OrderStatusRow>> = [
  { key: "status", label: "Status", get: (r) => r.status, className: "py-2 pr-3 font-semibold" },
  { key: "count", label: "Orders", get: (r) => r.count, className: "py-2 pr-3 text-right font-semibold" },
  { key: "revenue", label: "Revenue", get: (r) => r.revenue, className: "py-2 pr-3 text-right font-semibold" },
  { key: "pct", label: "Share", get: (r) => r.pct, className: "py-2 pr-0 text-right font-semibold" },
];
const ORDER_STATUS_FILTER_COLS = filterColsOf(ORDER_STATUS_COLS);
const orderStatusColGetter = colGetterOf(ORDER_STATUS_COLS);

const SALE_AGENT_COLS: Array<HeadCol<SaleAgentRow>> = [
  { key: "agent", label: "Agent", get: (r) => r.name, className: "py-2 pr-3 font-semibold" },
  { key: "tl", label: "TL", get: (r) => r.tlName, className: "py-2 pr-3 font-semibold" },
  { key: "saleCount", label: "Sale Count", get: (r) => r.saleCount, className: "py-2 pr-3 text-right font-semibold" },
  { key: "revenue", label: "Revenue", get: (r) => r.revenue, className: "py-2 pr-3 text-right font-semibold" },
  { key: "rtoPct", label: "RTO %", get: (r) => r.rtoPct, className: "py-2 pr-3 text-right font-semibold" },
  { key: "prepaidPct", label: "Prepaid %", get: (r) => r.prepaidPct, className: "py-2 pr-3 text-right font-semibold" },
  { key: "target", label: "Target", get: (r) => r.target, className: "py-2 pr-3 text-right font-semibold" },
  { key: "achievementPct", label: "Achievement %", get: (r) => r.achievementPct, className: "py-2 pr-0 text-right font-semibold" },
];
const SALE_AGENT_FILTER_COLS = filterColsOf(SALE_AGENT_COLS);
const saleAgentColGetter = colGetterOf(SALE_AGENT_COLS);

const ALLOC_AGENT_COLS: Array<HeadCol<AllocAgentRow>> = [
  { key: "agent", label: "Agent", get: (r) => r.agent, className: "py-2 pr-3 font-semibold" },
  { key: "allocation", label: "Allocation", get: (r) => r.allocation, className: "py-2 pr-3 text-right font-semibold" },
  { key: "connected", label: "Connected", get: (r) => r.connected, className: "py-2 pr-3 text-right font-semibold" },
  { key: "connectedPct", label: "Connected %", get: (r) => r.connectedPct, className: "py-2 pr-0 text-right font-semibold" },
];
const ALLOC_AGENT_FILTER_COLS = filterColsOf(ALLOC_AGENT_COLS);
const allocAgentColGetter = colGetterOf(ALLOC_AGENT_COLS);

const CHAT_LOB_COLS: Array<HeadCol<ChatLobRow>> = [
  { key: "lob", label: "LOB", get: (r) => r.lob, className: "py-2 pr-3 font-semibold" },
  { key: "tickets", label: "Tickets", get: (r) => r.tickets, className: "py-2 pr-3 text-right font-semibold" },
  { key: "resolvedPct", label: "Resolved %", get: (r) => r.resolvedPct, className: "py-2 pr-0 text-right font-semibold" },
];
const CHAT_LOB_FILTER_COLS = filterColsOf(CHAT_LOB_COLS);
const chatLobColGetter = colGetterOf(CHAT_LOB_COLS);

const CHAT_CHANNEL_COLS: Array<HeadCol<ChatChannelRow>> = [
  { key: "channel", label: "Channel", get: (r) => r.channel, className: "py-2 pr-3 font-semibold" },
  { key: "tickets", label: "Tickets", get: (r) => r.tickets, className: "py-2 pr-3 text-right font-semibold" },
  { key: "resolvedPct", label: "Resolved %", get: (r) => r.resolvedPct, className: "py-2 pr-0 text-right font-semibold" },
];
const CHAT_CHANNEL_FILTER_COLS = filterColsOf(CHAT_CHANNEL_COLS);
const chatChannelColGetter = colGetterOf(CHAT_CHANNEL_COLS);

const CHAT_AGENT_COLS: Array<HeadCol<ChatAgentRow>> = [
  { key: "agent", label: "Agent", get: (r) => r.agent, className: "py-2 pr-3 font-semibold" },
  { key: "tickets", label: "Tickets", get: (r) => r.tickets, className: "py-2 pr-3 text-right font-semibold" },
  { key: "resolvedPct", label: "Resolved %", get: (r) => r.resolvedPct, className: "py-2 pr-3 text-right font-semibold" },
  { key: "avgCsat", label: "Avg CSAT", get: (r) => r.avgCsat, className: "py-2 pr-0 text-right font-semibold" },
];
const CHAT_AGENT_FILTER_COLS = filterColsOf(CHAT_AGENT_COLS);
const chatAgentColGetter = colGetterOf(CHAT_AGENT_COLS);

const PROD_LOB_COLS: Array<HeadCol<ProdLobRow>> = [
  { key: "lob", label: "LOB", get: (r) => r.lob, className: "py-2 pr-3 font-semibold" },
  { key: "calls", label: "Calls", get: (r) => r.calls, className: "py-2 pr-3 text-right font-semibold" },
  { key: "agents", label: "Agents", get: (r) => r.agents, className: "py-2 pr-3 text-right font-semibold" },
  { key: "avgOccupancyPct", label: "Avg Occupancy %", get: (r) => r.avgOccupancyPct, className: "py-2 pr-0 text-right font-semibold" },
];
const PROD_LOB_FILTER_COLS = filterColsOf(PROD_LOB_COLS);
const prodLobColGetter = colGetterOf(PROD_LOB_COLS);

const PROD_AGENT_COLS: Array<HeadCol<ProdAgentRow>> = [
  { key: "agent", label: "Agent", get: (r) => r.name, className: "py-2 pr-3 font-semibold" },
  { key: "calls", label: "Calls", get: (r) => r.calls, className: "py-2 pr-3 text-right font-semibold" },
  { key: "loginTimeSec", label: "Login Time", get: (r) => r.loginTimeSec, className: "py-2 pr-3 text-right font-semibold" },
  { key: "talkTimeSec", label: "Talk Time", get: (r) => r.talkTimeSec, className: "py-2 pr-3 text-right font-semibold" },
  { key: "occupancyPct", label: "Occupancy %", get: (r) => r.occupancyPct, className: "py-2 pr-3 text-right font-semibold" },
  { key: "attendanceDays", label: "Attendance Days", get: (r) => r.attendanceDays, className: "py-2 pr-0 text-right font-semibold" },
];
const PROD_AGENT_FILTER_COLS = filterColsOf(PROD_AGENT_COLS);
const prodAgentColGetter = colGetterOf(PROD_AGENT_COLS);

/** Small "Clear N filter(s)" pill, shown next to a table's title/search row
 * whenever any column filter on that table is active. */
function ClearFiltersButton({ count, onClear }: { count: number; onClear: () => void }) {
  if (count <= 0) return null;
  return (
    <button type="button" onClick={onClear} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-200">
      Clear {count} filter{count > 1 ? "s" : ""}
    </button>
  );
}

export function NeemansPerformanceDashboard() {
  const [data, setData] = useState<NeemansDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabKey>("overview");
  const defaultRange = currentMonthRange();
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [saleSearch, setSaleSearch] = useState("");
  const [allocSearch, setAllocSearch] = useState("");
  const [chatSearch, setChatSearch] = useState("");
  const [prodSearch, setProdSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: NeemansDashboardData }>(
        `/api/process-performance/neemans-performance-dashboard?from=${from}&to=${to}`,
      );
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the Neemans performance dashboard.");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  const filteredSaleAgents = useMemo(() => {
    const rows = data?.sale.agents ?? [];
    const q = saleSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((a) => a.name.toLowerCase().includes(q) || a.empId.toLowerCase().includes(q) || a.tlName.toLowerCase().includes(q));
  }, [data, saleSearch]);

  const filteredAllocAgents = useMemo(() => {
    const rows = data?.allocation.agents ?? [];
    const q = allocSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((a) => a.agent.toLowerCase().includes(q));
  }, [data, allocSearch]);

  const filteredChatAgents = useMemo(() => {
    const rows = data?.chat.agents ?? [];
    const q = chatSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((a) => a.agent.toLowerCase().includes(q) || a.empId.toLowerCase().includes(q));
  }, [data, chatSearch]);

  const filteredProdAgents = useMemo(() => {
    const rows = data?.productivity.agents ?? [];
    const q = prodSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((a) => a.name.toLowerCase().includes(q) || a.empId.toLowerCase().includes(q));
  }, [data, prodSearch]);

  // Excel-style column sort/filter for every per-row table on this page. Each
  // table gets its own independent filter+sort state; search boxes (above)
  // narrow the rows first, column filters/sort apply on top, matching the
  // BellavitaAgentPerformance pattern.
  const saleTlRows = useMemo(() => data?.sale.byTl ?? [], [data]);
  const saleTlFilters = useColumnFilters(saleTlRows, SALE_TL_FILTER_COLS);
  const { sorted: sortedSaleTl, sortKey: saleTlSortKey, sortDir: saleTlSortDir, toggleSort: toggleSaleTlSort } = useSortableRows(saleTlFilters.filtered, saleTlColGetter);

  const orderStatusRows = useMemo(() => data?.sale.orderStatusBreakdown ?? [], [data]);
  const orderStatusFilters = useColumnFilters(orderStatusRows, ORDER_STATUS_FILTER_COLS);
  const { sorted: sortedOrderStatus, sortKey: orderStatusSortKey, sortDir: orderStatusSortDir, toggleSort: toggleOrderStatusSort } = useSortableRows(orderStatusFilters.filtered, orderStatusColGetter);

  const saleAgentFilters = useColumnFilters(filteredSaleAgents, SALE_AGENT_FILTER_COLS);
  const { sorted: sortedSaleAgents, sortKey: saleAgentSortKey, sortDir: saleAgentSortDir, toggleSort: toggleSaleAgentSort } = useSortableRows(saleAgentFilters.filtered, saleAgentColGetter);

  const allocAgentFilters = useColumnFilters(filteredAllocAgents, ALLOC_AGENT_FILTER_COLS);
  const { sorted: sortedAllocAgents, sortKey: allocAgentSortKey, sortDir: allocAgentSortDir, toggleSort: toggleAllocAgentSort } = useSortableRows(allocAgentFilters.filtered, allocAgentColGetter);

  const chatLobRows = useMemo(() => data?.chat.byLob ?? [], [data]);
  const chatLobFilters = useColumnFilters(chatLobRows, CHAT_LOB_FILTER_COLS);
  const { sorted: sortedChatLob, sortKey: chatLobSortKey, sortDir: chatLobSortDir, toggleSort: toggleChatLobSort } = useSortableRows(chatLobFilters.filtered, chatLobColGetter);

  const chatChannelRows = useMemo(() => data?.chat.channelBreakdown ?? [], [data]);
  const chatChannelFilters = useColumnFilters(chatChannelRows, CHAT_CHANNEL_FILTER_COLS);
  const { sorted: sortedChatChannel, sortKey: chatChannelSortKey, sortDir: chatChannelSortDir, toggleSort: toggleChatChannelSort } = useSortableRows(chatChannelFilters.filtered, chatChannelColGetter);

  const chatAgentFilters = useColumnFilters(filteredChatAgents, CHAT_AGENT_FILTER_COLS);
  const { sorted: sortedChatAgents, sortKey: chatAgentSortKey, sortDir: chatAgentSortDir, toggleSort: toggleChatAgentSort } = useSortableRows(chatAgentFilters.filtered, chatAgentColGetter);

  const prodLobRows = useMemo(() => data?.productivity.lobBreakdown ?? [], [data]);
  const prodLobFilters = useColumnFilters(prodLobRows, PROD_LOB_FILTER_COLS);
  const { sorted: sortedProdLob, sortKey: prodLobSortKey, sortDir: prodLobSortDir, toggleSort: toggleProdLobSort } = useSortableRows(prodLobFilters.filtered, prodLobColGetter);

  const prodAgentFilters = useColumnFilters(filteredProdAgents, PROD_AGENT_FILTER_COLS);
  const { sorted: sortedProdAgents, sortKey: prodAgentSortKey, sortDir: prodAgentSortDir, toggleSort: toggleProdAgentSort } = useSortableRows(prodAgentFilters.filtered, prodAgentColGetter);

  /** Export slides for "Download Snap"/"Download Excel" — one per tab,
   * built from the same data already rendered on screen, not re-fetched. */
  const exportSlides = useMemo<ExportSlide[]>(() => {
    if (!data) return [];
    const { sale, allocation, chat, productivity, cart, inbound } = data;
    const n = (v: number) => v.toLocaleString("en-IN");

    const overviewSlide: ExportSlide = {
      title: "Overview",
      kpis: [
        { label: "Sale · Revenue", value: formatINR(sale.headline.revenue) },
        { label: "Sale · Orders", value: n(sale.headline.saleCount) },
        { label: "Sale · AOV", value: formatINR(sale.headline.aov) },
        { label: "Sale · Prepaid %", value: `${sale.headline.prepaidPct}%` },
        { label: "Sale · COD %", value: `${sale.headline.codPct}%` },
        { label: "Sale · RTO %", value: `${sale.headline.rtoPct}%` },
        { label: "Allocation · Total", value: n(allocation.headline.totalAllocation) },
        { label: "Allocation · Connected %", value: `${allocation.headline.connectedPct}%` },
        { label: "Allocation · Not connected", value: n(allocation.headline.notConnected) },
        { label: "Chat · Tickets", value: n(chat.headline.totalTickets) },
        { label: "Chat · Resolved %", value: `${chat.headline.resolvedPct}%` },
        { label: "Chat · FRT TAT compliance %", value: `${chat.headline.frtTatCompliancePct}%` },
        { label: "Chat · Resolution TAT compliance %", value: `${chat.headline.resolutionTatCompliancePct}%` },
        { label: "APR · Total calls", value: n(productivity.headline.totalCalls) },
        { label: "APR · Avg occupancy %", value: `${productivity.headline.avgOccupancyPct}%` },
        { label: "APR · Avg net login", value: secondsToHms(productivity.headline.avgNetLoginSec) },
        { label: "Inbound · Offered", value: inbound ? n(inbound.headline.offered) : "—" },
        { label: "Inbound · Answered", value: inbound ? n(inbound.headline.answered) : "—" },
        { label: "Inbound · Service level %", value: inbound ? `${inbound.headline.slPct}%` : "—" },
        { label: "Inbound · AHT (sec)", value: inbound ? String(inbound.headline.ahtSec) : "—" },
        { label: "Cart · Abandoned carts", value: n(cart.headline.totalCarts) },
        { label: "Cart · Total value", value: formatINR(cart.headline.totalCartValue) },
      ],
      tables: [
        {
          title: "Sale — date-wise",
          columns: ["Date", "Orders", "Revenue", "RTO"],
          rows: sale.dateWiseTrend.map((r) => [formatShortDate(r.date), r.saleCount, formatINR(r.revenue), r.rtoCount]),
        },
        {
          title: "Allocation — date-wise",
          columns: ["Date", "Allocation", "Connected %"],
          rows: allocation.dateWiseTrend.map((r) => [formatShortDate(r.date), r.allocationCount, `${r.connectedPct}%`]),
        },
        {
          title: "Chat — date-wise",
          columns: ["Date", "Tickets", "Resolved %"],
          rows: chat.dateWiseTrend.map((r) => [formatShortDate(r.date), r.tickets, `${r.resolvedPct}%`]),
        },
        {
          title: "APR — date-wise",
          columns: ["Date", "Calls", "Agents logged in", "Occupancy %"],
          rows: productivity.dateWiseTrend.map((r) => [formatShortDate(r.date), r.calls, r.loginAgents, `${r.avgOccupancyPct}%`]),
        },
        {
          title: "Inbound — date-wise",
          columns: ["Date", "Offered", "Answered", "Service level %"],
          rows: (inbound?.dateWiseTrend ?? []).map((r) => [formatShortDate(r.date), r.offered, r.answered, `${r.slPct}%`]),
        },
        {
          title: "Abandoned cart — date-wise",
          columns: ["Date", "Carts", "Cart value"],
          rows: cart.dateWiseTrend.map((r) => [formatShortDate(r.date), r.cartCount, formatINR(r.cartValue)]),
        },
      ],
    };

    const saleSlide: ExportSlide = {
      title: "Sale",
      kpis: [
        { label: "Revenue", value: formatINR(sale.headline.revenue) },
        { label: "Sale Count", value: sale.headline.saleCount.toLocaleString("en-IN") },
        { label: "AOV", value: formatINR(sale.headline.aov) },
        { label: "Prepaid %", value: `${sale.headline.prepaidPct}%` },
        { label: "COD %", value: `${sale.headline.codPct}%` },
        { label: "RTO %", value: `${sale.headline.rtoPct}%` },
        { label: "Target", value: formatINR(sale.headline.target) },
        { label: "Achievement %", value: `${sale.headline.achievementPct}%` },
      ],
      tables: [
        {
          title: "TL-wise Summary",
          columns: ["TL Name", "Sale Count", "Revenue", "RTO %", "Target", "Achievement %"],
          rows: sale.byTl.map((r) => [r.tlName, r.saleCount, formatINR(r.revenue), `${r.rtoPct}%`, formatINR(r.target), `${r.achievementPct}%`]),
        },
        {
          title: "Agent-wise Sale Performance",
          columns: ["Agent", "Emp ID", "TL", "Sale Count", "Revenue", "RTO %", "Prepaid %", "Target", "Achievement %"],
          rows: sale.agents.map((a) => [
            a.name, a.empId, a.tlName, a.saleCount, formatINR(a.revenue), `${a.rtoPct}%`, `${a.prepaidPct}%`, formatINR(a.target), `${a.achievementPct}%`,
          ]),
        },
      ],
    };

    const allocationSlide: ExportSlide = {
      title: "Allocation",
      kpis: [
        { label: "Total Allocation", value: allocation.headline.totalAllocation.toLocaleString("en-IN") },
        { label: "Connected", value: allocation.headline.connected.toLocaleString("en-IN") },
        { label: "Connected %", value: `${allocation.headline.connectedPct}%` },
        { label: "Not Connected", value: allocation.headline.notConnected.toLocaleString("en-IN") },
        { label: "Pending", value: allocation.headline.pending.toLocaleString("en-IN") },
        { label: "Unique Phones", value: allocation.headline.uniquePhones.toLocaleString("en-IN") },
        { label: "Active Agents", value: String(allocation.headline.activeAgents) },
      ],
      tables: [
        {
          title: "Calling Status Breakdown",
          columns: ["Status", "Count", "Share"],
          rows: allocation.statusBreakdown.map((s) => [s.status, s.count.toLocaleString("en-IN"), `${s.pct}%`]),
        },
        {
          title: "Sub-scenario Breakdown",
          columns: ["Sub-scenario", "Count", "Share"],
          rows: allocation.subScenarioBreakdown.map((s) => [s.subScenario, s.count.toLocaleString("en-IN"), `${s.pct}%`]),
        },
        {
          title: "Date-wise Allocation",
          columns: ["Date", "Allocation", "Connected %"],
          rows: allocation.dateWiseTrend.map((r) => [formatShortDate(r.date), r.allocationCount, `${r.connectedPct}%`]),
        },
        {
          title: "Agent-wise Allocation",
          columns: ["Agent", "Allocation", "Connected", "Connected %"],
          rows: allocation.agents.map((a) => [a.agent, a.allocation.toLocaleString("en-IN"), a.connected.toLocaleString("en-IN"), `${a.connectedPct}%`]),
        },
      ],
    };

    const chatSlide: ExportSlide = {
      title: "Chat",
      kpis: [
        { label: "Total Tickets", value: String(chat.headline.totalTickets) },
        { label: "Resolved %", value: `${chat.headline.resolvedPct}%` },
        { label: "Avg FRT", value: `${chat.headline.avgFrtHrs}m` },
        { label: "Avg Resolution", value: `${chat.headline.avgResolutionHrs}m` },
        { label: "Avg CSAT", value: String(chat.headline.avgCsat) },
        { label: "FRT TAT Compliance %", value: `${chat.headline.frtTatCompliancePct}%` },
        { label: "Resolution TAT Compliance %", value: `${chat.headline.resolutionTatCompliancePct}%` },
      ],
      tables: [
        {
          title: "LOB-wise Tickets",
          columns: ["LOB", "Tickets", "Resolved %"],
          rows: chat.byLob.map((r) => [r.lob, r.tickets, `${r.resolvedPct}%`]),
        },
        {
          title: "Ticket Status Breakdown",
          columns: ["Status", "Count", "Share"],
          rows: chat.statusBreakdown.map((s) => [s.status, s.count, `${s.pct}%`]),
        },
        {
          title: "Date-wise Chat Trend",
          columns: ["Date", "Tickets", "Resolved %"],
          rows: chat.dateWiseTrend.map((r) => [formatShortDate(r.date), r.tickets, `${r.resolvedPct}%`]),
        },
        {
          title: "Agent-wise Chat Performance",
          columns: ["Agent", "Emp ID", "Tickets", "Resolved %", "Avg CSAT"],
          rows: chat.agents.map((a) => [a.agent, a.empId, a.tickets, `${a.resolvedPct}%`, a.avgCsat || "—"]),
        },
      ],
    };

    const productivitySlide: ExportSlide = {
      title: "APR",
      kpis: [
        { label: "Total Calls", value: productivity.headline.totalCalls.toLocaleString("en-IN") },
        { label: "Active Agents", value: String(productivity.headline.activeAgents) },
        { label: "Avg Occupancy %", value: `${productivity.headline.avgOccupancyPct}%` },
        { label: "Attendance Days", value: String(productivity.headline.attendanceDays) },
        { label: "Avg Net Login", value: secondsToHms(productivity.headline.avgNetLoginSec) },
        { label: "Avg Total Break", value: secondsToHms(productivity.headline.avgTotalBreakSec) },
      ],
      tables: [
        {
          title: "Agent-wise Productivity",
          columns: ["Agent", "Emp ID", "Calls", "Login Time", "Talk Time", "Occupancy %", "Attendance Days"],
          rows: productivity.agents.map((a) => [
            a.name, a.empId, a.calls, secondsToHms(a.loginTimeSec), secondsToHms(a.talkTimeSec), `${a.occupancyPct}%`, a.attendanceDays,
          ]),
        },
      ],
    };

    return [overviewSlide, saleSlide, allocationSlide, chatSlide, productivitySlide];
  }, [data]);

  if (loading && !data) return <Spinner tone="blue" />;
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  const { sale, allocation, chat, productivity } = data;
  /** Orders placed / total numbers allocated -- matches the reference management
   * workbook's "Conversion %" (Neeman's Billing Sep 26.xlsb, sheet "Dashboard": Total
   * Orders / Workable Data). See NeemansOverviewTab for the same computation. */
  const conversionPct = allocation.headline.totalAllocation > 0
    ? Math.round((sale.headline.saleCount / allocation.headline.totalAllocation) * 10000) / 100
    : 0;

  return (
    <div className="space-y-5">
      <DashboardHero<TabKey>
        icon={Footprints} eyebrow="Neemans · Process Performance" title="Sale, Allocation, Chat, APR, Inbound & Cart"
        tabs={TABS} activeTab={tab} onTabChange={setTab}
        gradient="from-violet-600 via-purple-600 to-fuchsia-600"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <DashboardExportMenu
          reportTitle="Neemans — Sale, Allocation, Chat, APR, Inbound & Cart"
          fileBaseName="Neemans_Performance"
          raw={{ dashboard: "neemans_performance", from, to }}
          subtitle={`${from} to ${to}`}
          slides={exportSlides}
          activeSlideTitle={
            tab === "overview" ? "Overview"
            : tab === "sale" ? "Sale"
            : tab === "allocation" ? "Allocation"
            : tab === "chat" ? "Chat"
            : "APR"
          }
        />
        <DateRangeToolbar
          from={from} to={to} onFrom={setFrom} onTo={setTo}
          onReset={() => { const r = currentMonthRange(); setFrom(r.from); setTo(r.to); }}
          accentFocus="focus:border-violet-400"
        />
      </div>
      <p className="text-[11px] text-slate-400">
        Showing {from} to {to} — every chart and table below reflects this range. If a section looks empty, that source has no uploaded data for these dates: widen the range or upload the file for this period.
      </p>

      {tab === "overview" && <NeemansOverviewTab data={data} onOpenTab={setTab} />}

      {tab === "sale" && (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          <KpiCard icon={IndianRupee} label="Revenue" value={formatINR(sale.headline.revenue)} tone="emerald" />
          <KpiCard icon={ShoppingBag} label="Sale Count" value={sale.headline.saleCount.toLocaleString("en-IN")} tone="sky" />
          <KpiCard icon={TrendingUp} label="AOV" value={formatINR(sale.headline.aov)} tone="violet" />
          <KpiCard icon={IndianRupee} label="Prepaid %" value={`${sale.headline.prepaidPct}%`} tone="teal" />
          <KpiCard icon={IndianRupee} label="COD %" value={`${sale.headline.codPct}%`} tone="amber" />
          <KpiCard icon={TrendingUp} label="RTO %" value={`${sale.headline.rtoPct}%`} tone="rose" />
          <KpiCard icon={Target} label="Target" value={formatINR(sale.headline.target)} tone="indigo" />
          <KpiCard icon={Trophy} label="Achievement %" value={`${sale.headline.achievementPct}%`} tone="cyan" />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <SectionCard icon={TrendingUp} title="Date-wise Sale & RTO" tone="violet">
              <ComboTrend
                data={sale.dateWiseTrend}
                series={[
                  { key: "revenue", name: "Revenue", kind: "area", color: "#7c3aed", axis: "right", format: formatINR },
                  { key: "saleCount", name: "Orders", kind: "bar", color: "#0ea5e9" },
                  { key: "rtoCount", name: "RTO Count", kind: "line", color: "#f43f5e" },
                ]}
              />
            </SectionCard>
          </div>
          <SectionCard icon={Layers} title="Payment Breakdown" tone="teal">
            <Donut
              data={sale.paymentBreakdown.map((p) => ({ name: p.paymentStatus, value: p.revenue }))}
              valueFormat={formatINR} centerValue={formatINR(sale.headline.revenue)} centerLabel="Revenue"
            />
          </SectionCard>
        </div>

        <SectionCard icon={Users} title="Revenue by team leader" tone="violet">
          <RankBars data={sale.byTl.map((t) => ({ name: t.tlName, value: t.revenue }))} valueFormat={formatINR} />
        </SectionCard>

        <SectionCard icon={Users} title="TL-wise Summary" tone="violet" action={<ClearFiltersButton count={saleTlFilters.activeCount} onClear={saleTlFilters.clearAll} />}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  {SALE_TL_COLS.map((c) => (
                    <FilterSortTh key={c.key} label={c.label} columnKey={c.key} sortKey={saleTlSortKey} sortDir={saleTlSortDir} onSort={toggleSaleTlSort} filters={saleTlFilters} className={c.className} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedSaleTl.map((r) => (
                  <tr key={r.tlName} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-violet-50/40">
                    <td className="py-2.5 pr-3 font-medium text-slate-700">{r.tlName}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{r.saleCount}</td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{formatINR(r.revenue)}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{r.rtoPct}%</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{formatINR(r.target)}</td>
                    <td className={`py-2.5 pr-0 text-right font-semibold ${attainmentClass(r.achievementPct)}`}>{r.achievementPct}%</td>
                  </tr>
                ))}
                {sortedSaleTl.length === 0 && (
                  <tr><td colSpan={6} className="py-6 text-center text-slate-400">{sale.byTl.length === 0 ? "No data for this period." : "No rows match the filters."}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard
          icon={ListTree} title="Order Status Breakdown" tone="teal"
          footnote="neemans_sale_raw.current_status — the shipment/fulfilment status (Delivered/RTO/Dispatched/Cancelled/Unfulfilled/...), not the same as the payment-status or RTO% cards above."
          action={<ClearFiltersButton count={orderStatusFilters.activeCount} onClear={orderStatusFilters.clearAll} />}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  {ORDER_STATUS_COLS.map((c) => (
                    <FilterSortTh key={c.key} label={c.label} columnKey={c.key} sortKey={orderStatusSortKey} sortDir={orderStatusSortDir} onSort={toggleOrderStatusSort} filters={orderStatusFilters} className={c.className} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedOrderStatus.map((r) => (
                  <tr key={r.status} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-teal-50/40">
                    <td className="py-2.5 pr-3 font-medium text-slate-700">{r.status}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{r.count.toLocaleString("en-IN")}</td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{formatINR(r.revenue)}</td>
                    <td className="py-2.5 pr-0 text-right text-slate-600">{r.pct}%</td>
                  </tr>
                ))}
                {sortedOrderStatus.length === 0 && (
                  <tr><td colSpan={4} className="py-6 text-center text-slate-400">{sale.orderStatusBreakdown.length === 0 ? "No data for this period." : "No rows match the filters."}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input type="text" value={saleSearch} onChange={(e) => setSaleSearch(e.target.value)} placeholder="Search agent name, ID or TL..."
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 shadow-sm transition-colors focus:border-violet-400 focus:outline-none" />
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500">
              <ListFilter className="h-3 w-3" />{sortedSaleAgents.length} of {sale.agents.length} agents
            </span>
            <ClearFiltersButton count={saleAgentFilters.activeCount} onClear={saleAgentFilters.clearAll} />
          </div>
          <SectionCard icon={Trophy} title="Agent-wise Sale Performance" tone="amber">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                    {SALE_AGENT_COLS.map((c) => (
                      <FilterSortTh key={c.key} label={c.label} columnKey={c.key} sortKey={saleAgentSortKey} sortDir={saleAgentSortDir} onSort={toggleSaleAgentSort} filters={saleAgentFilters} className={c.className} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedSaleAgents.map((a) => (
                    <tr key={a.empId} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-amber-50/40">
                      <td className="py-2.5 pr-3">
                        <div className="font-medium text-slate-700">{a.name}</div>
                        <div className="text-[11px] text-slate-400">{a.empId}</div>
                      </td>
                      <td className="py-2.5 pr-3 text-slate-500">{a.tlName}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{a.saleCount}</td>
                      <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{formatINR(a.revenue)}</td>
                      <td className={`py-2.5 pr-3 text-right ${a.rtoPct > 10 ? "font-semibold text-red-600" : "text-slate-600"}`}>{a.rtoPct}%</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{a.prepaidPct}%</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{formatINR(a.target)}</td>
                      <td className={`py-2.5 pr-0 text-right font-semibold ${attainmentClass(a.achievementPct)}`}>{a.achievementPct}%</td>
                    </tr>
                  ))}
                  {sortedSaleAgents.length === 0 && (
                    <tr><td colSpan={8} className="py-6 text-center text-slate-400">No agents match the search / filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      </div>
      )}

      {tab === "allocation" && (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          <KpiCard icon={ClipboardList} label="Total Allocation" value={allocation.headline.totalAllocation.toLocaleString("en-IN")} tone="violet" />
          <KpiCard icon={PhoneCall} label="Connected" value={allocation.headline.connected.toLocaleString("en-IN")} tone="emerald" />
          <KpiCard icon={Gauge} label="Connected %" value={`${allocation.headline.connectedPct}%`} tone="teal" />
          <KpiCard icon={PhoneCall} label="Not Connected" value={allocation.headline.notConnected.toLocaleString("en-IN")} tone="rose" />
          <KpiCard icon={Clock3} label="Pending" value={allocation.headline.pending.toLocaleString("en-IN")} tone="amber" />
          <KpiCard icon={Users} label="Unique Phones" value={allocation.headline.uniquePhones.toLocaleString("en-IN")} tone="sky" />
          <KpiCard icon={Users} label="Active Agents" value={String(allocation.headline.activeAgents)} tone="indigo" />
          <KpiCard icon={Target} label="Conversion %" value={`${conversionPct}%`} tone="cyan" sub="orders / allocation" />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <SectionCard icon={CalendarDays} title="Date-wise Allocation & Connected %" tone="indigo">
              <ComboTrend
                data={allocation.dateWiseTrend}
                series={[
                  { key: "allocationCount", name: "Allocation", kind: "bar", color: "#7c3aed" },
                  { key: "connectedPct", name: "Connected %", kind: "line", color: "#10b981", axis: "right", format: fmtPct },
                ]}
              />
            </SectionCard>
          </div>
          <SectionCard icon={ClipboardList} title="Calling Status Breakdown" tone="teal">
            <Donut
              data={allocation.statusBreakdown.map((s) => ({ name: s.status, value: s.count }))}
              centerValue={allocation.headline.totalAllocation.toLocaleString("en-IN")} centerLabel="Allocated"
              colors={["#10b981", "#f43f5e", "#f59e0b", "#0ea5e9", "#7c3aed", "#64748b"]}
            />
          </SectionCard>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard
            icon={ListTree} title="Sub-scenario Breakdown" tone="rose"
            footnote="neemans_allocation.sub_scenario1 — the specific outcome behind each call (why it wasn't connected, or what happened when it was), not just the coarser Calling Status."
          >
            <RankBars
              maxRows={10}
              data={allocation.subScenarioBreakdown.map((s) => ({ name: s.subScenario, value: s.count }))}
              colors={["#f43f5e", "#f97316", "#f59e0b", "#84cc16", "#10b981", "#14b8a6", "#0ea5e9", "#6366f1", "#8b5cf6", "#ec4899"]}
            />
          </SectionCard>
          <SectionCard icon={Layers} title="Type-wise Allocation (Shopify vs GOKWICK)" tone="violet">
            <Donut data={allocation.typeBreakdown.map((t) => ({ name: t.type, value: t.count }))} colors={["#7c3aed", "#0ea5e9", "#f59e0b"]} />
          </SectionCard>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input type="text" value={allocSearch} onChange={(e) => setAllocSearch(e.target.value)} placeholder="Search agent..."
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 shadow-sm transition-colors focus:border-violet-400 focus:outline-none" />
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500">
              <ListFilter className="h-3 w-3" />{sortedAllocAgents.length} of {allocation.agents.length} agents
            </span>
            <ClearFiltersButton count={allocAgentFilters.activeCount} onClear={allocAgentFilters.clearAll} />
          </div>
          <SectionCard
            icon={Users} title="Agent-wise Allocation" tone="violet"
            footnote="No TL-wise view is shown — neemans_allocation has no team-lead column."
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                    {ALLOC_AGENT_COLS.map((c) => (
                      <FilterSortTh key={c.key} label={c.label} columnKey={c.key} sortKey={allocAgentSortKey} sortDir={allocAgentSortDir} onSort={toggleAllocAgentSort} filters={allocAgentFilters} className={c.className} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedAllocAgents.map((a) => (
                    <tr key={a.agent} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-violet-50/40">
                      <td className="py-2.5 pr-3 font-medium text-slate-700">{a.agent}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{a.allocation.toLocaleString("en-IN")}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{a.connected.toLocaleString("en-IN")}</td>
                      <td className="py-2.5 pr-0 text-right font-semibold text-slate-800">{a.connectedPct}%</td>
                    </tr>
                  ))}
                  {sortedAllocAgents.length === 0 && (
                    <tr><td colSpan={4} className="py-6 text-center text-slate-400">No agents match the search / filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      </div>
      )}

      {tab === "chat" && (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <KpiCard icon={MessageSquare} label="Total Tickets" value={String(chat.headline.totalTickets)} tone="indigo" />
          <KpiCard icon={Gauge} label="Resolved %" value={`${chat.headline.resolvedPct}%`} tone="emerald" />
          <KpiCard icon={Clock3} label="Avg FRT" value={`${chat.headline.avgFrtHrs}m`} tone="sky" />
          <KpiCard icon={Clock3} label="Avg Resolution" value={`${chat.headline.avgResolutionHrs}m`} tone="violet" />
          <KpiCard icon={Trophy} label="Avg CSAT" value={String(chat.headline.avgCsat)} tone="amber" />
          <KpiCard icon={ShieldCheck} label="FRT TAT Compliance" value={`${chat.headline.frtTatCompliancePct}%`} tone="teal" sub="frt_tat = IN TAT" />
          <KpiCard icon={ShieldCheck} label="Resolution TAT Compliance" value={`${chat.headline.resolutionTatCompliancePct}%`} tone="cyan" sub="resolution_tat = IN TAT" />
        </div>
        {chat.headline.totalTickets < 20 && (
          <p className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs text-amber-700">
            Only {chat.headline.totalTickets} chat ticket(s) in this range (db_masmis.neemans_chat) — these numbers are real but thin. They'll fill out automatically as more chat exports are uploaded, no page change needed.
          </p>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <SectionCard icon={CalendarDays} title="Date-wise Chat Trend" tone="violet">
              <ComboTrend
                data={chat.dateWiseTrend}
                height={220}
                series={[
                  { key: "tickets", name: "Tickets", kind: "bar", color: "#6366f1" },
                  { key: "resolvedPct", name: "Resolved %", kind: "line", color: "#10b981", axis: "right", format: fmtPct },
                ]}
              />
            </SectionCard>
          </div>
          <SectionCard icon={ListTree} title="Ticket Status Breakdown" tone="rose">
            <Donut
              data={chat.statusBreakdown.map((s) => ({ name: s.status, value: s.count }))}
              centerValue={String(chat.headline.totalTickets)} centerLabel="Tickets"
              colors={["#10b981", "#f59e0b", "#6366f1", "#f43f5e", "#0ea5e9"]}
            />
          </SectionCard>
        </div>

        <SectionCard icon={Layers} title="LOB-wise Tickets" tone="indigo" action={<ClearFiltersButton count={chatLobFilters.activeCount} onClear={chatLobFilters.clearAll} />}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  {CHAT_LOB_COLS.map((c) => (
                    <FilterSortTh key={c.key} label={c.label} columnKey={c.key} sortKey={chatLobSortKey} sortDir={chatLobSortDir} onSort={toggleChatLobSort} filters={chatLobFilters} className={c.className} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedChatLob.map((r) => (
                  <tr key={r.lob} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-indigo-50/40">
                    <td className="py-2.5 pr-3 font-medium text-slate-700">{r.lob}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{r.tickets}</td>
                    <td className={`py-2.5 pr-0 text-right font-semibold ${resolvedClass(r.resolvedPct)}`}>{r.resolvedPct}%</td>
                  </tr>
                ))}
                {sortedChatLob.length === 0 && (
                  <tr><td colSpan={3} className="py-6 text-center text-slate-400">{chat.byLob.length === 0 ? "No data for this period." : "No rows match the filters."}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard
          icon={Layers} title="Channel-wise Tickets" tone="sky"
          footnote="neemans_chat.inbox_name — the actual inbox (WhatsApp, Instagram, Facebook, Email), a finer grain than the LOB view above."
          action={<ClearFiltersButton count={chatChannelFilters.activeCount} onClear={chatChannelFilters.clearAll} />}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  {CHAT_CHANNEL_COLS.map((c) => (
                    <FilterSortTh key={c.key} label={c.label} columnKey={c.key} sortKey={chatChannelSortKey} sortDir={chatChannelSortDir} onSort={toggleChatChannelSort} filters={chatChannelFilters} className={c.className} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedChatChannel.map((r) => (
                  <tr key={r.channel} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-sky-50/40">
                    <td className="py-2.5 pr-3 font-medium text-slate-700">{r.channel}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{r.tickets}</td>
                    <td className={`py-2.5 pr-0 text-right font-semibold ${resolvedClass(r.resolvedPct)}`}>{r.resolvedPct}%</td>
                  </tr>
                ))}
                {sortedChatChannel.length === 0 && (
                  <tr><td colSpan={3} className="py-6 text-center text-slate-400">{chat.channelBreakdown.length === 0 ? "No data for this period." : "No rows match the filters."}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input type="text" value={chatSearch} onChange={(e) => setChatSearch(e.target.value)} placeholder="Search agent..."
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 shadow-sm transition-colors focus:border-violet-400 focus:outline-none" />
            </div>
            <ClearFiltersButton count={chatAgentFilters.activeCount} onClear={chatAgentFilters.clearAll} />
          </div>
          <SectionCard icon={Users} title="Agent-wise Chat Performance" tone="violet">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                    {CHAT_AGENT_COLS.map((c) => (
                      <FilterSortTh key={c.key} label={c.label} columnKey={c.key} sortKey={chatAgentSortKey} sortDir={chatAgentSortDir} onSort={toggleChatAgentSort} filters={chatAgentFilters} className={c.className} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedChatAgents.map((a) => (
                    <tr key={`${a.empId}-${a.agent}`} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-violet-50/40">
                      <td className="py-2.5 pr-3">
                        <div className="font-medium text-slate-700">{a.agent}</div>
                        <div className="text-[11px] text-slate-400">{a.empId}</div>
                      </td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{a.tickets}</td>
                      <td className={`py-2.5 pr-3 text-right font-semibold ${resolvedClass(a.resolvedPct)}`}>{a.resolvedPct}%</td>
                      <td className="py-2.5 pr-0 text-right text-slate-600">{a.avgCsat || "—"}</td>
                    </tr>
                  ))}
                  {sortedChatAgents.length === 0 && (
                    <tr><td colSpan={4} className="py-6 text-center text-slate-400">No agents match the search / filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      </div>
      )}

      {tab === "productivity" && (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <KpiCard icon={PhoneCall} label="Total Calls" value={productivity.headline.totalCalls.toLocaleString("en-IN")} tone="sky" />
          <KpiCard icon={Users} label="Active Agents" value={String(productivity.headline.activeAgents)} tone="indigo" />
          <KpiCard icon={Gauge} label="Avg Occupancy %" value={`${productivity.headline.avgOccupancyPct}%`} tone="violet" />
          <KpiCard icon={Clock3} label="Attendance Days" value={String(productivity.headline.attendanceDays)} tone="emerald" />
          <KpiCard icon={LogIn} label="Avg Net Login" value={secondsToHms(productivity.headline.avgNetLoginSec)} tone="teal" sub="per agent-day" />
          <KpiCard icon={Coffee} label="Avg Total Break" value={secondsToHms(productivity.headline.avgTotalBreakSec)} tone="amber" sub="per agent-day" />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <SectionCard icon={TrendingUp} title="Date-wise Calls & Occupancy" tone="violet">
              <ComboTrend
                data={productivity.dateWiseTrend}
                series={[
                  { key: "calls", name: "Calls", kind: "bar", color: "#7c3aed" },
                  { key: "loginAgents", name: "Agents logged in", kind: "line", color: "#6366f1" },
                  { key: "avgOccupancyPct", name: "Avg Occupancy %", kind: "line", color: "#f59e0b", axis: "right", format: fmtPct },
                ]}
              />
            </SectionCard>
          </div>
          <SectionCard icon={Trophy} title="Top agents by calls" tone="sky">
            <RankBars
              data={productivity.agents.map((a) => ({ name: a.name, value: a.calls }))}
              colors={["#0ea5e9", "#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#14b8a6", "#f97316"]}
            />
          </SectionCard>
        </div>

        <SectionCard
          icon={Layers} title="LOB-wise Productivity" tone="indigo"
          footnote="neemans_apr.lob — currently only Cart-process APR files have ever been uploaded to this table (for any month), so this shows one row today. Chat/Inbound/Email/Social Media rows will appear here automatically once their APR exports are uploaded."
          action={<ClearFiltersButton count={prodLobFilters.activeCount} onClear={prodLobFilters.clearAll} />}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  {PROD_LOB_COLS.map((c) => (
                    <FilterSortTh key={c.key} label={c.label} columnKey={c.key} sortKey={prodLobSortKey} sortDir={prodLobSortDir} onSort={toggleProdLobSort} filters={prodLobFilters} className={c.className} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedProdLob.map((r) => (
                  <tr key={r.lob} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-indigo-50/40">
                    <td className="py-2.5 pr-3 font-medium text-slate-700">{r.lob}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{r.calls.toLocaleString("en-IN")}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-600">{r.agents}</td>
                    <td className="py-2.5 pr-0 text-right font-semibold text-slate-800">{r.avgOccupancyPct}%</td>
                  </tr>
                ))}
                {sortedProdLob.length === 0 && (
                  <tr><td colSpan={4} className="py-6 text-center text-slate-400">{productivity.lobBreakdown.length === 0 ? "No data for this period." : "No rows match the filters."}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input type="text" value={prodSearch} onChange={(e) => setProdSearch(e.target.value)} placeholder="Search agent name or ID..."
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 shadow-sm transition-colors focus:border-violet-400 focus:outline-none" />
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500">
              <ListFilter className="h-3 w-3" />{sortedProdAgents.length} of {productivity.agents.length} agents
            </span>
            <ClearFiltersButton count={prodAgentFilters.activeCount} onClear={prodAgentFilters.clearAll} />
          </div>
          <SectionCard icon={Users} title="Agent-wise Productivity" tone="violet">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                    {PROD_AGENT_COLS.map((c) => (
                      <FilterSortTh key={c.key} label={c.label} columnKey={c.key} sortKey={prodAgentSortKey} sortDir={prodAgentSortDir} onSort={toggleProdAgentSort} filters={prodAgentFilters} className={c.className} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedProdAgents.map((a) => (
                    <tr key={a.empId} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-violet-50/40">
                      <td className="py-2.5 pr-3">
                        <div className="font-medium text-slate-700">{a.name}</div>
                        <div className="text-[11px] text-slate-400">{a.empId}</div>
                      </td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{a.calls}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{secondsToHms(a.loginTimeSec)}</td>
                      <td className="py-2.5 pr-3 text-right text-slate-600">{secondsToHms(a.talkTimeSec)}</td>
                      <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{a.occupancyPct}%</td>
                      <td className="py-2.5 pr-0 text-right text-slate-600">{a.attendanceDays}</td>
                    </tr>
                  ))}
                  {sortedProdAgents.length === 0 && (
                    <tr><td colSpan={6} className="py-6 text-center text-slate-400">No agents match the search / filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      </div>
      )}
    </div>
  );
}
