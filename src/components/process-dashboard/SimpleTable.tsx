import { DASH, formatValue } from "./format";
import { FOCUS } from "./ui";

export interface SimpleCol { key: string; label: string; unit?: string; align?: "left" | "right"; render?: (r: Record<string, unknown>) => React.ReactNode }

/** Small accessible table; when onRow is given the first cell becomes a real button (keyboard reachable). */
export function SimpleTable({ cols, rows, caption, onRow, rowLabel, maxHeight }: {
  cols: SimpleCol[]; rows: Array<Record<string, unknown>>; caption: string; onRow?: (r: Record<string, unknown>) => void; rowLabel?: (r: Record<string, unknown>) => string; maxHeight?: string;
}) {
  return (
    <div className={`overflow-auto rounded-xl border border-slate-200 bg-white ${maxHeight ?? ""}`}>
      <table className="w-full text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-slate-50 text-slate-700"><tr>
          {cols.map((c) => <th key={c.key} scope="col" className={`whitespace-nowrap px-3 py-2 font-semibold ${c.align === "left" ? "text-left" : "text-right"}`}>{c.label}</th>)}
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-slate-50">
              {cols.map((c, ci) => {
                const raw = r[c.key];
                const content = c.render ? c.render(r) : typeof raw === "number" ? formatValue(raw, c.unit) : raw == null || raw === "" ? DASH : String(raw);
                return <td key={c.key} className={`whitespace-nowrap px-3 py-1.5 tabular-nums text-slate-800 ${c.align === "left" ? "text-left" : "text-right"}`}>
                  {ci === 0 && onRow ? <button type="button" onClick={() => onRow(r)} aria-label={rowLabel?.(r)} className={`cursor-pointer rounded font-semibold text-blue-800 underline-offset-2 hover:underline ${FOCUS}`}>{content}</button> : content}
                </td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
