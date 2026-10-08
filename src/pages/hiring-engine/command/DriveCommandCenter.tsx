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
import { SECTIONS, TYPE_LABEL, commandHash, defaultFilters, istTodayClient, parseCommandHash, sectionLabels, sectionsFor, type Filters, type SectionId } from "./driveCommandModel";
import { useHasRole } from "@/hooks/useUserRole";
import { CRITERIA_READ_ROLES } from "@/components/selection/criteriaListModel";
import type { DriveAnalytics } from "./driveCommandTypes";
import { useDriveAnalytics, useFilterOptions } from "./useCommandData";
import KpiStrip from "./charts/KpiStrip";
import FunnelCompare from "./charts/FunnelCompare";
import YieldChart from "./charts/YieldChart";
import ConversionHeatmap from "./charts/ConversionHeatmap";
import TimingHeatmap from "./charts/TimingHeatmap";
import ShowRateScatter from "./charts/ShowRateScatter";
import DropOffWaterfall from "./charts/DropOffWaterfall";
import CompareTable from "./charts/CompareTable";
import InsightsPanel from "./InsightsPanel";
import DriveTypeSection, { type SectionActions } from "./DriveTypeSection";
import { insightNavHash, type ActionTarget } from "./insightsPanelModel";
import CreateStreamDialog from "./CreateStreamDialog";
import { StreamDialog } from "./RowStreamActions";
import type { SourceType } from "./driveCommandTypes";
import SourceOverview from "./SourceOverview";
import { Note } from "./charts/ChartFrame";
import { HE_META_NOTE } from "./sourceSectionModel";
import PlanSection from "./PlanSection";
import FollowupPanel from "./FollowupPanel";
import ActionQueuePanel from "./ActionQueuePanel";
import { DriveFunnelDepth, SummaryFunnelDepth } from "./FunnelDepth";

const DrivesTab = lazy(() => import("../DrivesTab"));
const CriteriaSection = lazy(() => import("@/components/selection/CriteriaSection"));

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
  /** Rendered once analytics are usable (not loading-without-data, not failed, not empty). */
  gated?: ReactNode;
  /** Rendered regardless of the analytics state (the existing DrivesTab, the Plan section). */
  children?: ReactNode;
  /** The tabs shown (the Selection criteria tab only for roles that may read criteria). */
  sections?: typeof SECTIONS;
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

export function DriveCommandView({ section, filters, analytics, loading, error, onSection, onFilters, onRetry, requisitions, branches, gated, children, sections = SECTIONS }: DriveCommandViewProps) {
  const needs = section !== "plan" && section !== "criteria"; // Plan and Selection criteria load their own data
  const firstLoad = needs && loading && !analytics;
  const failed = needs && !!error && !analytics;
  // Live Meta / Old Meta data explain their own zeros (and still offer Open a stream), so the generic empty box is the Summary's only.
  const empty = !!analytics && analytics.requisitionCount === 0 && section === "summary";
  return (
    <div className="space-y-0">
      <SectionNav current={section} onSelect={onSection} sections={sections} />
      {section !== "criteria" && <FilterBar filters={filters} requisitions={requisitions} branches={branches} onChange={onFilters} />}
      <div id={PANEL_ID} role="tabpanel" tabIndex={-1} aria-labelledby={tabDomId(section)} aria-busy={loading} className="space-y-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
        {section === "summary" && children}
        {firstLoad && <CommandSkeleton />}
        {failed && !firstLoad && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-200">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">Could not load drive analytics: {error}</span>
            <button type="button" onClick={onRetry} className={RETRY_BTN}>Retry</button>
          </div>
        )}
        {needs && analytics && error && (
          <p role="alert" className="text-xs text-rose-800 dark:text-rose-200">Could not refresh: {error}. Showing the last result.</p>
        )}
        {needs && analytics?.partial && <DegradedBanner degraded={sectionLabels(analytics.failedSections)} onRetry={onRetry} />}
        {needs && analytics?.truncated && (
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
        {!firstLoad && !failed && !empty && gated}
        {section !== "summary" && children}
      </div>
    </div>
  );
}

/** Summary: KPI strip full width, the insights, the funnel depth block, then the comparison charts two per row on large screens. */
function SummaryCharts({ analytics, insights, planHref }: { analytics: DriveAnalytics; insights?: ReactNode; planHref?: string }) {
  return (
    <div className="space-y-4">
      <KpiStrip analytics={analytics} />
      {insights}
      <SummaryFunnelDepth analytics={analytics} planHref={planHref} />
      <div className="grid gap-4 lg:grid-cols-2">
        <FunnelCompare analytics={analytics} />
        <YieldChart analytics={analytics} />
        <ShowRateScatter analytics={analytics} />
        <DropOffWaterfall analytics={analytics} />
        <div className="min-w-0 lg:col-span-2"><ConversionHeatmap analytics={analytics} /></div>
        <div className="min-w-0 lg:col-span-2"><TimingHeatmap analytics={analytics} /></div>
        <div className="min-w-0 lg:col-span-2"><CompareTable analytics={analytics} /></div>
      </div>
    </div>
  );
}

/**
 * Analytics-dependent panels (gated) and panels that must not wait for analytics (children). `typeInsights` renders the insights of one
 * drive type inside its section (the Summary shows `insights`, all types).
 */
export function sectionParts(section: SectionId, analytics?: DriveAnalytics | null, insights?: ReactNode, actions?: SectionActions, plan?: ReactNode, followupOpen = 0, filters?: Filters, onFilters?: (f: Filters) => void,
  typeInsights?: (t: SourceType) => ReactNode, now?: Date): { gated: ReactNode; always: ReactNode } {
  const planHref = commandHash("plan", filters ?? defaultFilters());
  if (section === "summary") {
    // The action queue does not wait for analytics; DriveCommandView draws the Summary's always slot above the gated charts.
    return {
      gated: <>{analytics && <SummaryCharts analytics={analytics} insights={insights} planHref={planHref} />}<FollowupPanel requisitionId={actions?.requisitionId ?? null} qualifiedTracked={analytics?.qualifiedTracked ?? null} openSignal={followupOpen} /></>,
      always: filters ? <ActionQueuePanel filters={filters} /> : null,
    };
  }
  if (section === "plan") return { gated: null, always: plan ?? null }; // the Plan section loads its own data
  if (section === "criteria") {
    return { gated: null, always: <Suspense fallback={<div className={PULSE} style={{ height: 240 }} aria-busy="true" />}><CriteriaSection requisitionId={filters?.requisitionId ?? null} /></Suspense> };
  }
  if (section === "he") {
    return {
      gated: analytics && (
        <div className="space-y-4">
          <Note>{HE_META_NOTE}</Note>
          <DriveFunnelDepth analytics={analytics} type="he" insights={typeInsights?.("he")} planHref={planHref} />
          <DriveTypeSection type="he" groups={analytics.groups ?? []} today={istTodayClient()} title="Hiring Engine drives" actions={actions} />
        </div>
      ),
      always: (
        <section aria-labelledby="all-drives-heading" className="space-y-2">
          <h3 id="all-drives-heading" className="text-base font-bold text-slate-900 dark:text-slate-100">All drives</h3>
          <Suspense fallback={<div className={PULSE} style={{ height: 240 }} aria-busy="true" />}><DrivesTab /></Suspense>
        </section>
      ),
    };
  }
  const type = section === "live" ? "meta_live" : "meta_old";
  return {
    gated: analytics && (
      <div className="space-y-4">
        <SourceOverview analytics={analytics} type={type} filters={filters ?? defaultFilters(now)} onFilters={onFilters} now={now} />
        <DriveFunnelDepth analytics={analytics} type={type} insights={typeInsights?.(type)} planHref={planHref} withFunnel={false} />
        <DriveTypeSection type={type} groups={analytics.groups ?? []} today={istTodayClient()} title={section === "live" ? "Live Meta drives" : "Old Meta data drives"} actions={actions} />
      </div>
    ),
    always: null,
  };
}

/** The code of a requisition an insight names: from the analytics rows, the scatter, or the filter options; "" when unknown. */
export function requisitionCodeOf(id: string, analytics: Pick<DriveAnalytics, "groups" | "scatter"> | null | undefined, options: RequisitionOption[]): string {
  return analytics?.groups?.find((g) => g.requisitionId === id)?.requisition || analytics?.scatter?.find((p) => p.requisitionId === id)?.code
    || options.find((o) => o.id === id)?.code || "";
}

export default function DriveCommandCenter() {
  const [state, setState] = useState(() => parseCommandHash(typeof window === "undefined" ? "" : window.location.hash));
  const showCriteria = useHasRole(...CRITERIA_READ_ROLES);
  const sections = sectionsFor(showCriteria);
  // a role that may not read criteria lands on the Summary even with #drives:criteria in the address
  const section: SectionId = state.section === "criteria" && !showCriteria ? "summary" : state.section;
  const { filters } = state;
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

  // Dismissals live in memory only: a reload or a new session shows every suggestion again.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const dismiss = useCallback((id: string) => setDismissed((d) => new Set(d).add(id)), []);
  const restore = useCallback(() => setDismissed(new Set()), []);
  // Extend and create-stream open their real dialogs over the current section; Plan now opens the Plan section with its dry-run preview.
  const [dialog, setDialog] = useState<{ kind: "extend_stream"; streamId: string } | { kind: "create_stream"; requisitionId: string; sourceType: SourceType } | null>(null);
  const [planIntent, setPlanIntent] = useState<{ requisitionId: string; date?: string; nonce: number } | null>(null);
  useEffect(() => { if (section !== "plan") setPlanIntent(null); }, [section]); // a later visit to Plan does not re-run the preview
  const [followupOpen, setFollowupOpen] = useState(0);
  const act = useCallback((t: ActionTarget) => {
    if (t.dialog === "extend_stream" && t.streamId) { setDialog({ kind: "extend_stream", streamId: t.streamId }); return; }
    if (t.intent === "followup") setFollowupOpen((n) => n + 1);
    if (t.preview && t.requisitionId) setPlanIntent({ requisitionId: t.requisitionId, date: t.date, nonce: Date.now() });
    if (t.dialog === "create_stream" && t.requisitionId && t.sourceType) { setDialog({ kind: "create_stream", requisitionId: t.requisitionId, sourceType: t.sourceType }); return; }
    const next = insightNavHash(t, filters, section);
    if (window.location.hash !== next) window.location.hash = next;
    setState(parseCommandHash(next));
    window.setTimeout(() => document.getElementById(PANEL_ID)?.focus(), 0);
  }, [filters, section]);

  const actions: SectionActions = { requisitions, requisitionId: filters.requisitionId, onChanged: reload };
  const [pageNote, setPageNote] = useState<string | null>(null);
  const today = istTodayClient();
  const plan = section === "plan" ? (
    <PlanSection requisitionId={filters.requisitionId} groups={data?.groups ?? null} groupsLoading={loading} requisitions={requisitions}
      onPick={(id) => go("plan", { ...filters, requisitionId: id })} onChanged={reload} autoPreview={planIntent} />
  ) : null;
  const typeInsights = (t: SourceType) => (
    <InsightsPanel analytics={data ? { insights: (data.insights ?? []).filter((i) => i.sourceType === t), partial: data.partial } : null} title={`Insights for ${TYPE_LABEL[t]}`}
      dismissed={dismissed} onDismiss={dismiss} onRestore={restore} onAction={act} onRetry={reload} />
  );
  const parts = sectionParts(section, data, <InsightsPanel analytics={data} dismissed={dismissed} onDismiss={dismiss} onRestore={restore} onAction={act} onRetry={reload} />, actions, plan, followupOpen, filters, (f) => go(section, f), typeInsights);
  return (
    <div className="space-y-3">
      <PipelineHealthStrip />
      <p role="status" className="text-sm text-emerald-800 empty:hidden dark:text-emerald-200">{pageNote}</p>
      <DriveCommandView section={section} filters={filters} analytics={data} loading={loading} error={error}
        onSection={(s) => go(s, filters)} onFilters={(f) => go(section, f)} onRetry={reload} requisitions={requisitions} branches={branches} gated={parts.gated} sections={sections}>
        {parts.always}
      </DriveCommandView>
      <StreamDialog open={dialog?.kind === "extend_stream"} onOpenChange={(o) => { if (!o) setDialog(null); }} streamId={dialog?.kind === "extend_stream" ? dialog.streamId : null} today={today} onChanged={reload} />
      <CreateStreamDialog open={dialog?.kind === "create_stream"} onOpenChange={(o) => { if (!o) setDialog(null); }} today={today} requisitions={requisitions}
        requisitionId={dialog?.kind === "create_stream" ? dialog.requisitionId : null} sourceType={dialog?.kind === "create_stream" ? dialog.sourceType : undefined}
        preset={dialog?.kind === "create_stream" ? { id: dialog.requisitionId, code: requisitionCodeOf(dialog.requisitionId, data, requisitions) } : null}
        onCreated={(_s, text) => { setDialog(null); setPageNote(text); reload(); }} />
    </div>
  );
}
