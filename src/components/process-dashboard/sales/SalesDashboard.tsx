import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Drawer } from "../Drawer";
import { formatValue } from "../format";
import { Empty, ErrorBox, Panel, Skeleton } from "../ui";
import { BarList, DataTable, FilterBar, LiveHeader, Pager, Tiles, TrendChart, type DataCol, type TileData } from "./common";
import { msg } from "./ext.style";
import { useExtLive, useExtUrl } from "./ext.hooks";
import { fetchAgent, fetchAgents, fetchDay, fetchOverview } from "./extApi";

const PAGE = 25;
interface Kpis { orders: number; netOrders: number | null; grossRevenue: number | null; netRevenue: number | null; aov: number | null; prepaidPct: number | null; rtoPct: number | null; cancellationPct: number | null; deliveredPct: number | null; pendingPct: number | null; calls: number | null; conversionPct: number | null }
interface Group extends Kpis { key: string }
interface Funnel { status: string; label: string; orders: number; revenue: number | null; pct: number | null }
interface Pacing { target: number; achieved: number; attainmentPct: number | null; expectedToDate: number; pacingPct: number | null; projected: number | null; projectedAttainmentPct: number | null; elapsedDays: number; daysInMonth: number; month: string }
interface AgentRow extends Kpis { agent: string; tl: string | null; target: number | null; achieved: number | null; attainmentPct: number | null; pacingPct: number | null; projectedAttainmentPct: number | null }
interface Overview {
  range: { from: string; to: string }; freshness: { latestDate: string | null; rows: number }; truncated: boolean; capabilities: Record<string, boolean>; targetMetric: string;
  kpis: Kpis; tiles: Array<TileData & { prev: number | null }>; pacing: Pacing | null; trend: Array<Kpis & { date: string }>; funnel: Funnel[];
  byTl: Group[]; byProduct: Group[]; byLob: Group[]; topBottom: { top: AgentRow[]; bottom: AgentRow[] };
  quality: { duplicateOrders: number; badAmounts: number; unmappedStatuses: Array<{ value: string; orders: number }> };
  filters: { tls: string[]; lobs: string[]; products: string[] };
}
interface AgentsRes { total: number; rows: AgentRow[]; capabilities: Record<string, boolean> }
interface AgentDetail { agent: string; tl: string | null; range: { from: string; to: string }; kpis: Kpis; target: number | null; achieved: number | null; attainmentPct: number | null; pacingPct: number | null; projectedAttainmentPct: number | null; targetMetric: string;
  trend: Array<Kpis & { date: string }>; funnel: Funnel[]; byProduct: Group[]; recentOrders: Array<{ orderId: string | null; date: string; amount: number | null; status: string | null; product: string | null; prepaid: boolean | null }> }
interface DayDetail { date: string; kpis: Kpis; funnel: Funnel[]; byProduct: Group[]; byAgent: Group[]; byTl: Group[] }

const STATUS_TONE: Record<string, "good" | "bad" | "neutral"> = { delivered: "good", rto: "bad", cancelled: "bad", pending: "neutral", other: "neutral" };
const funnelItems = (f: Funnel[]) => f.filter((s) => s.orders > 0 || s.status !== "other").map((s) => ({ label: s.label, value: s.orders, pct: s.pct, sub: s.revenue !== null ? formatValue(s.revenue, "currency") : undefined, tone: STATUS_TONE[s.status] }));
const pctTxt = (v: number | null) => (v === null ? "—" : `${v}%`);

function GroupTable({ rows, caption, label, onPick }: { rows: Group[]; caption: string; label: string; onPick?: (k: string) => void }) {
  if (!rows.length) return <Empty>Not available for this source.</Empty>;
  return <DataTable caption={caption} maxHeight="max-h-72" rows={rows as unknown as Array<Record<string, unknown>>} onRow={onPick ? (r) => onPick(String(r.key)) : undefined} rowLabel={(r) => `Filter by ${r.key}`}
    cols={[{ key: "key", label, align: "left" }, { key: "orders", label: "Orders" }, { key: "netRevenue", label: "Net revenue", unit: "currency" }, { key: "aov", label: "AOV", unit: "currency" }, { key: "rtoPct", label: "RTO %", unit: "percent" }, { key: "prepaidPct", label: "Prepaid %", unit: "percent" }]} />;
}

export function SalesDashboard({ processId, name, refreshSeconds }: { processId: string; name: string; refreshSeconds: number }) {
  const { state, update } = useExtUrl();
  const live = useExtLive(processId, "sales", refreshSeconds);
  const scopeKey = [state.from, state.to, state.tl, state.lob, state.product];
  const ov = useQuery({ queryKey: ["pd-sales", processId, "overview", ...scopeKey], queryFn: () => fetchOverview<Overview>(processId, "sales", state), placeholderData: keepPreviousData, staleTime: 10_000 });
  const ag = useQuery({ queryKey: ["pd-sales", processId, "agents", ...scopeKey, state.q, state.sort, state.dir, state.page], placeholderData: keepPreviousData, staleTime: 10_000,
    queryFn: () => fetchAgents<AgentsRes>(processId, "sales", { ...state, limit: PAGE, offset: (state.page - 1) * PAGE }) });
  const agent = useQuery({ queryKey: ["pd-sales", processId, "agent", state.agent, state.from, state.to], queryFn: () => fetchAgent<AgentDetail>(processId, "sales", state.agent, state), enabled: !!state.agent });
  const day = useQuery({ queryKey: ["pd-sales", processId, "day", state.day, state.tl, state.lob, state.product], queryFn: () => fetchDay<DayDetail>(processId, state.day, state), enabled: !!state.day && !state.agent });
  const d = ov.data;
  const caps = d?.capabilities ?? {};
  const tiles = useMemo(() => (d?.tiles ?? []).map((t) => (t.key === "conversionPct" ? { ...t, note: "Orders per APR call" } : t)), [d?.tiles]);
  const onSort = (key: string) => update({ sort: key, dir: state.sort === key && state.dir === "desc" ? "asc" : "desc", page: 1 });

  if (ov.isLoading) return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-16" /><Skeleton className="h-64" /></div>;
  if (ov.isError && !d) return <ErrorBox message={msg(ov.error)} onRetry={() => void ov.refetch()} />;
  if (!d) return null;
  const agentCols: DataCol[] = [
    { key: "agent", label: "Agent", align: "left", sortable: true }, { key: "tl", label: "Team leader", align: "left", sortable: true },
    { key: "orders", label: "Orders", sortable: true }, { key: "netRevenue", label: "Net revenue", unit: "currency", sortable: true }, { key: "aov", label: "AOV", unit: "currency", sortable: true },
    { key: "rtoPct", label: "RTO %", unit: "percent", sortable: true }, { key: "prepaidPct", label: "Prepaid %", unit: "percent", sortable: true },
    ...(caps.calls ? [{ key: "conversionPct", label: "Conversion", unit: "percent", sortable: true }] : []),
    ...(caps.roster ? [{ key: "target", label: "Target", unit: d.targetMetric === "orders" ? undefined : "currency", sortable: true }, { key: "attainmentPct", label: "Attainment", unit: "percent", sortable: true }, { key: "pacingPct", label: "Pacing", unit: "percent", sortable: true }] : []),
  ];
  return (
    <div className="space-y-4">
      <LiveHeader title={name} badgeLabel="Sales" live={live} freshness={d.freshness} fetching={ov.isFetching} truncated={d.truncated} />
      <FilterBar state={state} onChange={update} range={d.range} tls={d.filters.tls} lobs={d.filters.lobs} lobLabel="LOB" products={d.filters.products} />
      {d.kpis.orders === 0 && <Empty>No orders for {d.range.from} to {d.range.to}. Try a wider date range.</Empty>}
      <Tiles tiles={tiles} label="Sales key metrics" />
      {d.pacing && (
        <Panel title={`Target pacing, ${d.pacing.month}`}>
          <p className="text-sm text-slate-900">Achieved <b className="tabular-nums">{fmtTarget(d.pacing.achieved, d.targetMetric)}</b> of <b className="tabular-nums">{fmtTarget(d.pacing.target, d.targetMetric)}</b> ({pctTxt(d.pacing.attainmentPct)}). Expected by day {d.pacing.elapsedDays} of {d.pacing.daysInMonth}: <b className="tabular-nums">{fmtTarget(d.pacing.expectedToDate, d.targetMetric)}</b>, so pacing is <b>{pctTxt(d.pacing.pacingPct)}</b>; at this rate the month ends at <b className="tabular-nums">{d.pacing.projected === null ? "—" : fmtTarget(d.pacing.projected, d.targetMetric)}</b> ({pctTxt(d.pacing.projectedAttainmentPct)} of target).</p>
          <div role="progressbar" aria-label="Target attainment" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(d.pacing.attainmentPct ?? 0))} className="mt-2 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-blue-600" style={{ width: `${Math.min(100, d.pacing.attainmentPct ?? 0)}%` }} /></div>
        </Panel>)}
      <Panel title="Daily trend"><TrendChart name="Sales trend" data={d.trend as unknown as Array<Record<string, unknown> & { date: string }>} onDay={(day) => update({ day }, true)}
        series={[{ key: "orders", label: "Orders", unit: "count", type: "bar", axis: "l" }, ...(caps.amount ? [{ key: "netRevenue", label: "Net revenue", unit: "currency", type: "line" as const, axis: "r" as const }] : [])]} /></Panel>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Order status funnel">{d.funnel.length ? <BarList name="Orders by status" items={funnelItems(d.funnel)} /> : <Empty>Map the order status column to see the funnel.</Empty>}
          {d.quality.unmappedStatuses.length > 0 && <p className="mt-2 text-[11px] text-amber-900">Statuses not yet classified: {d.quality.unmappedStatuses.slice(0, 5).map((s) => `${s.value} (${s.orders})`).join(", ")}. Assign them in Dashboard Setup.</p>}</Panel>
        <Panel title="Top and bottom agents"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <RankList title="Top" rows={d.topBottom.top} onAgent={(a) => update({ agent: a }, true)} /><RankList title="Bottom" rows={d.topBottom.bottom} onAgent={(a) => update({ agent: a }, true)} /></div></Panel>
        <Panel title="By team leader"><GroupTable rows={d.byTl} caption="Sales by team leader" label="Team leader" onPick={(k) => update({ tl: k === "Unassigned" ? "" : k })} /></Panel>
        <Panel title="By product"><GroupTable rows={d.byProduct} caption="Sales by product" label="Product" onPick={(k) => update({ product: k === "Unassigned" ? "" : k })} /></Panel>
        {d.byLob.length > 0 && <Panel title="By LOB"><GroupTable rows={d.byLob} caption="Sales by LOB" label="LOB" onPick={(k) => update({ lob: k === "Unassigned" ? "" : k })} /></Panel>}
      </div>
      <Panel title="Agents">
        {ag.isError && !ag.data ? <ErrorBox message={msg(ag.error)} onRetry={() => void ag.refetch()} /> : !ag.data?.rows.length ? <Empty>No agents for this range and filters.</Empty> : (
          <>
            <DataTable caption="Sales by agent" rows={ag.data.rows as unknown as Array<Record<string, unknown>>} cols={agentCols} sort={state.sort} dir={state.dir} onSort={onSort}
              onRow={(r) => update({ agent: String(r.agent) }, true)} rowLabel={(r) => `Open details for agent ${r.agent}`} />
            <Pager page={state.page} total={ag.data.total} size={PAGE} onPage={(page) => update({ page })} />
          </>)}
      </Panel>
      {state.agent && <AgentDrawer code={state.agent} q={agent} target={d.targetMetric} onClose={() => update({ agent: "" })} onDay={(day) => update({ day, agent: "" }, true)} />}
      {state.day && !state.agent && <DayDrawer date={state.day} q={day} onClose={() => update({ day: "" })} onAgent={(a) => update({ agent: a, day: "" }, true)} />}
    </div>
  );
}

const fmtTarget = (v: number, metric: string) => (metric === "orders" ? v.toLocaleString("en-IN") : formatValue(v, "currency"));

function RankList({ title, rows, onAgent }: { title: string; rows: AgentRow[]; onAgent: (a: string) => void }) {
  return (
    <div><h4 className="mb-1 text-xs font-bold text-slate-700">{title}</h4>
      {!rows.length ? <p className="text-xs text-slate-600">None</p> : <ol className="space-y-1">{rows.map((r) => (
        <li key={r.agent} className="flex items-center justify-between gap-2 text-xs">
          <button type="button" onClick={() => onAgent(r.agent)} aria-label={`Open details for agent ${r.agent}`} className="cursor-pointer rounded font-semibold text-blue-800 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">{r.agent}</button>
          <span className="tabular-nums text-slate-800">{r.netRevenue !== null ? formatValue(r.netRevenue, "currency") : `${r.orders} orders`}</span></li>))}</ol>}
    </div>
  );
}

function KpiGrid({ k }: { k: Kpis }) {
  const items: Array<[string, string]> = [["Orders", String(k.orders)], ["Gross revenue", formatValue(k.grossRevenue, "currency")], ["Net revenue", formatValue(k.netRevenue, "currency")], ["AOV", formatValue(k.aov, "currency")],
    ["Prepaid", pctTxt(k.prepaidPct)], ["RTO", pctTxt(k.rtoPct)], ["Cancelled", pctTxt(k.cancellationPct)], ["Delivered", pctTxt(k.deliveredPct)], ...(k.conversionPct !== null ? [["Conversion", pctTxt(k.conversionPct)] as [string, string]] : [])];
  return <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">{items.map(([a, b]) => <div key={a}><dt className="text-slate-600">{a}</dt><dd className="text-base font-bold tabular-nums text-slate-900">{b}</dd></div>)}</dl>;
}

function AgentDrawer({ code, q, target, onClose, onDay }: { code: string; q: ReturnType<typeof useQuery<AgentDetail>>; target: string; onClose: () => void; onDay: (d: string) => void }) {
  const d = q.data;
  return (
    <Drawer title={`Agent ${code}`} subtitle={d ? `${d.tl ? `${d.tl} · ` : ""}${d.range.from} to ${d.range.to}` : undefined} onClose={onClose}>
      {q.isLoading ? <><Skeleton className="h-24" /><Skeleton className="h-48" /></> : q.isError ? <ErrorBox message={msg(q.error)} onRetry={() => void q.refetch()} /> : !d ? <Empty>No data.</Empty> : (
        <>
          <Panel title="Performance"><KpiGrid k={d.kpis} /></Panel>
          {d.target !== null && <Panel title="Target"><p className="text-sm text-slate-900">Month to date <b className="tabular-nums">{fmtTarget(d.achieved ?? 0, target)}</b> of <b className="tabular-nums">{fmtTarget(d.target, target)}</b>: attainment <b>{pctTxt(d.attainmentPct)}</b>, pacing <b>{pctTxt(d.pacingPct)}</b>, projected month end <b>{pctTxt(d.projectedAttainmentPct)}</b> of target.</p></Panel>}
          <Panel title="Daily trend"><TrendChart name={`Agent ${code}`} data={d.trend as unknown as Array<Record<string, unknown> & { date: string }>} onDay={onDay}
            series={[{ key: "orders", label: "Orders", unit: "count", type: "bar", axis: "l" }, { key: "netRevenue", label: "Net revenue", unit: "currency", type: "line", axis: "r" }]} /></Panel>
          {d.funnel.length > 0 && <Panel title="Order status"><BarList name="Agent orders by status" items={funnelItems(d.funnel)} /></Panel>}
          {d.byProduct.length > 0 && <Panel title="By product"><GroupTable rows={d.byProduct} caption="Agent sales by product" label="Product" /></Panel>}
          <Panel title="Recent orders">{d.recentOrders.length ? <DataTable caption="Latest orders of this agent" maxHeight="max-h-72" rows={d.recentOrders as unknown as Array<Record<string, unknown>>}
            cols={[{ key: "date", label: "Date", align: "left" }, { key: "orderId", label: "Order", align: "left" }, { key: "status", label: "Status", align: "left" }, { key: "product", label: "Product", align: "left" }, { key: "amount", label: "Amount", unit: "currency" }]} /> : <Empty>No orders in range.</Empty>}</Panel>
        </>)}
    </Drawer>
  );
}

function DayDrawer({ date, q, onClose, onAgent }: { date: string; q: ReturnType<typeof useQuery<DayDetail>>; onClose: () => void; onAgent: (a: string) => void }) {
  const d = q.data;
  return (
    <Drawer title={date} subtitle="Sales for the day" onClose={onClose}>
      {q.isLoading ? <><Skeleton className="h-24" /><Skeleton className="h-48" /></> : q.isError ? <ErrorBox message={msg(q.error)} onRetry={() => void q.refetch()} /> : !d ? <Empty>No data.</Empty> : (
        <>
          <Panel title="Day totals"><KpiGrid k={d.kpis} /></Panel>
          {d.funnel.length > 0 && <Panel title="Order status"><BarList name="Orders by status on this day" items={funnelItems(d.funnel)} /></Panel>}
          <Panel title="By agent"><GroupTable rows={d.byAgent} caption="Sales by agent on this day" label="Agent" onPick={onAgent} /></Panel>
          {d.byProduct.length > 0 && <Panel title="By product"><GroupTable rows={d.byProduct} caption="Sales by product on this day" label="Product" /></Panel>}
        </>)}
    </Drawer>
  );
}
