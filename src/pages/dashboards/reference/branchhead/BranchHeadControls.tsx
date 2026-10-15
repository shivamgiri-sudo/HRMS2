import { Loader2, RefreshCw } from "lucide-react";
import type { HeadBranch } from "../../../../../backend/src/modules/branch-head-health/scope";

/** Date input and branch switcher. Rendered outside loading/error states so a bad date always has a way back. */
export function BranchHeadControls({ options, selectedBranchId = "", onBranchChange, date, onDateChange, onRefresh, stale }: {
  options: HeadBranch[];
  selectedBranchId?: string;
  onBranchChange?: (branchId: string) => void;
  date?: string;
  onDateChange?: (date: string) => void;
  onRefresh?: () => void;
  stale?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      {options.length >= 2 ? (
        <label className="text-[12px] font-semibold text-slate-800">
          Branch
          <select value={selectedBranchId} onChange={(e) => onBranchChange?.(e.target.value)}
            className="mt-1 block min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-[14px] text-slate-900">
            <option value="">All my branches</option>
            {options.map((b) => <option key={b.branchId} value={b.branchId}>{b.branchName}</option>)}
          </select>
        </label>
      ) : null}
      <label className="text-[12px] font-semibold text-slate-800">
        Date
        <input type="date" value={date ?? ""} onChange={(e) => onDateChange?.(e.target.value)}
          className="mt-1 block min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-[14px] text-slate-900" />
      </label>
      {onRefresh ? (
        <button type="button" onClick={onRefresh} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-900">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />Refresh
        </button>
      ) : null}
      {stale ? <span role="status" className="inline-flex min-h-[44px] items-center gap-1.5 text-[13px] text-slate-700"><Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />Updating, showing previous results</span> : null}
    </div>
  );
}
