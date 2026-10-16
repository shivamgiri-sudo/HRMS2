import { DataHealthPanel } from "./DataHealthPanel";
import { Home } from "lucide-react";
import { Panel, SectionTitle } from "../../kit";
import type { BranchHeadHealthPayload } from "../../../../../backend/src/modules/branch-head-health/types";
import type { HeadBranch } from "../../../../../backend/src/modules/branch-head-health/scope";
import { ProcessCoveragePanel } from "./ProcessCoveragePanel";
import { LeaderboardPanel } from "./SectionPanels";
import { CallmasterPanel } from "./CallmasterPanel";
import { OperationsPanel, QualityPanel } from "./OperationsPanel";
import { FinancePanel } from "./FinancePanel";
import { ProcessPnlPanel } from "./ProcessPnlPanel";
import { AttendanceDetailPanel } from "./AttendanceDetailPanel";
import { HeadcountPanel } from "./HeadcountPanel";
import { HiringPanel } from "./HiringPanel";
import { AttritionPanel } from "./AttritionPanel";
import { BacklogPanel } from "./BacklogPanel";
import { BranchHeadControls } from "./BranchHeadControls";
import { BranchOverviewTop } from "./BranchOverviewTop";
import { ANCHOR_OFFSET_CLASS, BH_SECTIONS, SectionNav } from "./SectionNav";

/** Drill-down hooks are wired to the drawer host in Task 4; until then tiles and chips open nothing extra. */
const NOOP = () => {};

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

      {data.branches.map(({ branch, overview, score }) => (
        <section key={branch.branchId} aria-label={`${branch.branchName} health`} className="space-y-4">
          <div id={anchor("bh-overview")} className={ANCHOR_OFFSET_CLASS}>
            <BranchOverviewTop branch={branch} overview={overview} score={score} onOpenKpi={NOOP} onOpenAttentionItem={NOOP} />
          </div>
          <div id={anchor("bh-finance")} className={ANCHOR_OFFSET_CLASS}><FinancePanel section={overview.finance} /></div>
          <div id={anchor("bh-pnl")} className={ANCHOR_OFFSET_CLASS}><ProcessPnlPanel section={overview.processPnl} /></div>
          <div id={anchor("bh-attendance")} className={ANCHOR_OFFSET_CLASS}><AttendanceDetailPanel section={overview.attendance} /></div>
          <div id={anchor("bh-people")} className={ANCHOR_OFFSET_CLASS}><HeadcountPanel section={overview.people} /></div>
          <div id={anchor("bh-hiring")} className={ANCHOR_OFFSET_CLASS}><HiringPanel section={overview.hiring} /></div>
          <AttritionPanel section={overview.attrition} />
          <BacklogPanel section={overview.backlogs} />
          <div id={anchor("bh-ops")} className={`space-y-4 ${ANCHOR_OFFSET_CLASS}`}>
            <LeaderboardPanel section={overview.leaderboard} />
            {overview.operations || overview.quality || overview.callmaster ? (() => {
              const panels = (
                <div className="space-y-4">
                  <OperationsPanel section={overview.operations} />
                  <QualityPanel section={overview.quality} />
                  <CallmasterPanel section={overview.callmaster} />
                </div>
              );
              return data.branches.length > 1 ? (
                <details data-group={`ops-${branch.branchId}`} className="rounded-lg border border-slate-200">
                  <summary className="flex min-h-[44px] cursor-pointer items-center px-3 text-[13px] font-bold text-slate-900">Operations, quality and Callmaster for {branch.branchName}</summary>
                  <div className="p-3">{panels}</div>
                </details>
              ) : panels;
            })() : null}
          </div>
        </section>
      ))}

      {data.branches.length > 0 || data.processesError ? (
        <>
          <SectionTitle>Processes</SectionTitle>
          <DataHealthPanel section={data.dataHealth} />
          <ProcessCoveragePanel active={data.processes.active} unmapped={data.processes.unmapped} selectedBranchId={selectedBranchId} branchNames={branchNames} error={data.processesError} />
        </>
      ) : null}
    </div>
  );
}
