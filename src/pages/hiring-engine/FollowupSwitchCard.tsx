/**
 * Follow-up switches (Master tab, above the outreach policy): per source mode capped by the server setting, canary requisitions and
 * per-branch caps, the kill switch, the shared WhatsApp budget, Pinbot inbound health and journey counts. Admins change; everyone else
 * (CEO, HR) sees it read-only. Canary / live asks for confirmation, and for the owner's explicit risk tick while inbound is not verified.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Eye, Loader2, PauseCircle, PlayCircle, Plus, RefreshCcw, ShieldCheck, ToggleLeft, X } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { InlineAlertDialog } from "@/components/ui/inline-alert-dialog";
import { useUserRole } from "@/hooks/useUserRole";
import {
  budgetPercent, canEditSwitches, confirmFor, countsLine, effectiveText, inboundLine, MODE_LABEL, MODES, pickerOptions, putBody, SOURCE_LABEL, SOURCES,
  type OpenRequisition, type SourceMode, type SourceType, type SwitchesView,
} from "./followupSwitchModel";

export interface ViewProps {
  data: SwitchesView | null; loading: boolean; error: string | null; canEdit: boolean; busy: boolean;
  message: { ok: boolean; text: string } | null; pending: { source: SourceType; mode: SourceMode } | null; requisitions: OpenRequisition[];
  onMode: (source: SourceType, mode: SourceMode) => void; onConfirm: (acknowledge: boolean) => void; onCancel: () => void;
  onKill: (paused: boolean) => void; onInboundVerified: (verified: boolean) => void; onCap: (prefix: string, dailyMax: number) => void;
  onAddCanary: (source: SourceType, requisitionId: string) => void; onRemoveCanary: (source: SourceType, requisitionId: string) => void; onRetry: () => void;
}

const BTN = "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 transition-colors duration-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 motion-reduce:transition-none sm:min-h-0 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700";
const SELECT = "rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";

function ConfirmStep({ data, pending, busy, onConfirm, onCancel }: Pick<ViewProps, "busy" | "onConfirm" | "onCancel"> & { data: SwitchesView; pending: NonNullable<ViewProps["pending"]> }) {
  const [ack, setAck] = useState(false);
  const c = confirmFor(pending.source, pending.mode, data.inbound);
  return (
    <InlineAlertDialog
      className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/40"
      titleClassName="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200"
      title={<><AlertTriangle className="h-4 w-4" aria-hidden /> Confirm the change</>}
      descriptionClassName="mt-1 text-sm text-slate-800 dark:text-slate-200" description={c.text}
      onCancel={onCancel} actionsClassName="mt-3 flex gap-2"
      actions={
        <button type="button" disabled={busy || (c.needsAck && !ack)} onClick={() => onConfirm(ack)} className={`${BTN} border-blue-600 bg-blue-600 text-white hover:bg-blue-700 dark:border-blue-500 dark:bg-blue-600`}>
          <CheckCircle2 className="h-4 w-4" aria-hidden /> Switch to {MODE_LABEL[pending.mode]}
        </button>
      }
      cancel={<button type="button" className={BTN}><X className="h-4 w-4" aria-hidden /> Cancel</button>}
    >
      {c.needsAck && (
        <label className="mt-2 flex cursor-pointer items-start gap-2 text-sm text-slate-800 dark:text-slate-200">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-4 w-4 cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-500" />
          I accept that Pinbot inbound is not verified: WhatsApp replies, STOP and receipts may not reach the system (STOP still works by email, call and HR).
        </label>
      )}
    </InlineAlertDialog>
  );
}

function CanaryList({ data, canEdit, busy, requisitions, onAddCanary, onRemoveCanary }: Pick<ViewProps, "canEdit" | "busy" | "requisitions" | "onAddCanary" | "onRemoveCanary"> & { data: SwitchesView }) {
  const [pick, setPick] = useState<Record<string, string>>({});
  return (
    <div className="border-t border-slate-100 pt-3 dark:border-slate-700">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Canary requisitions</h3>
      <p className="text-xs text-slate-600 dark:text-slate-400">In Canary mode only these requisitions get real sends; everyone else stays in dry run. Only open requisitions can be added.</p>
      <div className="mt-2 grid gap-3 md:grid-cols-3">
        {SOURCES.map((src) => {
          const listed = data.canary.filter((c) => c.sourceType === src);
          const options = pickerOptions(requisitions, data, src);
          return (
            <div key={src} className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{SOURCE_LABEL[src]}</p>
              {listed.length === 0 ? <p className="text-xs text-slate-500 dark:text-slate-400">None listed.</p> : (
                <ul className="mt-1 space-y-1">
                  {listed.map((c) => (
                    <li key={c.requisitionId} className="flex items-center justify-between gap-2 text-sm text-slate-800 dark:text-slate-200">
                      <span>{c.code ?? c.requisitionId.slice(0, 8)}{c.branch ? ` · ${c.branch}` : ""}</span>
                      {canEdit && <button type="button" disabled={busy} onClick={() => onRemoveCanary(src, c.requisitionId)} aria-label={`Remove ${c.code ?? c.requisitionId} from the ${src} canary list`} className="cursor-pointer rounded p-1 text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-slate-700"><X className="h-4 w-4" aria-hidden /></button>}
                    </li>
                  ))}
                </ul>
              )}
              {canEdit && (
                <div className="mt-2 flex gap-1">
                  <label htmlFor={`fu-canary-${src}`} className="sr-only">Add an open requisition to the {SOURCE_LABEL[src]} canary list</label>
                  <select id={`fu-canary-${src}`} value={pick[src] ?? ""} onChange={(e) => setPick({ ...pick, [src]: e.target.value })} className={`${SELECT} min-w-0 flex-1`}>
                    <option value="">Choose a requisition</option>
                    {options.map((r) => <option key={r.id} value={r.id}>{r.requisition_code ?? r.id.slice(0, 8)}{r.branch_name ? ` · ${r.branch_name}` : ""}</option>)}
                  </select>
                  <button type="button" disabled={busy || !pick[src]} onClick={() => { onAddCanary(src, pick[src]); setPick({ ...pick, [src]: "" }); }} aria-label={`Add to the ${SOURCE_LABEL[src]} canary list`} className={BTN}><Plus className="h-4 w-4" aria-hidden /></button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Caps({ data, canEdit, busy, onCap }: Pick<ViewProps, "canEdit" | "busy" | "onCap"> & { data: SwitchesView }) {
  const [edit, setEdit] = useState<Record<string, string>>({});
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="text-left text-xs text-slate-600 dark:text-slate-400">Canary first contacts per branch per day</caption>
        <thead><tr className="text-left text-xs text-slate-500 dark:text-slate-400"><th scope="col" className="py-1">Branch prefix</th><th scope="col" className="py-1 text-right">Used today</th><th scope="col" className="py-1 text-right">Daily cap</th></tr></thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
          {data.caps.map((c) => (
            <tr key={c.prefix}>
              <td className="py-1.5 text-slate-800 dark:text-slate-200">{c.prefix}</td>
              <td className="py-1.5 text-right tabular-nums text-slate-800 dark:text-slate-200">{c.usedToday}</td>
              <td className="py-1.5 text-right">
                {canEdit ? (
                  <span className="inline-flex items-center gap-1">
                    <label htmlFor={`fu-cap-${c.prefix}`} className="sr-only">Daily cap for {c.prefix}</label>
                    <input id={`fu-cap-${c.prefix}`} type="number" min={0} max={1000} value={edit[c.prefix] ?? String(c.dailyMax)} onChange={(e) => setEdit({ ...edit, [c.prefix]: e.target.value })} className={`${SELECT} w-20 text-right`} />
                    <button type="button" disabled={busy || edit[c.prefix] === undefined || Number(edit[c.prefix]) === c.dailyMax} onClick={() => onCap(c.prefix, Number(edit[c.prefix]))} className={BTN}>Save</button>
                  </span>
                ) : <span className="tabular-nums text-slate-800 dark:text-slate-200">{c.dailyMax}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FollowupSwitchView(p: ViewProps) {
  const { data, canEdit, busy } = p;
  if (!data) {
    return (
      <section aria-label="Follow-up switches" aria-busy={p.loading ? "true" : "false"} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100"><ToggleLeft className="h-4 w-4 text-blue-600" aria-hidden /> Follow-up switches</h2>
        {p.loading ? <div className="mt-3 h-40 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" /> : (
          <p role="alert" className="mt-2 flex items-center gap-2 text-sm text-rose-700 dark:text-rose-300"><AlertTriangle className="h-4 w-4" aria-hidden /> {p.error ?? "Could not load"}
            <button type="button" onClick={p.onRetry} className={BTN}><RefreshCcw className="h-4 w-4" aria-hidden /> Retry</button></p>
        )}
      </section>
    );
  }
  const inb = inboundLine(data.inbound);
  const pct = budgetPercent(data.budget);
  return (
    <section aria-label="Follow-up switches" aria-busy="false" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100"><ToggleLeft className="h-4 w-4 text-blue-600" aria-hidden /> Follow-up switches</h2>
        <span className="text-xs text-slate-600 dark:text-slate-400">Server setting allows up to {MODE_LABEL[data.ceiling]}</span>
        {!canEdit && <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300"><Eye className="h-3.5 w-3.5" aria-hidden /> View only</span>}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        {data.killSwitch
          ? <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-rose-700 dark:text-rose-300"><PauseCircle className="h-4 w-4" aria-hidden /> All follow-up sends paused{data.envPaused ? " (server setting)" : ""}</span>
          : <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-300"><PlayCircle className="h-4 w-4" aria-hidden /> Sends running</span>}
        <span className="text-xs text-slate-600 dark:text-slate-400">STOP, replies and receipts keep working while paused.</span>
        {canEdit && <button type="button" disabled={busy} onClick={() => p.onKill(!data.killSwitch)} className={`${BTN} ml-auto`}>{data.killSwitch ? "Resume sends" : "Pause all sends"}</button>}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-500 dark:text-slate-400"><th scope="col" className="py-1">Source</th><th scope="col" className="py-1">Mode</th><th scope="col" className="py-1">Running as</th><th scope="col" className="py-1">Journeys</th></tr></thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {SOURCES.map((src) => {
              const s = data.sources[src];
              return (
                <tr key={src}>
                  <td className="py-2 text-slate-800 dark:text-slate-200"><label htmlFor={`fu-mode-${src}`}>{SOURCE_LABEL[src]}</label></td>
                  <td className="py-2">
                    <select id={`fu-mode-${src}`} disabled={!canEdit || busy} value={s.mode} onChange={(e) => p.onMode(src, e.target.value as SourceMode)} className={SELECT}>
                      {MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
                    </select>
                  </td>
                  <td className="py-2 text-slate-700 dark:text-slate-300">{effectiveText(s.mode, s.effective, data.ceiling)}</td>
                  <td className="py-2 text-xs text-slate-600 dark:text-slate-400">{countsLine(data.counts[src])}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {p.pending && <ConfirmStep data={data} pending={p.pending} busy={busy} onConfirm={p.onConfirm} onCancel={p.onCancel} />}

      <CanaryList data={data} canEdit={canEdit} busy={busy} requisitions={p.requisitions} onAddCanary={p.onAddCanary} onRemoveCanary={p.onRemoveCanary} />
      <Caps data={data} canEdit={canEdit} busy={busy} onCap={p.onCap} />

      <div className="grid gap-3 border-t border-slate-100 pt-3 md:grid-cols-2 dark:border-slate-700">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">WhatsApp budget today</h3>
          <p className="text-sm text-slate-800 dark:text-slate-200">{data.budget.used} of {data.budget.max} used · quality {data.budget.quality ?? "unknown"}</p>
          <div role="progressbar" aria-label="WhatsApp budget used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="mt-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-2 rounded-full bg-blue-600" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Confirmations, new slots and STOP replies do not count.</p>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Pinbot inbound WhatsApp</h3>
          <p className={`flex items-center gap-1.5 text-sm ${inb.ok ? "text-emerald-700 dark:text-emerald-300" : "text-amber-800 dark:text-amber-300"}`}>
            {inb.ok ? <ShieldCheck className="h-4 w-4" aria-hidden /> : <AlertTriangle className="h-4 w-4" aria-hidden />} {inb.text}
          </p>
          {canEdit && <button type="button" disabled={busy} onClick={() => p.onInboundVerified(!data.inbound.verified)} className={`${BTN} mt-1`}>{data.inbound.verified ? "Mark as not verified" : "Mark inbound verified"}</button>}
        </div>
      </div>
      {busy && <p className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> Saving</p>}
      {p.message && <p role={p.message.ok ? "status" : "alert"} className={`flex items-center gap-1.5 text-sm ${p.message.ok ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}`}>
        {p.message.ok ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <AlertTriangle className="h-4 w-4" aria-hidden />} {p.message.text}</p>}
    </section>
  );
}

export default function FollowupSwitchCard() {
  const { data: roleData } = useUserRole();
  const canEdit = canEditSwitches((roleData as { roles?: string[] } | null | undefined)?.roles);
  const [data, setData] = useState<SwitchesView | null>(null);
  const [reqs, setReqs] = useState<OpenRequisition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<ViewProps["message"]>(null);
  const [pending, setPending] = useState<ViewProps["pending"]>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await hrmsApi.get<{ data: SwitchesView }>("/api/he/qualified-followup/switches");
      setData(r.data);
    } catch (e: unknown) { setError((e as { message?: string })?.message || "Could not load the follow-up switches"); }
    finally { setLoading(false); }
    try { const r = await hrmsApi.get<{ data: OpenRequisition[] }>("/api/he/requisitions/open"); setReqs(r.data ?? []); } catch { setReqs([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, okText: string) => {
    setBusy(true); setMessage(null);
    try { await fn(); setMessage({ ok: true, text: okText }); await load(); }
    catch (e: unknown) { setMessage({ ok: false, text: (e as { message?: string })?.message || "Only an admin can change this" }); }
    finally { setBusy(false); }
  };
  const putMode = (source: SourceType, mode: SourceMode, ack: boolean) =>
    act(() => hrmsApi.put(`/api/he/qualified-followup/switches/${source}`, putBody(mode, ack)), `${SOURCE_LABEL[source]} is now ${MODE_LABEL[mode]}.`);

  return (
    <FollowupSwitchView data={data} loading={loading} error={error} canEdit={canEdit} busy={busy} message={message} pending={pending} requisitions={reqs}
      onMode={(source, mode) => { if (mode === "canary" || mode === "live") setPending({ source, mode }); else { setPending(null); void putMode(source, mode, false); } }}
      onConfirm={(ack) => { if (pending) { const pd = pending; setPending(null); void putMode(pd.source, pd.mode, ack); } }}
      onCancel={() => setPending(null)}
      onKill={(paused) => void act(() => hrmsApi.put("/api/he/qualified-followup/kill", { paused }), paused ? "All follow-up sends are paused." : "Follow-up sends resumed.")}
      onInboundVerified={(verified) => void act(() => hrmsApi.put("/api/he/qualified-followup/inbound-verified", { verified }), verified ? "Pinbot inbound marked verified." : "Pinbot inbound marked not verified.")}
      onCap={(prefix, dailyMax) => void act(() => hrmsApi.put(`/api/he/qualified-followup/caps/${encodeURIComponent(prefix)}`, { dailyMax }), `Cap for ${prefix} is ${dailyMax}.`)}
      onAddCanary={(sourceType, requisitionId) => void act(() => hrmsApi.post("/api/he/qualified-followup/canary", { sourceType, requisitionId }), "Added to the canary list.")}
      onRemoveCanary={(sourceType, requisitionId) => void act(() => hrmsApi.delete(`/api/he/qualified-followup/canary/${sourceType}/${encodeURIComponent(requisitionId)}`), "Removed from the canary list.")}
      onRetry={() => void load()} />
  );
}
