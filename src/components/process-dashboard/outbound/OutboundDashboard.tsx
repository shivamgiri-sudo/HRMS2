import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Drawer } from "../Drawer";
import { formatValue } from "../format";
import { Empty, ErrorBox, Panel, Skeleton } from "../ui";
import { BarList, DataTable, FilterBar, LiveHeader, Pager, Tiles, TrendChart, type DataCol, type TileData } from "../sales/common";
import { msg } from "../sales/ext.style";
import { useExtLive, useExtUrl } from "../sales/ext.hooks";
import { fetchAgent, fetchAgents, fetchOverview } from "../sales/extApi";

const PAGE = 25;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
interface Kpis { dials: number; connects: number; connectRate: number | null; uniqueLeads: number | null; contactPenetrationPct: number | null; attemptsPerLead: number | null; talkSec: number | null; avgTalkSec: number | null }
interface Disp { disposition: string; connected: boolean; calls: number; pct: number | null }
interface Heat { weekday: number; hour: number; dials: number; connects: number; connectRate: number | null }
interface Group extends Kpis { key: string }
interface AgentRow extends Kpis { agent: string; tl: string | null }
interface Overview {
  range: { from: string; to: string }; freshness: { latestDate: string | null; rows: number }; truncated: boolean; capabilities: Record<string, boolean>;
  tiles: Array<TileData>; trend: Array<Kpis & { date: string }>; dispositions: Disp[]; hourly: Array<{ hour: number; dials: number; connects: number; connectRate: number | null }>; heat: Heat[];
  byTl: Group[]; byCampaign: Group[]; topBottom: { top: AgentRow[]; bottom: AgentRow[] }; quality: { badDurations: number }; filters: { tls: string[]; campaigns: string[] };
}
interface AgentsRes { total: number; rows: AgentRow[] }
interface AgentDetail { agent: string; tl: string | null; range: { from: string; to: string }; kpis: Kpis; deltas: Record<string, number | null>; trend: Array<Kpis & { date: string }>; dispositions: Disp[]; hourly: Overview["hourly"]; byCampaign: Group[] }

const dispItems = (d: Disp[]) => d.slice(0, 12).map((x) => ({ label: x.disposition, value: x.calls, pct: x.pct, sub: x.connected ? "connect" : undefined, tone: x.connected ? ("good" as const) : ("neutral" as const) }));
const pctTxt = (v: number | null) => (v === null ? "—" : `${v}%`);
const num = (v: number | null, unit?: string) => formatValue(v, unit);

function GroupTable({ rows, caption, label, onPick }: { rows: Group[]; caption: string; label: string; onPick?: (k: string) => void }) {
  if (!rows.length) return <Empty>Not available for this source.</Empty>;
  return <DataTable caption={caption} maxHeight="max-h-72" rows={rows as unknown as Array<Record<string, unknown>>} onRow={onPick ? (r) => onPick(String(r.key)) : undefined} rowLabel={(r) => `Filter by ${r.key}`}
    cols={[{ key: "key", label, align: "left" }, { key: "dials", label: "Dials" }, { key: "connects", label: "Connects" }, { key: "connectRate", label: "Connect rate", unit: "percent" }, { key: "uniqueLeads", label: "Unique leads" }, { key: "avgTalkSec", label: "Avg talk", unit: "seconds" }]} />;
}

/** Weekday x hour grid. Colour intensity is decorative: every cell carries its dials and connect rate as text for assistive tech and in the table below. */
function HeatGrid({ cells }: { cells: Heat[] }) {
  if (!cells.length) return <Empty>No time of day in the source: map a call-time column, or use a DATETIME call date.</Empty>;
  const hours = Array.from(new Set(cells.map((c) => c.hour))).sort((a, b) => a - b);
  const by = new Map(cells.map((c) => [`${c.weekday}|${c.hour}`, c]));
  const max = Math.max(...cells.map((c) => c.dials), 1);
  return (
    <>
      <div className="overflow-x-auto"><table className="text-[10px]" aria-label="Dials by weekday and hour; darker means more dials">
        <thead><tr><th className="px-1" scope="col"><span className="sr-only">Day</span></th>{hours.map((h) => <th key={h} scope="col" className="px-1 font-semibold text-slate-700">{String(h).padStart(2, "0")}</th>)}</tr></thead>
        <tbody>{DAYS.map((dn, w) => <tr key={dn}><th scope="row" className="pr-2 text-left font-semibold text-slate-700">{dn}</th>
          {hours.map((h) => { const c = by.get(`${w}|${h}`); return <td key={h} className="p-0.5"><div title={c ? `${dn} ${h}:00 - ${c.dials} dials, ${c.connectRate ?? "n/a"}% connect` : `${dn} ${h}:00 - no dials`}
            className="flex h-7 w-8 items-center justify-center rounded text-[10px] tabular-nums" style={{ background: c ? `rgba(37,99,235,${0.12 + 0.78 * (c.dials / max)})` : "#f1f5f9", color: c && c.dials / max > 0.5 ? "#fff" : "#0f172a" }}>{c ? c.dials : ""}</div></td>; })}</tr>)}</tbody>
      </table></div>
      <details className="mt-2 text-xs text-slate-800"><summary className="cursor-pointer rounded font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">View as table</summary>
        <div className="mt-2"><DataTable caption="Dials and connect rate by weekday and hour" maxHeight="max-h-72" rows={cells.map((c) => ({ day: DAYS[c.weekday], hour: `${String(c.hour).padStart(2, "0")}:00`, dials: c.dials, connects: c.connects, connectRate: c.connectRate }))}
          cols={[{ key: "day", label: "Day", align: "left" }, { key: "hour", label: "Hour", align: "left" }, { key: "dials", label: "Dials" }, { key: "connects", label: "Connects" }, { key: "connectRate", label: "Connect rate", unit: "percent" }]} /></div></details>
    </>
  );
}

function KpiGrid({ k }: { k: Kpis }) {
  const items: Array<[string, string]> = [["Dials", num(k.dials)], ["Connects", num(k.connects)], ["Connect rate", pctTxt(k.connectRate)], ["Unique leads", num(k.uniqueLeads)], ["Contact penetration", pctTxt(k.contactPenetrationPct)],
    ["Attempts / lead", num(k.attemptsPerLead)], ["Talk time", num(k.talkSec, "seconds")], ["Avg talk / connect", num(k.avgTalkSec, "seconds")]];
  return <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">{items.map(([a, b]) => <div key={a}><dt className="text-slate-600">{a}</dt><dd className="text-base font-bold tabular-nums text-slate-900">{b}</dd></div>)}</dl>;
}

export function OutboundDashboard({ processId, name, refreshSeconds }: { processId: string; name: string; refreshSeconds: number }) {
  const { state, update } = useExtUrl();
  const live = useExtLive(processId, "outbound", refreshSeconds);
  const scopeKey = [state.from, state.to, state.tl, state.lob];
  const ov = useQuery({ queryKey: ["pd-outbound", processId, "overview", ...scopeKey], queryFn: () => fetchOverview<Overview>(processId, "outbound", state), placeholderData: keepPreviousData, staleTime: 10_000 });
  const ag = useQuery({ queryKey: ["pd-outbound", processId, "agents", ...scopeKey, state.q, state.sort, state.dir, state.page], placeholderData: keepPreviousData, staleTime: 10_000,
    queryFn: () => fetchAgents<AgentsRes>(processId, "outbound", { ...state, limit: PAGE, offset: (state.page - 1) * PAGE }) });
  const agent = useQuery({ queryKey: ["pd-outbound", processId, "agent", state.agent, state.from, state.to], queryFn: () => fetchAgent<AgentDetail>(processId, "outbound", state.agent, state), enabled: !!state.agent });
  const d = ov.data;
  const caps = d?.capabilities ?? {};
  const tiles = useMemo(() => d?.tiles ?? [], [d?.tiles]);
  const onSort = (key: string) => update({ sort: key, dir: state.sort === key && state.dir === "desc" ? "asc" : "desc", page: 1 });

  if (ov.isLoading) return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-16" /><Skeleton className="h-64" /></div>;
  if (ov.isError && !d) return <ErrorBox message={msg(ov.error)} onRetry={() => void ov.refetch()} />;
  if (!d) return null;
  const agentCols: DataCol[] = [
    { key: "agent", label: "Agent", align: "left", sortable: true }, { key: "tl", label: "Team leader", align: "left", sortable: true }, { key: "dials", label: "Dials", sortable: true }, { key: "connects", label: "Connects", sortable: true },
    { key: "connectRate", label: "Connect rate", unit: "percent", sortable: true },
    ...(caps.lead || caps.uniqueFlag ? [{ key: "uniqueLeads", label: "Unique leads", sortable: true }, { key: "attemptsPerLead", label: "Attempts / lead", sortable: true }] : []),
    ...(caps.lead ? [{ key: "contactPenetrationPct", label: "Penetration", unit: "percent", sortable: true }] : []),
    ...(caps.duration || caps.talk ? [{ key: "talkSec", label: "Talk time", unit: "seconds", sortable: true }, { key: "avgTalkSec", label: "Avg talk", unit: "seconds", sortable: true }] : []),
  ];
  return (
    <div className="space-y-4">
      <LiveHeader title={name} badgeLabel="Outbound" live={live} freshness={d.freshness} fetching={ov.isFetching} truncated={d.truncated} />
      <FilterBar state={state} onChange={update} range={d.range} tls={d.filters.tls} lobs={d.filters.campaigns} lobLabel="Campaign" />
      {d.tiles[0]?.value === 0 && <Empty>No calls for {d.range.from} to {d.range.to}. Try a wider date range.</Empty>}
      <Tiles tiles={tiles} label="Outbound key metrics" />
      <Panel title="Daily trend"><TrendChart name="Outbound trend" data={d.trend as unknown as Array<Record<string, unknown> & { date: string }>}
        series={[{ key: "dials", label: "Dials", unit: "count", type: "bar", axis: "l" }, { key: "connects", label: "Connects", unit: "count", type: "bar", axis: "l" }, { key: "connectRate", label: "Connect rate", unit: "percent", type: "line", axis: "r" }]} /></Panel>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Disposition mix"><BarList name="Calls by disposition" valueLabel="calls" items={dispItems(d.dispositions)} />
          {d.dispositions.length > 12 && <p className="mt-2 text-[11px] text-slate-600">Showing the 12 most frequent of {d.dispositions.length} dispositions.</p>}</Panel>
        <Panel title="Top and bottom agents by connect rate"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <RankList title="Top" rows={d.topBottom.top} onAgent={(a) => update({ agent: a }, true)} /><RankList title="Bottom" rows={d.topBottom.bottom} onAgent={(a) => update({ agent: a }, true)} /></div>
          <p className="mt-2 text-[11px] text-slate-600">Agents with at least 20 dials in the range.</p></Panel>
        <Panel title="Hourly activity"><HeatGrid cells={d.heat} /></Panel>
        <Panel title="By team leader"><GroupTable rows={d.byTl} caption="Outbound by team leader" label="Team leader" onPick={(k) => update({ tl: k === "Unassigned" ? "" : k })} /></Panel>
        {d.byCampaign.length > 0 && <Panel title="By campaign"><GroupTable rows={d.byCampaign} caption="Outbound by campaign" label="Campaign" onPick={(k) => update({ lob: k === "Unassigned" ? "" : k })} /></Panel>}
      </div>
      <Panel title="Agents">
        {ag.isError && !ag.data ? <ErrorBox message={msg(ag.error)} onRetry={() => void ag.refetch()} /> : !ag.data?.rows.length ? <Empty>No agents for this range and filters.</Empty> : (
          <>
            <DataTable caption="Outbound by agent" rows={ag.data.rows as unknown as Array<Record<string, unknown>>} cols={agentCols} sort={state.sort} dir={state.dir} onSort={onSort}
              onRow={(r) => update({ agent: String(r.agent) }, true)} rowLabel={(r) => `Open details for agent ${r.agent}`} />
            <Pager page={state.page} total={ag.data.total} size={PAGE} onPage={(page) => update({ page })} />
          </>)}
      </Panel>
      {state.agent && <AgentDrawer code={state.agent} q={agent} onClose={() => update({ agent: "" })} />}
    </div>
  );
}

function RankList({ title, rows, onAgent }: { title: string; rows: AgentRow[]; onAgent: (a: string) => void }) {
  return (
    <div><h4 className="mb-1 text-xs font-bold text-slate-700">{title}</h4>
      {!rows.length ? <p className="text-xs text-slate-600">None</p> : <ol className="space-y-1">{rows.map((r) => (
        <li key={r.agent} className="flex items-center justify-between gap-2 text-xs">
          <button type="button" onClick={() => onAgent(r.agent)} aria-label={`Open details for agent ${r.agent}`} className="cursor-pointer rounded font-semibold text-blue-800 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">{r.agent}</button>
          <span className="tabular-nums text-slate-800">{pctTxt(r.connectRate)} of {r.dials.toLocaleString("en-IN")}</span></li>))}</ol>}
    </div>
  );
}

function AgentDrawer({ code, q, onClose }: { code: string; q: ReturnType<typeof useQuery<AgentDetail>>; onClose: () => void }) {
  const d = q.data;
  return (
    <Drawer title={`Agent ${code}`} subtitle={d ? `${d.tl ? `${d.tl} · ` : ""}${d.range.from} to ${d.range.to}` : undefined} onClose={onClose}>
      {q.isLoading ? <><Skeleton className="h-24" /><Skeleton className="h-48" /></> : q.isError ? <ErrorBox message={msg(q.error)} onRetry={() => void q.refetch()} /> : !d ? <Empty>No data.</Empty> : (
        <>
          <Panel title="Performance"><KpiGrid k={d.kpis} /></Panel>
          <Panel title="Daily trend"><TrendChart name={`Agent ${code}`} data={d.trend as unknown as Array<Record<string, unknown> & { date: string }>}
            series={[{ key: "dials", label: "Dials", unit: "count", type: "bar", axis: "l" }, { key: "connectRate", label: "Connect rate", unit: "percent", type: "line", axis: "r" }]} /></Panel>
          <Panel title="Disposition mix"><BarList name="Agent calls by disposition" valueLabel="calls" items={dispItems(d.dispositions)} /></Panel>
          {d.hourly.length > 0 && <Panel title="By hour"><DataTable caption="Agent dials by hour" maxHeight="max-h-64" rows={d.hourly.map((h) => ({ ...h, hourLabel: `${String(h.hour).padStart(2, "0")}:00` })) as unknown as Array<Record<string, unknown>>}
            cols={[{ key: "hourLabel", label: "Hour", align: "left" }, { key: "dials", label: "Dials" }, { key: "connects", label: "Connects" }, { key: "connectRate", label: "Connect rate", unit: "percent" }]} /></Panel>}
          {d.byCampaign.length > 0 && <Panel title="By campaign"><GroupTable rows={d.byCampaign} caption="Agent calls by campaign" label="Campaign" /></Panel>}
        </>)}
    </Drawer>
  );
}
