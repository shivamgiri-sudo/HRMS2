/**
 * Drive Command Center: pipeline health strip, sticky section tabs, filter bar and the section panel.
 * DriveCommandView is purely presentational (static-markup tested); the default export wires the hash, the data and the sections.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Info, Inbox } from "lucide-react";
import { DegradedBanner } from "@/components/analytics/analytics-kit";
import PipelineHealthStrip from "../PipelineHealthStrip";
import FilterBar from "./FilterBar";
import SectionNav, { PANEL_ID, tabDomId } from "./SectionNav";
import { filtersKey, type RequisitionOption } from "./commandData";
import { commandHash, parseCommandHash, type Filters, type SectionId } from "./driveCommandModel";
import type { DriveAnalytics } from "./driveCommandTypes";
import { useDriveAnalytics, useFilterOptions } from "./useCommandData";

const DrivesTab = lazy(() => import("../DrivesTab"));

const RETRY_BTN = "min-h-11 cursor-pointer rounded-lg border border-rose-400 bg-white px-3 text-sm font-semibold text-rose-800 transition-colors duration-150 hover:bg-rose-100 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-slate-900 dark:text-rose-200 dark:hover:bg-slate-800 sm:min-h-8";
const PULSE = "animate-pulse rounded-xl border border-slate-200 bg-slate-100 motion-reduce:animate-none dark:border-slate-700 dark:bg-slate-800";

export interface DriveCommandViewProps {
  section: SectionId;
  filters: Filters;
  analytics: DriveAnalytics | null;
  loading: boolean;
  error: string | null;
  onSection: (s: SectionId) => void;
  onFilters: (f: Filters) => void;
  onRetry: () => void;
  requisitions: RequisitionOption[];
  branches: string[];
  children?: ReactNode;
}

/** Reserved-height skeleton: four KPI tiles (112 px) and two charts (280 px). */
function CommandSkeleton() {
  return (
    <div role="status" aria-label="Loading drive analytics" className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className={PULSE} style={{ height: 112 }} />)}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {[0, 1].map((i) => <div key={i} className={PULSE} style={{ height: 280 }} />)}
      </div>
    </div>
  );
}

export function DriveCommandView({ section, filters, analytics, loading, error, onSection, onFilters, onRetry, requisitions, branches, children }: DriveCommandViewProps) {
  const firstLoad = loading && !analytics;
  const failed = !!error && !analytics;
  const empty = !!analytics && analytics.requisitionCount === 0 && (section === "summary" || section === "live" || section === "old");
  return (
    <div className="space-y-0">
      <SectionNav current={section} onSelect={onSection} />
      <FilterBar filters={filters} requisitions={requisitions} branches={branches} onChange={onFilters} />
      <div id={PANEL_ID} role="tabpanel" aria-labelledby={tabDomId(section)} aria-busy={loading} className="space-y-3">
        {firstLoad && <CommandSkeleton />}
        {failed && !firstLoad && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-200">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">Could not load drive analytics: {error}</span>
            <button type="button" onClick={onRetry} className={RETRY_BTN}>Retry</button>
          </div>
        )}
        {analytics && error && (
          <p role="alert" className="text-xs text-rose-800 dark:text-rose-200">Could not refresh: {error}. Showing the last result.</p>
        )}
        {analytics?.partial && <DegradedBanner degraded={analytics.failedSections} onRetry={onRetry} />}
        {analytics?.truncated && (
          <p className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            <Info className="h-4 w-4 shrink-0" aria-hidden /> Showing the 200 most recent requisitions; narrow the filters to see the rest
          </p>
        )}
        {empty && (
          <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 px-4 text-center dark:border-slate-600" style={{ minHeight: 200 }}>
            <Inbox className="h-6 w-6 text-slate-500 dark:text-slate-400" aria-hidden />
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">No requisitions with drives in this window</p>
            <p className="text-xs text-slate-600 dark:text-slate-300">Widen the date range or clear the requisition and branch filters.</p>
          </div>
        )}
        {!firstLoad && !failed && !empty && children}
      </div>
    </div>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <section aria-label={title} className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600 dark:border-slate-600 dark:text-slate-300" style={{ minHeight: 120 }}>
      <h3 className="font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
      <p>Loads in a later step</p>
    </section>
  );
}

function SectionBody({ section }: { section: SectionId }) {
  if (section === "summary") return <><Placeholder title="Summary charts" /><Placeholder title="Insights" /><Placeholder title="Follow-up pipeline" /></>;
  if (section === "plan") return <Placeholder title="Plan" />;
  if (section === "he") {
    return (
      <>
        <Placeholder title="Hiring Engine drives" />
        <section aria-labelledby="all-drives-heading" className="space-y-2">
          <h3 id="all-drives-heading" className="text-base font-bold text-slate-900 dark:text-slate-100">All drives</h3>
          <Suspense fallback={<div className={PULSE} style={{ height: 240 }} aria-busy="true" />}><DrivesTab /></Suspense>
        </section>
      </>
    );
  }
  return <Placeholder title={section === "live" ? "Live Meta drives" : "Old Meta data drives"} />;
}

export default function DriveCommandCenter() {
  const [state, setState] = useState(() => parseCommandHash(typeof window === "undefined" ? "" : window.location.hash));
  const { section, filters } = state;
  useEffect(() => {
    const h = () => setState(parseCommandHash(window.location.hash));
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);

  // The hash is the source of truth: assigning it adds a history entry (back works) and hashchange re-parses.
  const go = useCallback((s: SectionId, f: Filters) => {
    const next = commandHash(s, f);
    if (window.location.hash !== next) window.location.hash = next;
    setState({ section: s, filters: f });
  }, []);

  const stable = useMemo(() => filters, [filtersKey(filters)]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data, error, loading, reload } = useDriveAnalytics(stable);
  const { requisitions, branches } = useFilterOptions();

  return (
    <div className="space-y-3">
      <PipelineHealthStrip />
      <DriveCommandView section={section} filters={filters} analytics={data} loading={loading} error={error}
        onSection={(s) => go(s, filters)} onFilters={(f) => go(section, f)} onRetry={reload} requisitions={requisitions} branches={branches}>
        <SectionBody section={section} />
      </DriveCommandView>
    </div>
  );
}
