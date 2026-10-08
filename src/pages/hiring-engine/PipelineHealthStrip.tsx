/**
 * Pipeline health strip (Master tab, top): overall status plus one chip per check from GET /api/he/pipeline-health.
 * Reloads every 60 s. Chips are real buttons, so Enter and Space expand the detail natively.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { buildStripView, toggleExpanded, type HealthLevel, type HealthPayload, type IconKey, type StripView } from "./healthStripModel";

const REFRESH_MS = 60_000;
const ICONS = { check: CheckCircle2, alert: AlertTriangle, x: XCircle } as const;
const TONE: Record<HealthLevel, string> = {
  ok: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200",
  warn: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200",
  critical: "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-200",
};
const FOCUS = "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";
const MOTION = "transition-colors duration-150 motion-reduce:transition-none";

function Icon({ name, className }: { name: IconKey; className?: string }) {
  const C = ICONS[name];
  return <C className={className ?? "h-4 w-4 shrink-0"} aria-hidden />;
}

interface ViewProps { view: StripView; error: string | null; loading: boolean; onToggle: (key: string) => void; onRefresh: () => void }

export function PipelineHealthView({ view, error, loading, onToggle, onRefresh }: ViewProps) {
  if (error && view.chips.length === 0) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-200">
        <span className="min-w-0 flex-1">Pipeline health unavailable: {error}</span>
        <button type="button" onClick={onRefresh} className={`min-h-11 cursor-pointer rounded-lg border border-rose-400 bg-white px-3 text-sm font-semibold text-rose-800 hover:bg-rose-100 dark:bg-slate-900 dark:text-rose-200 dark:hover:bg-slate-800 sm:min-h-8 ${MOTION} ${FOCUS}`}>Retry</button>
      </div>
    );
  }
  return (
    <section aria-label="Pipeline health" className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-2">
        {view.overallLevel && view.overallIcon && (
          <span className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-semibold ${TONE[view.overallLevel]}`}>
            <Icon name={view.overallIcon} />{view.overallLabel}
          </span>
        )}
        {view.chips.map((c) => (
          <button key={c.key} type="button" aria-expanded={c.expanded} aria-controls="he-health-detail" onClick={() => onToggle(c.key)}
            className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium hover:brightness-95 sm:min-h-8 ${TONE[c.level]} ${MOTION} ${FOCUS}`}>
            <Icon name={c.icon} className="h-3.5 w-3.5 shrink-0" />
            <span>{c.label}</span>
            <span className="font-semibold">{c.levelWord}</span>
          </button>
        ))}
        <button type="button" aria-label="Refresh pipeline health" aria-disabled={loading} onClick={() => { if (!loading) onRefresh(); }}
          className={`ml-auto inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 aria-disabled:cursor-wait aria-disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800 sm:h-8 sm:w-8 ${MOTION} ${FOCUS}`}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden />
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-rose-800 dark:text-rose-200">Could not refresh: {error}</p>}
      <div id="he-health-detail" aria-live="polite">
        {view.expandedDetail && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:bg-slate-800 dark:text-slate-100">{view.expandedDetail}</p>}
      </div>
    </section>
  );
}

export default function PipelineHealthStrip() {
  const [data, setData] = useState<HealthPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await hrmsApi.get<{ success: boolean; data: HealthPayload }>("/api/he/pipeline-health");
      if (r?.data && Array.isArray(r.data.checks)) { setData(r.data); setError(null); }
      else setError("Unexpected response from the server");
    } catch (e: unknown) { setError((e as { message?: string })?.message || "Request failed"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  if (!data && !error) return <div className="h-14 animate-pulse rounded-lg border border-slate-200 bg-slate-50 motion-reduce:animate-none dark:border-slate-700 dark:bg-slate-800" role="status" aria-label="Loading pipeline health" />;
  return <PipelineHealthView view={buildStripView(data, expanded)} error={error} loading={loading} onToggle={(k) => setExpanded((cur) => toggleExpanded(cur, k))} onRefresh={() => void load()} />;
}
