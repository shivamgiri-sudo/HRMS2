import { DataHealthPanel } from "./DataHealthPanel";
import { Building2, Home } from "lucide-react";
import { Panel, SectionTitle } from "../../kit";
import type { BranchHeadHealthPayload } from "../../../../../backend/src/modules/branch-head-health/types";
import type { HeadBranch } from "../../../../../backend/src/modules/branch-head-health/scope";
import { AttentionList } from "./AttentionList";
import { ProcessCoveragePanel } from "./ProcessCoveragePanel";
import { LeaderboardPanel } from "./SectionPanels";
import { CallmasterPanel } from "./CallmasterPanel";
import { OperationsPanel, QualityPanel } from "./OperationsPanel";
import { StatusChip } from "./StatusChip";
import { FinancePanel } from "./FinancePanel";
import { ProcessPnlPanel } from "./ProcessPnlPanel";
import { AttendanceDetailPanel } from "./AttendanceDetailPanel";
import { HeadcountPanel } from "./HeadcountPanel";
import { HiringPanel } from "./HiringPanel";
import { AttritionPanel } from "./AttritionPanel";
import { BacklogPanel } from "./BacklogPanel";
import { ScoreBand } from "./ScoreBand";
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
              {score ? <ScoreBand score={score.score} /> : null}
            </div>
            {score && (score.pillars.length > 0 || score.excluded.length > 0) ? (
              <div className="w-full border-t border-slate-100 pt-3 text-[13px] text-slate-800">
                <ul aria-label="Score breakdown" className="flex flex-wrap gap-x-5 gap-y-1">
                  {score.pillars.map((p) => (
                    <li key={p.key}>
                      <span className="font-semibold capitalize">{p.key.replace(/_/g, " ")}</span>{" "}
                      {p.score == null ? "not scored" : `${Math.round(p.score)}/100`} (weight {p.weight})
                    </li>
                  ))}
                </ul>
                {score.excluded.length > 0 ? (
                  <p className="mt-1">Not scored (no data): {score.excluded.join(", ")} - remaining weights renormalised</p>
                ) : null}
              </div>
            ) : null}
          </div>
          <Panel title="Attention and wins"><AttentionList attention={overview.attention} positives={overview.positives} /></Panel>
          <FinancePanel section={overview.finance} />
          <ProcessPnlPanel section={overview.processPnl} />
          <AttendanceDetailPanel section={overview.attendance} />
          <HeadcountPanel section={overview.people} />
          <HiringPanel section={overview.hiring} />
          <AttritionPanel section={overview.attrition} />
          <BacklogPanel section={overview.backlogs} />
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
