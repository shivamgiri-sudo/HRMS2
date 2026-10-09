/** One requisition's criteria where people work (S20): the summary, then Edit / Preview / Approve / Booked. Used on the requisition
 * detail page, in the Command Center "Selection criteria" section and in the campaign drawer. A role without read access gets nothing. */
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import CriteriaSummary from "./CriteriaSummary";
import JdSuggestionsPanel from "./JdSuggestionsPanel";
import { textHint, type JdSuggestionsData } from "./jdSuggestionsModel";
import { SMALL_BTN } from "./RuleRow";
import { selectionApi } from "./selectionApi";
import type { CriteriaResponse, Permissions, SourceKind } from "./selectionTypes";
import { SOURCE_TABS } from "./ruleFunnelModel";

const RequisitionCriteriaEditor = lazy(() => import("./RequisitionCriteriaEditor"));
const SelectionPreview = lazy(() => import("./SelectionPreview"));
const ApproveShortlistBar = lazy(() => import("./ApproveShortlistBar"));
const BookedMismatchList = lazy(() => import("./BookedMismatchList"));

export type PanelTab = "summary" | "preview" | "approve" | "booked";
export function panelTabs(p: Permissions): Array<{ id: PanelTab; label: string }> {
  if (!p.read) return [];
  return [{ id: "summary", label: "Summary" }, { id: "preview", label: "Preview" }, { id: "approve", label: p.approve ? "Approve shortlist" : "Shortlist status" },
    ...(p.override ? [{ id: "booked" as const, label: "Booked, no longer matching" }] : [])];
}

const SKELETON = <div aria-busy="true" aria-label="Loading" className="h-40 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" />;
const errText = (e: unknown) => (e as { message?: string })?.message ?? "Something went wrong";
const status = (e: unknown) => (e as { status?: number; statusCode?: number })?.status ?? (e as { statusCode?: number })?.statusCode;

export default function RequisitionCriteriaPanel({ requisitionId, initialTab = "summary", onChanged, title }: { requisitionId: string; initialTab?: PanelTab; onChanged?: () => void; title?: string }) {
  const [data, setData] = useState<CriteriaResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [tab, setTab] = useState<PanelTab>(initialTab);
  const [source, setSource] = useState<SourceKind>("meta_live");
  const [editing, setEditing] = useState<{ focus: string | null } | null>(null);
  const [jd, setJd] = useState<JdSuggestionsData | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try { setData(await selectionApi.criteria(requisitionId)); } catch (e) { if (status(e) === 403) setHidden(true); else setError(errText(e)); }
  }, [requisitionId]);
  useEffect(() => { setData(null); setHidden(false); void load(); }, [load]);
  useEffect(() => { setTab(initialTab); }, [initialTab, requisitionId]);
  if (hidden) return null;
  if (error) return <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-rose-800 dark:text-rose-200">Could not load the criteria: {error}<button type="button" className={SMALL_BTN} onClick={() => void load()}>Retry</button></p>;
  if (!data) return SKELETON;
  const p = data.permissions;
  const tabs = panelTabs(p);
  return (
    <div className="min-w-0 space-y-3 rounded-xl bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      {title && <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>}
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Criteria views">
        {tabs.map((t) => (
          <button key={t.id} type="button" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}
            className={`${SMALL_BTN} ${tab === t.id ? "border-blue-700 bg-blue-50 text-blue-900 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-100" : ""}`}>{t.label}</button>
        ))}
        {p.edit && <button type="button" className={SMALL_BTN} onClick={() => setEditing({ focus: null })}><Pencil className="h-4 w-4" aria-hidden="true" />Edit criteria</button>}
      </div>
      {tab === "summary" && <CriteriaSummary data={{ completeness: data.completeness, rules: data.compiled.rules, legacy: data.compiled.legacy, version: data.versions[0] ? { versionNo: data.versions[0].versionNo, at: data.versions[0].createdAt, by: data.versions[0].createdBy, source: data.versions[0].source } : null }}
        onEdit={p.edit ? (key) => setEditing({ focus: key }) : undefined} textHint={jd ? textHint(jd) : null} />}
      {tab === "summary" && <JdSuggestionsPanel requisitionId={requisitionId} onData={setJd} onChanged={() => { void load(); onChanged?.(); }} />}
      <Suspense fallback={SKELETON}>
        {tab === "preview" && <SelectionPreview requisitionId={requisitionId} permissions={p} />}
        {tab === "approve" && (
          <div className="space-y-2">
            <div role="group" aria-label="Source to approve" className="flex flex-wrap gap-1">
              {SOURCE_TABS.map((s) => <button key={s.id} type="button" aria-pressed={source === s.id} onClick={() => setSource(s.id)}
                className={`${SMALL_BTN} ${source === s.id ? "border-blue-700 bg-blue-50 text-blue-900 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-100" : ""}`}>{s.label}</button>)}
            </div>
            <ApproveShortlistBar key={source} requisitionId={requisitionId} sourceKind={source} />
          </div>
        )}
        {tab === "booked" && p.override && <BookedMismatchList requisitionId={requisitionId} />}
        {editing && <RequisitionCriteriaEditor requisitionId={requisitionId} open onOpenChange={(o) => { if (!o) setEditing(null); }} focusRule={editing.focus} onSaved={() => { void load(); onChanged?.(); }} />}
      </Suspense>
    </div>
  );
}
