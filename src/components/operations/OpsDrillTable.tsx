import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Download, Info, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { DIMENSIONS } from "./opsTabs";
import { TONE_TEXT, formatMetric, toneFor, type MetricValues, type OpsDimension, type OpsMetricDef, type OpsRecordDomain, type OpsRow, type Tone } from "./opsTypes";

const BAR: Record<Tone, string> = { good: "hsl(152 60% 42% / 0.16)", warn: "hsl(38 92% 50% / 0.18)", bad: "hsl(0 72% 52% / 0.16)", neutral: "hsl(var(--primary) / 0.10)" };

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

/** Cell background = an in-cell data bar: % metrics fill 0–100, counts fill relative to the column maximum. */
function barStyle(def: OpsMetricDef, v: number | null | undefined, colMax: number): React.CSSProperties | undefined {
  if (v === null || v === undefined || v <= 0) return undefined;
  const w = def.unit === "pct" ? Math.min(v, 100) : colMax > 0 ? Math.min((v / colMax) * 100, 100) : 0;
  if (w < 1) return undefined;
  return { backgroundImage: `linear-gradient(90deg, ${BAR[toneFor(def, v)]} ${w}%, transparent ${w}%)` };
}

/** Group table: search, sortable columns with formula tooltips, in-cell data bars, keyboard-drillable rows, CSV export. */
export function OpsDrillTable(p: Props) {
  const [query, setQuery] = useState("");
  const cols = p.columns.map((id) => p.defs.get(id)).filter((d): d is OpsMetricDef => !!d);
  const noun = DIMENSIONS.find((d) => d.id === p.groupBy)?.label ?? "Group";
  const shown = useMemo(() => {
    const t = query.trim().toLowerCase();
    return t ? p.rows.filter((r) => r.name.toLowerCase().includes(t) || (r.sub ?? "").toLowerCase().includes(t)) : p.rows;
  }, [p.rows, query]);
  const colMax = useMemo(() => Object.fromEntries(cols.map((c) => [c.id, Math.max(0, ...p.rows.map((r) => r.m[c.id] ?? 0))])), [cols, p.rows]);

  return (
    <section className="rounded-xl border bg-card shadow-sm" aria-label={`${noun} table`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold">View by</p>
          <ToggleGroup type="single" value={p.groupBy} onValueChange={(v) => v && p.onGroupBy(v as OpsDimension)} variant="outline" size="sm" className="flex-wrap justify-start">
            {DIMENSIONS.map((d) => <ToggleGroupItem key={d.id} value={d.id} aria-label={d.label}>{d.label}</ToggleGroupItem>)}
          </ToggleGroup>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="sr-only">Search {noun.toLowerCase()}</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${noun.toLowerCase()}…`}
              className="h-9 w-48 rounded-md border bg-background pl-8 pr-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring" />
          </label>
          {p.onExport && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={p.onExport} disabled={p.exporting || !p.rows.length}>
              <Download className="h-3.5 w-3.5" /> {p.exporting ? "Preparing…" : "Export CSV"}
            </Button>
          )}
        </div>
      </div>
      <p className="border-b bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
        {p.totalRows > p.rows.length ? `Top ${p.rows.length} of ${p.totalRows}` : `${shown.length}${query ? ` of ${p.rows.length}` : ""} ${noun.toLowerCase()}${shown.length === 1 ? "" : "s"}`}
        {" · "}Enter or click a row to drill down · click a number to see the people · bars show the value against 100% (or the column maximum)
      </p>
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="sticky top-0 z-20">
            <tr className="border-b bg-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="sticky left-0 z-30 min-w-[180px] bg-muted px-3 py-2 font-semibold">{noun}</th>
              {cols.map((c) => (
                <th key={c.id} scope="col" aria-sort={p.sort === c.id ? (p.dir === "asc" ? "ascending" : "descending") : "none"} className="whitespace-nowrap px-3 py-2 text-right font-semibold">
                  <button type="button" className="inline-flex items-center gap-1 rounded transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => p.onSort(c.id)}>
                    {c.label}
                    {p.sort === c.id && (p.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                  </button>
                  <Tooltip>
                    <TooltipTrigger asChild><Info className="ml-1 inline h-3 w-3 cursor-help opacity-60" aria-label={`${c.label} formula`} /></TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs normal-case leading-relaxed tracking-normal">{c.formula}</TooltipContent>
                  </Tooltip>
                </th>
              ))}
              <th className="w-8 bg-muted" />
            </tr>
          </thead>
          <tbody>
            {p.loading && !p.rows.length && Array.from({ length: 6 }).map((_, i) => (
              <tr key={i} className="border-b"><td colSpan={cols.length + 2} className="px-3 py-3"><div className="h-4 animate-pulse rounded bg-muted" /></td></tr>
            ))}
            {!p.loading && !shown.length && (
              <tr><td colSpan={cols.length + 2} className="px-3 py-12 text-center text-muted-foreground">
                {query ? `No ${noun.toLowerCase()} matches “${query}”.` : `No ${noun.toLowerCase()} data in your scope for this selection.`}
              </td></tr>
            )}
            {shown.map((row) => (
              <tr key={row.id} tabIndex={0} role="button" aria-label={`${row.name}: drill down`}
                className="group cursor-pointer border-b transition-colors even:bg-muted/20 hover:bg-primary/5 focus-visible:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                onClick={() => p.onRowClick(row)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); p.onRowClick(row); } }}>
                <td className="sticky left-0 z-10 bg-card px-3 py-2 group-even:bg-muted/20 group-hover:bg-primary/5">
                  <p className="font-medium leading-snug">{row.name}</p>
                  {row.sub && <p className="text-xs text-muted-foreground">{row.sub}</p>}
                </td>
                {cols.map((c) => {
                  const v = row.m[c.id];
                  const tone = toneFor(c, v);
                  return (
                    <td key={c.id} className="whitespace-nowrap px-3 py-2 text-right tabular-nums" style={barStyle(c, v, colMax[c.id])}>
                      {c.records && v ? (
                        <button type="button" className={cn("rounded px-0.5 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring", TONE_TEXT[tone])}
                          onClick={(e) => { e.stopPropagation(); p.onCellClick(c.records!, row); }} onKeyDown={(e) => e.stopPropagation()}>
                          {formatMetric(v, c.unit)}
                        </button>
                      ) : (
                        <span className={TONE_TEXT[tone]}>{formatMetric(v, c.unit)}</span>
                      )}
                    </td>
                  );
                })}
                <td className="pr-2 text-muted-foreground transition-transform group-hover:translate-x-0.5"><ChevronRight className="h-4 w-4" /></td>
              </tr>
            ))}
          </tbody>
          {p.totals && p.rows.length > 1 && !query && (
            <tfoot className="sticky bottom-0 z-20">
              <tr className="border-t-2 bg-muted font-semibold">
                <td className="sticky left-0 z-30 bg-muted px-3 py-2">Total (in scope)</td>
                {cols.map((c) => <td key={c.id} className={cn("whitespace-nowrap px-3 py-2 text-right tabular-nums", TONE_TEXT[toneFor(c, p.totals![c.id])])}>{formatMetric(p.totals![c.id], c.unit)}</td>)}
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}
