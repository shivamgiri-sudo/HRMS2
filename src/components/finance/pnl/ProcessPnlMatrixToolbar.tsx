import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ProcessPnlDensity,
  ProcessPnlIssueFilter,
  ProcessPnlMatrixPreset,
  ProcessPnlStatusFilter,
} from "@/components/finance/pnl/processPnlMatrixConfig";

export interface ProcessPnlMatrixToolbarProps {
  preset: ProcessPnlMatrixPreset;
  status: ProcessPnlStatusFilter;
  issue: ProcessPnlIssueFilter;
  density: ProcessPnlDensity;
  issueCounts: Record<ProcessPnlIssueFilter, number>;
  onPresetChange: (value: ProcessPnlMatrixPreset) => void;
  onStatusChange: (value: ProcessPnlStatusFilter) => void;
  onIssueChange: (value: ProcessPnlIssueFilter) => void;
  onDensityChange: (value: ProcessPnlDensity) => void;
}

const presets: Array<[ProcessPnlMatrixPreset, string]> = [
  ["summary", "Summary"],
  ["revenue", "Revenue"],
  ["cost", "Cost"],
  ["profitability", "Profitability"],
  ["budget-risk", "Budget & Risk"],
  ["full", "Full Matrix"],
];

const issues: Array<[ProcessPnlIssueFilter, string]> = [
  ["all", "All"],
  ["revenue-at-risk", "Revenue at risk"],
  ["delivery-missing", "Delivery missing"],
  ["budget-exceeded", "Budget exceeded"],
  ["high-receivable", "High receivable"],
  ["accounting-fallback", "Accounting fallback"],
];

export function ProcessPnlMatrixToolbar({
  preset,
  status,
  issue,
  density,
  issueCounts,
  onPresetChange,
  onStatusChange,
  onIssueChange,
  onDensityChange,
}: ProcessPnlMatrixToolbarProps) {
  return (
    <div className="mb-3 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Matrix view</p>
          <ToggleGroup
            type="single"
            value={preset}
            onValueChange={(value) => value && onPresetChange(value as ProcessPnlMatrixPreset)}
            className="mt-2 flex-wrap justify-start"
            aria-label="Matrix preset"
          >
            {presets.map(([value, label]) => (
              <ToggleGroupItem key={value} value={value} size="sm" aria-label={label}>
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            Status
            <Select value={status} onValueChange={(value) => onStatusChange(value as ProcessPnlStatusFilter)}>
              <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="profitable">Profitable</SelectItem>
                <SelectItem value="at-risk">At risk</SelectItem>
                <SelectItem value="loss-making">Loss making</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <ToggleGroup
            type="single"
            value={density}
            onValueChange={(value) => value && onDensityChange(value as ProcessPnlDensity)}
            aria-label="Matrix density"
          >
            <ToggleGroupItem value="comfortable" size="sm">Comfortable</ToggleGroupItem>
            <ToggleGroupItem value="compact" size="sm">Compact</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3" aria-label="Matrix issues">
        <span className="mr-1 text-xs font-semibold text-slate-500">Issues</span>
        {issues.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => onIssueChange(value)}
            aria-pressed={issue === value}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
              issue === value
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-400"
            }`}
          >
            {label} <span className="ml-1 opacity-70">{issueCounts[value]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
