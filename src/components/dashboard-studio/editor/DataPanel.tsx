import { Plus, X } from "lucide-react";
import { useFieldValues } from "../api";
import { fitQuery, queryProblems } from "../model";
import type { Agg, DatasetDef, DatePreset, Grain, Op, QuerySpec, Widget } from "../types";
import type { VizDef } from "../viz/def";
import { Field, NumberInput, Section, SelectInput, TextInput, Toggle, iconBtn, smallBtn } from "./controls";

const GRAINS: Array<{ value: Grain; label: string }> = [
  { value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }, { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" }, { value: "weekday", label: "Day of week" }, { value: "hour", label: "Hour of day" },
];
const AGGS: Array<{ value: Agg; label: string }> = [
  { value: "sum", label: "Sum" }, { value: "avg", label: "Average" }, { value: "min", label: "Minimum" }, { value: "max", label: "Maximum" },
  { value: "count", label: "Count" }, { value: "count_distinct", label: "Count distinct" },
];
const OPS: Array<{ value: Op; label: string; input: "one" | "list" | "two" | "none" }> = [
  { value: "eq", label: "is", input: "one" }, { value: "neq", label: "is not", input: "one" }, { value: "in", label: "is any of", input: "list" },
  { value: "not_in", label: "is none of", input: "list" }, { value: "contains", label: "contains", input: "one" }, { value: "starts_with", label: "starts with", input: "one" },
  { value: "gt", label: ">", input: "one" }, { value: "gte", label: "≥", input: "one" }, { value: "lt", label: "<", input: "one" }, { value: "lte", label: "≤", input: "one" },
  { value: "between", label: "between", input: "two" }, { value: "is_null", label: "is empty", input: "none" }, { value: "not_null", label: "is not empty", input: "none" },
];
export const DATE_PRESETS: Array<{ value: DatePreset; label: string }> = [
  { value: "today", label: "Today" }, { value: "yesterday", label: "Yesterday" }, { value: "last_7", label: "Last 7 days" }, { value: "last_30", label: "Last 30 days" },
  { value: "last_90", label: "Last 90 days" }, { value: "this_week", label: "This week" }, { value: "this_month", label: "This month" }, { value: "last_month", label: "Last month" },
  { value: "this_quarter", label: "This quarter" }, { value: "this_year", label: "This year" }, { value: "all", label: "All time" }, { value: "custom", label: "Custom dates" },
];

function FilterValue({ dataset, field, op, value, onChange }: { dataset: string; field: string; op: Op; value: unknown; onChange: (v: unknown) => void }) {
  const kind = OPS.find((o) => o.value === op)?.input ?? "one";
  const text = Array.isArray(value) ? value.join(", ") : value === undefined || value === null ? "" : String(value);
  const { data: suggestions } = useFieldValues(dataset, field, "");
  const listId = `vals-${dataset}-${field}`;
  if (kind === "none") return null;
  const parse = (s: string) => (s.trim() !== "" && !Number.isNaN(Number(s)) && !/^0\d/.test(s.trim()) ? Number(s) : s);
  return (
    <>
      <TextInput ariaLabel="Filter value" list={listId} value={text}
        placeholder={kind === "list" ? "value, value, …" : kind === "two" ? "from, to" : "value"}
        onChange={(s) => onChange(kind === "one" ? parse(s) : s.split(",").map((x) => parse(x.trim())).filter((x) => x !== ""))} />
      <datalist id={listId}>{(suggestions ?? []).slice(0, 50).map((v) => <option key={v} value={v} />)}</datalist>
    </>
  );
}

interface Props { widget: Widget; def: VizDef; datasets: DatasetDef[]; onChange: (patch: Partial<Widget>) => void; onChangeType: () => void }

/** The Data tab: what to measure, grouped by what, filtered how. */
export default function DataPanel({ widget, def, datasets, onChange, onChangeType }: Props) {
  if (def.noQuery) return <p className="p-3 text-sm text-slate-600">This widget shows text only. Use the Style tab to write it.</p>;
  const q = widget.query;
  const ds = datasets.find((d) => d.code === q?.dataset);
  const set = (patch: Partial<QuerySpec>) => onChange({ query: { ...(q as QuerySpec), ...patch } });
  const groupable = ds?.fields.filter((f) => f.role !== "measure") ?? [];
  const isTime = (key: string) => { const f = ds?.fields.find((x) => x.fieldKey === key); return !!f && (f.role === "time" || f.dataType === "date" || f.dataType === "datetime"); };
  const problems = queryProblems(def.needs, q, def.label);
  const outKeys = q ? [...q.dimensions.map((d, i) => ({ value: `d${i}`, label: ds?.fields.find((f) => f.fieldKey === d.field)?.label ?? d.field })),
    ...q.measures.map((m, i) => ({ value: `m${i}`, label: m.alias || (m.field ? ds?.fields.find((f) => f.fieldKey === m.field)?.label ?? m.field : "Count of rows") }))] : [];

  return (
    <div>
      <Section title="Chart type" action={<button type="button" className={smallBtn} onClick={onChangeType}>Change</button>}>
        <p className="flex items-center gap-2 text-sm font-medium text-slate-800"><def.icon className="h-4 w-4" aria-hidden />{def.label}</p>
        <p className="text-[11px] text-slate-500">{def.description}</p>
      </Section>

      <Section title="Dataset">
        <Field label="Where the numbers come from" hint={ds?.description ?? undefined}>{(id) => (
          <SelectInput id={id} value={q?.dataset ?? ""} onChange={(code) => {
            const next = datasets.find((d) => d.code === code); if (!next) return;
            onChange({ query: fitQuery({ dataset: code, dimensions: [], measures: [], dateRange: next.timeField ? { preset: "last_30" } : undefined, limit: 500 }, def.needs) });
          }} options={[{ value: "", label: "Choose a dataset…", disabled: true }, ...datasets.map((d) => ({ value: d.code, label: d.category ? `${d.category} · ${d.name}` : d.name }))]} />
        )}</Field>
      </Section>

      {q && ds && <>
        {problems.length > 0 && <div role="alert" className="mx-3 mt-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">{problems.map((p) => <p key={p}>{p}</p>)}</div>}

        <Section title={`Group by (${def.needs.dims[0]}–${def.needs.dims[1]})`} action={q.dimensions.length < def.needs.dims[1] &&
          <button type="button" className={smallBtn} onClick={() => { const f = groupable.find((x) => !q.dimensions.some((d) => d.field === x.fieldKey)) ?? groupable[0]; if (f) set({ dimensions: [...q.dimensions, { field: f.fieldKey, grain: isTime(f.fieldKey) ? "day" : undefined }] }); }}><Plus className="h-3.5 w-3.5" />Add</button>}>
          {q.dimensions.length === 0 && <p className="text-xs text-slate-500">No grouping: one total.</p>}
          {q.dimensions.map((d, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <SelectInput ariaLabel={`Group by field ${i + 1}`} value={d.field} options={groupable.map((f) => ({ value: f.fieldKey, label: f.label }))}
                onChange={(field) => set({ dimensions: q.dimensions.map((x, j) => (j === i ? { field, grain: isTime(field) ? x.grain ?? "day" : undefined } : x)) })} />
              {isTime(d.field) && <SelectInput ariaLabel="Time grain" value={d.grain ?? "day"} options={GRAINS} onChange={(g) => set({ dimensions: q.dimensions.map((x, j) => (j === i ? { ...x, grain: g as Grain } : x)) })} />}
              <button type="button" className={iconBtn} aria-label="Remove grouping" onClick={() => set({ dimensions: q.dimensions.filter((_, j) => j !== i), sort: [] })}><X className="h-4 w-4" /></button>
            </div>
          ))}
        </Section>

        <Section title={`Measures (${def.needs.measures[0]}–${def.needs.measures[1]})`} action={q.measures.length < def.needs.measures[1] &&
          <button type="button" className={smallBtn} onClick={() => { const f = ds.fields.find((x) => x.role === "measure" && !q.measures.some((m) => m.field === x.fieldKey)); set({ measures: [...q.measures, f ? { field: f.fieldKey, agg: f.defaultAgg } : { agg: "count" }] }); }}><Plus className="h-3.5 w-3.5" />Add</button>}>
          {q.measures.map((m, i) => {
            const f = ds.fields.find((x) => x.fieldKey === m.field);
            const numeric = f?.dataType === "number";
            return (
              <div key={i} className="space-y-1 rounded-md border border-slate-200 p-1.5">
                <div className="flex items-center gap-1.5">
                  <SelectInput ariaLabel={`Measure ${i + 1} field`} value={m.field ?? ""} options={[{ value: "", label: "Count of rows" }, ...ds.fields.map((x) => ({ value: x.fieldKey, label: x.label }))]}
                    onChange={(field) => { const nf = ds.fields.find((x) => x.fieldKey === field); set({ measures: q.measures.map((x, j) => (j === i ? (field ? { ...x, field, agg: nf?.role === "measure" ? nf.defaultAgg : nf?.dataType === "number" ? "sum" : "count_distinct" } : { agg: "count", alias: x.alias }) : x)) }); }} />
                  <button type="button" className={iconBtn} aria-label="Remove measure" onClick={() => set({ measures: q.measures.filter((_, j) => j !== i), sort: [] })}><X className="h-4 w-4" /></button>
                </div>
                <div className="flex items-center gap-1.5">
                  {m.field && <SelectInput ariaLabel="How to combine" value={m.agg ?? f?.defaultAgg ?? "count"} options={AGGS.map((a) => ({ ...a, disabled: !numeric && !["count", "count_distinct"].includes(a.value) }))}
                    onChange={(agg) => set({ measures: q.measures.map((x, j) => (j === i ? { ...x, agg: agg as Agg } : x)) })} />}
                  <TextInput ariaLabel="Display name" placeholder="Display name (optional)" value={m.alias ?? ""} onChange={(alias) => set({ measures: q.measures.map((x, j) => (j === i ? { ...x, alias: alias || undefined } : x)) })} />
                </div>
              </div>
            );
          })}
        </Section>

        <Section title="Filters" action={<button type="button" className={smallBtn} onClick={() => set({ filters: [...(q.filters ?? []), { field: ds.fields[0].fieldKey, op: "eq", value: "" }] })}><Plus className="h-3.5 w-3.5" />Add</button>}>
          {!(q.filters ?? []).length && <p className="text-xs text-slate-500">No filters. The dashboard's own filters still apply.</p>}
          {(q.filters ?? []).map((f, i) => (
            <div key={i} className="space-y-1 rounded-md border border-slate-200 p-1.5">
              <div className="flex items-center gap-1.5">
                <SelectInput ariaLabel="Filter field" value={f.field} options={ds.fields.map((x) => ({ value: x.fieldKey, label: x.label }))} onChange={(field) => set({ filters: q.filters!.map((x, j) => (j === i ? { ...x, field } : x)) })} />
                <SelectInput ariaLabel="Filter condition" value={f.op} options={OPS} onChange={(op) => set({ filters: q.filters!.map((x, j) => (j === i ? { field: x.field, op: op as Op, value: ["is_null", "not_null"].includes(op) ? undefined : x.value } : x)) })} />
                <button type="button" className={iconBtn} aria-label="Remove filter" onClick={() => set({ filters: q.filters!.filter((_, j) => j !== i) })}><X className="h-4 w-4" /></button>
              </div>
              <FilterValue dataset={q.dataset} field={f.field} op={f.op} value={f.value} onChange={(value) => set({ filters: q.filters!.map((x, j) => (j === i ? { ...x, value } : x)) })} />
            </div>
          ))}
        </Section>

        {ds.timeField && (
          <Section title="Dates">
            <Field label="Date range">{(id) => <SelectInput id={id} value={q.dateRange?.preset ?? "last_30"} options={DATE_PRESETS} onChange={(p) => set({ dateRange: p === "custom" ? { preset: "custom", from: q.dateRange?.from ?? "", to: q.dateRange?.to ?? "" } : { preset: p as DatePreset } })} />}</Field>
            {q.dateRange?.preset === "custom" && (
              <div className="grid grid-cols-2 gap-1.5">
                <Field label="From">{(id) => <TextInput id={id} type="date" value={q.dateRange?.from ?? ""} onChange={(from) => set({ dateRange: { ...q.dateRange!, from } })} />}</Field>
                <Field label="To">{(id) => <TextInput id={id} type="date" value={q.dateRange?.to ?? ""} onChange={(to) => set({ dateRange: { ...q.dateRange!, to } })} />}</Field>
              </div>
            )}
            <Toggle label="Keep this date range" hint="Ignore the dashboard's date filter for this widget." checked={!!widget.viz.pinDate} onChange={(pinDate) => onChange({ viz: { ...widget.viz, pinDate } })} />
          </Section>
        )}

        <Section title="Order and size">
          <div className="grid grid-cols-2 gap-1.5">
            <Field label="Sort by">{(id) => <SelectInput id={id} value={q.sort?.[0]?.key ?? ""} options={[{ value: "", label: "Default" }, ...outKeys]} onChange={(key) => set({ sort: key ? [{ key, dir: q.sort?.[0]?.dir ?? "desc" }] : [] })} />}</Field>
            <Field label="Direction">{(id) => <SelectInput id={id} disabled={!q.sort?.[0]} value={q.sort?.[0]?.dir ?? "desc"} options={[{ value: "desc", label: "Largest first" }, { value: "asc", label: "Smallest first" }]} onChange={(dir) => set({ sort: q.sort?.[0] ? [{ key: q.sort[0].key, dir: dir as "asc" | "desc" }] : [] })} />}</Field>
          </div>
          <Field label="Maximum rows" hint={`Up to ${ds.maxRows.toLocaleString("en-IN")} for this dataset.`}>{(id) => <NumberInput id={id} min={1} max={ds.maxRows} value={q.limit} placeholder="500" onChange={(limit) => set({ limit })} />}</Field>
        </Section>
      </>}
    </div>
  );
}
