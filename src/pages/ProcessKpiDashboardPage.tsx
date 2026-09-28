import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi, type HrmsEnvelope } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Gauge, Loader2 } from "lucide-react";
import KpiScorecardDetail from "@/components/process-performance/KpiScorecardDetail";

/**
 * Client Process KPI Dashboard.
 *
 * Per-client/process scorecards for the targets on the client-facing "Process
 * KPI's" sheet, with a team-leader -> agent -> raw-row drill-down on every
 * card. Same honesty rule as its sibling /performance/process-performance: a
 * card either shows a number computed from real kpi_daily_actual rows, or it
 * says "Not tracked" / "No data" -- never a fabricated figure. Verified live
 * 2026-09-06 that none of the 4 registered processes have real data yet for
 * any of these metrics; the plumbing is genuine and lights up the moment a
 * feed populates kpi_daily_actual, with no rebuild required.
 */

interface ProcessOption { processCode: string; billingName: string; projectName: string }
interface ProcessHeader { processCode: string; billingName: string; projectName: string; note: string | null }
export interface KpiScorecardRow {
  metricKey: string;
  label: string;
  family: "rate" | "volume" | "duration" | "roi";
  unit: "percent" | "count" | "currency" | "seconds" | "ratio";
  lobLabel: string;
  target: number;
  direction: "higher_is_better" | "lower_is_better";
  availability: "ok" | "no_data" | "not_tracked";
  actual: number | null;
  rag: "good" | "warn" | "crit" | null;
  trend: Array<{ period: string; value: number | null }>;
  /**
   * The counts behind a rate, already descaled by the API. Present only for a
   * ratio metric whose every day in the window carried its parts.
   */
  support?: { numerator: number; denominator: number } | null;
  note?: string;
}

export function formatKpiValue(v: number | null, unit: KpiScorecardRow["unit"]): string {
  if (v === null) return "—";
  switch (unit) {
    case "percent": return `${v}%`;
    case "seconds": return v >= 3600 ? `${(v / 3600).toFixed(1)} hr` : `${Math.round(v)}s`;
    case "currency": return `₹${Math.round(v).toLocaleString("en-IN")}`;
    case "ratio": return `${v.toFixed(2)}x`;
    default: return v.toLocaleString("en-IN");
  }
}

const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const firstOfMonth = () => isoLocal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
const todayIso = () => isoLocal(new Date());

const ragTone: Record<NonNullable<KpiScorecardRow["rag"]>, string> = {
  good: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warn: "bg-amber-50 text-amber-700 border-amber-200",
  crit: "bg-red-50 text-red-700 border-red-200",
};
const ragLabel: Record<NonNullable<KpiScorecardRow["rag"]>, string> = {
  good: "SLA Met", warn: "At Risk", crit: "Breached",
};

function KpiCard({ row, onOpen }: { row: KpiScorecardRow; onOpen: () => void }) {
  const interactive = row.availability === "ok";
  return (
    <button
      type="button"
      disabled={!interactive}
      onClick={onOpen}
      className={`text-left rounded-2xl border p-4 bg-white transition-shadow ${
        interactive ? "border-slate-200 hover:shadow-md cursor-pointer" : "border-slate-100 cursor-default"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-slate-700">{row.label}</p>
          <p className="text-[10px] uppercase tracking-wide text-slate-400 mt-0.5">{row.family}</p>
        </div>
        {row.rag ? (
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${ragTone[row.rag]}`}>
            {ragLabel[row.rag]}
          </span>
        ) : (
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border border-slate-200 text-slate-400">
            {row.availability === "no_data" ? "No data" : "Not tracked"}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={`text-xl font-semibold tabular-nums ${interactive ? "text-slate-900" : "text-slate-300"}`}>
          {interactive ? formatKpiValue(row.actual, row.unit) : "—"}
        </span>
        <span className="text-[11px] text-slate-400">of target {formatKpiValue(row.target, row.unit)}</span>
      </div>
      {/* A rate with no volume beside it is unreadable: 98% of 12 calls and 98% of
          12,000 are the same number and not the same fact. Shown only when every
          day in the window carried its parts, so the pair always reconstructs the
          figure above it rather than covering part of the period. */}
      {interactive && row.support && (
        <p className="mt-1 text-[11px] text-slate-500 tabular-nums">
          {row.support.numerator.toLocaleString("en-IN")} of{" "}
          {row.support.denominator.toLocaleString("en-IN")}
        </p>
      )}
      {!interactive && row.note && (
        <p className="mt-2 text-[11px] text-slate-400 line-clamp-2">{row.note}</p>
      )}
      {interactive && <p className="mt-2 text-[11px] text-indigo-600 font-medium">RCA drilldown →</p>}
    </button>
  );
}

export default function ProcessKpiDashboardPage() {
  const [processCode, setProcessCode] = useState<string | null>(null);
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(todayIso);
  const [openMetric, setOpenMetric] = useState<KpiScorecardRow | null>(null);

  const { data: procData } = useQuery({
    queryKey: ["process-kpi-dashboard", "processes"],
    queryFn: () => hrmsApi.get<HrmsEnvelope<ProcessOption[]>>("/api/process-kpi-dashboard/processes"),
  });
  const processes = procData?.data ?? [];
  const activeCode = processCode ?? processes[0]?.processCode ?? null;

  const { data: headerData } = useQuery({
    queryKey: ["process-kpi-dashboard", "header", activeCode],
    queryFn: () => hrmsApi.get<HrmsEnvelope<ProcessHeader>>(`/api/process-kpi-dashboard/${activeCode}/header`),
    enabled: !!activeCode,
  });
  const header = headerData?.data ?? null;

  const { data: scoreData, isLoading } = useQuery({
    queryKey: ["process-kpi-dashboard", "scorecards", activeCode, from, to],
    queryFn: () => hrmsApi.get<HrmsEnvelope<KpiScorecardRow[]>>(
      `/api/process-kpi-dashboard/${activeCode}/scorecards?from=${from}&to=${to}`,
    ),
    enabled: !!activeCode,
  });
  const rows = scoreData?.data ?? [];

  const grouped = useMemo(() => {
    const map = new Map<string, KpiScorecardRow[]>();
    for (const r of rows) {
      const list = map.get(r.lobLabel) ?? [];
      list.push(r);
      map.set(r.lobLabel, list);
    }
    return [...map.entries()];
  }, [rows]);

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <Gauge className="h-4.5 w-4.5" />
          </span>
          <div>
            <h1 className="text-lg font-bold text-slate-900">Process KPI Dashboard</h1>
            <p className="text-xs text-slate-500">
              Client/process SLA targets, scored against real records where a feed exists — never a fabricated number.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm p-4 shadow-sm">
          <div className="flex flex-col gap-1">
            <label htmlFor="pk-process" className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Process</label>
            <select
              id="pk-process"
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={activeCode ?? ""}
              onChange={(e) => setProcessCode(e.target.value)}
            >
              {processes.map((p) => (
                <option key={p.processCode} value={p.processCode}>{p.billingName} · {p.projectName}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="pk-from" className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">From</label>
            <input id="pk-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="pk-to" className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">To</label>
            <input id="pk-to" type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900" />
          </div>
        </div>

        {header?.note && (
          <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 inline-block">
            {header.note}
          </div>
        )}

        {isLoading && (
          <p className="text-sm text-slate-500"><Loader2 className="inline h-4 w-4 animate-spin mr-1.5" />Loading…</p>
        )}

        {!isLoading && grouped.map(([lob, list]) => (
          <section key={lob} className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-wide text-slate-400">{lob}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {list.map((row) => (
                <KpiCard key={row.metricKey} row={row} onOpen={() => row.availability === "ok" && setOpenMetric(row)} />
              ))}
            </div>
          </section>
        ))}

        {!isLoading && rows.length === 0 && (
          <p className="text-sm text-slate-500">No KPIs registered for this process.</p>
        )}
      </div>

      {activeCode && openMetric && (
        <KpiScorecardDetail
          open={!!openMetric}
          onClose={() => setOpenMetric(null)}
          processCode={activeCode}
          row={openMetric}
          baseQuery={{ from, to }}
        />
      )}
    </DashboardLayout>
  );
}
