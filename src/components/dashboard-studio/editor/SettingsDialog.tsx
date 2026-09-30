import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DashboardSettings, DatasetDef, Widget } from "../types";
import { Field, SelectInput, Toggle } from "./controls";

interface Doc { name: string; description: string | null; theme: string; settings: DashboardSettings; widgets: Widget[] }
interface Props { open: boolean; onClose: () => void; doc: Doc; datasets: DatasetDef[]; usedDatasets: string[]; onChange: (patch: Partial<Doc>) => void }

/** Dashboard-wide options: description, auto-refresh, click-to-filter, and which fields appear in the filter bar. */
export default function SettingsDialog({ open, onClose, doc, datasets, usedDatasets, onChange }: Props) {
  const s = doc.settings;
  const set = (patch: Partial<DashboardSettings>) => onChange({ settings: { ...s, ...patch } });
  const fields = new Map<string, string>();
  for (const code of usedDatasets) for (const f of datasets.find((d) => d.code === code)?.fields ?? []) if (f.role === "dimension" && !fields.has(f.fieldKey)) fields.set(f.fieldKey, f.label);
  const chosen = new Set((s.filterFields ?? []).map((f) => f.field));
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>Dashboard settings</DialogTitle><DialogDescription>These apply to the whole dashboard. Remember to save.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <Field label="Description">{(id) => <textarea id={id} rows={2} maxLength={500} value={doc.description ?? ""} onChange={(e) => onChange({ description: e.target.value || null })}
            className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600" />}</Field>
          <Field label="Refresh automatically">{(id) => <SelectInput id={id} value={String(s.autoRefreshSec ?? 0)} onChange={(v) => set({ autoRefreshSec: Number(v) || undefined })}
            options={[{ value: "0", label: "Off" }, { value: "60", label: "Every minute" }, { value: "300", label: "Every 5 minutes" }, { value: "900", label: "Every 15 minutes" }]} />}</Field>
          <Toggle label="Click a chart to filter the others" hint="Clicking a bar or slice filters every widget that has the same field." checked={s.crossFilter !== false} onChange={(crossFilter) => set({ crossFilter })} />
          <fieldset>
            <legend className="mb-1 text-xs font-semibold text-slate-700">Extra filters to show in the filter bar</legend>
            {!fields.size && <p className="text-xs text-slate-500">Add a widget first; its fields will be listed here.</p>}
            <div className="grid max-h-56 grid-cols-1 gap-1 overflow-auto sm:grid-cols-2">
              {[...fields].map(([field, label]) => (
                <Toggle key={field} label={label} checked={chosen.has(field)}
                  onChange={(on) => set({ filterFields: on ? [...(s.filterFields ?? []), { field, label }] : (s.filterFields ?? []).filter((f) => f.field !== field) })} />
              ))}
            </div>
          </fieldset>
        </div>
        <DialogFooter><button type="button" onClick={onClose} className="h-10 cursor-pointer rounded-md bg-blue-800 px-4 text-sm font-semibold text-white hover:bg-blue-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">Done</button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
