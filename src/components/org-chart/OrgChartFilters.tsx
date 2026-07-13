import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";

export interface OrgChartFilterValues {
  branch_id?: string;
  process_id?: string;
  department_id?: string;
  designation_id?: string;
  status?: "active" | "inactive" | "all";
}

interface FilterOption {
  id: string;
  name: string;
}

interface OrgChartFiltersProps {
  filters: OrgChartFilterValues;
  onFiltersChange: (filters: OrgChartFilterValues) => void;
  availableBranches?: FilterOption[];
  availableProcesses?: FilterOption[];
  availableDepartments?: FilterOption[];
  availableDesignations?: FilterOption[];
  disabled?: boolean;
  showAllFilters?: boolean; // Show all filters (for company/branch/process scopes)
}

export function OrgChartFilters({
  filters,
  onFiltersChange,
  availableBranches = [],
  availableProcesses = [],
  availableDepartments = [],
  availableDesignations = [],
  disabled = false,
  showAllFilters = false,
}: OrgChartFiltersProps) {
  const activeFilterCount = [
    filters.branch_id,
    filters.process_id,
    filters.department_id,
    filters.designation_id,
    filters.status && filters.status !== "active",
  ].filter(Boolean).length;

  const updateFilter = (key: keyof OrgChartFilterValues, value: string | undefined) => {
    onFiltersChange({ ...filters, [key]: value === "all" ? undefined : value });
  };

  const clearFilters = () => {
    onFiltersChange({ status: "active" });
  };

  if (!showAllFilters) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Branch filter */}
      {availableBranches.length > 0 && (
        <Select
          value={filters.branch_id ?? "all"}
          onValueChange={(v) => updateFilter("branch_id", v)}
          disabled={disabled}
        >
          <SelectTrigger className="h-8 w-[130px] text-xs border-slate-200 rounded-lg">
            <SelectValue placeholder="All Branches" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Branches</SelectItem>
            {availableBranches.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Process filter */}
      {availableProcesses.length > 0 && (
        <Select
          value={filters.process_id ?? "all"}
          onValueChange={(v) => updateFilter("process_id", v)}
          disabled={disabled}
        >
          <SelectTrigger className="h-8 w-[140px] text-xs border-slate-200 rounded-lg">
            <SelectValue placeholder="All Processes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Processes</SelectItem>
            {availableProcesses.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Department filter */}
      {availableDepartments.length > 0 && (
        <Select
          value={filters.department_id ?? "all"}
          onValueChange={(v) => updateFilter("department_id", v)}
          disabled={disabled}
        >
          <SelectTrigger className="h-8 w-[140px] text-xs border-slate-200 rounded-lg">
            <SelectValue placeholder="All Departments" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Departments</SelectItem>
            {availableDepartments.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Designation filter */}
      {availableDesignations.length > 0 && (
        <Select
          value={filters.designation_id ?? "all"}
          onValueChange={(v) => updateFilter("designation_id", v)}
          disabled={disabled}
        >
          <SelectTrigger className="h-8 w-[140px] text-xs border-slate-200 rounded-lg">
            <SelectValue placeholder="All Designations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Designations</SelectItem>
            {availableDesignations.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Status filter */}
      <Select
        value={filters.status ?? "active"}
        onValueChange={(v) => updateFilter("status", v as "active" | "inactive" | "all")}
        disabled={disabled}
      >
        <SelectTrigger className="h-8 w-[110px] text-xs border-slate-200 rounded-lg">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="inactive">Inactive</SelectItem>
          <SelectItem value="all">All Status</SelectItem>
        </SelectContent>
      </Select>

      {/* Active filter count badge */}
      {activeFilterCount > 0 && (
        <Badge variant="secondary" className="h-8 px-2 text-xs">
          {activeFilterCount} {activeFilterCount === 1 ? "filter" : "filters"}
        </Badge>
      )}

      {/* Clear filters */}
      {activeFilterCount > 0 && (
        <button
          onClick={clearFilters}
          disabled={disabled}
          className="flex items-center gap-1 h-8 px-2 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Clear all filters"
        >
          <X className="h-3 w-3" />
          Clear
        </button>
      )}
    </div>
  );
}
