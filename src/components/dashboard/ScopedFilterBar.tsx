import React, { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";
import { cn } from "@/lib/utils";

interface Branch {
  id: string;
  name: string;
}

interface Process {
  id: string;
  name: string;
  branch_id?: string;
}

const ALL_VALUE = "__all__";

export interface DateRange {
  from: string;
  to: string;
}

export interface ScopedFilterBarProps {
  onBranchChange: (id: string) => void;
  onProcessChange: (id: string) => void;
  onDateRangeChange: (range: DateRange) => void;
  showBranch?: boolean;
  showProcess?: boolean;
  showDateRange?: boolean;
  dashboardCode?: string;
  className?: string;
}

export function ScopedFilterBar({
  onBranchChange,
  onProcessChange,
  onDateRangeChange,
  showBranch = true,
  showProcess = true,
  showDateRange = true,
  dashboardCode,
  className,
}: ScopedFilterBarProps) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [loadingProcesses, setLoadingProcesses] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [selectedProcess, setSelectedProcess] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  useEffect(() => {
    if (!showBranch && !showProcess) return;
    setLoadingBranches(true);
    setLoadError(null);
    const url = dashboardCode
      ? `/api/dashboards/${dashboardCode}/filters`
      : "/api/org/branches";
    hrmsApi.get(url)
      .then((json) => {
        const payload = dashboardCode ? json.data ?? json : json;
        const list: Branch[] = Array.isArray(payload)
          ? payload
          : payload.branches ?? payload.data ?? [];
        setBranches(list);
        if (dashboardCode) {
          const processList: Process[] = Array.isArray(payload.processes) ? payload.processes : [];
          setProcesses(processList.map((process) => ({
            ...process,
            branch_id: process.branch_id ?? (process as Process & { branchId?: string }).branchId,
          })));
        }
      })
      .catch((error) => {
        setBranches([]);
        setProcesses([]);
        setLoadError(error instanceof Error ? error.message : "Unable to load scoped filters.");
      })
      .finally(() => setLoadingBranches(false));
  }, [dashboardCode, showBranch, showProcess]);

  useEffect(() => {
    if (!showProcess) return;
    if (dashboardCode) return;
    setLoadingProcesses(true);
    const url = selectedBranch
      ? `/api/org/processes?branch_id=${selectedBranch}`
      : "/api/org/processes";
    hrmsApi.get(url)
      .then((json) => {
        const list: Process[] = Array.isArray(json)
          ? json
          : json.processes ?? json.data ?? [];
        setProcesses(list);
      })
      .catch(() => setProcesses([]))
      .finally(() => setLoadingProcesses(false));
  }, [dashboardCode, showProcess, selectedBranch]);

  const visibleProcesses = selectedBranch
    ? processes.filter((process) => !process.branch_id || process.branch_id === selectedBranch)
    : processes;

  function handleBranchChange(value: string) {
    const normalized = value === ALL_VALUE ? "" : value;
    setSelectedBranch(normalized);
    setSelectedProcess("");
    onBranchChange(normalized);
    onProcessChange("");
  }

  function handleProcessChange(value: string) {
    const normalized = value === ALL_VALUE ? "" : value;
    setSelectedProcess(normalized);
    onProcessChange(normalized);
  }

  function handleDateFrom(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setDateFrom(val);
    onDateRangeChange({ from: val, to: dateTo });
  }

  function handleDateTo(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setDateTo(val);
    onDateRangeChange({ from: dateFrom, to: val });
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm",
        className
      )}
    >
      {showBranch && (
        loadingBranches ? (
          <Skeleton className="h-9 w-36" />
        ) : (
          <Select value={selectedBranch || ALL_VALUE} onValueChange={handleBranchChange}>
            <SelectTrigger className="h-9 w-40 text-sm">
              <SelectValue placeholder="All Branches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>All Branches</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      )}

      {loadError ? <p className="text-xs text-red-600" role="alert">Scoped filters unavailable: {loadError}</p> : null}

      {showProcess && (
        loadingProcesses ? (
          <Skeleton className="h-9 w-36" />
        ) : (
          <Select value={selectedProcess || ALL_VALUE} onValueChange={handleProcessChange}>
            <SelectTrigger className="h-9 w-44 text-sm">
              <SelectValue placeholder="All Processes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>All Processes</SelectItem>
              {visibleProcesses.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      )}

      {showDateRange && (
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 whitespace-nowrap">From</label>
          <Input
            type="date"
            value={dateFrom}
            onChange={handleDateFrom}
            className="h-9 w-36 text-sm"
          />
          <label className="text-xs text-slate-500">To</label>
          <Input
            type="date"
            value={dateTo}
            onChange={handleDateTo}
            className="h-9 w-36 text-sm"
          />
        </div>
      )}
    </div>
  );
}
