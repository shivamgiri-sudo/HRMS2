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
  className?: string;
}

export function ScopedFilterBar({
  onBranchChange,
  onProcessChange,
  onDateRangeChange,
  showBranch = true,
  showProcess = true,
  showDateRange = true,
  className,
}: ScopedFilterBarProps) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [loadingProcesses, setLoadingProcesses] = useState(false);

  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [selectedProcess, setSelectedProcess] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  useEffect(() => {
    if (!showBranch && !showProcess) return;
    setLoadingBranches(true);
    fetch("/api/org/branches")
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((json) => {
        const list: Branch[] = Array.isArray(json)
          ? json
          : json.branches ?? json.data ?? [];
        setBranches(list);
      })
      .catch(() => setBranches([]))
      .finally(() => setLoadingBranches(false));
  }, [showBranch, showProcess]);

  useEffect(() => {
    if (!showProcess) return;
    setLoadingProcesses(true);
    const url = selectedBranch
      ? `/api/org/processes?branch_id=${selectedBranch}`
      : "/api/org/processes";
    fetch(url)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((json) => {
        const list: Process[] = Array.isArray(json)
          ? json
          : json.processes ?? json.data ?? [];
        setProcesses(list);
      })
      .catch(() => setProcesses([]))
      .finally(() => setLoadingProcesses(false));
  }, [showProcess, selectedBranch]);

  function handleBranchChange(value: string) {
    setSelectedBranch(value);
    setSelectedProcess("");
    onBranchChange(value);
    onProcessChange("");
  }

  function handleProcessChange(value: string) {
    setSelectedProcess(value);
    onProcessChange(value);
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
          <Select value={selectedBranch} onValueChange={handleBranchChange}>
            <SelectTrigger className="h-9 w-40 text-sm">
              <SelectValue placeholder="All Branches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Branches</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      )}

      {showProcess && (
        loadingProcesses ? (
          <Skeleton className="h-9 w-36" />
        ) : (
          <Select value={selectedProcess} onValueChange={handleProcessChange}>
            <SelectTrigger className="h-9 w-44 text-sm">
              <SelectValue placeholder="All Processes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Processes</SelectItem>
              {processes.map((p) => (
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
