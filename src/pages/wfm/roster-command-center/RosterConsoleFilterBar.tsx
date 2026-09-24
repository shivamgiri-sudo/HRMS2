/**
 * Sticky filter toolbar for the Roster Command Center: Branch, Process, LOB, date range +
 * presets, Reset, applied-filter chips, a per-tab "what this tab uses" line and a LOB
 * data-coverage hint. Option sources match the proven ones from TrendsPanel.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { FilterBar, type FilterChip } from "@/components/ui/filter-bar";
import { LobSelect } from "@/components/wfm/LobSelect";
import { useWithoutLobSummary } from "@/hooks/useProcessLobMap";
import { hrmsApi } from "@/lib/hrmsApi";
import { cn } from "@/lib/utils";
import { useRosterConsoleFilters } from "./RosterConsoleFilterContext";
import { DATE_PRESETS, activePreset, buildChips, describeTabFilters, presetRange } from "./filterState";

interface Process { id: string; process_name: string }
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

  const chips: FilterChip[] = buildChips(filters, {
    branch: branches.find((b) => b.id === filters.branchId)?.branch_name,
    process: processes.find((p) => p.id === filters.processId)?.process_name,
  }).map((c) => ({ key: c.key, label: c.label, value: c.value }));

  const removeChip = (key: string) => {
    if (key === "branchId") setBranchId("");
    else if (key === "processId") setProcessId("");
    else if (key === "lob") setLobId("");
    else if (key === "dates") {
      const r = presetRange("last14");
      setDateRange(r.from, r.to);
    }
  };

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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_9rem_9rem_auto]">
          <div>
            <label className={LABEL} htmlFor="rcc-branch">Branch</label>
            <Select value={filters.branchId || "__all__"} onValueChange={(v) => setBranchId(v === "__all__" ? "" : v)}>
              <SelectTrigger id="rcc-branch" className={CONTROL}><SelectValue placeholder="All branches" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All branches</SelectItem>
                {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className={LABEL} htmlFor="rcc-process">Process</label>
            <Select value={filters.processId || "__all__"} onValueChange={(v) => setProcessId(v === "__all__" ? "" : v)}>
              <SelectTrigger id="rcc-process" className={CONTROL}><SelectValue placeholder="All processes" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All processes</SelectItem>
                {processes.map((p) => <SelectItem key={p.id} value={p.id}>{p.process_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <span className={LABEL}>LOB</span>
            <LobSelect processId={filters.processId} value={filters.lobId} onChange={setLobId} includeUnassigned className={CONTROL} />
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
          <div className="flex items-end">
            <Button type="button" variant="outline" size="sm" className="h-9 w-full cursor-pointer" onClick={resetFilters}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Reset
            </Button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Date presets">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => {
                const r = presetRange(p.key);
                setDateRange(r.from, r.to);
              }}
              aria-pressed={preset === p.key}
              className={cn(
                "cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
                preset === p.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-white text-slate-700 hover:bg-muted",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {chips.length > 0 && <FilterBar className="mt-2" filters={chips} onRemove={removeChip} onClearAll={resetFilters} />}
        <p className="mt-2 text-xs font-medium text-slate-600">{describeTabFilters(activeTabKey)}</p>
        <LobCoverageHint branchId={filters.branchId} processId={filters.processId} />
      </section>
    </>
  );
}
