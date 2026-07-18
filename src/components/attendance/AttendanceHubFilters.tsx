import { useRef, useEffect } from "react";
import { Search, Filter, AlertTriangle, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import type { HubFilters, SelectOption } from "@/hooks/useAttendanceHub";
import { useBranchList, useProcessList, useDesignationList } from "@/hooks/useAttendanceHub";

interface Props {
  filters: HubFilters;
  onChange: (partial: Partial<HubFilters>) => void;
  month: string;
  onMonthChange: (m: string) => void;
}

function FilterSelect({
  placeholder,
  value,
  options,
  onValueChange,
}: {
  placeholder: string;
  value: string;
  options: SelectOption[];
  onValueChange: (v: string) => void;
}) {
  return (
    <Select value={value || "__all__"} onValueChange={v => onValueChange(v === "__all__" ? "" : v)}>
      <SelectTrigger className="h-9 min-w-[140px] text-xs border-slate-200">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">{placeholder}</SelectItem>
        {options.map(o => (
          <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function AttendanceHubFilters({ filters, onChange, month, onMonthChange }: Props) {
  const { data: branches = [] } = useBranchList();
  const { data: processes = [] } = useProcessList();
  const { data: designations = [] } = useDesignationList();

  const searchRef = useRef<HTMLInputElement>(null);

  // '/' keyboard shortcut focuses search
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const hasActiveFilters = filters.branchId || filters.processId || filters.designationId || filters.status || filters.anomalyOnly;

  function clearAll() {
    onChange({ branchId: "", processId: "", designationId: "", status: "", anomalyOnly: false, page: 1 });
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm p-4 shadow-sm space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <Input
            ref={searchRef}
            value={filters.search}
            onChange={e => onChange({ search: e.target.value, page: 1 })}
            placeholder="Search name or code… (press / )"
            className="pl-9 h-9 text-sm border-slate-200"
          />
          {filters.search && (
            <button
              type="button"
              onClick={() => onChange({ search: "", page: 1 })}
              className="absolute right-3 top-1/2 -translate-y-1/2"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5 text-slate-400 hover:text-slate-700" />
            </button>
          )}
        </div>

        {/* Month picker */}
        <input
          type="month"
          value={month}
          onChange={e => onMonthChange(e.target.value)}
          className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-3.5 w-3.5 text-slate-400 shrink-0" />

        <FilterSelect
          placeholder="All Branches"
          value={filters.branchId}
          options={branches}
          onValueChange={v => onChange({ branchId: v, page: 1 })}
        />
        <FilterSelect
          placeholder="All Processes"
          value={filters.processId}
          options={processes}
          onValueChange={v => onChange({ processId: v, page: 1 })}
        />
        <FilterSelect
          placeholder="All Designations"
          value={filters.designationId}
          options={designations}
          onValueChange={v => onChange({ designationId: v, page: 1 })}
        />
        <FilterSelect
          placeholder="All Statuses"
          value={filters.status}
          options={[
            { id: "Active", name: "Active" },
            { id: "Inactive", name: "Inactive" },
            { id: "On Notice", name: "On Notice" },
            { id: "Onboarding", name: "Onboarding" },
          ]}
          onValueChange={v => onChange({ status: v, page: 1 })}
        />

        {/* Anomaly toggle */}
        <button
          type="button"
          onClick={() => onChange({ anomalyOnly: !filters.anomalyOnly, page: 1 })}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
            filters.anomalyOnly
              ? "border-rose-300 bg-rose-50 text-rose-700"
              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Anomalies only
        </button>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearAll} className="text-xs text-slate-500 h-8 px-2">
            <X className="h-3 w-3 mr-1" />
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}
