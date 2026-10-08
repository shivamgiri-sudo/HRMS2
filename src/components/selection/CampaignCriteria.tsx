/** The campaign drawer's criteria block (S20): read-through of every requisition the campaign points at, with Edit / Preview and a
 * bulk edit when there are several. Nothing for roles without read access. */
import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import CriteriaListView from "./CriteriaListView";
import RequisitionCriteriaPanel from "./RequisitionCriteriaPanel";
import { SMALL_BTN } from "./RuleRow";
import { listCounts } from "./criteriaListModel";
import { selectionApi } from "./selectionApi";
import type { Permissions, RequisitionItem } from "./selectionTypes";

const BulkCriteriaDialog = lazy(() => import("./BulkCriteriaDialog"));

export function CampaignCriteriaView({ items, permissions, selected, onSelect, onBulk, now, panel }:
  { items: RequisitionItem[]; permissions: Permissions; selected: string | null; onSelect: (id: string) => void; onBulk: () => void; now: Date; panel?: ReactNode }) {
  if (!permissions.read) return null;
  return (
    <section aria-labelledby="campaign-criteria-title" className="space-y-2 text-slate-900 dark:text-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 id="campaign-criteria-title" className="text-sm font-bold">Selection criteria</h3><p className="text-xs text-slate-600 dark:text-slate-300">{listCounts(items)}</p></div>
        {permissions.edit && items.length > 1 && <button type="button" className={SMALL_BTN} onClick={onBulk}>Bulk edit criteria</button>}
      </div>
      {items.length === 0 ? <p className="text-sm text-slate-600 dark:text-slate-300">This campaign is not linked to a requisition you can see.</p>
        : <CriteriaListView items={items} selected={selected} onSelect={onSelect} now={now} caption="Requisitions of this campaign and their selection criteria" />}
      {selected && panel}
    </section>
  );
}

export default function CampaignCriteria({ campaignId }: { campaignId: string }) {
  const [data, setData] = useState<{ items: RequisitionItem[]; permissions: Permissions } | null>(null);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [bulk, setBulk] = useState(false);
  const load = useCallback(async () => {
    setError(null);
    try { const r = await selectionApi.campaign(campaignId); setData(r); if (r.items.length === 1) setSelected((s) => s ?? r.items[0].id); }
    catch (e) { if ((e as { status?: number }).status === 403) setHidden(true); else setError((e as Error).message); }
  }, [campaignId]);
  useEffect(() => { void load(); }, [load]);
  if (hidden) return null;
  if (error) return <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-rose-800 dark:text-rose-200">Could not load the criteria: {error}<button type="button" className={SMALL_BTN} onClick={() => void load()}>Retry</button></p>;
  if (!data) return <div aria-busy="true" aria-label="Loading criteria" className="h-24 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" />;
  return (
    <>
      <CampaignCriteriaView items={data.items} permissions={data.permissions} selected={selected} onSelect={(id) => setSelected((s) => (s === id ? null : id))} onBulk={() => setBulk(true)} now={new Date()}
        panel={selected ? <RequisitionCriteriaPanel requisitionId={selected} onChanged={load} /> : null} />
      {bulk && <Suspense fallback={null}><BulkCriteriaDialog open onOpenChange={(o) => { if (!o) setBulk(false); }} items={data.items} onDone={load} /></Suspense>}
    </>
  );
}
