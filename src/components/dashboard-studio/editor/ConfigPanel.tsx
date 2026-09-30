import { useState } from "react";
import type { DatasetDef, Widget } from "../types";
import { vizOf } from "../viz/registry";
import DataPanel from "./DataPanel";
import StylePanel from "./StylePanel";

interface Props { widget: Widget; datasets: DatasetDef[]; onChange: (patch: Partial<Widget>) => void; onChangeType: () => void }

/** Settings for the selected widget: what it shows (Data) and how it looks (Style). */
export default function ConfigPanel({ widget, datasets, onChange, onChangeType }: Props) {
  const def = vizOf(widget.widgetType);
  const [tab, setTab] = useState<"data" | "style">("data");
  if (!def) return <p className="p-3 text-sm text-slate-600">This chart type is no longer available. Remove the widget or change its type.</p>;
  const active = def.noQuery ? "style" : tab;
  return (
    <div>
      {!def.noQuery && (
        <div role="tablist" aria-label="Widget settings" className="grid grid-cols-2 border-b border-slate-200">
          {(["data", "style"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={active === t} onClick={() => setTab(t)}
              className={`h-10 cursor-pointer text-sm font-semibold capitalize transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600 ${active === t ? "border-b-2 border-blue-800 text-blue-900" : "text-slate-600 hover:text-slate-900"}`}>{t}</button>
          ))}
        </div>
      )}
      {active === "data" ? <DataPanel widget={widget} def={def} datasets={datasets} onChange={onChange} onChangeType={onChangeType} /> : <StylePanel widget={widget} def={def} onChange={onChange} />}
    </div>
  );
}
