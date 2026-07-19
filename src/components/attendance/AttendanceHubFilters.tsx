import { useEffect, useRef } from "react";
import { AlertTriangle, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useAttendanceHubFilterOptions,
  type HubFilters,
  type SelectOption,
} from "@/hooks/useAttendanceHub";
import { getDependentAttendanceFilterChange } from "./attendanceFilterState";

interface Props {
  filters: HubFilters;
  onChange: (partial: Partial<HubFilters>) => void;
  month: string;
  onMonthChange: (month: string) => void;
}

function FilterSelect({
  placeholder,
  value,
  options,
  onValueChange,
  disabled = false,
}: {
  placeholder: string;
  value: string;
  options: SelectOption[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value || "__all__"}
      onValueChange={(next) => onValueChange(next === "__all__" ? "" : next)}
      disabled={disabled}
    >
      <SelectTrigger className="h-9 w-full min-w-0 border-slate-200 bg-white text-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">{placeholder}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function AttendanceHubFilters({ filters, onChange, month, onMonthChange }: Props) {
  const searchRef = useRef<HTMLInputElement>(null);
  const { data: options, isLoading, isFetching } = useAttendanceHubFilterOptions(
    filters.branchId,
    filters.processId,
    filters.designationId,
  );
  const optionsLoading = isLoading || isFetching;

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      const tag = document.activeElement?.tagName;
      if (event.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }

    document.addEventListener("keydown", focusSearch);
    return () => document.removeEventListener("keydown", focusSearch);
  }, []);

  const hasActiveFilters = Boolean(
    filters.search ||
    filters.branchId ||
    filters.processId ||
    filters.designationId ||
    filters.status ||
    filters.anomalyOnly,
  );

  function clearAll() {
    onChange({
      search: "",
      branchId: "",
      processId: "",
      designationId: "",
      status: "",
      anomalyOnly: false,
      page: 1,
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-[minmax(220px,1.5fr)_150px_repeat(4,minmax(130px,1fr))_auto_auto]">
        <div className="relative sm:col-span-2 lg:col-span-2 2xl:col-span-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            ref={searchRef}
            value={filters.search}
            onChange={(event) => onChange({ search: event.target.value, page: 1 })}
            placeholder="Search name or code (press /)"
            className="h-9 border-slate-200 pl-9 pr-8 text-sm"
          />
          {filters.search ? (
            <button
              type="button"
              onClick={() => onChange({ search: "", page: 1 })}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        <input
          type="month"
          value={month}
          onChange={(event) => onMonthChange(event.target.value)}
          aria-label="Attendance month"
          className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1B6AB5]/30"
        />

        <FilterSelect
          placeholder="All Branches"
          value={filters.branchId}
          options={options?.branches ?? []}
          onValueChange={(value) => onChange(getDependentAttendanceFilterChange("branchId", value))}
          disabled={optionsLoading}
        />
        <FilterSelect
          placeholder="All Processes"
          value={filters.processId}
          options={options?.processes ?? []}
          onValueChange={(value) => onChange(getDependentAttendanceFilterChange("processId", value))}
          disabled={optionsLoading}
        />
        <FilterSelect
          placeholder="All Designations"
          value={filters.designationId}
          options={options?.designations ?? []}
          onValueChange={(value) => onChange(getDependentAttendanceFilterChange("designationId", value))}
          disabled={optionsLoading}
        />
        <FilterSelect
          placeholder="All Statuses"
          value={filters.status}
          options={options?.statuses ?? []}
          onValueChange={(value) => onChange({ status: value, page: 1 })}
          disabled={optionsLoading}
        />

        <button
          type="button"
          onClick={() => onChange({ anomalyOnly: !filters.anomalyOnly, page: 1 })}
          className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors ${
            filters.anomalyOnly
              ? "border-rose-300 bg-rose-50 text-rose-700"
              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Anomalies
        </button>

        {hasActiveFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAll}
            className="h-9 px-2 text-xs text-slate-500"
          >
            <X className="mr-1 h-3 w-3" />
            Clear
          </Button>
        ) : (
          <div className="hidden 2xl:block" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
