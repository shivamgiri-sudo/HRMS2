import { useMemo, useState } from "react";
import { Warehouse, MapPin, Layers, ShoppingCart, ListFilter } from "lucide-react";
import { KpiCard, SectionCard, formatINR } from "./DashboardKit";
import { Donut, RankBars } from "./NeemansCharts";
import { BarCell, DataTable, SearchBox, type Col } from "./SatyaUi";
import {
  addCounts, callsMade, emptyCounts, fmtInt, fmtRatio, ratio, type SatyaBeatRow, type SatyaCounts, type SatyaReportData, type SatyaWarehouseRow,
} from "./satyaReportModel";
import type { SatyaDetailTarget } from "./SatyaDetailDrawer";

const connectPct = (c: SatyaCounts) => ratio(c.connected, c.connected + c.notConnected);

/** Beat-wise and warehouse-wise coverage: how many shops were allocated,
 * reached and converted, with each row opening its drill-down. */
export function SatyaBeatTab({ data, onOpen }: { data: SatyaReportData; onOpen: (t: SatyaDetailTarget) => void }) {
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const beats = useMemo(
    () => (q ? data.beats.filter((b) => b.beat.toLowerCase().includes(q) || b.warehouse.toLowerCase().includes(q)) : data.beats),
    [data.beats, q],
  );

  const whTotal = data.warehouses.reduce((s, w) => addCounts(s, w.counts), emptyCounts());
  const maxWhAlloc = Math.max(0, ...data.warehouses.map((w) => w.counts.allocation));
  const maxBeatAlloc = Math.max(0, ...beats.map((b) => b.counts.allocation));
  const maxBeatOrders = Math.max(0, ...beats.map((b) => b.counts.orders));

  const whCols: Array<Col<SatyaWarehouseRow>> = [
    { key: "wh", label: "Warehouse", sort: (r) => r.warehouse, total: "Total", render: (r) => <span className="font-medium text-slate-700">{r.warehouse}</span> },
    { key: "beats", label: "Beats", align: "right", sort: (r) => r.beats, render: (r) => r.beats },
    { key: "alloc", label: "Allocation", align: "right", sort: (r) => r.counts.allocation, total: fmtInt(whTotal.allocation), render: (r) => (
      <BarCell value={r.counts.allocation} max={maxWhAlloc} color="#f59e0b">{fmtInt(r.counts.allocation)}</BarCell>
    ) },
    { key: "made", label: "Calls made", align: "right", sort: (r) => callsMade(r.counts), total: fmtInt(callsMade(whTotal)), render: (r) => fmtInt(callsMade(r.counts)) },
    { key: "conn", label: "Connected", align: "right", sort: (r) => r.counts.connected, total: fmtInt(whTotal.connected), render: (r) => <span className="text-emerald-700">{fmtInt(r.counts.connected)}</span> },
    { key: "cpct", label: "Connect %", align: "right", sort: (r) => connectPct(r.counts) ?? -1, total: fmtRatio(connectPct(whTotal)), render: (r) => fmtRatio(connectPct(r.counts)) },
    { key: "orders", label: "Orders", align: "right", sort: (r) => r.counts.orders, total: fmtInt(whTotal.orders), render: (r) => <span className="font-semibold text-slate-800">{fmtInt(r.counts.orders)}</span> },
    { key: "conv", label: "Conversion %", align: "right", sort: (r) => ratio(r.counts.orders, callsMade(r.counts)) ?? -1, total: fmtRatio(ratio(whTotal.orders, callsMade(whTotal))), render: (r) => fmtRatio(ratio(r.counts.orders, callsMade(r.counts))) },
    { key: "rev", label: "Revenue", align: "right", sort: (r) => r.counts.revenue, total: formatINR(whTotal.revenue), render: (r) => formatINR(r.counts.revenue) },
  ];

  const beatTotal = beats.reduce((s, b) => addCounts(s, b.counts), emptyCounts());
  const beatCols: Array<Col<SatyaBeatRow>> = [
    { key: "beat", label: "Beat", sort: (r) => r.beat, total: `${beats.length} beats`, render: (r) => <span className="font-medium text-slate-700">{r.beat}</span> },
    { key: "wh", label: "Warehouse", sort: (r) => r.warehouse, render: (r) => <span className="text-slate-500">{r.warehouse}</span> },
    { key: "shops", label: "Shops", align: "right", sort: (r) => r.shops, render: (r) => fmtInt(r.shops) },
    { key: "alloc", label: "Allocation", align: "right", sort: (r) => r.counts.allocation, total: fmtInt(beatTotal.allocation), render: (r) => (
      <BarCell value={r.counts.allocation} max={maxBeatAlloc} color="#f59e0b">{fmtInt(r.counts.allocation)}</BarCell>
    ) },
    { key: "conn", label: "Connected", align: "right", sort: (r) => r.counts.connected, total: fmtInt(beatTotal.connected), render: (r) => <span className="text-emerald-700">{fmtInt(r.counts.connected)}</span> },
    { key: "cpct", label: "Connect %", align: "right", sort: (r) => connectPct(r.counts) ?? -1, total: fmtRatio(connectPct(beatTotal)), render: (r) => fmtRatio(connectPct(r.counts)) },
    { key: "orders", label: "Orders", align: "right", sort: (r) => r.counts.orders, total: fmtInt(beatTotal.orders), render: (r) => (
      <BarCell value={r.counts.orders} max={maxBeatOrders} color="#7c3aed"><span className="font-semibold text-slate-800">{fmtInt(r.counts.orders)}</span></BarCell>
    ) },
    { key: "conv", label: "Conversion %", align: "right", sort: (r) => ratio(r.counts.orders, callsMade(r.counts)) ?? -1, total: fmtRatio(ratio(beatTotal.orders, callsMade(beatTotal))), render: (r) => fmtRatio(ratio(r.counts.orders, callsMade(r.counts))) },
    { key: "rev", label: "Revenue", align: "right", sort: (r) => r.counts.revenue, total: formatINR(beatTotal.revenue), render: (r) => formatINR(r.counts.revenue) },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard icon={Warehouse} label="Warehouses" value={String(data.warehouses.length)} tone="amber" />
        <KpiCard icon={MapPin} label="Beats covered" value={String(data.beats.length)} tone="violet" />
        <KpiCard icon={Layers} label="Shops reached" value={fmtInt(data.headline.shops)} sub="distinct shop numbers" tone="teal" />
        <KpiCard icon={ShoppingCart} label="Orders" value={fmtInt(data.headline.orders)} sub={formatINR(data.headline.revenue)} tone="emerald" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard icon={Warehouse} title="Orders by warehouse" tone="amber">
          <Donut data={data.warehouses.map((w) => ({ name: w.warehouse, value: w.counts.orders }))} centerValue={fmtInt(whTotal.orders)} centerLabel="Orders" colors={["#f59e0b", "#7c3aed", "#10b981", "#0ea5e9", "#f43f5e", "#64748b"]} />
        </SectionCard>
        <SectionCard icon={ShoppingCart} title="Top beats by orders" tone="violet">
          <RankBars data={[...data.beats].sort((a, b) => b.counts.orders - a.counts.orders).map((b) => ({ name: b.beat, value: b.counts.orders }))} maxRows={8} colors={["#7c3aed", "#8b5cf6", "#a78bfa", "#6366f1", "#0ea5e9", "#14b8a6", "#10b981", "#84cc16"]} />
        </SectionCard>
        <SectionCard icon={MapPin} title="Biggest beats by allocation" tone="teal">
          <RankBars data={[...data.beats].sort((a, b) => b.counts.allocation - a.counts.allocation).map((b) => ({ name: b.beat, value: b.counts.allocation }))} maxRows={8} colors={["#f59e0b", "#f97316", "#fb923c", "#facc15", "#14b8a6", "#0ea5e9", "#6366f1", "#8b5cf6"]} />
        </SectionCard>
      </div>

      <SectionCard icon={Warehouse} title="Warehouse-wise" tone="amber" footnote="Every warehouse in the data is listed. 'Unmapped' = allocations with no warehouse in the source sheet. Click a row for its drill-down.">
        <DataTable columns={whCols} rows={data.warehouses} rowKey={(r) => r.warehouse} onRowClick={(r) => onOpen({ type: "warehouse", key: r.warehouse })} defaultSort={{ key: "alloc", dir: "desc" }} />
      </SectionCard>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SearchBox value={search} onChange={setSearch} placeholder="Search beat or warehouse…" />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-500">
            <ListFilter className="h-3 w-3" />{beats.length} of {data.beats.length} beats
          </span>
        </div>
        <SectionCard icon={MapPin} title="Beat-wise" tone="violet" footnote="Click a row for the beat's agents, outcomes and orders.">
          <DataTable maxHeight="560px" columns={beatCols} rows={beats} rowKey={(r) => r.beat} onRowClick={(r) => onOpen({ type: "beat", key: r.beat })} defaultSort={{ key: "alloc", dir: "desc" }} />
        </SectionCard>
      </div>
    </div>
  );
}
