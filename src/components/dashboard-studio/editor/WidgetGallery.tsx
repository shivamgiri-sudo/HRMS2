import { vizByCategory } from "../viz/registry";
import type { VizDef } from "../viz/def";

/** The chart picker: every visualisation, grouped by what it is for. */
export default function WidgetGallery({ onPick, current }: { onPick: (def: VizDef) => void; current?: string }) {
  return (
    <div className="space-y-4">
      {vizByCategory().map((g) => (
        <div key={g.category}>
          <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">{g.category}</h4>
          <div className="grid grid-cols-2 gap-1.5">
            {g.items.map((v) => (
              <button key={v.type} type="button" onClick={() => onPick(v)} title={v.description} aria-pressed={current === v.type}
                className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs font-medium transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${current === v.type ? "border-blue-700 bg-blue-50 text-blue-900" : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50/50"}`}>
                <v.icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="leading-tight">{v.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
