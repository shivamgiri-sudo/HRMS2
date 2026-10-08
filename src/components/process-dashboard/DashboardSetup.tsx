import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Save, Sparkles, TableProperties, Eye } from "lucide-react";
import { hrmsApi, type HrmsEnvelope } from "@/lib/hrmsApi";
import { PD_API } from "./api";
import { CANONICAL_FIELDS, CATEGORY_OPTIONS, SOURCE_SCHEMAS, TIME_UNIT_OPTIONS, emptyForm, toConfigPayload, validateSetup, type SetupForm } from "./canonicalFields";
import { InboundSourcePanel } from "./InboundSourcePanel";
import { OutboundSourcePanel } from "./outbound/OutboundSourcePanel";
import { SalesSourcePanel } from "./sales/SalesSourcePanel";
import { SimpleTable } from "./SimpleTable";
import { Empty, ErrorBox, FOCUS, Panel, Skeleton, btn } from "./ui";
import type { ProcessConfigSummary } from "./types";

interface ProcessRow { processId: string; processName: string; processCode?: string | null }
interface TableRow { table: string; rows?: number | null }
interface ColumnRow { name: string; dataType?: string }
type Candidate = string | { column: string; values?: Array<string | { value: string; rows?: number }> };
interface Suggest { column_map?: Record<string, string>; columnMap?: Record<string, string>; time_unit?: string; timeUnit?: string; processFilter?: { column: string; value: string | number | boolean } | null; processFilterCandidates?: Candidate[] }
interface Preview { rows?: Array<Record<string, unknown>>; problems?: Array<string | { severity?: string; field?: string; message: string }> }
type StoredConfig = Partial<SetupForm> & { processId: string; processFilter?: { column: string; value: string | number | boolean } | null };

const input = `min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 ${FOCUS}`;
const lbl = "mb-1 block text-xs font-semibold text-slate-700";
const msg = (e: unknown) => (e instanceof Error ? e.message : "Request failed.");
const candCol = (c: Candidate) => (typeof c === "string" ? c : c.column);

export function DashboardSetup({ initialProcessId = "" }: { initialProcessId?: string }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<SetupForm>(() => emptyForm(initialProcessId));
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const set = (patch: Partial<SetupForm>) => { setForm((f) => ({ ...f, ...patch })); setSaved(null); };

  const processes = useQuery({ queryKey: ["pd-admin", "processes"], queryFn: async () => (await hrmsApi.get<HrmsEnvelope<ProcessRow[]>>("/api/process-operations/processes")).data ?? [] });
  // The list endpoint omits the mapping, so the stored config is read per process (200 with data null = nothing saved yet).
  const stored = useQuery({
    queryKey: ["pd-admin", "config", form.processId], enabled: !!form.processId, retry: false,
    queryFn: async (): Promise<StoredConfig | null> => (await hrmsApi.get<HrmsEnvelope<StoredConfig | null>>(`${PD_API}/admin/configs/${encodeURIComponent(form.processId)}`)).data ?? null,
  });
  const tables = useQuery({ queryKey: ["pd-admin", "tables", form.aprSchema], queryFn: async () => (await hrmsApi.get<HrmsEnvelope<TableRow[]>>(`${PD_API}/admin/tables?schema=${encodeURIComponent(form.aprSchema)}`)).data ?? [], enabled: !!form.aprSchema });
  const columns = useQuery({ queryKey: ["pd-admin", "columns", form.aprSchema, form.aprTable], queryFn: async () => (await hrmsApi.get<HrmsEnvelope<ColumnRow[]>>(`${PD_API}/admin/columns?schema=${encodeURIComponent(form.aprSchema)}&table=${encodeURIComponent(form.aprTable)}`)).data ?? [], enabled: !!form.aprSchema && !!form.aprTable });

  // Load the stored config when a process is picked (or after a save refreshes it).
  useEffect(() => {
    if (!form.processId || stored.isLoading) return;
    setPreview(null); setCandidates([]);
    const c = stored.data;
    if (!c) { setForm((f) => emptyForm(f.processId)); return; }
    setForm({ ...emptyForm(c.processId), ...c, label: c.label ?? "", columnMap: c.columnMap ?? {}, category: c.category && c.category !== "unconfigured" ? c.category : "",
      filterColumn: c.processFilter?.column ?? "", filterValue: c.processFilter ? String(c.processFilter.value) : "", aprSchema: c.aprSchema ?? SOURCE_SCHEMAS[0], aprTable: c.aprTable ?? "" } as SetupForm);
  }, [form.processId, stored.data, stored.isLoading]);

  const suggest = useMutation({
    mutationFn: async () => (await hrmsApi.post<HrmsEnvelope<Suggest>>(`${PD_API}/admin/suggest`, { schema: form.aprSchema, table: form.aprTable, processId: form.processId || undefined })).data ?? {},
    onSuccess: (s) => {
      set({ columnMap: s.column_map ?? s.columnMap ?? {}, timeUnit: s.time_unit ?? s.timeUnit ?? form.timeUnit, ...(s.processFilter ? { filterColumn: s.processFilter.column, filterValue: String(s.processFilter.value) } : {}) });
      setCandidates(s.processFilterCandidates ?? []);
    },
  });
  const runPreview = useMutation({
    mutationFn: async () => (await hrmsApi.post<HrmsEnvelope<Preview>>(`${PD_API}/admin/preview`, { processId: form.processId, config: toConfigPayload(form) })).data ?? {},
    onSuccess: setPreview,
  });
  const save = useMutation({
    mutationFn: (enabled: boolean) => hrmsApi.put(`${PD_API}/admin/configs/${encodeURIComponent(form.processId)}`, { ...toConfigPayload(form), enabled }),
    onSuccess: async (_r, enabled) => {
      setForm((f) => ({ ...f, enabled })); setSaved(enabled ? "Saved and enabled. The dashboard is live." : "Saved. The dashboard is disabled until you enable it.");
      await Promise.all([qc.invalidateQueries({ queryKey: ["pd-admin", "config", form.processId] }), qc.invalidateQueries({ queryKey: ["process-dashboard", "configs"] })]);
    },
  });

  const errors = useMemo(() => validateSetup(form), [form]);
  const filterValues = useMemo(() => { const c = candidates.find((x) => candCol(x) === form.filterColumn); return typeof c === "object" ? (c.values ?? []).map((v) => (typeof v === "string" ? v : v.value)) : []; }, [candidates, form.filterColumn]);
  const colNames = (columns.data ?? []).map((c) => c.name);
  const filterCols = Array.from(new Set([...candidates.map(candCol), ...colNames]));
  const needsTimeUnit = CANONICAL_FIELDS.some((f) => f.time && form.columnMap[f.key]);
  const current = stored.data as (StoredConfig & Partial<ProcessConfigSummary>) | null | undefined;

  return (
    <div className="space-y-4">
      <Panel title="1. Process and category">
        {processes.isError && <ErrorBox message={msg(processes.error)} onRetry={() => void processes.refetch()} />}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div><label className={lbl} htmlFor="pd-process">Process</label>
            <select id="pd-process" className={`${input} cursor-pointer`} value={form.processId} onChange={(e) => set({ processId: e.target.value })}>
              <option value="">Select a process</option>
              {(processes.data ?? []).map((p) => <option key={p.processId} value={p.processId}>{p.processName}{p.processCode ? ` (${p.processCode})` : ""}</option>)}</select></div>
          <div><label className={lbl} htmlFor="pd-cat">Category <span className="text-red-700">*</span></label>
            <select id="pd-cat" className={`${input} cursor-pointer`} value={form.category} onChange={(e) => set({ category: e.target.value })} aria-describedby="pd-cat-help">
              <option value="">Select a category</option>{CATEGORY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
            <p id="pd-cat-help" className="mt-1 text-[11px] text-slate-600">Decides which KPI tiles and columns appear.</p></div>
          <div><label className={lbl} htmlFor="pd-label">Display label (optional)</label><input id="pd-label" className={input} value={form.label} onChange={(e) => set({ label: e.target.value })} placeholder="Defaults to the process name" /></div>
        </div>
        {current && <p className="mt-2 text-xs text-slate-700">Current state: {current.enabled ? "enabled" : "disabled"}{current.aprTable ? `, source ${current.aprSchema}.${current.aprTable}` : ""}.</p>}
      </Panel>

      <Panel title="2. APR source table">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div><label className={lbl} htmlFor="pd-schema">Schema</label>
            <select id="pd-schema" className={`${input} cursor-pointer`} value={form.aprSchema} onChange={(e) => set({ aprSchema: e.target.value, aprTable: "", columnMap: {} })}>
              {SOURCE_SCHEMAS.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
          <div className="sm:col-span-2"><label className={lbl} htmlFor="pd-table">Table <span className="text-red-700">*</span></label>
            <select id="pd-table" className={`${input} cursor-pointer`} value={form.aprTable} onChange={(e) => set({ aprTable: e.target.value, columnMap: {} })} disabled={tables.isLoading}>
              <option value="">{tables.isLoading ? "Loading tables..." : "Select a table"}</option>
              {(tables.data ?? []).map((t) => <option key={t.table} value={t.table}>{t.table}{t.rows != null ? ` (~${t.rows.toLocaleString("en-IN")} rows)` : ""}</option>)}</select></div>
        </div>
        {tables.isError && <div className="mt-2"><ErrorBox message={msg(tables.error)} onRetry={() => void tables.refetch()} /></div>}
      </Panel>

      <Panel title="3. Column mapping" action={
        <button type="button" className={btn} disabled={!form.aprTable || suggest.isPending} onClick={() => suggest.mutate()}><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />{suggest.isPending ? "Suggesting..." : "Suggest mapping"}</button>}>
        {suggest.isError && <ErrorBox message={msg(suggest.error)} />}
        {!form.aprTable ? <Empty>Choose a table first.</Empty> : columns.isLoading ? <Skeleton className="h-48" /> : columns.isError ? <ErrorBox message={msg(columns.error)} onRetry={() => void columns.refetch()} /> : (
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            {CANONICAL_FIELDS.map((f) => {
              const v = form.columnMap[f.key] ?? "";
              const missing = f.required && !v;
              return (
                <div key={f.key}>
                  <label className={lbl} htmlFor={`pd-map-${f.key}`}>{f.label}{f.required && <span className="text-red-700" aria-hidden="true"> *</span>}{f.required && <span className="sr-only"> (required)</span>}</label>
                  <select id={`pd-map-${f.key}`} value={v} onChange={(e) => set({ columnMap: { ...form.columnMap, [f.key]: e.target.value } })} aria-invalid={missing} aria-describedby={missing ? `pd-err-${f.key}` : undefined}
                    className={`${input} cursor-pointer ${missing ? "border-red-400" : ""}`}>
                    <option value="">{f.required ? "Select a column" : "Not mapped"}</option>
                    {(columns.data ?? []).map((c) => <option key={c.name} value={c.name}>{c.name}{c.dataType ? ` (${c.dataType})` : ""}</option>)}</select>
                  {missing && <p id={`pd-err-${f.key}`} className="mt-0.5 text-[11px] font-semibold text-red-800">Required: pick the column that holds the {f.label.toLowerCase()}.</p>}
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-4 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2">
          <div><label className={lbl} htmlFor="pd-unit">Time unit of mapped time columns</label>
            <select id="pd-unit" className={`${input} cursor-pointer`} value={form.timeUnit} onChange={(e) => set({ timeUnit: e.target.value })} disabled={!needsTimeUnit}>
              {TIME_UNIT_OPTIONS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}</select>
            {!needsTimeUnit && <p className="mt-1 text-[11px] text-slate-600">Only needed once a time column is mapped.</p>}</div>
          <div><label className={lbl} htmlFor="pd-refresh">Refresh every (seconds)</label>
            <input id="pd-refresh" type="number" min={10} max={3600} className={input} value={form.refreshSeconds} onChange={(e) => set({ refreshSeconds: Number(e.target.value) })} /></div>
          <div><label className={lbl} htmlFor="pd-fcol">Process filter column (optional)</label>
            <select id="pd-fcol" className={`${input} cursor-pointer`} value={form.filterColumn} onChange={(e) => set({ filterColumn: e.target.value, filterValue: "" })}>
              <option value="">No filter: table holds only this process</option>{filterCols.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            <p className="mt-1 text-[11px] text-slate-600">Use when the table mixes several processes.</p></div>
          <div><label className={lbl} htmlFor="pd-fval">Process filter value</label>
            <input id="pd-fval" list="pd-fvals" className={input} value={form.filterValue} disabled={!form.filterColumn} onChange={(e) => set({ filterValue: e.target.value })} />
            <datalist id="pd-fvals">{filterValues.map((v) => <option key={v} value={v} />)}</datalist></div>
        </div>
      </Panel>

      <Panel title="4. Preview" action={<button type="button" className={btn} disabled={!form.processId || errors.length > 0 || runPreview.isPending} onClick={() => runPreview.mutate()}><Eye className="h-3.5 w-3.5" aria-hidden="true" />{runPreview.isPending ? "Loading..." : "Preview 20 rows"}</button>}>
        {runPreview.isError && <ErrorBox message={msg(runPreview.error)} />}
        {errors.length > 0 && <ul aria-label="Setup checklist" className="mb-3 list-disc space-y-0.5 pl-5 text-xs text-amber-900">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        {!preview ? <Empty>Preview shows how the first rows look after mapping and unit conversion.</Empty> : (
          <div className="space-y-3">
            {(preview.problems?.length ?? 0) > 0 ? (
              <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950"><p className="font-bold">Problems found ({preview.problems!.length})</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">{preview.problems!.map((p, i) => <li key={i}>{typeof p === "string" ? p : `${p.severity === "error" ? "Error" : "Warning"}${p.field ? ` (${p.field})` : ""}: ${p.message}`}</li>)}</ul></div>
            ) : <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />No problems found in the sample.</p>}
            {preview.rows?.length ? <SimpleTable caption="Normalized preview rows" maxHeight="max-h-80" rows={preview.rows}
              cols={Object.keys(preview.rows[0]).map((k, i) => ({ key: k, label: k, align: i < 2 ? "left" as const : "right" as const }))} /> : <Empty>No rows returned: check the table, date column and process filter.</Empty>}
          </div>
        )}
      </Panel>

      {form.category === "support_inbound" && <InboundSourcePanel processId={form.processId} />}
      {form.category === "sales" && <SalesSourcePanel processId={form.processId} />}
      {form.category === "outbound" && <OutboundSourcePanel processId={form.processId} />}

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <button type="button" className={`${btn} bg-blue-700 text-white hover:bg-blue-800 border-blue-700`} disabled={errors.length > 0 || save.isPending} onClick={() => save.mutate(form.enabled)}><Save className="h-3.5 w-3.5" aria-hidden="true" />{save.isPending ? "Saving..." : "Save mapping"}</button>
        <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-sm font-semibold text-slate-900">
          <input type="checkbox" role="switch" checked={form.enabled} disabled={errors.length > 0 || save.isPending} onChange={(e) => save.mutate(e.target.checked)} className={`h-4 w-4 ${FOCUS}`} />Dashboard enabled</label>
        {errors.length > 0 && <span className="text-xs text-slate-700">Fix the items in the checklist to save.</span>}
        <div role="status" aria-live="polite" className="text-xs font-semibold text-emerald-800">{saved}</div>
        {save.isError && <ErrorBox message={msg(save.error)} />}
        {saved && form.processId && <Link className="ml-auto text-xs font-semibold text-blue-800 underline" to={`/performance/process-dashboard/${encodeURIComponent(form.processId)}`}><TableProperties className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />Open dashboard</Link>}
      </div>
    </div>
  );
}
