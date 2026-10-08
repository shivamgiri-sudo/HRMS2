import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, PhoneOutgoing, Save, Sparkles } from "lucide-react";
import { Empty, ErrorBox, FOCUS, Panel, Skeleton, btn } from "../ui";
import { formatValue } from "../format";
import { DataTable, MappingEditor, ProblemList } from "../sales/common";
import { input, lbl, msg } from "../sales/ext.style";
import { fetchColumns, fetchStored, previewConfig, saveStored, suggest, type Problem } from "../sales/extApi";
import { FilterFields, TablePicker } from "../sales/SourceParts";
import { OUTBOUND_FIELDS, emptyOutbound, outboundFromStored, outboundPayload, validateOutbound, type OutboundForm, type OutboundStored } from "../sales/ext.model";

export interface OutboundPreview {
  problems: Problem[]; freshness: { latestDate: string | null; earliestDate: string | null; rows: number } | null;
  dispositions: Array<{ value: string; rows: number; suggestedConnected: boolean }>; window: { from: string; to: string } | null;
  kpis: { dials: number; connects: number; connectRate: number | null; uniqueLeads: number | null; contactPenetrationPct: number | null; attemptsPerLead: number | null; avgTalkSec: number | null } | null;
  sample: Array<Record<string, unknown>>;
}

/** Dashboard Setup, category outbound: which call-detail table / columns / connected dispositions feed this process's Outbound tab. */
export function OutboundSourcePanel({ processId }: { processId: string }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<OutboundForm>(emptyOutbound);
  const [preview, setPreview] = useState<OutboundPreview | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const set = (patch: Partial<OutboundForm>) => { setForm((f) => ({ ...f, ...patch })); setSaved(null); };

  const stored = useQuery({ queryKey: ["pd-admin", "outbound", processId], queryFn: () => fetchStored<OutboundStored>("outbound", processId), enabled: !!processId, retry: false });
  // Reload the form from the server when the process changes (or first loads). A refetch after Save must NOT wipe the "Saved" message or the preview.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (stored.isLoading || loadedFor.current === processId) return;
    loadedFor.current = processId; setForm(outboundFromStored(stored.data ?? null)); setPreview(null); setSaved(null);
  }, [processId, stored.data, stored.isLoading]);
  const columns = useQuery({ queryKey: ["pd-admin", "outbound", "columns", form.schema, form.table], queryFn: () => fetchColumns("outbound", form.schema, form.table), enabled: !!form.table, retry: false });

  const runPreview = useMutation({ mutationFn: (f: OutboundForm) => previewConfig<OutboundPreview>("outbound", processId, outboundPayload(f)), onSuccess: setPreview });
  const suggestMap = useMutation({
    mutationFn: () => suggest("outbound", form.schema, form.table),
    onSuccess: (r) => { const next = { ...form, columnMap: r.columnMap }; set({ columnMap: r.columnMap }); if (r.columnMap.date && r.columnMap.agent_code) runPreview.mutate(next); },
  });
  const save = useMutation({
    mutationFn: (f: OutboundForm) => saveStored<OutboundStored>("outbound", processId, outboundPayload(f)),
    onSuccess: async (s) => {
      setForm(outboundFromStored(s)); setSaved(s.enabled ? "Saved. The Outbound tab is on." : "Saved. The Outbound tab is off until you enable it.");
      await Promise.all([qc.invalidateQueries({ queryKey: ["pd-admin", "outbound", processId] }), qc.invalidateQueries({ queryKey: ["process-dashboard", processId, "outbound"] }), qc.invalidateQueries({ queryKey: ["process-dashboard", "configs"] })]);
    },
  });

  const errors = useMemo(() => validateOutbound(form), [form]);
  const dispRows = useMemo(() => {
    const seen = new Set((preview?.dispositions ?? []).map((d) => d.value));
    return [...(preview?.dispositions ?? []).map((d) => ({ value: d.value, rows: d.rows as number | null })), ...form.connected.filter((v) => !seen.has(v)).map((v) => ({ value: v, rows: null }))];
  }, [preview, form.connected]);
  const toggle = (v: string) => set({ connected: form.connected.includes(v) ? form.connected.filter((x) => x !== v) : [...form.connected, v] });
  const useSuggestions = () => set({ connected: Array.from(new Set([...form.connected, ...(preview?.dispositions ?? []).filter((d) => d.suggestedConnected).map((d) => d.value)])) });

  if (!processId) return <Panel title="5. Outbound call source"><Empty>Choose a process first.</Empty></Panel>;
  return (
    <Panel title="5. Outbound call source" action={<span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600"><PhoneOutgoing className="h-3.5 w-3.5" aria-hidden="true" />Feeds the Outbound tab</span>}>
      <p className="mb-3 text-xs text-slate-700">Pick the table that holds one row per dial attempt, map its columns and choose which dispositions count as a connect. Phone numbers and other personal columns cannot be mapped; leads are identified by an id column.</p>
      {stored.isLoading ? <Skeleton className="h-32" /> : (
        <div className="space-y-5">
          <TablePicker kind="outbound" idPrefix="ob" schema={form.schema} table={form.table} label="Call-detail table" onChange={(schema, table) => { set({ schema, table, columnMap: {}, connected: [] }); setPreview(null); }} />
          <section aria-label="Call column mapping">
            <div className="mb-2 flex items-center justify-between"><h4 className="text-xs font-bold text-slate-800">Column mapping</h4>
              <button type="button" className={btn} disabled={!form.table || suggestMap.isPending} onClick={() => suggestMap.mutate()}><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />{suggestMap.isPending ? "Suggesting..." : "Suggest mapping"}</button></div>
            {suggestMap.isError && <ErrorBox message={msg(suggestMap.error)} />}
            {!form.table ? <Empty>Choose a table first.</Empty> : columns.isLoading ? <Skeleton className="h-32" /> : columns.isError ? <ErrorBox message={msg(columns.error)} onRetry={() => void columns.refetch()} /> : (
              <>
                <MappingEditor idPrefix="ob-map" fields={OUTBOUND_FIELDS} columns={columns.data ?? []} value={form.columnMap} onChange={(columnMap) => set({ columnMap })} />
                <div className="mt-3"><FilterFields idPrefix="ob" columns={columns.data ?? []} column={form.filterColumn} value={form.filterValue} onChange={(filterColumn, filterValue) => set({ filterColumn, filterValue })} /></div>
              </>)}
          </section>

          <section aria-label="Connected dispositions" className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-xs font-bold text-slate-800">Dispositions that count as a connect</h4>
              <button type="button" className={btn} disabled={!form.table || !form.columnMap.date || !form.columnMap.agent_code || !form.columnMap.disposition || runPreview.isPending} onClick={() => runPreview.mutate(form)}><Eye className="h-3.5 w-3.5" aria-hidden="true" />{runPreview.isPending ? "Loading..." : "Preview and discover dispositions"}</button></div>
            {runPreview.isError && <ErrorBox message={msg(runPreview.error)} />}
            {!form.columnMap.disposition ? <p className="text-xs text-slate-600">Map the disposition column first.</p> : !preview ? (dispRows.length === 0 ? <Empty>Run the preview to list the dispositions found in the table.</Empty> : null) : (
              <button type="button" className="text-xs font-semibold text-blue-800 underline" onClick={useSuggestions}>Use suggestions</button>)}
            {dispRows.length > 0 && (
              <fieldset><legend className="sr-only">Connected dispositions ({form.connected.length} selected)</legend>
                <div className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-2">
                  {dispRows.map((d) => (
                    <label key={d.value} className="flex min-h-[32px] cursor-pointer items-center gap-2 text-xs text-slate-900">
                      <input type="checkbox" className={`h-4 w-4 ${FOCUS}`} checked={form.connected.includes(d.value)} onChange={() => toggle(d.value)} />
                      <span className="min-w-0 flex-1 truncate" title={d.value}>{d.value || "(blank)"}</span><span className="text-[11px] text-slate-600">{d.rows === null ? "saved" : `${d.rows.toLocaleString("en-IN")} calls`}</span></label>))}
                </div></fieldset>)}
          </section>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div><label className={lbl} htmlFor="ob-refresh">Refresh every (seconds)</label><input id="ob-refresh" inputMode="numeric" className={input} value={form.refreshSeconds} onChange={(e) => set({ refreshSeconds: e.target.value })} /></div>
            <div className="flex items-end"><label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-sm font-semibold text-slate-900"><input type="checkbox" role="switch" className={`h-4 w-4 ${FOCUS}`} checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />Outbound tab on</label></div>
          </div>

          {errors.length > 0 && <ul aria-label="Outbound source checklist" className="list-disc space-y-0.5 pl-5 text-xs text-amber-900">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={`${btn} border-blue-700 !bg-blue-700 !text-white hover:!bg-blue-800`} disabled={errors.length > 0 || save.isPending} onClick={() => save.mutate(form)}><Save className="h-3.5 w-3.5" aria-hidden="true" />{save.isPending ? "Saving..." : "Save outbound source"}</button>
            <div role="status" aria-live="polite" className="text-xs font-semibold text-emerald-800">{saved}</div>
          </div>
          {save.isError && <ErrorBox message={msg(save.error)} />}

          {preview && (
            <div className="space-y-2 border-t border-slate-100 pt-3" aria-label="Outbound preview">
              <ProblemList problems={preview.problems} />
              {preview.kpis && <p className="text-xs text-slate-800">Last 7 days of data{preview.window ? ` (${preview.window.from} to ${preview.window.to})` : ""}: <b className="tabular-nums">{preview.kpis.dials.toLocaleString("en-IN")}</b> dials, <b className="tabular-nums">{preview.kpis.connects.toLocaleString("en-IN")}</b> connects, connect rate <b>{preview.kpis.connectRate === null ? "—" : `${preview.kpis.connectRate}%`}</b>, unique leads <b>{preview.kpis.uniqueLeads === null ? "—" : preview.kpis.uniqueLeads.toLocaleString("en-IN")}</b>, avg talk <b>{formatValue(preview.kpis.avgTalkSec, "seconds")}</b>.</p>}
              {preview.sample.length > 0 && <DataTable caption="Latest calls (mapped columns only)" maxHeight="max-h-64" rows={preview.sample} cols={Object.keys(preview.sample[0]).map((k, i) => ({ key: k, label: k, align: i < 3 ? "left" as const : "right" as const }))} />}
            </div>)}
        </div>
      )}
    </Panel>
  );
}
