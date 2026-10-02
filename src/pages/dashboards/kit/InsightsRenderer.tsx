import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { InsightKpi, InsightSeries, InsightTable } from "../../../../backend/src/modules/dashboards/role-insights/types";
import { BarsChart, ChartEmpty, DonutChart, FunnelChart, HeatStrip, RankedBars, TrendChart } from "./charts";
import { formatUnit } from "./format";
import { LazySection, Panel } from "./Panel";
import { PulseGrid, PulseTile } from "./PulseTile";
import { Skeleton } from "@/components/ui/skeleton";

/** Renders a provider-supplied series with the right chart for its `kind`. */
export function SeriesPanel({ series, className }: { series: InsightSeries; className?: string }) {
  const body = (() => {
    if (series.unavailable) return <ChartEmpty text={series.unavailable} />;
    switch (series.kind) {
      case "line": return <TrendChart points={series.points} keys={series.keys} unit={series.unit} area={false} />;
      case "area": return <TrendChart points={series.points} keys={series.keys} unit={series.unit} />;
      case "bar": return <BarsChart points={series.points} keys={series.keys} unit={series.unit} />;
      case "stacked": return <BarsChart points={series.points} keys={series.keys} unit={series.unit} stacked />;
      case "donut": return <DonutChart points={series.points} unit={series.unit} />;
      case "funnel": return <FunnelChart points={series.points as never} />;
      case "ranked": return <RankedBars points={series.points as never} unit={series.unit} />;
      case "heat": return <HeatStrip points={series.points} unit={series.unit} />;
    }
  })();
  return <Panel title={series.title} subtitle={series.subtitle} href={series.href} className={className}>{body}</Panel>;
}

export function TablePanel({ table, className }: { table: InsightTable; className?: string }) {
  return (
    <Panel title={table.title} href={table.href} className={className} bodyClassName="p-0">
      {table.unavailable ? <p className="p-4 text-[12px] text-amber-700">{table.unavailable}</p> : !table.rows.length ? <p className="p-4 text-[12px] text-slate-400">Nothing to list right now.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-[12px]">
            <thead className="bg-slate-50 text-slate-500"><tr>{table.columns.map((c) => <th key={c.key} className={cn("px-4 py-2 font-semibold", c.align === "right" && "text-right")}>{c.label}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {table.rows.map((row, i) => (
                <tr key={i} className="transition hover:bg-slate-50">
                  {table.columns.map((c, ci) => {
                    const raw = row[c.key];
                    const f = c.unit && typeof raw === "number" ? formatUnit(raw, c.unit) : null;
                    const text = f ? `${f.text}${f.suffix}` : raw === null || raw === undefined ? "—" : String(raw);
                    return <td key={c.key} className={cn("px-4 py-2.5 text-slate-700", c.align === "right" && "kit-num text-right font-semibold", ci === 0 && "font-medium text-slate-900")}>{ci === 0 && row.href ? <Link to={row.href} className="text-blue-700 hover:underline">{text}</Link> : text}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/** Convert provider KPIs into tiles. `onDrill` wires the shared drawer for KPIs without a page href. */
export function KpiTiles({ kpis, loading, cols = 4, onDrill, icons }: {
  kpis: InsightKpi[] | undefined; loading?: boolean; cols?: 3 | 4 | 5 | 6;
  onDrill?: (kpi: InsightKpi) => void; icons?: Record<string, React.ElementType>;
}) {
  if (loading && !kpis?.length) return <PulseGrid cols={cols}>{Array.from({ length: cols * 2 }, (_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</PulseGrid>;
  if (!kpis?.length) return null;
  return (
    <PulseGrid cols={cols}>
      {kpis.map((k) => (
        <PulseTile key={k.key} label={k.label} value={k.value} unit={k.unit} tone={k.tone ?? "blue"} delta={k.delta} deltaLabel={k.deltaLabel}
          higherIsBetter={k.higherIsBetter ?? true} spark={k.spark} helper={k.helper} formula={k.formula} unavailable={k.unavailable}
          icon={icons?.[k.key]} href={k.href} onDrill={!k.href && k.drill && onDrill ? () => onDrill(k) : undefined} />
      ))}
    </PulseGrid>
  );
}

/** Auto-lays out all provider series + tables in a responsive grid with lazy rendering. */
export function InsightGrid({ series, tables, loading, only }: { series?: InsightSeries[]; tables?: InsightTable[]; loading?: boolean; only?: string[] }) {
  const s = (series ?? []).filter((x) => !only || only.includes(x.key));
  const t = (tables ?? []).filter((x) => !only || only.includes(x.key));
  if (loading && !s.length && !t.length) return <div className="grid gap-4 lg:grid-cols-2">{[0, 1].map((i) => <div key={i} className="kit-shimmer h-60 rounded-2xl" />)}</div>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {s.map((x) => <LazySection key={x.key}><SeriesPanel series={x} /></LazySection>)}
      {t.map((x) => <LazySection key={x.key}><TablePanel table={x} /></LazySection>)}
    </div>
  );
}
