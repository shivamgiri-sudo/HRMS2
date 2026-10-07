/** Sortable comparison of the three drive types with a CSV export (formula-safe toCsv; the file name carries the date range). */
import { useId, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Download } from "lucide-react";
import type { DriveAnalytics } from "../driveCommandTypes";
import { COMPARE_COLUMNS, sortCompareRows, toCsv } from "../driveCommandModel";
import { useIsDark } from "../chartTheme";
import { BTN, Note } from "./ChartFrame";
import { ShapeGlyph } from "./TypePatterns";
import { CSV_COLUMNS, EMPTY_TEXT, UNTRACKED_NOTE, compareCellText, compareCsvName, compareCsvRows, compareView } from "./summaryView";

type Dir = "asc" | "desc";
const SORT_BTN = "inline-flex min-h-11 w-full cursor-pointer items-center justify-end gap-1 rounded px-1 font-semibold transition-colors duration-150 hover:bg-slate-100 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-slate-800 sm:min-h-8";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function CompareTable({ analytics }: { analytics: DriveAnalytics }) {
  const dark = useIsDark();
  const titleId = `compare-types-title-${useId().replaceAll(":", "")}`;
  const [sort, setSort] = useState<{ key: string; dir: Dir } | null>(null);
  const v = compareView(analytics);
  const rows = sort ? sortCompareRows(v.rows, sort.key, sort.dir) : v.rows;
  const range = `${analytics?.window?.from ?? ""} to ${analytics?.window?.to ?? ""}`;
  const toggle = (key: string) => setSort((s) => (s?.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));
  return (
    <section aria-labelledby={titleId} className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={titleId} className="text-sm font-bold text-slate-900 dark:text-slate-100">Compare drive types</h3>
          <p className="text-xs text-slate-600 dark:text-slate-300">{`${range}. Show rate is arrived of confirmed; lead to join is joined of leads. Select a column heading to sort.`}</p>
        </div>
        <button type="button" className={BTN} aria-label={`Export the comparison as CSV for ${range}`}
          onClick={() => download(compareCsvName(analytics), toCsv(CSV_COLUMNS, compareCsvRows(rows)))}>
          <Download className="h-3.5 w-3.5" aria-hidden /> Export CSV
        </button>
      </div>
      {v.untracked && <Note>{UNTRACKED_NOTE}</Note>}
      {v.empty && <Note>{EMPTY_TEXT}</Note>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-xs text-slate-800 dark:text-slate-100">
          <caption className="sr-only">Drive types compared stage by stage, {range}</caption>
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th scope="col" className="px-2 py-1 text-left font-semibold">Drive type</th>
              {COMPARE_COLUMNS.map((c) => {
                const on = sort?.key === c.key;
                const Icon = !on ? ArrowUpDown : sort?.dir === "asc" ? ArrowUp : ArrowDown;
                return (
                  <th key={c.key} scope="col" aria-sort={on ? (sort?.dir === "asc" ? "ascending" : "descending") : "none"} className="px-1 py-1 text-right">
                    <button type="button" onClick={() => toggle(c.key)} className={SORT_BTN}>
                      {c.label}<Icon className="h-3 w-3 shrink-0" aria-hidden />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sourceType} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                <th scope="row" className="px-2 py-2 text-left font-semibold">
                  <span className="inline-flex items-center gap-1.5"><ShapeGlyph type={r.sourceType} dark={dark} />{r.label}</span>
                </th>
                {COMPARE_COLUMNS.map((c) => <td key={c.key} className="px-2 py-2 text-right tabular-nums">{compareCellText(c.kind, r.cells[c.key])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
