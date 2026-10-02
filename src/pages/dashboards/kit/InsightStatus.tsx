import { Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import type { RoleInsights } from "./useRoleInsights";

const nice = (name: string) => name.replace(/([A-Z])/g, " $1").replace(/[_-]/g, " ").trim().toLowerCase();

/**
 * One honest status line for the insight-fed parts of a dashboard: still loading, partly failed, or
 * unavailable — with a retry. Renders nothing when everything arrived, so a healthy page stays clean.
 */
export function InsightStatus({ insights, loading, error, onRetry }: {
  insights?: RoleInsights; loading?: boolean; error?: string | null; onRetry: () => void;
}) {
  const pending = insights?.pending ?? [];
  const failed = Object.keys(insights?.sectionErrors ?? {});
  if (error && !insights) {
    return (
      <div role="status" className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12px] text-amber-900">
        <TriangleAlert className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1">Insights could not be loaded ({error}). Summary figures are still shown.</span>
        <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 font-semibold text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100"><RefreshCw className="h-3 w-3" />Retry</button>
      </div>
    );
  }
  if (loading || pending.length) {
    return (
      <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-20 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-blue-100 bg-white px-4 py-2 text-[12px] font-medium text-blue-800 shadow-lg">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>{pending.length ? `Loading ${pending.length} more section${pending.length === 1 ? "" : "s"}…` : "Loading insights…"}</span>
      </div>
    );
  }
  if (failed.length) {
    return (
      <div role="status" className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12px] text-amber-900">
        <TriangleAlert className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1">{failed.length} section{failed.length === 1 ? "" : "s"} could not be loaded ({failed.slice(0, 4).map(nice).join(", ")}{failed.length > 4 ? "…" : ""}). Everything else is current.</span>
        <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 font-semibold text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100"><RefreshCw className="h-3 w-3" />Retry</button>
      </div>
    );
  }
  return null;
}
