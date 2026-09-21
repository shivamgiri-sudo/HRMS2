import { useEffect, useMemo, useState, type ReactNode } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Spinner } from "./DashboardKit";
import { InboundInsightsDashboard } from "./InboundInsightsDashboard";
import { CloviaLobSlide } from "./CloviaLobSlide";
import { DataTable, DetailDrawer, type DrillTarget, type TableSpec } from "./CloviaReportKit";

/**
 * Clovia INBOUND slide. Four views, nothing removed:
 *   Call performance  the shared full-featured inbound dashboard on the live dialer (cdr_in_250)
 *   CSAT & more       IVR feedback, quality audits, rechurn calls and CRM tickets (uploaded tables)
 *   MIS snapshot      the 27-row Inbound MIS table (uploaded cl_ib_cdr / apr / feedback / quality)
 *   Classic view      the previous Inbound page, unchanged (passed in by the shell)
 */

export type InboundView = "calls" | "addons" | "mis" | "classic";
const VIEWS: Array<{ key: InboundView; label: string }> = [
  { key: "calls", label: "Call performance (live dialer)" }, { key: "addons", label: "CSAT, Quality, Rechurn & Tickets" },
  { key: "mis", label: "MIS snapshot (uploaded CDR)" }, { key: "classic", label: "Classic view" },
];

interface Snapshot {
  periods: Array<{ key: string; label: string }>;
  metrics: Array<{ key: string; label: string; benchmark: string | null; values: Record<string, number | string> }>;
  cdrCoverage: { minDate: string; maxDate: string }; notes: string[];
}

function MisSnapshot() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  useEffect(() => {
    hrmsApi.get<{ success: boolean; data: Snapshot }>("/api/process-performance/clovia-inbound-snapshot").then((r) => setSnap(r.data)).catch((e) => setError(e instanceof Error ? e.message : "Unable to load the MIS snapshot."));
  }, []);
  const spec = useMemo<TableSpec | null>(() => {
    if (!snap) return null;
    return {
      key: "mis", title: "Inbound MIS snapshot", tab: "", drillKind: "mis", keyField: "key", searchable: true,
      subtitle: `Built from the uploaded inbound CDR, which only covers ${snap.cdrCoverage.minDate} to ${snap.cdrCoverage.maxDate}; it is not the live dialer. Click a metric for its value in every period.`,
      columns: [{ key: "label", label: "Metric", align: "left" }, { key: "benchmark", label: "Benchmark", align: "left" }, ...snap.periods.map((p) => ({ key: p.key, label: p.label }))],
      rows: snap.metrics.map((m) => ({ key: m.key, label: m.label, benchmark: m.benchmark ?? "—", ...m.values })),
      footnote: snap.notes.join(" "),
    };
  }, [snap]);
  if (error) return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!spec) return <Spinner tone="blue" />;
  return (
    <>
      <DataTable spec={spec} onRow={(kind, key) => setDrill({ kind, key })} />
      <DetailDrawer lob="inbound" target={drill} query="from=2026-01-01&to=2026-01-01" onClose={() => setDrill(null)} />
    </>
  );
}

export function CloviaInboundSlide({ from, to, onRangeChange, classic }: { from: string; to: string; onRangeChange: (from: string, to: string) => void; classic: ReactNode }) {
  const [view, setView] = useState<InboundView>("calls");
  return (
    <div className="space-y-5">
      <div role="tablist" aria-label="Inbound view" className="inline-flex flex-wrap rounded-xl bg-slate-100 p-1">
        {VIEWS.map((v) => (
          <button key={v.key} type="button" role="tab" aria-selected={view === v.key} onClick={() => setView(v.key)}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${view === v.key ? "bg-white text-purple-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{v.label}</button>
        ))}
      </div>
      {view === "calls" && <InboundInsightsDashboard projectKey="clovia" initialRange={{ from, to }} onRangeChange={onRangeChange} />}
      {view === "addons" && <CloviaLobSlide lob="inbound" from={from} to={to} onRangeChange={onRangeChange} hideHero />}
      {view === "mis" && <MisSnapshot />}
      {view === "classic" && classic}
    </div>
  );
}
