import { useMemo } from "react";
import {
  ClipboardList, PhoneCall, Repeat, ShoppingCart, IndianRupee, PhoneOff, Clock3, Percent, Layers, Users,
  Warehouse, MapPin, TrendingUp, CheckCircle2, ListTree, CalendarClock,
} from "lucide-react";
import { KpiCard, SectionCard, formatINR } from "./DashboardKit";
import { ComboTrend, Donut, RankBars, fmtPct } from "./NeemansCharts";
import { BarCell, DataTable, type Col } from "./SatyaUi";
import {
  addCounts, callsMade, emptyCounts, fmtInt, fmtRatio, outcomeLabel, ratio, subDispositionTotals,
  type SatyaAgentRow, type SatyaBeatRow, type SatyaCounts, type SatyaReportData, type SatyaWarehouseRow,
} from "./satyaReportModel";
import type { SatyaDetailTarget } from "./SatyaDetailDrawer";

const sumCounts = (rows: Array<{ counts: SatyaCounts }>) => rows.reduce((s, r) => addCounts(s, r.counts), emptyCounts());

/**
 * "Calling & Order Tracking Report" -- the first page of the report, laid out
 * after the ops team's Excel sheet: headline tiles, disposition split,
 * connected-outcome table, roster table, agent-wise calling details and the
 * warehouse / agent / beat order tables. Table rows open the drill-down drawer.
 */
export function SatyaOverviewTab({ data, onOpen }: { data: SatyaReportData; onOpen: (t: SatyaDetailTarget) => void }) {
  const h = data.headline;
  const made = callsMade(h);
  const dialled = h.connected + h.notConnected;

  const connectedOutcomes = useMemo(() => subDispositionTotals(data, "Connected"), [data]);
  const notConnectedReasons = useMemo(
    () => subDispositionTotals(data, "Not Connected").map((r) => ({ name: outcomeLabel(r.name), count: r.count })),
    [data],
  );
  const connectedTotal = connectedOutcomes.reduce((s, r) => s + r.count, 0);
  const maxOutcome = Math.max(0, ...connectedOutcomes.map((r) => r.count));

  const dayTotals = useMemo(() => {
    const byDay = new Map<string, SatyaCounts>();
    for (const d of data.daily) byDay.set(d.date, addCounts(byDay.get(d.date) ?? emptyCounts(), d.counts));
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, c]) => ({
      date, allocation: c.allocation, connected: c.connected, orders: c.orders,
    }));
  }, [data.daily]);

  const agentTotals = sumCounts(data.agents);
  const agentCols: Array<Col<SatyaAgentRow>> = [
    { key: "agent", label: "Agent", sort: (r) => r.agentName, total: "Total", render: (r) => (
      <div><div className="font-medium text-slate-700">{r.agentName}</div>{r.agentName !== r.agentId && <div className="text-[11px] text-slate-400">{r.agentId}</div>}</div>
    ) },
    { key: "unique", label: "Unique calls", align: "right", sort: (r) => r.counts.unique, total: fmtInt(agentTotals.unique), render: (r) => fmtInt(r.counts.unique) },
    { key: "repeat", label: "Repeat calls", align: "right", sort: (r) => r.counts.repeat, total: fmtInt(agentTotals.repeat), render: (r) => fmtInt(r.counts.repeat) },
    { key: "made", label: "Total calls", align: "right", sort: (r) => callsMade(r.counts), total: fmtInt(callsMade(agentTotals)), render: (r) => <span className="font-semibold text-slate-800">{fmtInt(callsMade(r.counts))}</span> },
    { key: "conn", label: "Connected", align: "right", sort: (r) => r.counts.connected, total: fmtInt(agentTotals.connected), render: (r) => <span className="text-emerald-700">{fmtInt(r.counts.connected)}</span> },
    { key: "nc", label: "Not connected", align: "right", sort: (r) => r.counts.notConnected, total: fmtInt(agentTotals.notConnected), render: (r) => <span className="text-rose-600">{fmtInt(r.counts.notConnected)}</span> },
  ];

  const whTotals = sumCounts(data.warehouses);
  const whCols: Array<Col<SatyaWarehouseRow>> = [
    { key: "wh", label: "Warehouse", sort: (r) => r.warehouse, total: "Total", render: (r) => <span className="font-medium text-slate-700">{r.warehouse}</span> },
    { key: "orders", label: "Orders placed", align: "right", sort: (r) => r.counts.orders, total: fmtInt(whTotals.orders), render: (r) => <span className="font-semibold text-slate-800">{fmtInt(r.counts.orders)}</span> },
  ];

  const orderAgents = data.agents.filter((a) => a.counts.orders > 0);
  const orderAgentCols: Array<Col<SatyaAgentRow>> = [
    { key: "agent", label: "Agent", sort: (r) => r.agentName, total: "Total", render: (r) => <span className="font-medium text-slate-700">{r.agentName}</span> },
    { key: "orders", label: "Orders placed", align: "right", sort: (r) => r.counts.orders, total: fmtInt(agentTotals.orders), render: (r) => <span className="font-semibold text-slate-800">{fmtInt(r.counts.orders)}</span> },
  ];

  const orderBeats = data.beats.filter((b) => b.counts.orders > 0).sort((a, b) => b.counts.orders - a.counts.orders);
  const maxBeatOrders = Math.max(0, ...orderBeats.map((b) => b.counts.orders));
  const beatCols: Array<Col<SatyaBeatRow>> = [
    { key: "beat", label: "Beat", sort: (r) => r.beat, total: "Total", render: (r) => <span className="font-medium text-slate-700">{r.beat}</span> },
    { key: "orders", label: "Orders placed", align: "right", sort: (r) => r.counts.orders, total: fmtInt(sumCounts(orderBeats).orders), render: (r) => (
      <BarCell value={r.counts.orders} max={maxBeatOrders} color="#ea580c"><span className="font-semibold text-slate-800">{fmtInt(r.counts.orders)}</span></BarCell>
    ) },
  ];

  const rosterRows = data.byRoster
    .filter((r) => r.roster !== "Unmapped" || r.counts.allocation > 0)
    .sort((a, b) => ["Morning", "Absentee", "Unmapped"].indexOf(a.roster) - ["Morning", "Absentee", "Unmapped"].indexOf(b.roster));
  const rosterTotals = sumCounts(rosterRows);
  const rosterCols: Array<Col<{ roster: string; counts: SatyaCounts }>> = [
    { key: "roster", label: "Roster", total: "Grand total", render: (r) => <span className="font-medium text-slate-700">{r.roster === "Morning" ? "Morning roster" : r.roster === "Absentee" ? "Absentee beat" : "Unmapped roster"}</span> },
    { key: "alloc", label: "Allocation", align: "right", total: fmtInt(rosterTotals.allocation), render: (r) => fmtInt(r.counts.allocation) },
    { key: "conn", label: "Connected", align: "right", total: fmtInt(rosterTotals.connected), render: (r) => <span className="text-emerald-700">{fmtInt(r.counts.connected)}</span> },
    { key: "nc", label: "Not connected", align: "right", total: fmtInt(rosterTotals.notConnected), render: (r) => <span className="text-rose-600">{fmtInt(r.counts.notConnected)}</span> },
    { key: "orders", label: "Orders placed", align: "right", total: fmtInt(rosterTotals.orders), render: (r) => <span className="font-semibold text-slate-800">{fmtInt(r.counts.orders)}</span> },
    { key: "conv", label: "Conversion", align: "right", total: fmtRatio(ratio(rosterTotals.orders, callsMade(rosterTotals))), render: (r) => fmtRatio(ratio(r.counts.orders, callsMade(r.counts))) },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <KpiCard icon={ClipboardList} label="Total allocation" value={fmtInt(h.allocation)} sub={`${h.shops.toLocaleString("en-IN")} shops`} tone="violet" />
        <KpiCard icon={PhoneCall} label="Total calls made" value={fmtInt(made)} sub={`allocation − ${fmtInt(h.pending)} pending`} tone="amber" />
        <KpiCard icon={CheckCircle2} label="Unique calls" value={fmtInt(h.unique)} sub="first-time calls" tone="sky" />
        <KpiCard icon={Repeat} label="Repeat calls" value={fmtInt(h.repeat)} sub="repeat allocations" tone="indigo" />
        <KpiCard icon={PhoneCall} label="Connected" value={fmtInt(h.connected)} sub={`${fmtRatio(ratio(h.connected, dialled))} of dialled`} tone="emerald" />
        <KpiCard icon={PhoneOff} label="Not connected" value={fmtInt(h.notConnected)} sub={`${fmtRatio(ratio(h.notConnected, dialled))} of dialled`} tone="rose" />
        <KpiCard icon={ShoppingCart} label="Total orders placed" value={fmtInt(h.orders)} sub={`${fmtRatio(ratio(h.orders, made))} of calls made`} tone="teal" />
        <KpiCard icon={IndianRupee} label="Order revenue" value={formatINR(h.revenue)} sub={h.orders ? `${formatINR(Math.round(h.revenue / h.orders))} per order` : undefined} tone="emerald" />
      </div>

      <SectionCard icon={TrendingUp} title="Allocation, connects & orders by day" tone="amber">
        <ComboTrend
          data={dayTotals}
          series={[
            { key: "allocation", name: "Allocation", kind: "bar", color: "#f59e0b" },
            { key: "connected", name: "Connected", kind: "line", color: "#10b981" },
            { key: "orders", name: "Orders", kind: "line", color: "#7c3aed", axis: "right" },
          ]}
        />
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard icon={Percent} title="Disposition wise" tone="teal" footnote="% is of dialled calls (connected + not connected), as in the Excel report. Dropped and pending are shown separately.">
          <table className="mb-3 w-full text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                <th className="py-2 text-left font-semibold">Disposition</th><th className="py-2 text-right font-semibold">Count</th><th className="py-2 text-right font-semibold">%</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-50"><td className="py-2 font-medium text-emerald-700">Connected</td><td className="py-2 text-right">{fmtInt(h.connected)}</td><td className="py-2 text-right font-semibold">{fmtRatio(ratio(h.connected, dialled))}</td></tr>
              <tr className="border-b border-slate-50"><td className="py-2 font-medium text-rose-600">Not connected</td><td className="py-2 text-right">{fmtInt(h.notConnected)}</td><td className="py-2 text-right font-semibold">{fmtRatio(ratio(h.notConnected, dialled))}</td></tr>
              <tr className="border-t-2 border-slate-200 font-bold"><td className="py-2">Total dialled</td><td className="py-2 text-right">{fmtInt(dialled)}</td><td className="py-2 text-right">100%</td></tr>
              <tr className="text-slate-400"><td className="pt-2">Call dropped</td><td className="pt-2 text-right">{fmtInt(h.dropped)}</td><td /></tr>
              <tr className="text-slate-400"><td>Pending (not called)</td><td className="text-right">{fmtInt(h.pending)}</td><td /></tr>
            </tbody>
          </table>
          <Donut
            height={170}
            data={[
              { name: "Connected", value: h.connected }, { name: "Not connected", value: h.notConnected },
              { name: "Call dropped", value: h.dropped }, { name: "Pending", value: h.pending },
            ]}
            colors={["#10b981", "#f43f5e", "#f59e0b", "#94a3b8"]}
            centerValue={fmtRatio(ratio(h.connected, dialled))} centerLabel="Connect rate"
          />
        </SectionCard>

        <div className="lg:col-span-2">
          <SectionCard icon={ListTree} title="Call status — connected (sub-disposition)" tone="emerald" footnote="Every outcome exactly as uploaded, so spelling variants (e.g. 'Shop Closed Temporary' vs 'Shop Closed – Temporary') appear as separate rows — see Data checks.">
            <DataTable
              maxHeight="520px"
              columns={[
                { key: "s", label: "Call status", total: "Total", render: (r: { name: string; count: number }) => <span className="font-medium text-slate-700">{r.name}</span>, sort: (r) => r.name },
                { key: "n", label: "Count", align: "right", total: fmtInt(connectedTotal), sort: (r) => r.count, render: (r) => (
                  <BarCell value={r.count} max={maxOutcome} color="#10b981">{fmtInt(r.count)}</BarCell>
                ) },
                { key: "p", label: "%", align: "right", total: "100%", render: (r) => <span className="text-slate-500">{fmtRatio(ratio(r.count, connectedTotal))}</span> },
              ]}
              rows={connectedOutcomes}
              rowKey={(r) => r.name}
              defaultSort={{ key: "n", dir: "desc" }}
            />
          </SectionCard>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard icon={CalendarClock} title="Morning roster / Absentee beat" tone="violet">
          <DataTable columns={rosterCols} rows={rosterRows} rowKey={(r) => r.roster} />
        </SectionCard>
        <SectionCard icon={PhoneOff} title="Why calls didn't connect" tone="rose" footnote="Sub-disposition on not-connected rows; 'Not tagged' = the source sheet left it as 0.">
          <RankBars data={notConnectedReasons.map((r) => ({ name: r.name, value: r.count }))} maxRows={8} colors={["#f43f5e", "#f97316", "#f59e0b", "#a855f7", "#6366f1", "#0ea5e9", "#14b8a6", "#64748b"]} />
        </SectionCard>
      </div>

      <SectionCard icon={Users} title="Agent-wise calling details" tone="amber" footnote="Click an agent for a full drill-down. Unique + repeat = calls made (see Data checks for how this differs from the Excel's 13,912 headline).">
        <DataTable columns={agentCols} rows={data.agents} rowKey={(r) => r.agentId} onRowClick={(r) => onOpen({ type: "agent", key: r.agentId })} defaultSort={{ key: "made", dir: "desc" }} />
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard icon={Warehouse} title="Warehouse-wise orders" tone="teal">
          <DataTable columns={whCols} rows={data.warehouses} rowKey={(r) => r.warehouse} onRowClick={(r) => onOpen({ type: "warehouse", key: r.warehouse })} defaultSort={{ key: "orders", dir: "desc" }} />
        </SectionCard>
        <SectionCard icon={Layers} title="Agent-wise orders" tone="violet">
          <DataTable columns={orderAgentCols} rows={orderAgents} rowKey={(r) => r.agentId} onRowClick={(r) => onOpen({ type: "agent", key: r.agentId })} defaultSort={{ key: "orders", dir: "desc" }} empty="No orders in this range." />
        </SectionCard>
        <SectionCard icon={MapPin} title="Orders — beat wise" tone="amber">
          <DataTable maxHeight="360px" columns={beatCols} rows={orderBeats} rowKey={(r) => r.beat} onRowClick={(r) => onOpen({ type: "beat", key: r.beat })} defaultSort={{ key: "orders", dir: "desc" }} empty="No orders in this range." />
        </SectionCard>
      </div>

      <SectionCard icon={Clock3} title="Connect rate by day" tone="sky">
        <ComboTrend
          height={200}
          data={dayTotals.map((d) => ({ date: d.date, connectRate: ratio(d.connected, d.allocation) ?? 0 }))}
          series={[{ key: "connectRate", name: "Connected % of allocation", kind: "area", color: "#0ea5e9", format: fmtPct }]}
        />
      </SectionCard>
    </div>
  );
}
