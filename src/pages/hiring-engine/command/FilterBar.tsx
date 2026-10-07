/** Filter bar: date range, requisition and branch selects, Reset. Edits go through the pure helpers in commandData.ts. */
import { RotateCcw } from "lucide-react";
import { applyBranchChange, applyDateChange, applyRequisitionChange, dateBounds, resetFilters, type RequisitionOption } from "./commandData";
import type { Filters } from "./driveCommandModel";

const FIELD = "min-h-11 w-full cursor-pointer rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 sm:min-h-9";
const LABEL = "mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-200";

export default function FilterBar({ filters, requisitions, branches, onChange }: { filters: Filters; requisitions: RequisitionOption[]; branches: string[]; onChange: (f: Filters) => void }) {
  const b = dateBounds(filters);
  // A hash can name a requisition or branch the option lists do not (yet) contain; keep it selectable.
  const reqKnown = !filters.requisitionId || requisitions.some((r) => r.id === filters.requisitionId);
  const branchKnown = !filters.branch || branches.includes(filters.branch);
  const visibleReqs = filters.branch ? requisitions.filter((r) => r.branch === filters.branch) : requisitions;
  return (
    <form role="search" aria-label="Drive filters" onSubmit={(e) => e.preventDefault()} className="grid grid-cols-2 items-end gap-3 py-3 sm:grid-cols-3 lg:grid-cols-6">
      <div>
        <label htmlFor="drive-filter-from" className={LABEL}>From</label>
        <input id="drive-filter-from" type="date" value={filters.from} min={b.from.min} max={b.from.max} onChange={(e) => onChange(applyDateChange(filters, "from", e.target.value))} className={FIELD} />
      </div>
      <div>
        <label htmlFor="drive-filter-to" className={LABEL}>To</label>
        <input id="drive-filter-to" type="date" value={filters.to} min={b.to.min} max={b.to.max} onChange={(e) => onChange(applyDateChange(filters, "to", e.target.value))} className={FIELD} />
      </div>
      <div className="col-span-2 lg:col-span-2">
        <label htmlFor="drive-filter-req" className={LABEL}>Requisition</label>
        <select id="drive-filter-req" value={filters.requisitionId ?? ""} onChange={(e) => onChange(applyRequisitionChange(filters, e.target.value))} className={FIELD}>
          <option value="">All requisitions</option>
          {!reqKnown && <option value={filters.requisitionId ?? ""}>Requisition {filters.requisitionId}</option>}
          {visibleReqs.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="drive-filter-branch" className={LABEL}>Branch</label>
        <select id="drive-filter-branch" value={filters.branch ?? ""} onChange={(e) => onChange(applyBranchChange(filters, e.target.value, requisitions))} className={FIELD}>
          <option value="">All branches</option>
          {!branchKnown && <option value={filters.branch ?? ""}>{filters.branch}</option>}
          {branches.map((br) => <option key={br} value={br}>{br}</option>)}
        </select>
      </div>
      <div>
        <button type="button" onClick={() => onChange(resetFilters())}
          className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 transition-colors duration-150 hover:bg-slate-50 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 sm:min-h-9">
          <RotateCcw className="h-4 w-4" aria-hidden /> Reset
        </button>
      </div>
    </form>
  );
}
