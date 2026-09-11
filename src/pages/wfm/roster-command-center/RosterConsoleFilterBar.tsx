/**
 * Shared global filter bar for the Roster Command Center console — Branch, Process,
 * From/To date range. Modeled directly on TrendsPanel.tsx's own FilterBar (the only one
 * of the 7 merged pages whose branch+process+date filters actually work end-to-end), so
 * the branch/process option sources and interaction pattern match what was already
 * proven correct rather than reinventing them.
 */
import { useQuery } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { hrmsApi } from "@/lib/hrmsApi";
import { useRosterConsoleFilters } from "./RosterConsoleFilterContext";

interface Process { id: string; process_name: string }
interface Branch { id: string; branch_name: string }

export function RosterConsoleFilterBar() {
  const { filters, setBranchId, setProcessId, setDateRange } = useRosterConsoleFilters();

  const { data: procData } = useQuery({
    queryKey: ["roster-console", "processes-list"],
    queryFn: () => hrmsApi.get<{ data: Process[] }>("/api/processes?limit=200"),
  });
  const { data: branchData } = useQuery({
    queryKey: ["roster-console", "branches-list"],
    queryFn: () => hrmsApi.get<{ branches: Branch[] }>("/api/wfm/roster-imports/branches"),
  });
  const processes = procData?.data ?? [];
  const branches = branchData?.branches ?? [];

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-white/40 bg-white/10 p-3 backdrop-blur-sm">
      <div className="min-w-[170px]">
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-white/70">Branch</label>
        <Select
          value={filters.branchId || "__all__"}
          onValueChange={(v) => setBranchId(v === "__all__" ? "" : v)}
        >
          <SelectTrigger className="h-9 w-full bg-white/90"><SelectValue placeholder="All branches" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All branches</SelectItem>
            {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="min-w-[190px]">
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-white/70">Process</label>
        <Select
          value={filters.processId || "__all__"}
          onValueChange={(v) => setProcessId(v === "__all__" ? "" : v)}
        >
          <SelectTrigger className="h-9 w-full bg-white/90"><SelectValue placeholder="All processes" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All processes</SelectItem>
            {processes.map((p) => <SelectItem key={p.id} value={p.id}>{p.process_name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-white/70">From</label>
        <Input
          type="date"
          className="h-9 w-[150px] bg-white/90"
          value={filters.from}
          onChange={(e) => setDateRange(e.target.value, filters.to)}
        />
      </div>
      <div>
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-white/70">To</label>
        <Input
          type="date"
          className="h-9 w-[150px] bg-white/90"
          value={filters.to}
          onChange={(e) => setDateRange(filters.from, e.target.value)}
        />
      </div>
    </div>
  );
}
