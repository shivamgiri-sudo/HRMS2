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
import { MultiSelectFilter } from "@/components/wfm/console/MultiSelectFilter";
import { LOB_NONE } from "@/components/wfm/LobSelect";
import { useProcessLobOptions } from "@/hooks/useProcessLobMap";
import { useLOBs } from "@/hooks/useOrgMasters";
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

/** Console filters carry several ids as one comma-separated string (the same shape the API takes). */
const toList = (csv: string): string[] => csv.split(",").map((x) => x.trim()).filter(Boolean);

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
  const branchList = toList(branchId);
  const processList = toList(processId);
  // The summary endpoint takes one branch; with several selected, ask for all and narrow here.
  const { data } = useWithoutLobSummary(branchList.length === 1 ? branchList[0] : undefined);
  if (!Array.isArray(data)) return null; // role-gated or failed: skip silently
  const byBranch = branchList.length > 1 ? data.filter((r) => branchList.includes(String((r as { branch_id?: string }).branch_id ?? ""))) : data;
  const rows = processList.length ? byBranch.filter((r) => processList.includes(r.process_id)) : byBranch;
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
    queryKey: ["roster-console", "console-options", filters.from],
    queryFn: () => hrmsApi.get<ConsoleOptions>(`/api/roster-intelligence/console-options?from=${encodeURIComponent(filters.from)}`),
    staleTime: 5 * 60_000,
  });
  const orgWide = opts?.orgWide ?? true;
  const branches = opts?.branches ?? [];
  // The Process list follows the selected branch, so a process from another branch can never be picked.
  const selBranches = toList(filters.branchId);
  const selProcesses = toList(filters.processId);
  const selLobs = toList(filters.lobId);
  // LOB choices: the mapped LOBs of the process when exactly one is picked, else every active LOB.
  const processLobs = useProcessLobOptions(selProcesses.length === 1 ? selProcesses[0] : "");
  const orgLobs = useLOBs();
  const lobOptions = [
    ...((selProcesses.length === 1 && processLobs.data
      ? processLobs.data.options.map((o) => ({ value: o.lob_id, label: o.lob_name }))
      : ((orgLobs.data as Array<{ id: string; lob_name?: string }> | undefined) ?? []).map((l) => ({ value: l.id, label: l.lob_name ?? l.id })))),
    { value: LOB_NONE, label: "Unassigned (no LOB)" },
  ];
  const processes = (opts?.processes ?? []).filter((p) => selBranches.length === 0 || !p.branch_id || selBranches.includes(p.branch_id));

  // A scoped user has no meaningful "All": pick their branch (or, with no branch, their process) by default,
  // and drop a stale selection that is no longer one of their options.
  useEffect(() => {
    if (!opts || opts.orgWide) return;
    if (selBranches.some((id) => !opts.branches.some((b) => b.id === id))) { setBranchId(selBranches.filter((id) => opts.branches.some((b) => b.id === id)).join(",")); return; }
    if (!filters.branchId && opts.branches.length > 0) { setBranchId(opts.branches[0].id); return; }
    if (!filters.branchId && opts.branches.length === 0 && !filters.processId && opts.processes.length > 0) setProcessId(opts.processes[0].id);
  }, [opts, filters.branchId, filters.processId, setBranchId, setProcessId]);
  // Changing branch can orphan the chosen process: clear it when it no longer belongs.
  useEffect(() => {
    if (opts && selProcesses.length && selBranches.length && selProcesses.some((id) => !processes.some((p) => p.id === id))) {
      setProcessId(selProcesses.filter((id) => processes.some((p) => p.id === id)).join(","));
    }
  }, [opts, filters.processId, filters.branchId, processes, setProcessId]); // eslint-disable-line react-hooks/exhaustive-deps

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
            <MultiSelectFilter
              id="rcc-branch" className={CONTROL} noun="branches"
              allLabel={orgWide ? "All branches" : "Select branches"}
              options={branches.map((b) => ({ value: b.id, label: b.branch_name }))}
              selected={selBranches}
              onChange={(ids) => setBranchId(ids.join(","))}
            />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className={LABEL} htmlFor="rcc-process">Process</label>
            <MultiSelectFilter
              id="rcc-process" className={CONTROL} noun="processes"
              allLabel="All processes"
              options={processes.map((p) => ({ value: p.id, label: p.process_name }))}
              selected={selProcesses}
              onChange={(ids) => setProcessId(ids.join(","))}
            />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className={LABEL} htmlFor="rcc-lob">LOB</label>
            <MultiSelectFilter
              id="rcc-lob" className={CONTROL} noun="LOBs"
              allLabel="All LOBs"
              options={lobOptions}
              selected={selLobs}
              onChange={(ids) => setLobId(ids.join(","))}
            />
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
