import { useState } from "react";
import { ChevronDown, Info, X } from "lucide-react";
import type { BranchProcess } from "../../../../../backend/src/modules/branch-head-health/processes";
import { AccentCard, EmptyLine } from "./look";
import { CoverageTable, freshness, seatGap, sortWorstFirst } from "./processRows";
import { ProcessAgents } from "./processAgents";

export { CoverageBadge, coverageLabel, defaultDrillBranch, DrilldownTable, drillMetricFor, ProcessAgents } from "./processAgents";

/** Tile filters for the coverage table (Processes tab KPI tiles). */
export type CoverageFilter = "full" | "baseline" | "stale" | "over" | "unmapped";
const FILTER_WORDS: Record<CoverageFilter, string> = {
  full: "Full coverage", baseline: "Baseline only", stale: "Stale data", over: "Over mandate", unmapped: "Not mapped to a cost centre",
};

export function applyFilter(rows: BranchProcess[], f: CoverageFilter | null | undefined, asOf?: string): BranchProcess[] {
  if (f === "full" || f === "baseline") return rows.filter((p) => p.tier === f);
  if (f === "stale") return rows.filter((p) => freshness(p.latestMetricDate, asOf) === "stale");
  if (f === "over") return rows.filter((p) => seatGap(p).over > 0);
  return rows;
}

interface Shared { asOf?: string; branchNames: Record<string, string>; openId: string | null; onToggle: (p: BranchProcess) => void; onOpenProcess?: (p: BranchProcess) => void }

function Group({ id, title, note, rows, open, ...shared }: Shared & { id: string; title: string; note?: string; rows: BranchProcess[]; open?: boolean }) {
  if (rows.length === 0) return null;
  return (
    <details data-group={id} className="bh-fold mt-3" open={open}>
      <summary className="bh-fold-sum">
        <span>{title} ({rows.length})</span><ChevronDown className="bh-fold-chev h-4 w-4" aria-hidden="true" />
      </summary>
      <div className="px-3 pb-2">
        {note ? <p className="flex items-start gap-1.5 pb-2 text-[12px] text-slate-700"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{note}</p> : null}
        <CoverageTable caption={title} rows={sortWorstFirst(rows, shared.asOf)} {...shared} />
      </div>
    </details>
  );
}

export interface ProcessCoveragePanelProps {
  active: BranchProcess[];
  unmapped: BranchProcess[];
  selectedBranchId?: string;
  branchNames?: Record<string, string>;
  error?: boolean;
  /** Report date: data older than 14 days before it is stale. */
  asOf?: string;
  filter?: CoverageFilter | null;
  onClearFilter?: () => void;
  /** Opens the process drawer (process 360) for the row. */
  onOpenProcess?: (p: BranchProcess) => void;
}

export function ProcessCoveragePanel({ active, unmapped, selectedBranchId = "", branchNames = {}, error, asOf, filter, onClearFilter, onOpenProcess }: ProcessCoveragePanelProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const normal = active.filter((p) => !p.billingMirror);
  const mirrors = active.filter((p) => p.billingMirror);
  const shown = sortWorstFirst(applyFilter(normal, filter, asOf), asOf);
  const opened = [...active, ...unmapped].find((p) => p.processId === openId) ?? null;
  const shared: Shared = { asOf, branchNames, openId, onToggle: (p) => setOpenId((cur) => (cur === p.processId ? null : p.processId)), onOpenProcess };
  return (
    <AccentCard title="Process coverage" accent="violet" chip={`${normal.length} active · worst first`}>
      <p className="mb-2 text-[12px] text-slate-700">Which processes report quality and sales data. Agent names appear only when you open a process.</p>
      {error ? <p role="alert" className="mb-2 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[13px] text-amber-900"><Info className="h-4 w-4" aria-hidden="true" />Process coverage could not be loaded. Other sections are unaffected.</p> : null}
      {filter && filter !== "unmapped" ? (
        <p role="status" className="mb-2 flex flex-wrap items-center gap-2 text-[13px] text-slate-800">
          {`Showing ${shown.length} of ${normal.length}: ${FILTER_WORDS[filter]}`}
          {onClearFilter ? (
            <button type="button" onClick={onClearFilter} className="inline-flex min-h-[44px] items-center gap-1 rounded-lg px-2 font-semibold text-blue-900 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
              <X className="h-4 w-4" aria-hidden="true" />Clear filter
            </button>
          ) : null}
        </p>
      ) : null}
      {normal.length === 0 && !error ? <EmptyLine text="No active processes for this branch." /> : null}
      {normal.length > 0 ? <CoverageTable caption="Process coverage, worst first" rows={shown} {...shared} /> : null}
      {opened ? (
        <div id="bh-process-agents" className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="mb-2 text-[13px] font-bold text-slate-900">{`Agents - ${opened.processName}`}</p>
          <ProcessAgents p={opened} selectedBranchId={selectedBranchId} branchNames={branchNames} />
        </div>
      ) : null}
      <Group id="mirrors" title="Billing mirrors (BSS_*)" rows={mirrors} {...shared} />
      <Group id="unmapped" title="Not mapped to a cost centre" open={filter === "unmapped" || undefined}
        note="Most of these are idle billing mirrors with no cost centre; they are listed for completeness." rows={unmapped} {...shared} />
    </AccentCard>
  );
}
