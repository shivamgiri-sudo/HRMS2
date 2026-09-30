import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Info } from "lucide-react";
import { formatValue } from "../format";
import { SimpleTable } from "../SimpleTable";
import { Empty, ErrorBox, FOCUS, Panel, Skeleton, loadPref, savePref } from "../ui";
import type { DashUrlState } from "../urlState";
import { fetchForecast } from "./api";
import { PacingCard } from "./PacingCard";
import { PacingChart } from "./PacingChart";
import { StatusChip, statusOf } from "./status";
import { TlPacingTable } from "./TlPacingTable";
import type { ForecastResponse } from "./types";

const PREF = "pd-pacing-open";
const monthLabel = (m: string) => { const [y, mo] = m.split("-").map(Number); return new Date(y, mo - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" }); };
/** Current month and the three before it, newest first. */
export function monthOptions(now: Date = new Date(), n = 4): string[] {
  return Array.from({ length: n }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
}

export function PacingPanel({ processId, state, onChange }: { processId: string; state: DashUrlState; onChange: (patch: Partial<DashUrlState>, push?: boolean) => void }) {
  const [open, setOpen] = useState<boolean>(() => loadPref(PREF, true));
  const opts = useMemo(() => monthOptions(), []);
  const stateMonth = state.to.slice(0, 7);
  const [month, setMonth] = useState<string>(opts.includes(stateMonth) ? stateMonth : opts[0]);
  const [kpiKey, setKpiKey] = useState<string>("");
  const q = useQuery({
    queryKey: ["process-dashboard", processId, "forecast", month, state.tl, state.lob],
    queryFn: () => fetchForecast(processId, month, state.tl, state.lob),
    enabled: open, placeholderData: keepPreviousData, staleTime: 30_000, retry: false,
  });
  const toggle = () => { const n = !open; setOpen(n); savePref(PREF, n); };
  const d: ForecastResponse | undefined = q.data;
  const shown = useMemo(() => (d?.kpis ?? []).filter((k) => k.reason !== "Source field not mapped"), [d?.kpis]);
  const hidden = (d?.kpis.length ?? 0) - shown.length;
  const selected = shown.find((k) => k.key === kpiKey) ?? shown.find((k) => k.key === d?.rankMetric) ?? shown[0];
  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const k of shown) c[k.status] = (c[k.status] ?? 0) + 1; return c; }, [shown]);

  return (
    <section aria-label="Month pacing and forecast" className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 p-4">
        <h3 className="text-sm font-semibold text-slate-800">
          <button type="button" aria-expanded={open} aria-controls="pd-pacing-body" onClick={toggle} className={`inline-flex min-h-[36px] cursor-pointer items-center gap-1 rounded ${FOCUS}`}>
            {open ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}Month pacing and forecast
          </button>
        </h3>
        {open && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {Object.entries(counts).map(([s, n]) => <span key={s} className="inline-flex items-center gap-1"><StatusChip status={s} /><span className="tabular-nums text-slate-700">{n}</span></span>)}
            <label className="flex items-center gap-1.5 font-semibold text-slate-700">Month
              <select value={month} onChange={(e) => { setMonth(e.target.value); setKpiKey(""); }} className={`min-h-[36px] cursor-pointer rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-900 ${FOCUS}`}>
                {opts.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
            </label>
          </div>
        )}
      </div>
      {open && (
        <div id="pd-pacing-body" className="space-y-4 border-t border-slate-100 p-4">
          {q.isLoading ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-56" />)}</div>
            : q.isError && !d ? <ErrorBox message={q.error instanceof Error ? q.error.message : "Could not load the forecast."} onRetry={() => void q.refetch()} />
            : !d || !shown.length ? <Empty>No forecastable KPIs for this process yet.</Empty> : (
              <>
                <p className="flex items-start gap-1.5 text-xs text-slate-800"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{monthLabel(d.month)}: {d.calendar.workingDays.elapsed} of {d.calendar.workingDays.total} working days done{d.asOf ? `, data complete to ${d.asOf}` : ", no complete day yet"}. {d.calendar.note}
                    {(state.tl || state.lob) && ` Filtered to ${[state.tl, state.lob].filter(Boolean).join(" / ")}.`}</span></p>
                {d.warnings.length > 0 && <ul className="space-y-1" aria-label="Forecast notes">{d.warnings.map((w) => <li key={w} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-950">{w}</li>)}</ul>}
                <ul aria-label="Pacing by KPI" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {shown.map((k) => <PacingCard key={k.key} k={k} selected={selected?.key === k.key} onSelect={() => setKpiKey(k.key)} />)}
                </ul>
                {hidden > 0 && <p className="text-xs text-slate-700">{hidden} KPI{hidden > 1 ? "s" : ""} hidden: the source field is not mapped.</p>}
                <details className="text-xs text-slate-800">
                  <summary className={`cursor-pointer rounded font-semibold ${FOCUS}`}>View all KPIs as table</summary>
                  <div className="mt-2">
                    <SimpleTable caption={`Pacing summary for ${monthLabel(d.month)}`} maxHeight="max-h-80"
                      cols={[{ key: "label", label: "KPI", align: "left" }, { key: "mtd", label: "Month to date", render: (r) => formatValue(r.mtd as number | null, r.unit as string) },
                        { key: "projected", label: "Projected", render: (r) => formatValue(r.projected as number | null, r.unit as string) },
                        { key: "range", label: "Range", render: (r) => { const b = r.band as { low: number; high: number } | null; return b ? `${formatValue(b.low, r.unit as string)} to ${formatValue(b.high, r.unit as string)}` : "—"; } },
                        { key: "target", label: "Target", render: (r) => (r.target === null ? "None" : formatValue(r.target as number, r.unit as string)) },
                        { key: "pacingPct", label: "Proj. vs target", render: (r) => (typeof r.pacingPct === "number" ? `${(r.pacingPct as number).toFixed(1)}%` : "—") },
                        { key: "requiredDailyRate", label: "Needed", render: (r) => formatValue(r.requiredDailyRate as number | null, r.unit as string) },
                        { key: "status", label: "Status", align: "left", render: (r) => statusOf(r.status as string).label }]}
                      rows={shown as unknown as Array<Record<string, unknown>>} />
                  </div>
                </details>
                {selected && (
                  <>
                    <Panel title={`${selected.label}: month path`}><PacingChart k={selected} onDay={(day) => onChange({ day }, true)} /></Panel>
                    <Panel title={`${selected.label}: pacing by team leader`}>
                      <TlPacingTable processId={processId} data={d} kpiKey={selected.key} state={state} onAgent={(agent) => onChange({ agent }, true)} onTl={(tl) => onChange({ tl, page: 1 })} />
                    </Panel>
                  </>
                )}
                <details className="text-xs text-slate-800">
                  <summary className={`cursor-pointer rounded font-semibold ${FOCUS}`}>How this is calculated</summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    <li>Counts and amounts: {d.method.additive}</li><li>Rates: {d.method.rate}</li><li>{d.method.targets}</li>
                    <li>Today&apos;s partial day is never counted and never scaled; it only raises today&apos;s expectation if it is already higher.</li>
                  </ul>
                </details>
              </>
            )}
        </div>
      )}
    </section>
  );
}
export default PacingPanel;
