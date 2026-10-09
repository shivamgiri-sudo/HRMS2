/**
 * The requisitions of one Meta campaign (WS3 A4), in the campaign drawer: one row per linked requisition (main, seats left, end date chip,
 * criteria label, open / closed), add / remove / make main for the write roles (removing the main one asks first), and the Live Meta leads
 * held for HR because no requisition fitted (place each on an open one). The criteria themselves stay in the criteria block below.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CircleDot, Star } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { InlineAlertDialog } from "@/components/ui/inline-alert-dialog";
import { useHasRole } from "@/hooks/useUserRole";
import { requisitionOptions, type RequisitionOption } from "@/pages/hiring-engine/command/commandData";
import {
  LINK_WRITE_ROLES, addOptions, addResultText, heldPlaceOptions, linkPath, linkRowView, linksPath, placePath, routingPath,
  type AddResult, type CampaignLink, type RoutingSummary,
} from "./campaignRequisitionsModel";

const BTN = "inline-flex min-h-11 cursor-pointer items-center rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-800 transition-colors duration-150 hover:bg-slate-100 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 sm:min-h-7";
const FIELD = "min-h-11 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 sm:min-h-8";
const TD = "border-b border-slate-100 px-2 py-1.5 align-top text-slate-800 dark:border-slate-800 dark:text-slate-100";

export interface CampaignRequisitionsViewProps {
  links: CampaignLink[] | null; loading: boolean; error: string | null; canWrite: boolean; options: Array<{ id: string; label: string }>;
  held: RoutingSummary | null; note: string | null; confirmRemove: string | null; busy: boolean;
  onAdd: (requisitionId: string, primary: boolean) => void; onRemove: (requisitionId: string) => void; onConfirmRemove: () => void; onCancelRemove: () => void;
  onPrimary: (requisitionId: string) => void; onPlace: (leadId: string, requisitionId: string) => void; onRetry: () => void;
}

function AddRow({ options, busy, onAdd }: { options: Array<{ id: string; label: string }>; busy: boolean; onAdd: CampaignRequisitionsViewProps["onAdd"] }) {
  const [pick, setPick] = useState("");
  const [main, setMain] = useState(false);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs font-semibold text-slate-800 dark:text-slate-100">Add requisition
        <select className={FIELD} value={pick} disabled={busy} onChange={(e) => setPick(e.target.value)}>
          <option value="">Pick an open requisition</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </label>
      <label className="flex min-h-11 cursor-pointer items-center gap-1.5 text-xs text-slate-800 dark:text-slate-100 sm:min-h-8">
        <input type="checkbox" className="h-4 w-4 cursor-pointer accent-blue-700" checked={main} disabled={busy} onChange={(e) => setMain(e.target.checked)} /> Make it the main one
      </label>
      <button type="button" className={BTN} disabled={busy || !pick} onClick={() => { onAdd(pick, main); setPick(""); setMain(false); }}>Add</button>
    </div>
  );
}

function PlaceRow({ leadId, options, busy, onPlace }: { leadId: string; options: Array<{ id: string; label: string }>; busy: boolean; onPlace: CampaignRequisitionsViewProps["onPlace"] }) {
  const [pick, setPick] = useState("");
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <select aria-label="Place on requisition" className={FIELD} value={pick} disabled={busy} onChange={(e) => setPick(e.target.value)}>
        <option value="">Pick</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <button type="button" className={BTN} disabled={busy || !pick} onClick={() => onPlace(leadId, pick)}>Place on</button>
    </span>
  );
}

export function CampaignRequisitionsView(p: CampaignRequisitionsViewProps) {
  const { links, loading, error, canWrite, options, held, note, confirmRemove, busy } = p;
  const removing = confirmRemove ? links?.find((l) => l.requisitionId === confirmRemove) : null;
  const heldCount = held?.held.length ?? 0;
  return (
    <section aria-labelledby="campaign-reqs-title" aria-busy={loading} className="space-y-2 rounded-xl bg-white p-3 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <h3 id="campaign-reqs-title" className="text-sm font-bold">Requisitions ({links?.length ?? 0})</h3>
      {loading && !links && <div aria-busy="true" aria-label="Loading the requisitions" className="h-16 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" />}
      {error && !links && <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-rose-800 dark:text-rose-200"><AlertTriangle className="h-4 w-4" aria-hidden /> Could not load: {error}
        <button type="button" className={BTN} onClick={p.onRetry}>Retry</button></p>}
      {note && <p role="status" className="text-xs text-slate-700 dark:text-slate-200">{note}</p>}
      {links && links.length === 0 && <p className="text-sm text-slate-700 dark:text-slate-200">No requisition linked yet (JR pending).</p>}
      {links && links.length > 0 && (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-left text-xs">
            <caption className="sr-only">Requisitions linked to this campaign</caption>
            <thead><tr className="border-b border-slate-200 dark:border-slate-700">
              <th scope="col" className="px-2 py-1 font-semibold">Requisition</th><th scope="col" className="px-2 py-1 font-semibold">State</th>
              <th scope="col" className="px-2 py-1 font-semibold">Criteria</th>{canWrite && <th scope="col" className="px-2 py-1 font-semibold">Actions</th>}
            </tr></thead>
            <tbody>
              {links.map((l) => {
                const v = linkRowView(l);
                return (
                  <tr key={l.requisitionId}>
                    <th scope="row" className={`${TD} text-left font-normal`}>
                      <span className="flex items-center gap-1 font-semibold">{l.isPrimary && <Star className="h-3.5 w-3.5 text-amber-600 dark:text-amber-300" aria-hidden />}{v.code}</span>
                      <span className="block text-slate-600 dark:text-slate-300">{v.branch}{v.main ? ` · ${v.main}` : ""}</span>
                    </th>
                    <td className={TD}>
                      <span className="block">{v.state}</span><span className="block">{v.seats}</span>
                      <span className={`mt-0.5 inline-flex items-center gap-1 rounded-full border px-1.5 ${v.end.ended ? "border-rose-400 text-rose-800 dark:border-rose-600 dark:text-rose-200" : "border-slate-300 dark:border-slate-600"}`}>
                        {v.end.ended && <CircleDot className="h-3 w-3" aria-hidden />}{v.end.text}</span>
                    </td>
                    <td className={TD}><span className="block">{v.criteria}</span>{v.enrolment && <span className="block text-amber-900 dark:text-amber-200">{v.enrolment}</span>}</td>
                    {canWrite && (
                      <td className={TD}>
                        <span className="flex flex-wrap gap-1">
                          {!l.isPrimary && <button type="button" className={BTN} disabled={busy} onClick={() => p.onPrimary(l.requisitionId)}>Make main</button>}
                          <button type="button" className={BTN} disabled={busy} aria-label={`Remove ${v.code} from this campaign`} onClick={() => p.onRemove(l.requisitionId)}>Remove</button>
                        </span>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {removing && (
        <InlineAlertDialog className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
          titleClassName="font-semibold" title={`${removing.code} is the main requisition.`}
          description={(links?.length ?? 0) > 1 ? "The next linked one becomes the main one." : "The campaign goes back to JR pending."}
          onCancel={p.onCancelRemove} actionsClassName="flex gap-2"
          actions={<button type="button" className={BTN} disabled={busy} onClick={p.onConfirmRemove}>Remove it</button>}
          cancel={<button type="button" className={BTN}>Keep it</button>} />
      )}
      {canWrite && links && <AddRow options={options} busy={busy} onAdd={p.onAdd} />}
      {heldCount > 0 && (
        <details className="rounded-lg border border-slate-200 p-2 text-xs dark:border-slate-700">
          <summary className="cursor-pointer font-semibold">Held for HR ({heldCount}): no requisition fitted</summary>
          <ul className="mt-1 space-y-1">
            {held!.held.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-2">
                <span>{h.name || "Lead"} · {h.maskedMobile}</span>
                {canWrite && <PlaceRow leadId={h.id} options={heldPlaceOptions(links ?? [])} busy={busy} onPlace={p.onPlace} />}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export default function CampaignRequisitionsEditor({ campaignId }: { campaignId: string }) {
  const canWrite = useHasRole(...LINK_WRITE_ROLES);
  const [openRequisitions, setOpen] = useState<RequisitionOption[]>([]);
  useEffect(() => {
    if (!canWrite) return;
    const c = new AbortController();
    hrmsApi.get<{ data?: unknown }>("/api/he/requisitions/open", undefined, c.signal).then((r) => { if (!c.signal.aborted) setOpen(requisitionOptions(r?.data)); }).catch(() => undefined);
    return () => c.abort();
  }, [canWrite]);
  const [links, setLinks] = useState<CampaignLink[] | null>(null);
  const [held, setHeld] = useState<RoutingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [l, r] = await Promise.all([hrmsApi.get<{ data?: CampaignLink[] }>(linksPath(campaignId)), hrmsApi.get<{ data?: RoutingSummary }>(routingPath(campaignId)).catch(() => null)]);
      setLinks(l?.data ?? []); setHeld(r?.data ?? null);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, [campaignId]);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<string | null>) => {
    setBusy(true); setNote(null);
    try { setNote(await fn()); await load(); } catch (e) { setNote(`Could not save: ${(e as Error).message}`); } finally { setBusy(false); }
  };
  const codeOf = (id: string) => links?.find((l) => l.requisitionId === id)?.code ?? openRequisitions.find((o) => o.id === id)?.label ?? "Requisition";
  const remove = (id: string) => void act(async () => { await hrmsApi.delete(linkPath(campaignId, id)); setConfirmRemove(null); return `${codeOf(id)} removed from this campaign.`; });
  return (
    <CampaignRequisitionsView links={links} loading={loading} error={error} canWrite={canWrite} options={addOptions(openRequisitions, links ?? [])} held={held} note={note}
      confirmRemove={confirmRemove} busy={busy} onRetry={() => void load()}
      onAdd={(id, primary) => void act(async () => {
        const r = await hrmsApi.post<{ data?: AddResult }>(linksPath(campaignId), { requisitionId: id, primary });
        return r?.data ? addResultText(r.data, codeOf(id)) : `${codeOf(id)} linked.`;
      })}
      onRemove={(id) => { if (links?.find((l) => l.requisitionId === id)?.isPrimary) setConfirmRemove(id); else remove(id); }}
      onConfirmRemove={() => { if (confirmRemove) remove(confirmRemove); }} onCancelRemove={() => setConfirmRemove(null)}
      onPrimary={(id) => void act(async () => { await hrmsApi.put(`${linkPath(campaignId, id)}/primary`, {}); return `${codeOf(id)} is now the main requisition.`; })}
      onPlace={(leadId, id) => void act(async () => { await hrmsApi.put(placePath(leadId), { requisitionId: id }); return `Lead placed on ${codeOf(id)}.`; })} />
  );
}
