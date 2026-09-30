import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Eye, PhoneIncoming, Save } from "lucide-react";
import {
  fetchInboundCandidates, fetchInboundConfig, previewInboundConfig, saveInboundConfig,
  type InboundConfigInput, type InboundPreviewResult, type InboundStored,
} from "./api";
import { SimpleTable } from "./SimpleTable";
import { Empty, ErrorBox, FOCUS, Panel, Skeleton, btn } from "./ui";

const input = `min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 ${FOCUS}`;
const lbl = "mb-1 block text-xs font-semibold text-slate-700";
const msg = (e: unknown) => (e instanceof Error ? e.message : "Request failed.");

export interface InboundForm {
  dialerTable: string; pattern: "A" | "B"; campaigns: string[]; mandate: string; required: string; slSeconds: string; hasFcr: boolean; fcrClientId: string; enabled: boolean;
}
export const emptyInboundForm = (): InboundForm => ({ dialerTable: "", pattern: "B", campaigns: [], mandate: "0", required: "0", slSeconds: "", hasFcr: false, fcrClientId: "", enabled: true });
export const formFromStored = (s: InboundStored | null): InboundForm => !s ? emptyInboundForm() : ({
  dialerTable: s.dialerTable, pattern: s.pattern, campaigns: s.campaigns, mandate: String(s.mandate), required: String(s.required),
  slSeconds: s.slSeconds == null ? "" : String(s.slSeconds), hasFcr: s.hasFcr, fcrClientId: s.fcrClientId == null ? "" : String(s.fcrClientId), enabled: s.enabled,
});

const whole = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN);
/** Client-side checklist; the server re-validates everything. */
export function validateInboundForm(f: InboundForm): string[] {
  const e: string[] = [];
  if (!f.dialerTable) e.push("Pick the dialer table.");
  if (f.campaigns.length === 0) e.push("Choose at least one campaign.");
  if (Number.isNaN(whole(f.mandate))) e.push("Mandate must be a whole number.");
  if (Number.isNaN(whole(f.required))) e.push("Required headcount must be a whole number.");
  if (f.slSeconds.trim() !== "" && !(whole(f.slSeconds) >= 1 && whole(f.slSeconds) <= 3600)) e.push("Service level seconds must be 1-3600 (or blank for the pattern default).");
  if (f.hasFcr && !(whole(f.fcrClientId) >= 1)) e.push("FCR needs a client id.");
  return e;
}
export function toInboundPayload(f: InboundForm): InboundConfigInput {
  return {
    dialerTable: f.dialerTable, pattern: f.pattern, campaigns: f.campaigns, mandate: whole(f.mandate) || 0, required: whole(f.required) || 0,
    hasFcr: f.hasFcr, fcrClientId: f.hasFcr ? whole(f.fcrClientId) : null, slSeconds: f.slSeconds.trim() === "" ? null : whole(f.slSeconds), enabled: f.enabled,
  };
}

/** Dashboard Setup, support_inbound only: which dialer table / pattern / campaigns feed this process's Live inbound tab. */
export function InboundSourcePanel({ processId }: { processId: string }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<InboundForm>(emptyInboundForm);
  const [preview, setPreview] = useState<InboundPreviewResult | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const set = (patch: Partial<InboundForm>) => { setForm((f) => ({ ...f, ...patch })); setSaved(null); };

  const candidates = useQuery({ queryKey: ["pd-admin", "inbound-tables"], queryFn: fetchInboundCandidates, staleTime: 60_000, retry: false });
  const stored = useQuery({ queryKey: ["pd-admin", "inbound", processId], queryFn: () => fetchInboundConfig(processId), enabled: !!processId, retry: false });

  useEffect(() => { if (!stored.isLoading) { setForm(formFromStored(stored.data ?? null)); setPreview(null); setSaved(null); } }, [processId, stored.data, stored.isLoading]);

  const runPreview = useMutation({
    mutationFn: (f: InboundForm) => previewInboundConfig(processId, toInboundPayload(f)),
    onSuccess: setPreview,
  });
  const save = useMutation({
    mutationFn: (f: InboundForm) => saveInboundConfig(processId, toInboundPayload(f)),
    onSuccess: async (s) => {
      setForm(formFromStored(s)); setSaved(s.enabled ? "Saved. The Live inbound tab is on." : "Saved. The Live inbound tab is off until you enable it.");
      await Promise.all([qc.invalidateQueries({ queryKey: ["pd-admin", "inbound", processId] }), qc.invalidateQueries({ queryKey: ["process-dashboard", processId, "inbound"] }), qc.invalidateQueries({ queryKey: ["pd-admin", "inbound-tables"] })]);
    },
  });

  // Picking a table loads its campaign list (and the detected pattern) without needing campaigns first.
  const pickTable = (dialerTable: string) => { set({ dialerTable, campaigns: [] }); setPreview(null); if (dialerTable) runPreview.mutate({ ...form, dialerTable, campaigns: [] }); };
  const toggleCampaign = (c: string) => set({ campaigns: form.campaigns.includes(c) ? form.campaigns.filter((x) => x !== c) : [...form.campaigns, c] });

  const errors = useMemo(() => validateInboundForm(form), [form]);
  const usable = (candidates.data ?? []).filter((t) => t.complete || t.table === form.dialerTable);
  const available = preview?.campaignsAvailable ?? [];
  // Campaigns already saved but quiet for 90 days must stay visible and removable.
  const extraSelected = form.campaigns.filter((c) => !available.some((a) => a.campaign === c));

  if (!processId) return <Panel title="5. Inbound dialer source"><Empty>Choose a process first.</Empty></Panel>;
  return (
    <Panel title="5. Inbound dialer source" action={<span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600"><PhoneIncoming className="h-3.5 w-3.5" aria-hidden="true" />Feeds the Live inbound tab</span>}>
      <p className="mb-3 text-xs text-slate-700">Pick the dialer table and campaigns this support process takes calls on. The same inbound dashboard the existing companies use then appears as a Live inbound tab.</p>
      {stored.isLoading ? <Skeleton className="h-32" /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2"><label className={lbl} htmlFor="ib-table">Dialer table <span className="text-red-700">*</span></label>
              <select id="ib-table" className={`${input} cursor-pointer`} value={form.dialerTable} onChange={(e) => pickTable(e.target.value)} disabled={candidates.isLoading}>
                <option value="">{candidates.isLoading ? "Loading tables..." : "Select a dialer table"}</option>
                {usable.map((t) => <option key={t.table} value={t.table}>{t.table}{t.rows != null ? ` (~${t.rows.toLocaleString("en-IN")} rows)` : ""}{t.usedBy.length ? ` · used by ${t.usedBy.join(", ")}` : ""}</option>)}</select>
              {candidates.isError && <div className="mt-2"><ErrorBox message={msg(candidates.error)} onRetry={() => void candidates.refetch()} /></div>}
              <p className="mt-1 text-[11px] text-slate-600">Several processes can share one table: what separates them is the campaign list below.</p></div>
            <div><label className={lbl} htmlFor="ib-pattern">Pattern</label>
              <select id="ib-pattern" className={`${input} cursor-pointer`} value={form.pattern} onChange={(e) => set({ pattern: e.target.value as "A" | "B" })}>
                <option value="B">B: plain queue table</option><option value="A">A: IVR-routed (HOLDTIME rows)</option></select>
              {preview && preview.detectedPattern.pattern !== form.pattern && (
                <button type="button" className="mt-1 text-[11px] font-semibold text-blue-800 underline" onClick={() => set({ pattern: preview.detectedPattern.pattern })}>Use detected pattern {preview.detectedPattern.pattern}</button>)}
              {preview && <p className="mt-1 text-[11px] text-slate-600">Detected: {preview.detectedPattern.reason}.</p>}</div>
          </div>

          <fieldset>
            <legend className={lbl}>Campaigns <span className="text-red-700">*</span> <span className="font-normal text-slate-600">({form.campaigns.length} selected)</span></legend>
            {!form.dialerTable ? <Empty>Pick a table to list its campaigns.</Empty> : runPreview.isPending && !preview ? <Skeleton className="h-20" /> : (
              <div className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-2">
                {available.length === 0 && extraSelected.length === 0 && <p className="text-xs text-slate-600">No campaigns with calls in the last 90 days.</p>}
                {[...available.map((a) => ({ campaign: a.campaign, note: `${a.calls.toLocaleString("en-IN")} calls${a.lastCall ? `, last ${a.lastCall}` : ""}` })), ...extraSelected.map((c) => ({ campaign: c, note: "saved, no calls in 90 days" }))].map((a) => (
                  <label key={a.campaign} className="flex min-h-[32px] cursor-pointer items-center gap-2 text-xs text-slate-900">
                    <input type="checkbox" className={`h-4 w-4 ${FOCUS}`} checked={form.campaigns.includes(a.campaign)} onChange={() => toggleCampaign(a.campaign)} />
                    <span className="min-w-0 flex-1 truncate" title={a.campaign}>{a.campaign}</span><span className="text-[11px] text-slate-600">{a.note}</span>
                  </label>))}
              </div>)}
          </fieldset>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div><label className={lbl} htmlFor="ib-mandate">Mandate (agents)</label><input id="ib-mandate" inputMode="numeric" className={input} value={form.mandate} onChange={(e) => set({ mandate: e.target.value })} /></div>
            <div><label className={lbl} htmlFor="ib-required">Required (agents)</label><input id="ib-required" inputMode="numeric" className={input} value={form.required} onChange={(e) => set({ required: e.target.value })} /></div>
            <div><label className={lbl} htmlFor="ib-sl">Service level (seconds)</label><input id="ib-sl" inputMode="numeric" className={input} value={form.slSeconds} placeholder={form.pattern === "A" ? "20 (default)" : "30 (default)"} onChange={(e) => set({ slSeconds: e.target.value })} /></div>
            <div className="flex items-end"><label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-sm font-semibold text-slate-900"><input type="checkbox" role="switch" className={`h-4 w-4 ${FOCUS}`} checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />Live inbound tab on</label></div>
          </div>

          {errors.length > 0 && <ul aria-label="Inbound source checklist" className="list-disc space-y-0.5 pl-5 text-xs text-amber-900">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
          {runPreview.isError && <ErrorBox message={msg(runPreview.error)} />}

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={btn} disabled={!form.dialerTable || runPreview.isPending} onClick={() => runPreview.mutate(form)}><Eye className="h-3.5 w-3.5" aria-hidden="true" />{runPreview.isPending ? "Loading..." : "Preview"}</button>
            <button type="button" className={`${btn} border-blue-700 !bg-blue-700 !text-white hover:!bg-blue-800`} disabled={errors.length > 0 || save.isPending} onClick={() => save.mutate(form)}><Save className="h-3.5 w-3.5" aria-hidden="true" />{save.isPending ? "Saving..." : "Save inbound source"}</button>
            <div role="status" aria-live="polite" className="text-xs font-semibold text-emerald-800">{saved}</div>
          </div>
          {save.isError && <ErrorBox message={msg(save.error)} />}

          {preview && form.campaigns.length > 0 && (
            <div className="space-y-2 border-t border-slate-100 pt-3" aria-label="Inbound preview">
              {preview.problems.length > 0 ? (
                <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950"><p className="font-bold">Problems found ({preview.problems.length})</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">{preview.problems.map((p, i) => <li key={i}>{p.severity === "error" ? "Error" : "Warning"}: {p.message}</li>)}</ul></div>
              ) : <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />No problems found.</p>}
              {preview.totals && <p className="text-xs text-slate-800">In the chosen campaigns: <b className="tabular-nums">{preview.totals.offered.toLocaleString("en-IN")}</b> calls offered, <b className="tabular-nums">{preview.totals.answered.toLocaleString("en-IN")}</b> answered, <b className="tabular-nums">{preview.totals.abandoned.toLocaleString("en-IN")}</b> abandoned{preview.totals.from ? ` (${preview.totals.from} to ${preview.totals.to})` : ""}.</p>}
              {preview.sample.length > 0 && <SimpleTable caption="Latest calls (phone numbers masked)" maxHeight="max-h-64" rows={preview.sample}
                cols={Object.keys(preview.sample[0]).map((k, i) => ({ key: k, label: k, align: i < 3 ? "left" as const : "right" as const }))} />}
            </div>)}
        </div>
      )}
    </Panel>
  );
}
