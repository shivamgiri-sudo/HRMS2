import { FileDown, Loader2, RefreshCw } from "lucide-react";
import type { HeadBranch } from "../../../../../backend/src/modules/branch-head-health/scope";
import "./look/look.css";

/**
 * Date input and branch switcher. Rendered outside loading/error states so a bad date always has a way back.
 * `variant="hero"` is the white-on-navy form used inside the banner (labels above, white controls).
 */
export function BranchHeadControls({ options, selectedBranchId = "", onBranchChange, date, onDateChange, onRefresh, onDownload, downloadHint, stale, variant = "light", freshness }: {
  options: HeadBranch[];
  selectedBranchId?: string;
  onBranchChange?: (branchId: string) => void;
  date?: string;
  onDateChange?: (date: string) => void;
  onRefresh?: () => void;
  /** Download the shown branch's report as Excel; the button is disabled (with `downloadHint`) when absent. */
  onDownload?: () => void;
  /** Why download is unavailable, e.g. "Pick one branch"; the button is hidden when both are absent. */
  downloadHint?: string;
  stale?: boolean;
  variant?: "light" | "hero";
  /** Data-freshness chip text (hero only), e.g. "Data as of 10:30". */
  freshness?: string;
}) {
  if (variant === "hero") {
    return (
      <div className="flex flex-wrap items-end gap-2">
        {options.length >= 2 ? (
          <label className="min-w-[min(220px,100%)] flex-1">
            <span className="bhl-ctl-label">Branch</span>
            <select value={selectedBranchId} onChange={(e) => onBranchChange?.(e.target.value)} className="bhl-ctl block w-full cursor-pointer">
              <option value="">All my branches</option>
              {options.map((b) => <option key={b.branchId} value={b.branchId}>{b.branchName}</option>)}
            </select>
          </label>
        ) : null}
        <label>
          <span className="bhl-ctl-label">Date</span>
          <input type="date" value={date ?? ""} onChange={(e) => onDateChange?.(e.target.value)} className="bhl-ctl block cursor-pointer" />
        </label>
        {onRefresh ? (
          <button type="button" onClick={onRefresh} className="bhl-ghost"><RefreshCw className="h-4 w-4" aria-hidden="true" />Refresh</button>
        ) : null}
        {onDownload || downloadHint ? (
          <button type="button" onClick={onDownload} disabled={!onDownload} title={onDownload ? "Download this branch's health report as Excel" : downloadHint}
            className="bhl-ghost disabled:cursor-not-allowed disabled:opacity-60"><FileDown className="h-4 w-4" aria-hidden="true" />Download Excel</button>
        ) : null}
        {stale ? (
          <span role="status" className="bhl-fresh"><Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden="true" />Updating, showing previous results</span>
        ) : freshness ? <span className="bhl-fresh"><i aria-hidden="true" />{freshness}</span> : null}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {options.length >= 2 ? (
        <label className="flex items-center gap-2 text-[12px] font-semibold text-slate-700">
          Branch
          <select value={selectedBranchId} onChange={(e) => onBranchChange?.(e.target.value)}
            className="block min-h-[44px] rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-900 shadow-sm">
            <option value="">All my branches</option>
            {options.map((b) => <option key={b.branchId} value={b.branchId}>{b.branchName}</option>)}
          </select>
        </label>
      ) : null}
      <label className="flex items-center gap-2 text-[12px] font-semibold text-slate-700">
        Date
        <input type="date" value={date ?? ""} onChange={(e) => onDateChange?.(e.target.value)}
          className="block min-h-[44px] rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-900 shadow-sm" />
      </label>
      {onRefresh ? (
        <button type="button" onClick={onRefresh} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-200">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />Refresh
        </button>
      ) : null}
      {stale ? <span role="status" className="inline-flex min-h-[44px] items-center gap-1.5 text-[13px] text-slate-700"><Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />Updating, showing previous results</span> : null}
    </div>
  );
}
