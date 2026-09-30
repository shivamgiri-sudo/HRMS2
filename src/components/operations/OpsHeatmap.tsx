import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DIMENSIONS } from "./opsTabs";
import { fmtDate, type OpsDimension } from "./opsTypes";
import type { HeatmapResponse } from "./useOpsCommand";

type HeatMetric = HeatmapResponse["metric"];
const METRICS: Array<{ id: HeatMetric; label: string; good: "high" | "low"; warn: number; bad: number }> = [
  { id: "attendance", label: "Attendance %", good: "high", warn: 90, bad: 80 },
  { id: "shrinkage", label: "Shrinkage %", good: "low", warn: 15, bad: 25 },
  { id: "absent", label: "Absent %", good: "low", warn: 8, bad: 15 },
  { id: "late", label: "Late %", good: "low", warn: 8, bad: 15 },
];

/** Traffic-light background as HSL so it works in light and dark themes. */
const isWeekend = (iso: string) => [0, 6].includes(new Date(`${iso}T00:00:00Z`).getUTCDay());
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

function cellColor(value: number | null, m: (typeof METRICS)[number]): string | undefined {
  if (value === null) return undefined;
  const bad = m.good === "high" ? value < m.bad : value > m.bad;
  const warn = m.good === "high" ? value < m.warn : value > m.warn;
  return bad ? "hsl(0 72% 52% / 0.75)" : warn ? "hsl(38 92% 50% / 0.65)" : "hsl(152 60% 42% / 0.55)";
}

interface Props {
  data: HeatmapResponse | undefined;
  loading: boolean;
  metric: HeatMetric;
  groupBy: OpsDimension;
  onMetric: (m: HeatMetric) => void;
  onGroupBy: (d: OpsDimension) => void;
  onCell: (date: string, groupId: string, groupName: string) => void;
}

export function OpsHeatmap({ data, loading, metric, groupBy, onMetric, onGroupBy, onCell }: Props) {
  const m = METRICS.find((x) => x.id === metric)!;
  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup type="single" value={metric} onValueChange={(v) => v && onMetric(v as HeatMetric)} variant="outline" size="sm" className="flex-wrap justify-start">
            {METRICS.map((x) => <ToggleGroupItem key={x.id} value={x.id}>{x.label}</ToggleGroupItem>)}
          </ToggleGroup>
          <ToggleGroup type="single" value={groupBy} onValueChange={(v) => v && onGroupBy(v as OpsDimension)} variant="outline" size="sm" className="flex-wrap justify-start">
            {DIMENSIONS.filter((d) => d.id !== "employee").map((d) => <ToggleGroupItem key={d.id} value={d.id}>{d.label}</ToggleGroupItem>)}
          </ToggleGroup>
        </div>
        <p className="text-xs text-muted-foreground">Day-by-day · click a cell to see who was behind it{data?.truncatedGroups ? " · top 60 groups shown" : ""}</p>
      </div>
      <div className="overflow-x-auto p-3">
        {loading && !data ? (
          <div className="h-40 animate-pulse rounded bg-muted" />
        ) : !data?.rows.length ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No attendance rows for this selection and period.</p>
        ) : (
          <table className="border-separate border-spacing-[2px] text-[10px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-[160px] bg-card pr-2 text-left text-xs font-semibold">Group</th>
                <th className="px-1 text-right text-xs font-semibold">Overall</th>
                {data.dates.map((d) => (
                  <th key={d} className={cn("w-7 min-w-7 rounded-sm font-normal text-muted-foreground", isWeekend(d) && "bg-muted/60")}>
                    <span className="block text-[8px] uppercase leading-3">{DOW[new Date(`${d}T00:00:00Z`).getUTCDay()]}</span>{d.slice(8)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td className="sticky left-0 z-10 max-w-[200px] truncate bg-card pr-2 text-xs font-medium" title={r.name}>{r.name}</td>
                  <td className="px-1 text-right text-xs font-semibold tabular-nums">{r.overall === null ? "—" : `${r.overall}%`}</td>
                  {r.cells.map((v, i) => (
                    <td key={i} className="p-0">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            disabled={v === null}
                            aria-label={`${r.name} ${fmtDate(data.dates[i])}: ${v ?? "no data"}`}
                            className="block h-6 w-7 rounded-sm text-[9px] font-medium text-white disabled:cursor-default disabled:bg-muted"
                            style={{ backgroundColor: cellColor(v, m) }}
                            onClick={() => onCell(data.dates[i], r.id, r.name)}
                          >
                            {v === null ? "" : Math.round(v)}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="text-xs">{r.name} · {fmtDate(data.dates[i])} · {v === null ? "no data" : `${v}%`}</TooltipContent>
                      </Tooltip>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && data.rows.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground" aria-label="Legend">
            <span className="font-semibold uppercase tracking-wide">Legend</span>
            {[["hsl(152 60% 42% / 0.55)", "healthy"], ["hsl(38 92% 50% / 0.65)", "watch"], ["hsl(0 72% 52% / 0.75)", "act now"]].map(([c, l]) => (
              <span key={l} className="inline-flex items-center gap-1.5"><span className="h-3 w-5 rounded-sm" style={{ backgroundColor: c }} />{l}</span>
            ))}
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-5 rounded-sm bg-muted" />no data</span>
            <span>· thresholds: {m.good === "high" ? `below ${m.warn}% watch, below ${m.bad}% act` : `above ${m.warn}% watch, above ${m.bad}% act`} · shaded day headers are weekends · numbers are % for the day</span>
          </div>
        )}
      </div>
    </div>
  );
}
