import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi, getHrmsApiErrorStatus, type HrmsEnvelope } from "@/lib/hrmsApi";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Loader2, TrendingUp, ListTree, Users, ChevronLeft } from "lucide-react";
import { formatValue, type PerformanceRow, type SectionValue, type PerfQuery } from "./ProcessPerformanceTable";

/**
 * The detail behind one KPI cell: trend, root cause, and the records making it up.
 *
 * Built rather than extending DashboardDrilldownDrawer: that component is a Sheet
 * wrapping a single flat table, and reshaping it to hold three co-resident panels
 * plus in-place navigation would change its contract for every existing caller.
 * Its visual language is reused here.
 *
 * The drill-down list navigates IN PLACE — clicking a manager pushes onto an
 * internal stack and refetches the same three panels one level deeper, rather
 * than closing this view and opening a different one.
 */

interface DetailRecord {
  id: string;
  name: string;
  subtitle: string | null;
  value: number | null;
  /** Which filter this id belongs to. null means the list is a leaf. */
  drillAs: "manager" | "employee" | null;
}

interface DetailPayload {
  section: string;
  label: string;
  availability: "ok" | "no_data" | "not_tracked";
  unit: SectionValue["unit"];
  trend: Array<{ period: string; value: number | null }>;
  rootCause: Array<{ label: string; value: number; share: number }> | null;
  rootCauseNote: string | null;
  recordsLabel: string;
  records: DetailRecord[];
}

interface Level {
  label: string;
  query: PerfQuery;
}

function qs(p: Record<string, string | null | undefined>) {
  const s = new URLSearchParams();
  Object.entries(p).forEach(([k, v]) => { if (v) s.set(k, v); });
  return s.toString();
}

/** Inline sparkline. Plain SVG — no chart dependency for a dozen points. */
function Trend({ points }: { points: Array<{ period: string; value: number | null }> }) {
  const usable = points.filter((p) => p.value !== null) as Array<{ period: string; value: number }>;
  if (usable.length < 2) {
    return <p className="text-xs text-slate-400">Not enough history in this window to plot a trend.</p>;
  }
  const values = usable.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 100;
  const h = 32;
  const path = usable
    .map((p, i) => {
      const x = (i / (usable.length - 1)) * w;
      const y = h - ((p.value - min) / span) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-16" role="img"
        aria-label={`Trend from ${usable[0].period} to ${usable[usable.length - 1].period}`}>
        <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-indigo-500" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] text-slate-400 mt-1">
        {usable.map((p) => <span key={p.period}>{p.period}</span>)}
      </div>
    </div>
  );
}

export default function KpiCellDetail({
  open, onClose, section, row, baseQuery,
}: {
  open: boolean;
  onClose: () => void;
  section: SectionValue;
  row: PerformanceRow;
  baseQuery: PerfQuery;
}) {
  // A stack, so "back" returns to the level above instead of closing.
  //
  // An agent row carries its OWN id as employeeId. Before, an agent's cell fell
  // back to baseQuery.managerId, so opening a figure on a person showed their
  // whole team's number under that person's name.
  const [stack, setStack] = useState<Level[]>([{
    label: row.name,
    query: {
      ...baseQuery,
      processId: row.grain === "process" ? row.id : baseQuery.processId,
      managerId: row.grain === "manager" ? row.id : row.grain === "agent" ? baseQuery.managerId : null,
      employeeId: row.grain === "agent" ? row.id : null,
    },
  }]);
  const current = stack[stack.length - 1];

  const { data, isLoading, error } = useQuery({
    queryKey: ["process-performance", "detail", section.key, current.query],
    queryFn: () => hrmsApi.get<HrmsEnvelope<DetailPayload>>(
      `/api/process-performance/detail/${section.key}?${qs({ ...current.query })}`,
    ),
    enabled: open,
  });

  const d = data?.data;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden">
        <div className="bg-gradient-to-r from-blue-700 to-indigo-700 px-5 py-3.5">
          <div className="flex items-center gap-2">
            {stack.length > 1 && (
              <button
                type="button"
                onClick={() => setStack((s) => s.slice(0, -1))}
                aria-label="Back to previous level"
                className="p-1 rounded hover:bg-white/15 cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/50"
              >
                <ChevronLeft className="h-4 w-4 text-white" />
              </button>
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">{section.label}</p>
              <p className="text-[11px] text-white/70 truncate">
                {stack.map((l) => l.label).join(" › ")}
              </p>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {isLoading && (
            <p className="text-sm text-slate-500"><Loader2 className="inline h-4 w-4 animate-spin mr-1.5" />Loading…</p>
          )}

          {error && (
            <p className="text-sm text-slate-500">
              {getHrmsApiErrorStatus(error) === 403
                ? "This detail isn't available for your role."
                : "Couldn't load this detail."}
            </p>
          )}

          {d && d.availability === "not_tracked" && (
            <p className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-xl p-4">
              {d.rootCauseNote ?? section.note ?? "This metric isn't reported at this level."}
            </p>
          )}

          {d && d.availability === "no_data" && (
            <p className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-xl p-4">
              {section.note ?? "No records in this period."}
            </p>
          )}

          {d && d.availability === "ok" && (
            <>
              <section>
                <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">
                  <TrendingUp className="h-3.5 w-3.5" />Trend
                </h3>
                <Trend points={d.trend} />
              </section>

              <section>
                <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">
                  <ListTree className="h-3.5 w-3.5" />Root cause
                </h3>
                {d.rootCause ? (
                  <div className="space-y-1.5">
                    {d.rootCause.map((rc) => (
                      <div key={rc.label} className="flex items-center gap-2">
                        <span className="w-32 shrink-0 text-xs text-slate-600 capitalize">{rc.label.replace(/_/g, " ")}</span>
                        <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full bg-indigo-500" style={{ width: `${rc.share}%` }} />
                        </div>
                        <span className="w-20 text-right text-xs tabular-nums text-slate-700">
                          {rc.share}% <span className="text-slate-400">({rc.value})</span>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  /* No fabricated split: where the schema doesn't categorise the
                     cause, the reason is stated instead of a chart. */
                  <p className="text-xs text-slate-500 bg-amber-50 border border-amber-100 rounded-lg p-3">
                    {d.rootCauseNote ?? "No categorised cause is available for this metric."}
                  </p>
                )}
              </section>

              <section>
                <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">
                  <Users className="h-3.5 w-3.5" />{d.recordsLabel} ({d.records.length})
                </h3>
                {d.records.length === 0 ? (
                  <p className="text-xs text-slate-400">No records in this period.</p>
                ) : (
                  <div className="rounded-xl border border-slate-100 divide-y divide-slate-50 max-h-64 overflow-y-auto">
                    {d.records.map((rec) => {
                      // Only drill where the id is actually a filter one level
                      // down. The list used to push every row as a managerId —
                      // so clicking an agent, a leaver or a cost centre opened
                      // an empty level that looked like "no data".
                      const drill = rec.drillAs
                        ? () => setStack((s) => [...s, {
                            label: rec.name,
                            query: rec.drillAs === "manager"
                              ? { ...current.query, managerId: rec.id, employeeId: null }
                              : { ...current.query, employeeId: rec.id },
                          }])
                        : null;
                      const Row = (
                        <>
                          <span className="min-w-0">
                            <span className="text-xs text-slate-700">{rec.name}</span>
                            {rec.subtitle && <span className="ml-2 text-[10px] font-mono text-slate-400">{rec.subtitle}</span>}
                          </span>
                          <span className="text-xs tabular-nums font-semibold text-slate-800">
                            {formatValue({ value: rec.value, unit: d.unit })}
                          </span>
                        </>
                      );
                      return drill ? (
                        <button
                          key={rec.id}
                          type="button"
                          onClick={drill}
                          className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-indigo-50/60 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        >
                          {Row}
                        </button>
                      ) : (
                        <div key={rec.id} className="w-full flex items-center justify-between px-3 py-2">
                          {Row}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
