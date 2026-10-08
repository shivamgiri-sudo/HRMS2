import { useState } from "react";
import { CalendarDays, X } from "lucide-react";
import { useFieldValues, type ScopeOptions } from "./api";
import { DATE_PRESETS } from "./editor/DataPanel";
import MultiPick from "./MultiPick";
import type { RuntimeFilters } from "./model";
import type { DashboardSettings, DatasetDef, DatePreset } from "./types";

interface Props {
  settings: DashboardSettings; onSettings: (patch: Partial<DashboardSettings>) => void;
  runtime: RuntimeFilters; onRuntime: (next: RuntimeFilters) => void;
  scope: ScopeOptions | undefined; datasets: DatasetDef[]; usedDatasets: string[];
}

function FieldFilter({ field, label, dataset, selected, onChange }: { field: string; label: string; dataset: string | undefined; selected: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState("");
  const { data, isFetching } = useFieldValues(dataset, field, q);
  const opts = [...new Set([...(data ?? []), ...selected])].map((v) => ({ value: v, label: v }));
  return <MultiPick label={label} options={opts} selected={selected} onChange={onChange} onSearch={setQ} loading={isFetching && !data} />;
}

/** Dashboard-wide filters: dates, branch, process, any extra fields, and the click-to-filter selections. */
export default function FilterBar({ settings, onSettings, runtime, onRuntime, scope, datasets, usedDatasets }: Props) {
  const preset = settings.dateRange?.preset ?? "";
  const processes = (scope?.processes ?? []).filter((p) => !settings.branchIds?.length || (p.branchId && settings.branchIds.includes(p.branchId)));
  const datasetFor = (field: string) => usedDatasets.find((code) => datasets.find((d) => d.code === code)?.fields.some((f) => f.fieldKey === field));
  const active = !!settings.dateRange || !!settings.branchIds?.length || !!settings.processIds?.length || runtime.cross.length > 0 || Object.values(runtime.values).some((v) => v.length);

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden" role="group" aria-label="Dashboard filters">
      <label className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white pl-3 pr-1 text-sm text-slate-700">
        <CalendarDays className="h-4 w-4 text-slate-500" aria-hidden />
        <span className="sr-only">Date range for every widget</span>
        <select value={preset} aria-label="Date range for every widget" className="h-9 cursor-pointer bg-transparent pr-1 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
          onChange={(e) => { const p = e.target.value as DatePreset | ""; onSettings({ dateRange: !p ? undefined : p === "custom" ? { preset: "custom", from: "", to: "" } : { preset: p } }); }}>
          <option value="">Each widget's own dates</option>
          {DATE_PRESETS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
      </label>
      {preset === "custom" && <>
        <input type="date" aria-label="From date" value={settings.dateRange?.from ?? ""} onChange={(e) => onSettings({ dateRange: { preset: "custom", from: e.target.value, to: settings.dateRange?.to ?? "" } })} className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm" />
        <input type="date" aria-label="To date" value={settings.dateRange?.to ?? ""} onChange={(e) => onSettings({ dateRange: { preset: "custom", from: settings.dateRange?.from ?? "", to: e.target.value } })} className="h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm" />
      </>}
      {(scope?.branches.length ?? 0) > 1 && <MultiPick label="Branch" options={(scope?.branches ?? []).map((b) => ({ value: b.id, label: b.name }))} selected={settings.branchIds ?? []} onChange={(branchIds) => onSettings({ branchIds, processIds: [] })} />}
      {(scope?.processes.length ?? 0) > 1 && <MultiPick label="Process" options={processes.map((p) => ({ value: p.id, label: p.name }))} selected={settings.processIds ?? []} onChange={(processIds) => onSettings({ processIds })} />}
      {(settings.filterFields ?? []).map((f) => (
        <FieldFilter key={f.field} field={f.field} label={f.label} dataset={datasetFor(f.field)} selected={runtime.values[f.field] ?? []}
          onChange={(v) => onRuntime({ ...runtime, values: { ...runtime.values, [f.field]: v } })} />
      ))}
      {runtime.cross.map((c, i) => (
        <span key={`${c.field}-${i}`} className="inline-flex h-8 items-center gap-1 rounded-full bg-amber-100 pl-3 pr-1 text-xs font-semibold text-amber-900">
          {c.label}
          <button type="button" aria-label={`Remove filter ${c.label}`} onClick={() => onRuntime({ ...runtime, cross: runtime.cross.filter((_, j) => j !== i) })}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full hover:bg-amber-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-700"><X className="h-3.5 w-3.5" /></button>
        </span>
      ))}
      {active && <button type="button" onClick={() => { onSettings({ dateRange: undefined, branchIds: [], processIds: [] }); onRuntime({ values: {}, cross: [] }); }}
        className="h-10 cursor-pointer rounded-lg px-2 text-xs font-semibold text-slate-600 underline hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">Clear all</button>}
    </div>
  );
}
