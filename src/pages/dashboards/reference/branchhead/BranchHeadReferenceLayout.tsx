import { useEffect } from "react";
import { Home } from "lucide-react";
import { Panel, SectionTitle } from "../../kit";
import type { BranchHeadHealthPayload } from "../../../../../backend/src/modules/branch-head-health/types";
import type { HeadBranch } from "../../../../../backend/src/modules/branch-head-health/scope";
import { ProcessCoveragePanel } from "./ProcessCoveragePanel";
import { PeopleVisual } from "./sections/PeopleVisual";
import { AttendanceVisual } from "./sections/AttendanceVisual";
import { AttritionVisual } from "./sections/AttritionVisual";
import { FinanceVisual } from "./sections/FinanceVisual";
import { ProcessPnlVisual } from "./sections/ProcessPnlVisual";
import { HiringVisual } from "./sections/HiringVisual";
import { BacklogVisual } from "./sections/BacklogVisual";
import { DataHealthChips, OpsQualityVisual } from "./sections/OpsQualityVisual";
import type { VisualProps } from "./sections/shared";
import type { DrillTarget, KpiId } from "./drill";
import { DrillHost, useDrillHost, type DrillHostApi } from "./drill/DrillHost";
import { drillResetKey } from "./drill/history";
import { BranchHeadControls } from "./BranchHeadControls";
import { BranchOverviewTop } from "./BranchOverviewTop";
import { ANCHOR_OFFSET_CLASS, BH_SECTIONS, SectionNav } from "./SectionNav";

/** Section clicks and KPI tiles of one branch overview open the drill host for that branch. */
export function drillHandlers(open: DrillHostApi["open"], branchId: string) {
  return {
    onSelect: (target: DrillTarget) => open(target, branchId),
    onOpenKpi: (kpi: KpiId) => open({ kind: "metric", id: kpi }, branchId),
  };
}

/** Visual sections below the overview, in page (and SectionNav) order. */
const SECTIONS: Array<{ id: string; Visual: (p: VisualProps) => JSX.Element | null }> = [
  { id: "bh-people", Visual: PeopleVisual },
  { id: "bh-attendance", Visual: AttendanceVisual },
  { id: "bh-attrition", Visual: AttritionVisual },
  { id: "bh-finance", Visual: FinanceVisual },
  { id: "bh-pnl", Visual: ProcessPnlVisual },
  { id: "bh-hiring", Visual: HiringVisual },
  { id: "bh-backlog", Visual: BacklogVisual },
];

export interface BranchHeadLayoutProps {
  data: BranchHeadHealthPayload;
  /** Full branch list for the switcher; defaults to the branches in `data`. */
  branchOptions?: HeadBranch[];
  selectedBranchId?: string;
  onBranchChange?: (branchId: string) => void;
  date?: string;
  onDateChange?: (date: string) => void;
  onRefresh?: () => void;
  /** True while newer data is loading and the page still shows the previous result. */
  stale?: boolean;
}

export function BranchHeadReferenceLayout({ data, branchOptions, selectedBranchId = "", onBranchChange, date, onDateChange, onRefresh, stale }: BranchHeadLayoutProps) {
  const options = branchOptions ?? data.branches.map((b) => b.branch);
  const branchNames = Object.fromEntries(options.map((o) => [o.branchId, o.branchName]));
  // Anchor ids must be unique, so the section nav and its targets exist only for a single-branch view.
  const single = data.branches.length === 1;
  const anchor = (id: string) => (single ? id : undefined);
  const host = useDrillHost();
  const { close } = host;
  // Another branch, date or branch list closes the drawer (its view would belong to the old data).
  const resetKey = drillResetKey(selectedBranchId, date, data.branches.map((b) => b.branch.branchId));
  useEffect(() => { close(); }, [resetKey, close]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-extrabold text-slate-900">Branch health</h1>
          {data.scope.viaHomeFallback ? (
            <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-slate-700"><Home className="h-4 w-4" aria-hidden="true" />Showing your home branch</p>
          ) : null}
        </div>
        <BranchHeadControls options={options} selectedBranchId={selectedBranchId} onBranchChange={onBranchChange} date={date} onDateChange={onDateChange} onRefresh={onRefresh} stale={stale} />
      </header>

      {data.scope.emptyReason ? (
        <Panel title="Nothing to show"><p className="text-[14px] text-slate-800">{data.scope.emptyReason}</p></Panel>
      ) : null}

      {single ? <SectionNav sections={BH_SECTIONS} /> : null}

      {data.branches.map(({ branch, overview, score }) => {
        const { onSelect, onOpenKpi } = drillHandlers(host.open, branch.branchId);
        return (
        <section key={branch.branchId} aria-label={`${branch.branchName} health`} className="space-y-4">
          <div id={anchor("bh-overview")} className={ANCHOR_OFFSET_CLASS}>
            <BranchOverviewTop branch={branch} overview={overview} score={score} onOpenKpi={onOpenKpi} />
          </div>
          {SECTIONS.map(({ id, Visual }) => (
            <div key={id} id={anchor(id)} className={ANCHOR_OFFSET_CLASS}>
              <Visual overview={overview} payload={data} onSelect={onSelect} />
            </div>
          ))}
          <div id={anchor("bh-ops")} className={ANCHOR_OFFSET_CLASS}>
            {single ? <OpsQualityVisual overview={overview} payload={data} onSelect={onSelect} /> : (
              <details data-group={`ops-${branch.branchId}`} className="rounded-lg border border-slate-200">
                <summary className="flex min-h-[44px] cursor-pointer items-center px-3 text-[13px] font-bold text-slate-900">Operations, quality and Callmaster for {branch.branchName}</summary>
                <div className="p-3"><OpsQualityVisual overview={overview} payload={data} onSelect={onSelect} /></div>
              </details>
            )}
          </div>
        </section>
        );
      })}

      <DrillHost host={host} data={data} branchNames={branchNames} />

      {data.branches.length > 0 || data.processesError ? (
        <>
          <SectionTitle>Processes</SectionTitle>
          <DataHealthChips section={data.dataHealth} />
          <ProcessCoveragePanel active={data.processes.active} unmapped={data.processes.unmapped} selectedBranchId={selectedBranchId} branchNames={branchNames} error={data.processesError} />
        </>
      ) : null}
    </div>
  );
}
