import { ArrowDown, ArrowUp, ChevronRight, Download, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { DIMENSIONS } from "./opsTabs";
import { TONE_TEXT, formatMetric, toneFor, type MetricValues, type OpsDimension, type OpsMetricDef, type OpsRecordDomain, type OpsRow } from "./opsTypes";

interface Props {
  rows: OpsRow[];
  totals: MetricValues | undefined;
  totalRows: number;
  columns: string[];
  defs: Map<string, OpsMetricDef>;
  groupBy: OpsDimension;
  sort: string;
  dir: "asc" | "desc";
  loading: boolean;
  onGroupBy: (d: OpsDimension) => void;
  onSort: (metricId: string) => void;
  onRowClick: (row: OpsRow) => void;
  onCellClick: (domain: OpsRecordDomain, row: OpsRow) => void;
  onExport?: () => void;
  exporting?: boolean;
}

/** Group table: one row per branch / process / LOB / manager / analyst, every cell drills to the people behind it. */
export function OpsDrillTable(p: Props) {
  const cols = p.columns.map((id) => p.defs.get(id)).filter((d): d is OpsMetricDef => !!d);
  const noun = DIMENSIONS.find((d) => d.id === p.groupBy)?.label ?? "Group";

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold">View by</p>
          <ToggleGroup type="single" value={p.groupBy} onValueChange={(v) => v && p.onGroupBy(v as OpsDimension)} variant="outline" size="sm">
            {DIMENSIONS.map((d) => <ToggleGroupItem key={d.id} value={d.id} aria-label={d.label}>{d.label}</ToggleGroupItem>)}
          </ToggleGroup>
        </div>
        <div className="flex items-center gap-3">
          {p.onExport && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={p.onExport} disabled={p.exporting || !p.rows.length}>
              <Download className="h-3.5 w-3.5" /> {p.exporting ? "Preparing…" : "Export CSV"}
            </Button>
          )}
        <p className="text-xs text-muted-foreground">
          {p.totalRows > p.rows.length ? `Top ${p.rows.length} of ${p.totalRows}` : `${p.totalRows} ${noun.toLowerCase()}${p.totalRows === 1 ? "" : "s"}`} · click a row to drill down, a number to see the people
        </p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="sticky left-0 z-10 bg-muted/40 px-3 py-2 font-semibold">{noun}</th>
              {cols.map((c) => (
                <th key={c.id} className="whitespace-nowrap px-3 py-2 text-right font-semibold">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => p.onSort(c.id)}>
                    {c.label}
                    {p.sort === c.id && (p.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                  </button>
                  <Tooltip>
                    <TooltipTrigger asChild><Info className="ml-1 inline h-3 w-3 cursor-help opacity-60" aria-label={`${c.label} formula`} /></TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs normal-case tracking-normal">{c.formula}</TooltipContent>
                  </Tooltip>
                </th>
              ))}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {p.loading && !p.rows.length && Array.from({ length: 6 }).map((_, i) => (
              <tr key={i} className="border-b"><td colSpan={cols.length + 2} className="px-3 py-3"><div className="h-4 animate-pulse rounded bg-muted" /></td></tr>
            ))}
            {!p.loading && !p.rows.length && (
              <tr><td colSpan={cols.length + 2} className="px-3 py-10 text-center text-muted-foreground">No {noun.toLowerCase()} data in your scope for this selection.</td></tr>
            )}
            {p.rows.map((row) => (
              <tr key={row.id} className="cursor-pointer border-b transition hover:bg-muted/40" onClick={() => p.onRowClick(row)}>
                <td className="sticky left-0 z-10 bg-card px-3 py-2">
                  <p className="font-medium">{row.name}</p>
                  {row.sub && <p className="text-xs text-muted-foreground">{row.sub}</p>}
                </td>
                {cols.map((c) => {
                  const v = row.m[c.id];
                  return (
                    <td key={c.id} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {c.records && v ? (
                        <button type="button" className={cn("underline-offset-2 hover:underline", TONE_TEXT[toneFor(c, v)])} onClick={(e) => { e.stopPropagation(); p.onCellClick(c.records!, row); }}>
                          {formatMetric(v, c.unit)}
                        </button>
                      ) : (
                        <span className={TONE_TEXT[toneFor(c, v)]}>{formatMetric(v, c.unit)}</span>
                      )}
                    </td>
                  );
                })}
                <td className="pr-2 text-muted-foreground"><ChevronRight className="h-4 w-4" /></td>
              </tr>
            ))}
          </tbody>
          {p.totals && p.rows.length > 1 && (
            <tfoot>
              <tr className="border-t-2 bg-muted/30 font-semibold">
                <td className="sticky left-0 z-10 bg-muted/30 px-3 py-2">Total (in scope)</td>
                {cols.map((c) => <td key={c.id} className={cn("whitespace-nowrap px-3 py-2 text-right tabular-nums", TONE_TEXT[toneFor(c, p.totals![c.id])])}>{formatMetric(p.totals![c.id], c.unit)}</td>)}
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
