/** A table of requisitions with their criteria badge (S20): Command Center section and campaign drawer share it. */
import { CompletenessBadge } from "./CriteriaSummary";
import { SMALL_BTN } from "./RuleRow";
import { listRows } from "./criteriaListModel";
import type { RequisitionItem } from "./selectionTypes";

export default function CriteriaListView({ items, selected, onSelect, now, caption }: { items: RequisitionItem[]; selected: string | null; onSelect: (id: string) => void; now: Date; caption: string }) {
  const rows = listRows(items, now);
  return (
    <div className="relative max-w-full overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
      <table className="w-full min-w-max text-left text-xs text-slate-900 dark:text-slate-100">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-slate-50 dark:bg-slate-800"><tr>
          <th scope="col" className="px-2 py-2">Requisition</th><th scope="col" className="px-2 py-2">Where</th><th scope="col" className="px-2 py-2">Status</th>
          <th scope="col" className="px-2 py-2">Criteria</th><th scope="col" className="px-2 py-2">Last change</th><th scope="col" className="px-2 py-2"><span className="sr-only">Open</span></th>
        </tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={r.id} className={`border-t border-slate-100 align-top dark:border-slate-800 ${selected === r.id ? "bg-blue-50 dark:bg-blue-950" : ""}`}>
            <th scope="row" className="px-2 py-1.5 font-semibold">{r.code}</th>
            <td className="px-2 py-1.5">{r.where}</td>
            <td className="px-2 py-1.5">{r.status}</td>
            <td className="px-2 py-1.5"><CompletenessBadge completeness={items[i].completeness} />{r.defaulted && <span className="mt-0.5 block max-w-xs whitespace-normal text-amber-800 dark:text-amber-200">{r.defaulted}</span>}</td>
            <td className="px-2 py-1.5">{r.version}</td>
            <td className="px-2 py-1.5"><button type="button" className={SMALL_BTN} aria-expanded={selected === r.id} aria-label={`Open criteria of ${r.code}`} onClick={() => onSelect(r.id)}>{selected === r.id ? "Close" : "Open"}</button></td>
          </tr>))}</tbody>
      </table>
    </div>
  );
}
