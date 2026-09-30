import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Archive, ArrowLeft, Database, Loader2, Pencil, Plus, RefreshCw, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";
import { errorText, useDatasets, useScopeOptions } from "./api";
import {
  AGG_LABELS, FORMATS, LOOKUPS, LOOKUP_LABELS, ROLES, SCOPE_INFO, SCOPE_MODES, SCOPE_NEEDS,
  aggOptions, allowedScopeModes, columnChoices, emptyForm, fromDataset, matchTables, mergeIntrospection, patchField,
  timeFieldChoices, toPayload, validateForm, withName,
  type DatasetPayload, type FormField, type FormState, type IntrospectResult, type ScopeMode,
} from "./dataset-form";
import type { DatasetDef } from "./types";

const BASE = "/api/analytics-catalogue";
interface Env<T> { success: boolean; data: T }
type ListItem = DatasetDef & { sourceTable?: string; connection?: string };

const SELECT = "h-10 w-full cursor-pointer rounded-lg border border-slate-300 bg-white px-2 text-sm focus-visible:border-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-60";
const CHECK = "h-4 w-4 cursor-pointer rounded border-slate-400 accent-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2";
const INPUT = "min-h-[40px] px-3 py-2 text-sm";
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");

function ErrorPanel({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
      <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-9">{items.map((m) => <li key={m}>{m}</li>)}</ul>
    </div>
  );
}

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`dsm-step-${n}`} className="rounded-xl border border-slate-200 p-4">
      <h3 id={`dsm-step-${n}`} className="flex items-center gap-2 text-base font-semibold text-slate-900">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">{n}</span>{title}
      </h3>
      {hint && <p className="mt-1 text-sm text-slate-600">{hint}</p>}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function Field({ id, label, children, className }: { id: string; label: string; children: ReactNode; className?: string }) {
  return <div className={className}><Label htmlFor={id} className="mb-1 block text-sm">{label}</Label>{children}</div>;
}

const FieldRow = memo(function FieldRow({ f, i, onChange }: { f: FormField; i: number; onChange: (i: number, patch: Partial<FormField>) => void }) {
  const off = !f.include;
  const name = f.label || f.fieldKey;
  return (
    <tr className={off ? "bg-slate-50 text-slate-500" : "bg-white"}>
      <td className="px-2 py-1.5 text-center">
        <input type="checkbox" className={CHECK} checked={f.include} aria-label={`Include ${name}`} onChange={(e) => onChange(i, { include: e.target.checked })} />
      </td>
      <td className="px-2 py-1.5">
        <Input className={`${INPUT} min-w-[150px]`} value={f.label} disabled={off} maxLength={128} aria-label={`Label for ${f.columnName}`} onChange={(e) => onChange(i, { label: e.target.value })} />
      </td>
      <td className="px-2 py-1.5 font-mono text-xs">{f.fieldKey}</td>
      <td className="px-2 py-1.5">
        <select className={`${SELECT} min-w-[110px]`} value={f.role} disabled={off} aria-label={`Role of ${name}`} onChange={(e) => onChange(i, { role: e.target.value as FormField["role"] })}>
          {ROLES.map((r) => <option key={r} value={r}>{cap(r)}</option>)}
        </select>
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 text-xs">{cap(f.dataType)}{f.sqlType ? <span className="text-slate-500"> ({f.sqlType})</span> : null}</td>
      <td className="px-2 py-1.5">
        <select className={`${SELECT} min-w-[120px]`} value={f.defaultAgg} disabled={off || f.role !== "measure"} aria-label={`Default aggregation of ${name}`} onChange={(e) => onChange(i, { defaultAgg: e.target.value as FormField["defaultAgg"] })}>
          {(f.role === "measure" ? aggOptions(f.dataType) : [f.defaultAgg]).map((a) => <option key={a} value={a}>{AGG_LABELS[a]}</option>)}
        </select>
      </td>
      <td className="px-2 py-1.5">
        <select className={`${SELECT} min-w-[110px]`} value={f.format} disabled={off} aria-label={`Format of ${name}`} onChange={(e) => onChange(i, { format: e.target.value as FormField["format"] })}>
          {FORMATS.map((x) => <option key={x} value={x}>{cap(x)}</option>)}
        </select>
      </td>
      <td className="px-2 py-1.5">
        <select className={`${SELECT} min-w-[140px]`} value={f.lookup} disabled={off} aria-label={`Lookup for ${name}`} onChange={(e) => onChange(i, { lookup: e.target.value as FormField["lookup"] })}>
          {LOOKUPS.map((x) => <option key={x} value={x}>{LOOKUP_LABELS[x]}</option>)}
        </select>
      </td>
      <td className="px-2 py-1.5 text-center">
        <input type="checkbox" className={CHECK} checked={f.hidden} disabled={off} aria-label={`Hide ${name}`} onChange={(e) => onChange(i, { hidden: e.target.checked })} />
      </td>
    </tr>
  );
});

export default function DatasetManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<FormState | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmCode, setConfirmCode] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => { if (open) { setForm(null); setSubmitted(false); setConfirmCode(null); setActionError(null); } }, [open]);

  const datasets = useDatasets();
  const scopeOptions = useScopeOptions();
  const connections = useQuery({
    queryKey: ["studio", "admin", "connections"], enabled: open && !!form, staleTime: 5 * 60_000,
    queryFn: async () => (await hrmsApi.get<Env<Array<{ key: string; label: string }>>>(`${BASE}/admin/connections`)).data,
  });
  const connection = form?.connection ?? "hrms";
  const tables = useQuery({
    queryKey: ["studio", "admin", "tables", connection], enabled: open && !!form, staleTime: 5 * 60_000,
    queryFn: async () => (await hrmsApi.get<Env<string[]>>(`${BASE}/admin/tables?connection=${encodeURIComponent(connection)}`)).data,
  });

  const loadForEdit = useMutation({
    mutationFn: async (code: string) => (await hrmsApi.get<Env<DatasetPayload>>(`${BASE}/admin/datasets/${encodeURIComponent(code)}`)).data,
    onMutate: () => setActionError(null),
    onSuccess: (ds) => { setSubmitted(false); setForm(fromDataset(ds)); },
    onError: (e) => setActionError(errorText(e)),
  });
  const archive = useMutation({
    mutationFn: async (code: string) => { await hrmsApi.delete(`${BASE}/admin/datasets/${encodeURIComponent(code)}`); return code; },
    onMutate: () => setActionError(null),
    onSuccess: (code) => { setConfirmCode(null); toast({ title: "Dataset archived", description: `"${code}" can no longer be used in new charts.` }); void qc.invalidateQueries({ queryKey: ["studio", "datasets"] }); },
    onError: (e) => setActionError(errorText(e)),
  });
  const introspect = useMutation({
    mutationFn: async (v: { connection: string; table: string }) => (await hrmsApi.post<Env<IntrospectResult>>(`${BASE}/admin/introspect`, v)).data,
    // Ignore the answer if the admin picked a different table while this was loading.
    onSuccess: (res, v) => setForm((f) => (f && f.connection === v.connection && f.sourceTable.trim() === v.table ? mergeIntrospection(f, res) : f)),
  });
  const save = useMutation({
    mutationFn: async (f: FormState) => {
      const body = toPayload(f);
      const res = f.editingCode
        ? await hrmsApi.put<Env<DatasetPayload>>(`${BASE}/admin/datasets/${encodeURIComponent(f.editingCode)}`, body)
        : await hrmsApi.post<Env<DatasetPayload>>(`${BASE}/admin/datasets`, body);
      return res.data;
    },
    onSuccess: (ds, f) => {
      toast({ title: f.editingCode ? "Dataset updated" : "Dataset registered", description: `"${ds?.name ?? f.name}" is ready to chart.` });
      void qc.invalidateQueries({ queryKey: ["studio", "datasets"] });
      setForm(null); setSubmitted(false);
    },
  });

  const set = useCallback((patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f)), []);
  /** Change fields, and drop the time field if it is no longer an included date field. */
  const setFields = useCallback((fn: (fields: FormField[]) => FormField[]) => setForm((f) => {
    if (!f) return f;
    const next = { ...f, fields: fn(f.fields) };
    return timeFieldChoices(next).some((x) => x.fieldKey === next.timeField) ? next : { ...next, timeField: "" };
  }), []);
  const changeField = useCallback((i: number, patch: Partial<FormField>) => setFields((fs) => fs.map((x, j) => (j === i ? patchField(x, patch) : x))), [setFields]);

  const problems = useMemo(() => (form && submitted ? validateForm(form) : []), [form, submitted]);
  const matches = useMemo(() => matchTables(tables.data ?? [], form?.sourceTable ?? ""), [tables.data, form?.sourceTable]);
  const startNew = () => { setSubmitted(false); setActionError(null); save.reset(); introspect.reset(); setForm(emptyForm()); };
  const backToList = () => { setForm(null); setSubmitted(false); save.reset(); introspect.reset(); };
  const onSave = () => { if (!form) return; setSubmitted(true); if (!validateForm(form).length) save.mutate(form); };

  const list = (datasets.data ?? []) as ListItem[];
  const renderList = () => (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">A dataset is a database table that people can build charts from.</p>
        <Button type="button" className="cursor-pointer" onClick={startNew}><Plus aria-hidden />Register a dataset</Button>
      </div>
      {actionError && <ErrorPanel title="That did not work" items={[actionError]} />}
      {datasets.isLoading && <p className="flex items-center gap-2 py-8 text-sm text-slate-600" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Loading datasets...</p>}
      {datasets.isError && (
        <div className="space-y-2">
          <ErrorPanel title="Could not load datasets" items={[errorText(datasets.error)]} />
          <Button type="button" variant="outline" className="cursor-pointer" onClick={() => void datasets.refetch()}><RefreshCw aria-hidden />Try again</Button>
        </div>
      )}
      {datasets.isSuccess && !list.length && (
        <div className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center">
          <Database className="mx-auto h-8 w-8 text-slate-400" aria-hidden />
          <p className="mt-2 font-semibold text-slate-900">No datasets yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">Register a table to make it available for charts. You choose the table, decide who can see which rows, and pick the fields people may use.</p>
        </div>
      )}
      <ul className="space-y-2">
        {list.map((d) => (
          <li key={d.code} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-900">{d.name} <span className="font-mono text-xs font-normal text-slate-500">{d.code}</span></p>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                {d.category && <Badge variant="secondary">{d.category}</Badge>}
                <Badge variant="outline">{SCOPE_INFO[d.scopeMode as ScopeMode]?.title ?? d.scopeMode}</Badge>
                <span>Table: <span className="font-mono">{d.sourceTable ?? "not shown"}</span></span>
                <span>{d.fields.length} visible {d.fields.length === 1 ? "field" : "fields"}</span>
              </p>
            </div>
            {confirmCode === d.code ? (
              <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label={`Confirm archiving ${d.name}`}>
                <span className="text-slate-700">Archive this dataset? Charts that use it will stop loading.</span>
                <Button type="button" size="sm" variant="destructive" className="cursor-pointer" disabled={archive.isPending} onClick={() => archive.mutate(d.code)}>
                  {archive.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Archive aria-hidden />}Yes, archive
                </Button>
                <Button type="button" size="sm" variant="outline" className="cursor-pointer" disabled={archive.isPending} onClick={() => setConfirmCode(null)}>Keep it</Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="outline" className="cursor-pointer" disabled={loadForEdit.isPending} aria-label={`Edit ${d.name}`} onClick={() => loadForEdit.mutate(d.code)}>
                  {loadForEdit.isPending && loadForEdit.variables === d.code ? <Loader2 className="animate-spin" aria-hidden /> : <Pencil aria-hidden />}Edit
                </Button>
                <Button type="button" size="sm" variant="outline" className="cursor-pointer" aria-label={`Archive ${d.name}`} onClick={() => { setActionError(null); setConfirmCode(d.code); }}><Archive aria-hidden />Archive</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );

  const renderEditor = (f: FormState) => {
    const allowed = allowedScopeModes(f.connection);
    const columns = columnChoices(f);
    const times = timeFieldChoices(f);
    const table = f.sourceTable.trim();
    const hasFields = f.fields.length > 0 && f.fieldsFrom === `${f.connection}|${table}`;
    const included = f.fields.filter((x) => x.include).length;
    const colSelect = (key: "processColumn" | "branchColumn" | "employeeColumn", label: string) => (
      <Field key={key} id={`dsm-${key}`} label={label}>
        <select id={`dsm-${key}`} className={SELECT} value={f[key]} onChange={(e) => set({ [key]: e.target.value })}>
          <option value="">{columns.length ? "Choose a column" : "Read columns first"}</option>
          {columns.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
    );
    return (
      <div className="space-y-4">
        <Button type="button" variant="ghost" size="sm" className="cursor-pointer" onClick={backToList}><ArrowLeft aria-hidden />All datasets</Button>

        <Step n={1} title="Source" hint="Pick the table this dataset reads from, then read its columns.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="dsm-connection" label="Connection">
              <select id="dsm-connection" className={SELECT} value={f.connection} disabled={connections.isLoading}
                onChange={(e) => { const c = e.target.value; set({ connection: c, sourceTable: "", scopeMode: allowedScopeModes(c).includes(f.scopeMode) ? f.scopeMode : "org" }); }}>
                {(connections.data ?? [{ key: f.connection, label: f.connection === "hrms" ? "HRMS" : f.connection }]).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              {connections.isError && <p className="mt-1 text-xs text-red-700" role="alert">Could not load connections: {errorText(connections.error)}</p>}
            </Field>
            <Field id="dsm-table" label="Table">
              <div className="relative">
                <Input id="dsm-table" className={`${INPUT} font-mono`} value={f.sourceTable} autoComplete="off" spellCheck={false} placeholder="Type to search tables"
                  role="combobox" aria-expanded={pickerOpen} aria-controls="dsm-table-list" aria-autocomplete="list"
                  onFocus={() => setPickerOpen(true)} onBlur={() => setPickerOpen(false)}
                  onKeyDown={(e) => { if (e.key === "Escape" && pickerOpen) { e.stopPropagation(); setPickerOpen(false); } }}
                  onChange={(e) => { set({ sourceTable: e.target.value }); setPickerOpen(true); }} />
                {pickerOpen && matches.length > 0 && !(matches.length === 1 && matches[0] === table) && (
                  <ul id="dsm-table-list" role="listbox" aria-label="Matching tables" className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-300 bg-white py-1 shadow-lg">
                    {matches.map((t) => (
                      <li key={t} role="option" aria-selected={t === table}>
                        <button type="button" tabIndex={-1} className="block w-full cursor-pointer truncate px-3 py-1.5 text-left font-mono text-sm hover:bg-blue-50 focus-visible:bg-blue-50 focus-visible:outline-none"
                          onMouseDown={(e) => e.preventDefault()} onClick={() => { set({ sourceTable: t }); setPickerOpen(false); }}>{t}</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-600" aria-live="polite">
                {tables.isLoading ? "Loading tables..." : tables.isError ? <span className="text-red-700">Could not load the table list ({errorText(tables.error)}). You can still type the exact table name.</span>
                  : `${tables.data?.length ?? 0} tables. Showing up to 50 matches.`}
              </p>
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant={hasFields ? "outline" : "default"} className="cursor-pointer" disabled={!table || introspect.isPending} onClick={() => introspect.mutate({ connection: f.connection, table })}>
              {introspect.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}{hasFields ? "Re-read columns" : "Read columns"}
            </Button>
            {hasFields && <p className="text-xs text-slate-600">Re-reading keeps your field settings and adds any new columns as not included.</p>}
          </div>
          {introspect.isError && <ErrorPanel title="Could not read the columns" items={[errorText(introspect.error)]} />}
        </Step>

        <Step n={2} title="Details">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="dsm-name" label="Name (required)"><Input id="dsm-name" className={INPUT} value={f.name} maxLength={128} required onChange={(e) => setForm((p) => (p ? withName(p, e.target.value) : p))} /></Field>
            <Field id="dsm-code" label="Code">
              <Input id="dsm-code" className={`${INPUT} font-mono`} value={f.code} maxLength={64} readOnly={!!f.editingCode} aria-describedby="dsm-code-help" onChange={(e) => set({ code: e.target.value, codeTouched: true })} />
              <p id="dsm-code-help" className="mt-1 text-xs text-slate-600">{f.editingCode ? "The code cannot be changed after a dataset is saved." : "Filled in from the name. Lower-case letters, digits and _, starting with a letter."}</p>
            </Field>
            <Field id="dsm-category" label="Category"><Input id="dsm-category" className={INPUT} value={f.category} maxLength={64} placeholder="For example: Attendance" onChange={(e) => set({ category: e.target.value })} /></Field>
            <Field id="dsm-maxrows" label="Max rows a chart may load (1 to 20000)"><Input id="dsm-maxrows" className={INPUT} type="number" min={1} max={20000} inputMode="numeric" value={f.maxRows} onChange={(e) => set({ maxRows: e.target.value })} /></Field>
            <Field id="dsm-description" label="Description" className="sm:col-span-2"><Input id="dsm-description" className={INPUT} value={f.description} maxLength={500} placeholder="What this dataset contains, in one sentence" onChange={(e) => set({ description: e.target.value })} /></Field>
          </div>
        </Step>

        <Step n={3} title="Who can see which rows" hint="People only ever see rows for the processes and branches they are allowed to see. Tell us how each row is tied to them.">
          <fieldset>
            <legend className="sr-only">How rows are tied to people</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {SCOPE_MODES.map((m) => {
                const ok = allowed.includes(m);
                return (
                  <label key={m} htmlFor={`dsm-scope-${m}`} className={`flex items-start gap-2 rounded-lg border p-3 text-sm focus-within:ring-2 focus-within:ring-blue-600 ${f.scopeMode === m ? "border-blue-600 bg-blue-50" : "border-slate-300"} ${ok ? "cursor-pointer hover:border-blue-400" : "cursor-not-allowed opacity-50"}`}>
                    <input id={`dsm-scope-${m}`} type="radio" name="dsm-scope" className="mt-0.5 h-4 w-4 accent-blue-600" checked={f.scopeMode === m} disabled={!ok} onChange={() => set({ scopeMode: m })} />
                    <span><span className="block font-semibold text-slate-900">{SCOPE_INFO[m].title}</span><span className="text-slate-600">{SCOPE_INFO[m].help}</span></span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          {f.connection !== "hrms" && <p className="text-sm text-slate-700">This table is on an outside connection, so its rows have no HRMS process, branch or employee ids. Only "One process" and "Organisation-wide" are available.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            {SCOPE_NEEDS[f.scopeMode].map((need) => need === "processColumn" ? colSelect(need, "Process column") : need === "branchColumn" ? colSelect(need, "Branch column")
              : need === "employeeColumn" ? colSelect(need, "Employee column") : (
                <Field key={need} id="dsm-scope-process" label="Process this table belongs to">
                  <select id="dsm-scope-process" className={SELECT} value={f.scopeProcessId} disabled={scopeOptions.isLoading} onChange={(e) => set({ scopeProcessId: e.target.value })}>
                    <option value="">{scopeOptions.isLoading ? "Loading processes..." : "Choose a process"}</option>
                    {f.scopeProcessId && !scopeOptions.data?.processes.some((p) => p.id === f.scopeProcessId) && <option value={f.scopeProcessId}>{f.scopeProcessId}</option>}
                    {(scopeOptions.data?.processes ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  {scopeOptions.isError && <p className="mt-1 text-xs text-red-700" role="alert">Could not load processes: {errorText(scopeOptions.error)}</p>}
                </Field>
              ))}
          </div>
        </Step>

        <Step n={4} title="Fields" hint="Choose which columns people can chart, and how each one behaves.">
          <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span><strong>Do not include salary, identity or contact columns</strong> (pay, Aadhaar, PAN, bank details, phone, email, address). Every included field can be charted by anyone allowed to see those rows. "Hidden" only removes a field from the field list; leave sensitive columns out entirely.</span>
          </p>
          {!hasFields ? (
            <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">{f.fields.length ? "The table changed. Press \"Read columns\" in step 1 to load its columns." : "No columns yet. Choose a table in step 1 and press \"Read columns\"."}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" className="cursor-pointer" onClick={() => setFields((fs) => fs.map((x) => ({ ...x, include: true })))}>Include all</Button>
                <Button type="button" size="sm" variant="outline" className="cursor-pointer" onClick={() => setFields((fs) => fs.map((x) => ({ ...x, include: false })))}>Include none</Button>
                <span className="text-sm text-slate-600" aria-live="polite">{included} of {f.fields.length} columns included</span>
              </div>
              <div className="max-h-[50vh] overflow-auto rounded-lg border border-slate-200" tabIndex={0} role="region" aria-label="Fields table, scrolls sideways">
                <table className="w-full min-w-[980px] border-collapse text-sm">
                  <thead className="sticky top-0 z-[1] bg-slate-100 text-left text-xs font-semibold text-slate-700">
                    <tr>{["Include", "Label", "Field key", "Role", "Data type", "Default aggregation", "Format", "Lookup", "Hidden"].map((h) => <th key={h} scope="col" className="whitespace-nowrap px-2 py-2">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">{f.fields.map((x, i) => <FieldRow key={x.columnName} f={x} i={i} onChange={changeField} />)}</tbody>
                </table>
              </div>
              <Field id="dsm-timefield" label="Time field (used for date ranges)" className="max-w-sm">
                <select id="dsm-timefield" className={SELECT} value={f.timeField} onChange={(e) => set({ timeField: e.target.value })}>
                  <option value="">None</option>
                  {times.map((t) => <option key={t.fieldKey} value={t.fieldKey}>{t.label || t.fieldKey}</option>)}
                </select>
                {!times.length && <p className="mt-1 text-xs text-slate-600">No date field is included, so charts on this dataset cannot be filtered by date.</p>}
              </Field>
            </>
          )}
        </Step>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col gap-0 p-0">
        <DialogHeader className="border-b border-slate-200 px-4 py-4 pr-12 sm:px-6">
          <DialogTitle>{!form ? "Datasets" : form.editingCode ? `Edit dataset: ${form.name || form.editingCode}` : "Register a dataset"}</DialogTitle>
          <DialogDescription>{form ? "Four steps: source, details, who can see which rows, and fields." : "Tables that people can build charts from."}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">{form ? renderEditor(form) : renderList()}</div>
        {form && (
          <div className="space-y-3 border-t border-slate-200 px-4 py-3 sm:px-6">
            <div className="max-h-40 space-y-2 overflow-y-auto empty:hidden">
              <ErrorPanel title="Fix these before saving" items={problems} />
              {save.isError && !problems.length && <ErrorPanel title="The dataset was not saved" items={[errorText(save.error)]} />}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" className="cursor-pointer" disabled={save.isPending} onClick={backToList}>Cancel</Button>
              <Button type="button" className="cursor-pointer" disabled={save.isPending} onClick={onSave}>
                {save.isPending && <Loader2 className="animate-spin" aria-hidden />}{save.isPending ? "Saving..." : form.editingCode ? "Save changes" : "Save dataset"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
