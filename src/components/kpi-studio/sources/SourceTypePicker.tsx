import { Database, FileSpreadsheet, Pencil, Plug, Server, Upload, type LucideIcon } from "lucide-react";
import { SOURCE_TYPES, type SourceType } from "./source-form";
import { focusRing } from "./form-bits";

const ICONS: Record<SourceType, LucideIcon> = {
  local_query: Database,
  named_pool: Server,
  integration_connector: Plug,
  google_sheet_csv: FileSpreadsheet,
  upload: Upload,
  manual: Pencil,
};

/** One card per kind of source the server supports. Behaves as a single-choice group. */
export function SourceTypePicker({ value, onChange }: { value: SourceType; onChange: (type: SourceType) => void }) {
  return (
    <div role="radiogroup" aria-label="Where the figures come from" className="grid gap-2 sm:grid-cols-2">
      {SOURCE_TYPES.map((type) => {
        const Icon = ICONS[type.value];
        const selected = value === type.value;
        return (
          <button
            key={type.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(type.value)}
            className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors ${focusRing} ${
              selected ? "border-indigo-500 bg-indigo-50" : "border-slate-200 bg-white hover:border-slate-300"
            }`}
          >
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${selected ? "text-indigo-600" : "text-slate-400"}`} aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-slate-900">{type.label}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{type.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
