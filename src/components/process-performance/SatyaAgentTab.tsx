import { useMemo, useState } from "react";
import { Users, Trophy, IndianRupee, Percent, ListFilter } from "lucide-react";
import { KpiCard, SectionCard, formatINR } from "./DashboardKit";
import { ComboTrend, RankBars, fmtPct } from "./NeemansCharts";
import { BarCell, DataTable, SearchBox, type Col } from "./SatyaUi";
import {
  addCounts, callsMade, emptyCounts, fmtInt, fmtRatio, ratio, type SatyaAgentRow, type SatyaReportData,
} from "./satyaReportModel";
import type { SatyaDetailTarget } from "./SatyaDetailDrawer";

const connectPct = (r: SatyaAgentRow) => ratio(r.counts.connected, r.counts.connected + r.counts.notConnected);
const conversionPct = (r: SatyaAgentRow) => ratio(r.counts.orders, callsMade(r.counts));

/**
 * Agent-wise performance -- the Excel "Agent ID | Allocation | Order count |
 * No. calls | Unique | Morning | Absentee | Revenue" table, plus connect %,
 * conversion, average order value and ranking charts. Rows open the agent
 * drill-down drawer.
 */
export function SatyaAgentTab({ data, onOpen }: { data: SatyaReportData; onOpen: (t: SatyaDetailTarget) => void }) {
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const rows = useMemo(
    () => (q ? data.agents.filter((a) => a.agentId.toLowerCase().includes(q) || a.agentName.toLowerCase().includes(q)) : data.agents),
    [data.agents, q],
  );

  const total = data.agents.reduce((s, a) => addCounts(s, a.counts), emptyCounts());
  const maxOrders = Math.max(0, ...rows.map((r) => r.counts.orders));
  const maxRevenue = Math.max(0, ...rows.map((r) => r.counts.revenue));
  const maxAlloc = Math.max(0, ...rows.map((r) => r.counts.allocation));
  const best = [...data.agents].sort((a, b) => b.counts.orders - a.counts.orders)[0];

  const cols: Array<Col<SatyaAgentRow>> = [
    { key: "agent", label: "Agent", sort: (r) => r.agentName, total: `All ${data.agents.length} agents`, render: (r) => (
      <div><div className="font-medium text-slate-700">{r.agentName}</div><div className="text-[11px] text-slate-400">{r.agentId}</div></div>
    ) },
    { key: "alloc", label: "Allocation", align: "right", sort: (r) => r.counts.allocation, total: fmtInt(total.allocation), render: (r) => (
      <BarCell value={r.counts.allocation} max={maxAlloc} color="#f59e0b">{fmtInt(r.counts.allocation)}</BarCell>
    ) },
    { key: "orders", label: "Orders", align: "right", sort: (r) => r.counts.orders, total: fmtInt(total.orders), render: (r) => (
      <BarCell value={r.counts.orders} max={maxOrders} color="#7c3aed"><span className="font-semibold text-slate-800">{fmtInt(r.counts.orders)}</span></BarCell>
    ) },
    { key: "made", label: "Calls made", align: "right", sort: (r) => callsMade(r.counts), total: fmtInt(callsMade(total)), render: (r) => fmtInt(callsMade(r.counts)) },
    { key: "unique", label: "Unique", align: "right", sort: (r) => r.counts.unique, total: fmtInt(total.unique), render: (r) => fmtInt(r.counts.unique) },
    { key: "repeat", label: "Repeat", align: "right", sort: (r) => r.counts.repeat, total: fmtInt(total.repeat), render: (r) => fmtInt(r.counts.repeat) },
    { key: "morning", label: "Morning", align: "right", sort: (r) => r.counts.morning, total: fmtInt(total.morning), render: (r) => fmtInt(r.counts.morning) },
    { key: "absentee", label: "Absentee", align: "right", sort: (r) => r.counts.absentee, total: fmtInt(total.absentee), render: (r) => fmtInt(r.counts.absentee) },
    { key: "conn", label: "Connected", align: "right", sort: (r) => r.counts.connected, total: fmtInt(total.connected), render: (r) => <span className="text-emerald-700">{fmtInt(r.counts.connected)}</span> },
    { key: "nc", label: "Not connected", align: "right", sort: (r) => r.counts.notConnected, total: fmtInt(total.notConnected), render: (r) => <span className="text-rose-600">{fmtInt(r.counts.notConnected)}</span> },
    { key: "cpct", label: "Connect %", align: "right", sort: (r) => connectPct(r) ?? -1, total: fmtRatio(ratio(total.connected, total.connected + total.notConnected)), render: (r) => fmtRatio(connectPct(r)) },
    { key: "conv", label: "Conversion %", align: "right", sort: (r) => conversionPct(r) ?? -1, total: fmtRatio(ratio(total.orders, callsMade(total))), render: (r) => fmtRatio(conversionPct(r)) },
    { key: "aov", label: "Avg order", align: "right", sort: (r) => (r.counts.orders ? r.counts.revenue / r.counts.orders : 0), total: total.orders ? formatINR(Math.round(total.revenue / total.orders)) : "—", render: (r) => (r.counts.orders ? formatINR(Math.round(r.counts.revenue / r.counts.orders)) : "—") },
    { key: "rev", label: "Revenue", align: "right", sort: (r) => r.counts.revenue, total: formatINR(total.revenue), render: (r) => (
      <BarCell value={r.counts.revenue} max={maxRevenue} color="#10b981"><span className="font-semibold text-slate-800">{formatINR(r.counts.revenue)}</span></BarCell>
    ) },
    { key: "days", label: "Days", align: "right", sort: (r) => r.daysWorked, render: (r) => r.daysWorked },
  ];

  const ranked = [...data.agents];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard icon={Users} label="Agents on the floor" value={String(data.agents.length)} sub={`${fmtInt(total.allocation)} shops allocated`} tone="violet" />
        <KpiCard icon={Trophy} label="Top by orders" value={best ? best.agentName : "—"} sub={best ? `${fmtInt(best.counts.orders)} orders · ${formatINR(best.counts.revenue)}` : undefined} tone="amber" />
        <KpiCard icon={Percent} label="Team connect rate" value={fmtRatio(ratio(total.connected, total.connected + total.notConnected))} sub="connected ÷ dialled" tone="emerald" />
        <KpiCard icon={IndianRupee} label="Team revenue" value={formatINR(total.revenue)} sub={`${fmtInt(total.orders)} orders`} tone="teal" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard icon={Trophy} title="Orders by agent" tone="violet">
          <RankBars data={[...ranked].sort((a, b) => b.counts.orders - a.counts.orders).map((a) => ({ name: a.agentName, value: a.counts.orders }))} colors={["#7c3aed", "#8b5cf6", "#a78bfa", "#6366f1", "#818cf8", "#0ea5e9", "#38bdf8", "#14b8a6"]} />
        </SectionCard>
        <SectionCard icon={IndianRupee} title="Revenue by agent" tone="emerald">
          <RankBars data={[...ranked].sort((a, b) => b.counts.revenue - a.counts.revenue).map((a) => ({ name: a.agentName, value: a.counts.revenue }))} valueFormat={formatINR} colors={["#10b981", "#14b8a6", "#0ea5e9", "#6366f1", "#8b5cf6", "#f59e0b", "#f97316", "#ec4899"]} />
        </SectionCard>
        <SectionCard icon={Percent} title="Connect % vs conversion %" tone="amber">
          <ComboTrend
            height={Math.max(180, 26 * Math.min(8, ranked.length) + 40)}
            xKey="name" xFormat={(v) => (v.length > 9 ? `${v.slice(0, 8)}…` : v)}
            data={ranked.map((a) => ({ name: a.agentName, connect: connectPct(a) ?? 0, conversion: conversionPct(a) ?? 0 }))}
            series={[
              { key: "connect", name: "Connect %", kind: "bar", color: "#10b981", format: fmtPct },
              { key: "conversion", name: "Conversion %", kind: "line", color: "#7c3aed", axis: "right", format: fmtPct },
            ]}
          />
        </SectionCard>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SearchBox value={search} onChange={setSearch} placeholder="Search agent name or ID…" />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500">
            <ListFilter className="h-3 w-3" />{rows.length} of {data.agents.length} agents
          </span>
        </div>
        <SectionCard icon={Users} title="Agent-wise performance" tone="amber" footnote="Click any column header to sort, or a row for the agent's full drill-down. Allocation = shops assigned; 'Morning'/'Absentee' split it by roster. Days = days with allocations in range.">
          <DataTable columns={cols} rows={rows} rowKey={(r) => r.agentId} onRowClick={(r) => onOpen({ type: "agent", key: r.agentId })} defaultSort={{ key: "orders", dir: "desc" }} />
        </SectionCard>
      </div>
    </div>
  );
}
