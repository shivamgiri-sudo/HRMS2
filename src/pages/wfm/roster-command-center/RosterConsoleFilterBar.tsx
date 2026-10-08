/**
 * Sticky scope toolbar for the Roster Command Center: Branch, Process, LOB and Reset on every
 * tab; the date range (preset dropdown + From/To) only on tabs that honour it; a LOB
 * data-coverage hint. Option sources match the proven ones from TrendsPanel.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { LobSelect } from "@/components/wfm/LobSelect";
import { useWithoutLobSummary } from "@/hooks/useProcessLobMap";
import { hrmsApi } from "@/lib/hrmsApi";
import { cn } from "@/lib/utils";
import { useRosterConsoleFilters } from "./RosterConsoleFilterContext";
import { DATE_PRESETS, TAB_FILTER_SUPPORT, activePreset, presetRange, type PresetKey } from "./filterState";

interface Process { id: string; process_name: string; branch_id?: string | null }
interface ConsoleOptions { orgWide: boolean; branches: Branch[]; processes: Process[] }
interface Branch { id: string; branch_name: string }

const LABEL = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-600";
const CONTROL = "h-9 w-full bg-white text-sm text-slate-900";
const DATE_INPUT =
  "h-9 w-full rounded-md border border-input bg-white px-2 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function useStuck() {
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { sentinel, stuck };
}

function LobCoverageHint({ branchId, processId }: { branchId: string; processId: string }) {
  const { data } = useWithoutLobSummary(branchId || undefined);
  if (!Array.isArray(data)) return null; // role-gated or failed: skip silently
  const rows = processId ? data.filter((r) => r.process_id === processId) : data;
  const n = rows.reduce((s, r) => s + Number(r.employees_without_lob || 0), 0);
  if (n <= 0) return null;
  return (
    <p className="mt-1 text-xs text-slate-600">
      {n.toLocaleString("en-IN")} employee{n === 1 ? " has" : "s have"} no LOB yet — assign in Process LOB Mapping.
    </p>
  );
}

export function RosterConsoleFilterBar({ activeTabKey }: { activeTabKey: string }) {
  const { filters, setBranchId, setProcessId, setLobId, setDateRange, resetFilters } = useRosterConsoleFilters();
  const { sentinel, stuck } = useStuck();

  // One feed for both dropdowns, limited server-side to the caller's branch / process scope. (It replaces
  // /api/processes, which returned every process in the company, and /api/wfm/roster-imports/branches, which
  // 403'd for branch heads and process managers.)
  const { data: opts } = useQuery({
    queryKey: ["roster-console", "console-options"],
    queryFn: () => hrmsApi.get<ConsoleOptions>("/api/roster-intelligence/console-options"),
    staleTime: 5 * 60_000,
  });
  const orgWide = opts?.orgWide ?? true;
  const branches = opts?.branches ?? [];
  // The Process list follows the selected branch, so a process from another branch can never be picked.
  const processes = (opts?.processes ?? []).filter((p) => !filters.branchId || !p.branch_id || p.branch_id === filters.branchId);

  // A scoped user has no meaningful "All": pick their branch (or, with no branch, their process) by default,
  // and drop a stale selection that is no longer one of their options.
  useEffect(() => {
    if (!opts || opts.orgWide) return;
    if (filters.branchId && !opts.branches.some((b) => b.id === filters.branchId)) { setBranchId(""); return; }
    if (!filters.branchId && opts.branches.length > 0) { setBranchId(opts.branches[0].id); return; }
    if (!filters.branchId && opts.branches.length === 0 && !filters.processId && opts.processes.length > 0) setProcessId(opts.processes[0].id);
  }, [opts, filters.branchId, filters.processId, setBranchId, setProcessId]);
  // Changing branch can orphan the chosen process: clear it when it no longer belongs.
  useEffect(() => {
    if (opts && filters.processId && filters.branchId && !processes.some((p) => p.id === filters.processId)) setProcessId("");
  }, [opts, filters.processId, filters.branchId, processes, setProcessId]);

  const usesDates = (TAB_FILTER_SUPPORT[activeTabKey] ?? []).includes("dates");
  const preset = activePreset(filters.from, filters.to);

  return (
    <>
      <div ref={sentinel} aria-hidden className="h-px" />
      <section
        aria-label="Roster filters"
        className={cn(
          "rounded-lg border border-border bg-card p-3 transition-shadow duration-200 motion-reduce:transition-none",
          stuck ? "shadow-md" : "shadow-sm",
        )}
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
          <div className="col-span-2 sm:col-span-1">
            <label className={LABEL} htmlFor="rcc-branch">Branch</label>
            <Select value={filters.branchId || "__all__"} onValueChange={(v) => setBranchId(v === "__all__" ? "" : v)}>
              <SelectTrigger id="rcc-branch" className={CONTROL}><SelectValue placeholder="All branches" /></SelectTrigger>
              <SelectContent>
                {orgWide && <SelectItem value="__all__">All branches</SelectItem>}
                {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className={LABEL} htmlFor="rcc-process">Process</label>
            <Select value={filters.processId || "__all__"} onValueChange={(v) => setProcessId(v === "__all__" ? "" : v)}>
              <SelectTrigger id="rcc-process" className={CONTROL}><SelectValue placeholder="All processes" /></SelectTrigger>
              <SelectContent>
                {(orgWide || !!filters.branchId) && <SelectItem value="__all__">All processes</SelectItem>}
                {processes.map((p) => <SelectItem key={p.id} value={p.id}>{p.process_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <span className={LABEL}>LOB</span>
            <LobSelect processId={filters.processId} value={filters.lobId} onChange={setLobId} includeUnassigned className={CONTROL} />
          </div>
          <div className="col-span-2 flex items-end sm:col-span-1">
            <Button type="button" variant="outline" size="sm" className="h-9 w-full cursor-pointer" onClick={resetFilters}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Reset
            </Button>
          </div>
        </div>
        {usesDates && (
          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 lg:grid-cols-[12rem_9rem_9rem]" role="group" aria-label="Date range">
            <div className="col-span-2 lg:col-span-1">
              <label className={LABEL} htmlFor="rcc-range">Date range</label>
              <Select
                value={preset ?? "custom"}
                onValueChange={(v) => {
                  if (v === "custom") return;
                  const r = presetRange(v as PresetKey);
                  setDateRange(r.from, r.to);
                }}
              >
                <SelectTrigger id="rcc-range" className={CONTROL}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DATE_PRESETS.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
                  <SelectItem value="custom" disabled={!!preset}>Custom range</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className={LABEL} htmlFor="rcc-from">From</label>
              <input
                id="rcc-from" type="date" value={filters.from} max={filters.to}
                onChange={(e) => e.target.value && setDateRange(e.target.value, filters.to)}
                className={DATE_INPUT}
              />
            </div>
            <div>
              <label className={LABEL} htmlFor="rcc-to">To</label>
              <input
                id="rcc-to" type="date" value={filters.to} min={filters.from}
                onChange={(e) => e.target.value && setDateRange(filters.from, e.target.value)}
                className={DATE_INPUT}
              />
            </div>
          </div>
        )}
        <LobCoverageHint branchId={filters.branchId} processId={filters.processId} />
      </section>
    </>
  );
}
