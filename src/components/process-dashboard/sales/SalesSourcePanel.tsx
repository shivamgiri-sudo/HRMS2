import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Save, ShoppingCart, Sparkles } from "lucide-react";
import { Empty, ErrorBox, FOCUS, Panel, Skeleton, btn } from "../ui";
import { formatValue } from "../format";
import { DataTable, MappingEditor, ProblemList } from "./common";
import { input, lbl, msg } from "./ext.style";
import { fetchColumns, fetchStored, previewConfig, saveStored, suggest, type Problem } from "./extApi";
import { FilterFields, TablePicker } from "./SourceParts";
import { ROSTER_FIELDS, SALES_FIELDS, STATUS_CLASSES, TARGET_METRICS, emptySales, salesFromStored, salesPayload, validateSales, type SalesForm, type SalesStored, type StatusClassKey } from "./ext.model";

export interface SalesPreview {
  problems: Problem[]; freshness: { latestDate: string | null; earliestDate: string | null; rows: number } | null;
  statuses: Array<{ value: string; rows: number; suggested: StatusClassKey | null }>; paymentModes: Array<{ value: string; rows: number; suggestedPrepaid: boolean }>;
  window: { from: string; to: string } | null;
  kpis: { orders: number; grossRevenue: number | null; netRevenue: number | null; aov: number | null; prepaidPct: number | null; rtoPct: number | null; cancellationPct: number | null; deliveredPct: number | null } | null;
  sample: Array<Record<string, unknown>>; roster: { rows: number; agentsMatched: number; agentsInOrders: number } | null;
}

/** Dashboard Setup, category sales: which orders table / columns / statuses / roster feed this process's Sales tab. */
export function SalesSourcePanel({ processId }: { processId: string }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<SalesForm>(emptySales);
  const [preview, setPreview] = useState<SalesPreview | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const set = (patch: Partial<SalesForm>) => { setForm((f) => ({ ...f, ...patch })); setSaved(null); };

  const stored = useQuery({ queryKey: ["pd-admin", "sales", processId], queryFn: () => fetchStored<SalesStored>("sales", processId), enabled: !!processId, retry: false });
  // Reload the form from the server when the process changes (or first loads). A refetch after Save must NOT wipe the "Saved" message or the preview.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (stored.isLoading || loadedFor.current === processId) return;
    loadedFor.current = processId; setForm(salesFromStored(stored.data ?? null)); setPreview(null); setSaved(null);
  }, [processId, stored.data, stored.isLoading]);
  const columns = useQuery({ queryKey: ["pd-admin", "sales", "columns", form.schema, form.table], queryFn: () => fetchColumns("sales", form.schema, form.table), enabled: !!form.table, retry: false });
  const rosterColumns = useQuery({ queryKey: ["pd-admin", "sales", "columns", form.rosterSchema, form.rosterTable], queryFn: () => fetchColumns("sales", form.rosterSchema, form.rosterTable), enabled: form.rosterOn && !!form.rosterTable, retry: false });

  const runPreview = useMutation({ mutationFn: (f: SalesForm) => previewConfig<SalesPreview>("sales", processId, salesPayload(f)), onSuccess: setPreview });
  const suggestMap = useMutation({
    mutationFn: () => suggest("sales", form.schema, form.table),
    onSuccess: (r) => { const next = { ...form, columnMap: r.columnMap }; set({ columnMap: r.columnMap }); if (r.columnMap.date && r.columnMap.agent_code) runPreview.mutate(next); },
  });
  const suggestRoster = useMutation({ mutationFn: () => suggest("sales", form.rosterSchema, form.rosterTable, true), onSuccess: (r) => set({ rosterMap: r.columnMap }) });
  const save = useMutation({
    mutationFn: (f: SalesForm) => saveStored<SalesStored>("sales", processId, salesPayload(f)),
    onSuccess: async (s) => {
      setForm(salesFromStored(s)); setSaved(s.enabled ? "Saved. The Sales tab is on." : "Saved. The Sales tab is off until you enable it.");
      await Promise.all([qc.invalidateQueries({ queryKey: ["pd-admin", "sales", processId] }), qc.invalidateQueries({ queryKey: ["process-dashboard", processId, "sales"] }), qc.invalidateQueries({ queryKey: ["process-dashboard", "configs"] })]);
    },
  });

  const errors = useMemo(() => validateSales(form), [form]);
  const statusRows = useMemo(() => {
    const seen = new Set((preview?.statuses ?? []).map((s) => s.value));
    return [...(preview?.statuses ?? []).map((s) => ({ value: s.value, rows: s.rows as number | null })), ...Object.keys(form.statusAssign).filter((v) => !seen.has(v)).map((v) => ({ value: v, rows: null }))];
  }, [preview, form.statusAssign]);
  const useStatusSuggestions = () => { const next = { ...form.statusAssign }; for (const s of preview?.statuses ?? []) if (!next[s.value] && s.suggested) next[s.value] = s.suggested; set({ statusAssign: next }); };
  const usePrepaidSuggestions = () => set({ prepaid: Array.from(new Set([...form.prepaid, ...(preview?.paymentModes ?? []).filter((p) => p.suggestedPrepaid).map((p) => p.value)])) });
  const hasStatus = !!form.columnMap.status, hasPay = !!form.columnMap.payment_mode;

  if (!processId) return <Panel title="5. Sales orders source"><Empty>Choose a process first.</Empty></Panel>;
  return (
    <Panel title="5. Sales orders source" action={<span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600"><ShoppingCart className="h-3.5 w-3.5" aria-hidden="true" />Feeds the Sales tab</span>}>
      <p className="mb-3 text-xs text-slate-700">Pick the table that holds one row per order, map its columns, tell the dashboard which statuses mean delivered, returned (RTO), cancelled or pending, and optionally add a roster table with monthly targets. Personal columns (phone, email, address) cannot be mapped.</p>
      {stored.isLoading ? <Skeleton className="h-32" /> : (
        <div className="space-y-5">
          <TablePicker kind="sales" idPrefix="so" schema={form.schema} table={form.table} label="Orders table" onChange={(schema, table) => { set({ schema, table, columnMap: {}, statusAssign: {}, prepaid: [] }); setPreview(null); }} />
          <section aria-label="Orders column mapping">
            <div className="mb-2 flex items-center justify-between"><h4 className="text-xs font-bold text-slate-800">Column mapping</h4>
              <button type="button" className={btn} disabled={!form.table || suggestMap.isPending} onClick={() => suggestMap.mutate()}><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />{suggestMap.isPending ? "Suggesting..." : "Suggest mapping"}</button></div>
            {suggestMap.isError && <ErrorBox message={msg(suggestMap.error)} />}
            {!form.table ? <Empty>Choose a table first.</Empty> : columns.isLoading ? <Skeleton className="h-32" /> : columns.isError ? <ErrorBox message={msg(columns.error)} onRetry={() => void columns.refetch()} /> : (
              <>
                <MappingEditor idPrefix="so-map" fields={SALES_FIELDS} columns={columns.data ?? []} value={form.columnMap} onChange={(columnMap) => set({ columnMap })} />
                <div className="mt-3"><FilterFields idPrefix="so" columns={columns.data ?? []} column={form.filterColumn} value={form.filterValue} onChange={(filterColumn, filterValue) => set({ filterColumn, filterValue })} /></div>
              </>)}
          </section>

          <section aria-label="Status and payment mapping" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-xs font-bold text-slate-800">Status and payment values</h4>
              <button type="button" className={btn} disabled={!form.table || !form.columnMap.date || !form.columnMap.agent_code || runPreview.isPending} onClick={() => runPreview.mutate(form)}><Eye className="h-3.5 w-3.5" aria-hidden="true" />{runPreview.isPending ? "Loading..." : "Preview and discover values"}</button></div>
            {runPreview.isError && <ErrorBox message={msg(runPreview.error)} />}
            {!hasStatus ? <p className="text-xs text-slate-600">Map the order status column to classify statuses (RTO, cancellation and net revenue need it).</p> : !preview ? <Empty>Run the preview to list the status values found in the table.</Empty> : (
              <div>
                <div className="mb-1 flex items-center justify-between"><p className="text-xs font-semibold text-slate-800">Order status values</p>
                  <button type="button" className={btn} onClick={useStatusSuggestions}>Use suggestions</button></div>
                <table className="w-full text-xs"><caption className="sr-only">Assign each status value found in the table to an outcome</caption>
                  <thead className="text-left text-slate-700"><tr><th scope="col" className="py-1 pr-2 font-semibold">Status in table</th><th scope="col" className="py-1 pr-2 text-right font-semibold">Rows (90 days)</th><th scope="col" className="py-1 font-semibold">Counts as</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">{statusRows.map((s, i) => (
                    <tr key={s.value}><td className="py-1 pr-2 text-slate-900">{s.value || "(blank)"}</td><td className="py-1 pr-2 text-right tabular-nums text-slate-800">{s.rows === null ? "saved" : s.rows.toLocaleString("en-IN")}</td>
                      <td className="py-1"><label className="sr-only" htmlFor={`so-st-${i}`}>Outcome for status {s.value || "blank"}</label>
                        <select id={`so-st-${i}`} className={`min-h-[32px] cursor-pointer rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-900 ${FOCUS}`} value={form.statusAssign[s.value] ?? ""}
                          onChange={(e) => set({ statusAssign: { ...form.statusAssign, [s.value]: e.target.value as StatusClassKey | "" } })}>
                          <option value="">Not classified</option>{STATUS_CLASSES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></td></tr>))}</tbody></table>
              </div>)}
            {hasPay && preview && (
              <fieldset><legend className={lbl}>Payment modes that count as prepaid <button type="button" className="ml-2 font-semibold text-blue-800 underline" onClick={usePrepaidSuggestions}>Use suggestions</button></legend>
                <div className="grid max-h-40 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-2">
                  {preview.paymentModes.length === 0 && <p className="text-xs text-slate-600">No payment values found.</p>}
                  {preview.paymentModes.map((p) => (
                    <label key={p.value} className="flex min-h-[32px] cursor-pointer items-center gap-2 text-xs text-slate-900">
                      <input type="checkbox" className={`h-4 w-4 ${FOCUS}`} checked={form.prepaid.includes(p.value)} onChange={() => set({ prepaid: form.prepaid.includes(p.value) ? form.prepaid.filter((x) => x !== p.value) : [...form.prepaid, p.value] })} />
                      <span className="min-w-0 flex-1 truncate" title={p.value}>{p.value || "(blank)"}</span><span className="text-[11px] text-slate-600">{p.rows.toLocaleString("en-IN")} rows</span></label>))}
                </div></fieldset>)}
          </section>

          <section aria-label="Roster and targets" className="space-y-3 border-t border-slate-100 pt-3">
            <label className="flex min-h-[36px] cursor-pointer items-center gap-2 text-sm font-semibold text-slate-900"><input type="checkbox" role="switch" className={`h-4 w-4 ${FOCUS}`} checked={form.rosterOn} onChange={(e) => set({ rosterOn: e.target.checked })} />Add a roster table with monthly targets (optional)</label>
            {form.rosterOn && (
              <>
                <TablePicker kind="sales" idPrefix="sr" schema={form.rosterSchema} table={form.rosterTable} label="Roster table" onChange={(rosterSchema, rosterTable) => set({ rosterSchema, rosterTable, rosterMap: {} })} />
                {form.rosterTable && (
                  <div>
                    <div className="mb-2 flex justify-end"><button type="button" className={btn} disabled={suggestRoster.isPending} onClick={() => suggestRoster.mutate()}><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />Suggest roster mapping</button></div>
                    {rosterColumns.isLoading ? <Skeleton className="h-16" /> : <MappingEditor idPrefix="sr-map" fields={ROSTER_FIELDS} columns={rosterColumns.data ?? []} value={form.rosterMap} onChange={(rosterMap) => set({ rosterMap })} />}
                  </div>)}
                <div className="max-w-xs"><label className={lbl} htmlFor="so-tm">Target is measured in</label>
                  <select id="so-tm" className={`${input} cursor-pointer`} value={form.targetMetric} onChange={(e) => set({ targetMetric: e.target.value })}>{TARGET_METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
                  <p className="mt-1 text-[11px] text-slate-600">Monthly target per agent; attainment and pacing use month to date.</p></div>
              </>)}
          </section>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div><label className={lbl} htmlFor="so-refresh">Refresh every (seconds)</label><input id="so-refresh" inputMode="numeric" className={input} value={form.refreshSeconds} onChange={(e) => set({ refreshSeconds: e.target.value })} /></div>
            <div className="flex items-end"><label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-sm font-semibold text-slate-900"><input type="checkbox" role="switch" className={`h-4 w-4 ${FOCUS}`} checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />Sales tab on</label></div>
          </div>

          {errors.length > 0 && <ul aria-label="Sales source checklist" className="list-disc space-y-0.5 pl-5 text-xs text-amber-900">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={`${btn} border-blue-700 !bg-blue-700 !text-white hover:!bg-blue-800`} disabled={errors.length > 0 || save.isPending} onClick={() => save.mutate(form)}><Save className="h-3.5 w-3.5" aria-hidden="true" />{save.isPending ? "Saving..." : "Save sales source"}</button>
            <div role="status" aria-live="polite" className="text-xs font-semibold text-emerald-800">{saved}</div>
          </div>
          {save.isError && <ErrorBox message={msg(save.error)} />}

          {preview && (
            <div className="space-y-2 border-t border-slate-100 pt-3" aria-label="Sales preview">
              <ProblemList problems={preview.problems} />
              {preview.kpis && <p className="text-xs text-slate-800">Last 30 days of data{preview.window ? ` (${preview.window.from} to ${preview.window.to})` : ""}: <b className="tabular-nums">{preview.kpis.orders.toLocaleString("en-IN")}</b> orders, gross <b className="tabular-nums">{formatValue(preview.kpis.grossRevenue, "currency")}</b>, net <b className="tabular-nums">{formatValue(preview.kpis.netRevenue, "currency")}</b>, AOV <b className="tabular-nums">{formatValue(preview.kpis.aov, "currency")}</b>, RTO <b>{preview.kpis.rtoPct === null ? "—" : `${preview.kpis.rtoPct}%`}</b>, prepaid <b>{preview.kpis.prepaidPct === null ? "—" : `${preview.kpis.prepaidPct}%`}</b>.</p>}
              {preview.roster && <p className="text-xs text-slate-800">Roster: {preview.roster.rows} agents with a target; {preview.roster.agentsMatched} of {preview.roster.agentsInOrders} order agents found on it.</p>}
              {preview.sample.length > 0 && <DataTable caption="Latest orders (mapped columns only)" maxHeight="max-h-64" rows={preview.sample} cols={Object.keys(preview.sample[0]).map((k, i) => ({ key: k, label: k, align: i < 3 ? "left" as const : "right" as const }))} />}
            </div>)}
        </div>
      )}
    </Panel>
  );
}

