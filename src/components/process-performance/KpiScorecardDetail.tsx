import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi, getHrmsApiErrorStatus, type HrmsEnvelope } from "@/lib/hrmsApi";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Loader2, TrendingUp, Users, ChevronLeft } from "lucide-react";
import type { KpiScorecardRow } from "@/pages/ProcessKpiDashboardPage";
import { formatKpiValue } from "@/pages/ProcessKpiDashboardPage";

/**
 * The 4-level RCA drill-down behind one Process KPI card: the trend already
 * shown on the card is level 1; opening it walks TL pod (2) -> agent (3) ->
 * raw ledger rows (4). Same in-place stack navigation as KpiCellDetail.tsx
 * (its sibling on /performance/process-performance) — a thin variant rather
 * than a shared component, because the record shape differs (team_leader/
 * employee vs manager/employee) and there is no root-cause panel here: these
 * metrics have no categorised failure dimension in kpi_daily_actual, so
 * showing an empty root-cause chart would imply data that doesn't exist.
 */

interface DetailRecord {
  id: string;
  name: string;
  subtitle: string | null;
  value: number | null;
  drillAs: "team_leader" | "employee" | null;
}
interface DetailPayload {
  metricKey: string;
  label: string;
  availability: "ok" | "no_data" | "not_tracked";
  unit: KpiScorecardRow["unit"];
  trend: Array<{ period: string; value: number | null }>;
  recordsLabel: string;
  records: DetailRecord[];
  note?: string;
}
interface Level {
  label: string;
  teamLeaderId: string | null;
  employeeId: string | null;
}

function qs(p: Record<string, string | null | undefined>) {
  const s = new URLSearchParams();
  Object.entries(p).forEach(([k, v]) => { if (v) s.set(k, v); });
  return s.toString();
}

/** Plain SVG sparkline — same approach as KpiCellDetail's Trend, no chart dependency for a dozen points. */
function Trend({ points }: { points: Array<{ period: string; value: number | null }> }) {
  const usable = points.filter((p) => p.value !== null) as Array<{ period: string; value: number }>;
  if (usable.length < 2) {
    return <p className="text-xs text-slate-400">Not enough history in this window to plot a trend.</p>;
  }
  const values = usable.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 100, h = 32;
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

export default function KpiScorecardDetail({
  open, onClose, processCode, row, baseQuery,
}: {
  open: boolean;
  onClose: () => void;
  processCode: string;
  row: KpiScorecardRow;
  baseQuery: { from: string; to: string };
}) {
  const [stack, setStack] = useState<Level[]>([{ label: row.label, teamLeaderId: null, employeeId: null }]);
  const current = stack[stack.length - 1];

  const { data, isLoading, error } = useQuery({
    queryKey: ["process-kpi-dashboard", "detail", processCode, row.metricKey, baseQuery, current.teamLeaderId, current.employeeId],
    queryFn: () => hrmsApi.get<HrmsEnvelope<DetailPayload>>(
      `/api/process-kpi-dashboard/${processCode}/detail/${row.metricKey}?${qs({
        ...baseQuery, teamLeaderId: current.teamLeaderId, employeeId: current.employeeId,
      })}`,
    ),
    enabled: open,
  });
  const d = data?.data;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden">
        <div className="bg-gradient-to-r from-blue-700 to-indigo-700 px-5 py-3.5">
          <div className="flex items-center gap-2">
            {stack.length > 1 && (
              <button type="button" onClick={() => setStack((s) => s.slice(0, -1))}
                aria-label="Back to previous level"
                className="p-1 rounded hover:bg-white/15 cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/50">
                <ChevronLeft className="h-4 w-4 text-white" />
              </button>
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">{row.label}</p>
              <p className="text-[11px] text-white/70 truncate">{stack.map((l) => l.label).join(" › ")}</p>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {isLoading && (
            <p className="text-sm text-slate-500"><Loader2 className="inline h-4 w-4 animate-spin mr-1.5" />Loading…</p>
          )}
          {error && (
            <p className="text-sm text-slate-500">
              {getHrmsApiErrorStatus(error) === 403 ? "This detail isn't available for your role." : "Couldn't load this detail."}
            </p>
          )}
          {d && d.availability !== "ok" && (
            <p className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-xl p-4">
              {d.note ?? "No records at this level."}
            </p>
          )}
          {d && d.availability === "ok" && (
            <>
              {stack.length === 1 && (
                <section>
                  <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">
                    <TrendingUp className="h-3.5 w-3.5" />Trend
                  </h3>
                  <Trend points={d.trend} />
                </section>
              )}
              <section>
                <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">
                  <Users className="h-3.5 w-3.5" />{d.recordsLabel} ({d.records.length})
                </h3>
                {d.records.length === 0 ? (
                  <p className="text-xs text-slate-400">No records in this period.</p>
                ) : (
                  <div className="rounded-xl border border-slate-100 divide-y divide-slate-50 max-h-64 overflow-y-auto">
                    {d.records.map((rec) => {
                      const drill = rec.drillAs
                        ? () => setStack((s) => [...s, {
                            label: rec.name,
                            teamLeaderId: rec.drillAs === "employee" ? current.teamLeaderId ?? rec.id : rec.id,
                            employeeId: rec.drillAs === "employee" ? rec.id : null,
                          }])
                        : null;
                      const Row = (
                        <>
                          <span className="min-w-0">
                            <span className="text-xs text-slate-700">{rec.name}</span>
                            {rec.subtitle && <span className="ml-2 text-[10px] font-mono text-slate-400">{rec.subtitle}</span>}
                          </span>
                          <span className="text-xs tabular-nums font-semibold text-slate-800">
                            {formatKpiValue(rec.value, d.unit)}
                          </span>
                        </>
                      );
                      return drill ? (
                        <button key={rec.id} type="button" onClick={drill}
                          className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-indigo-50/60 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-300">
                          {Row}
                        </button>
                      ) : (
                        <div key={rec.id} className="w-full flex items-center justify-between px-3 py-2">{Row}</div>
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
