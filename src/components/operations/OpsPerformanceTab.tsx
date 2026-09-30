import { Card, CardContent } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { DIMENSIONS } from "./opsTabs";
import { formatMetric, type OpsDimension, type PerfCell, type PerfResponse, type PerfRow } from "./opsTypes";

const STATUS_TEXT: Record<PerfCell["status"], string> = {
  on_track: "text-emerald-600 dark:text-emerald-400",
  watch: "text-amber-600 dark:text-amber-400",
  off_track: "text-rose-600 dark:text-rose-400",
  no_target: "text-foreground",
};

interface Props {
  data: PerfResponse | undefined;
  loading: boolean;
  groupBy: OpsDimension;
  onGroupBy: (d: OpsDimension) => void;
  onRowClick: (row: PerfRow) => void;
  source: "process" | "agent";
  onSource: (s: "process" | "agent") => void;
}

function unitOf(u: string | null): "pct" | "count" {
  return u && /pct|percent|%/i.test(u) ? "pct" : "count";
}

export function OpsPerformanceTab({ data, loading, groupBy, onGroupBy, onRowClick, source, onSource }: Props) {
  const noun = DIMENSIONS.find((d) => d.id === groupBy)?.label ?? "Process";
  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold">View by</p>
          <ToggleGroup type="single" value={groupBy} onValueChange={(v) => v && onGroupBy(v as OpsDimension)} variant="outline" size="sm" className="flex-wrap justify-start">
            {DIMENSIONS.map((d) => <ToggleGroupItem key={d.id} value={d.id}>{d.label}</ToggleGroupItem>)}
          </ToggleGroup>
        </div>
        <ToggleGroup type="single" value={source} onValueChange={(v) => v && onSource(v as "process" | "agent")} variant="outline" size="sm" className="flex-wrap justify-start">
          <ToggleGroupItem value="process">Client / process feed</ToggleGroupItem>
          <ToggleGroupItem value="agent">Agent KPIs</ToggleGroupItem>
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">
          {data?.grain === "analyst" ? "Per-agent daily KPIs" : "Client / process feed"} · ratios are rolled up from numerator ÷ denominator, never an average of daily percentages
        </p>
      </div>
      {loading && !data ? (
        <div className="p-6"><div className="h-24 animate-pulse rounded bg-muted" /></div>
      ) : !data?.rows.length ? (
        <Card className="m-4 border-dashed"><CardContent className="p-8 text-center text-sm text-muted-foreground">
          No process KPI data for this {noun.toLowerCase()} selection and period. Metrics appear once a client feed or manual upload is published for the process.
        </CardContent></Card>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="sticky left-0 z-10 bg-muted/40 px-3 py-2 font-semibold">{noun}</th>
                {data.metrics.map((m) => <th key={m.key} className="whitespace-nowrap px-3 py-2 text-right font-semibold" title={`${m.family ?? ""} ${m.category ?? ""}`}>{m.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className={cn("border-b transition hover:bg-muted/40", "cursor-pointer")} onClick={() => onRowClick(r)}>
                  <td className="sticky left-0 z-10 bg-card px-3 py-2">
                    <p className="font-medium">{r.name}</p>
                    {r.sub && <p className="text-xs text-muted-foreground">{r.sub}</p>}
                  </td>
                  {data.metrics.map((m) => {
                    const c = r.cells[m.key];
                    if (!c) return <td key={m.key} className="px-3 py-2 text-right text-muted-foreground">—</td>;
                    return (
                      <td key={m.key} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        <span className={STATUS_TEXT[c.status]}>{formatMetric(c.value, unitOf(m.unit))}</span>
                        {c.target !== null && (
                          <span className="block text-[11px] text-muted-foreground">tgt {formatMetric(c.target, unitOf(m.unit))} · {c.achievementPct !== null ? `${c.achievementPct}%` : ""}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
