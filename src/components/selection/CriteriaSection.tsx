/** Command Center "Selection criteria" section (S20, #drives:criteria): open requisitions in scope with their criteria badge, an
 * "only incomplete" filter, a why-not lookup, and the chosen requisition's summary / editor / preview / approval. */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import CriteriaListView from "./CriteriaListView";
import RequisitionCriteriaPanel from "./RequisitionCriteriaPanel";
import WhyNotLookup from "./WhyNotLookup";
import { SMALL_BTN } from "./RuleRow";
import { listCounts } from "./criteriaListModel";
import { selectionApi } from "./selectionApi";
import type { Permissions, RequisitionItem } from "./selectionTypes";

export function CriteriaSectionView({ items, permissions, onlyIncomplete, onOnlyIncomplete, selected, onSelect, loading, error, onRetry, now, whyNot, panel }:
  { items: RequisitionItem[] | null; permissions: Permissions | null; onlyIncomplete: boolean; onOnlyIncomplete: (b: boolean) => void; selected: string | null; onSelect: (id: string) => void;
    loading: boolean; error: string | null; onRetry: () => void; now: Date; whyNot?: ReactNode; panel?: ReactNode }) {
  return (
    <section aria-labelledby="criteria-section-title" className="space-y-3 rounded-xl bg-white p-3 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="criteria-section-title" className="text-base font-bold">Selection criteria</h2>
          <p className="text-xs text-slate-600 dark:text-slate-300">{items ? listCounts(items) : "Who each open requisition shortlists"}</p>
        </div>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-9 text-slate-700 dark:text-slate-200">
          <input type="checkbox" checked={onlyIncomplete} onChange={(e) => onOnlyIncomplete(e.target.checked)} className="h-5 w-5 cursor-pointer rounded" />Only criteria incomplete
        </label>
      </div>
      {error && <p role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-100">Could not load the requisitions: {error}<button type="button" className={SMALL_BTN} onClick={onRetry}>Retry</button></p>}
      {loading && !items && <div aria-busy="true" aria-label="Loading requisitions" className="space-y-1">{[0, 1, 2, 3].map((i) => <div key={i} className="h-11 animate-pulse rounded bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" />)}</div>}
      {items && items.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-600 dark:border-slate-600 dark:text-slate-300">{onlyIncomplete ? "Every open requisition you can see has complete criteria." : "No open requisitions in your scope."}</p>}
      {items && items.length > 0 && <CriteriaListView items={items} selected={selected} onSelect={onSelect} now={now} caption="Open requisitions and the state of their selection criteria" />}
      {selected && <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">{panel}</div>}
      {permissions?.read && whyNot}
    </section>
  );
}

const errText = (e: unknown) => (e as { message?: string })?.message ?? "Something went wrong";

export default function CriteriaSection({ requisitionId }: { requisitionId?: string | null }) {
  const [items, setItems] = useState<RequisitionItem[] | null>(null);
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [selected, setSelected] = useState<string | null>(requisitionId ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const r = await selectionApi.list(onlyIncomplete); setItems(r.items); setPermissions(r.permissions); } catch (e) { setError(errText(e)); } finally { setLoading(false); }
  }, [onlyIncomplete]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (requisitionId) setSelected(requisitionId); }, [requisitionId]);
  return <CriteriaSectionView items={items} permissions={permissions} onlyIncomplete={onlyIncomplete} onOnlyIncomplete={setOnlyIncomplete} selected={selected}
    onSelect={(id) => setSelected((s) => (s === id ? null : id))} loading={loading} error={error} onRetry={load} now={new Date()}
    whyNot={permissions ? <WhyNotLookup permissions={permissions} /> : null} panel={selected ? <RequisitionCriteriaPanel requisitionId={selected} onChanged={load} /> : null} />;
}
