import { DataHealthPanel } from "./DataHealthPanel";
import { Building2, Home } from "lucide-react";
import { Panel, SectionTitle } from "../../kit";
import type { BranchHeadHealthPayload } from "../../../../../backend/src/modules/branch-head-health/types";
import type { HeadBranch } from "../../../../../backend/src/modules/branch-head-health/scope";
import { AttentionList } from "./AttentionList";
import { ProcessCoveragePanel } from "./ProcessCoveragePanel";
import { LeaderboardPanel, SectionPanel } from "./SectionPanels";
import { StatusChip } from "./StatusChip";
import { BranchHeadControls } from "./BranchHeadControls";

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

      {data.branches.map(({ branch, overview, score }) => (
        <section key={branch.branchId} aria-label={`${branch.branchName} health`} className="space-y-4">
          <div className="kit-card flex flex-wrap items-center gap-3 p-4">
            <Building2 className="h-5 w-5 text-slate-700" aria-hidden="true" />
            <h2 className="min-w-0 flex-1 text-[16px] font-bold text-slate-900">{branch.branchName}</h2>
            <StatusChip status={overview.status} />
            <div className="text-right">
              <div className="text-[28px] font-extrabold leading-none text-slate-900">{score ? Math.round(score.score) : "—"}<span className="text-[13px] font-semibold text-slate-700">/100</span></div>
              <div className="text-[12px] text-slate-700">{score ? "Health score" : "Score unavailable"}</div>
            </div>
          </div>
          <Panel title="Attention and wins"><AttentionList attention={overview.attention} positives={overview.positives} /></Panel>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SectionPanel title="People" section={overview.people} />
            <SectionPanel title="Attendance" section={overview.attendance} />
            <SectionPanel title="Hiring" section={overview.hiring} />
            <SectionPanel title="Finance" section={overview.finance} />
          </div>
          <LeaderboardPanel section={overview.leaderboard} />
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
