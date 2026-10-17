import { useEffect, useState } from "react";
import { Inbox } from "lucide-react";
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
import { OpsQualityVisual } from "./sections/OpsQualityVisual";
import { DataHealthChips } from "./sections/DataHealthChips";
import type { VisualProps } from "./sections/shared";
import type { DrillTarget, KpiId } from "./drill";
import { DrillHost, useDrillHost, type DrillHostApi } from "./drill/DrillHost";
import { drillResetKey } from "./drill/history";
import { BranchHeadControls } from "./BranchHeadControls";
import { BranchOverviewTop } from "./BranchOverviewTop";
import { BH_SECTIONS, BranchHero, panelDomId, tabDomId } from "./BranchHero";
import { StatusChip } from "./StatusChip";
import { BhCard } from "./ui";
import { downloadBranchHealthExcel } from "./excelExport";
import { toast } from "sonner";

/** Section clicks and KPI tiles of one branch overview open the drill host for that branch. */
export function drillHandlers(open: DrillHostApi["open"], branchId: string) {
  return {
    onSelect: (target: DrillTarget) => open(target, branchId),
    onOpenKpi: (kpi: KpiId) => open({ kind: "metric", id: kpi }, branchId),
  };
}

type Visual = (p: VisualProps) => JSX.Element | null;

/** Tab id -> the visual that fills it (Overview and Processes are built inline). */
const VISUALS: Record<string, Visual> = {
  people: PeopleVisual, attendance: AttendanceVisual, attrition: AttritionVisual, finance: FinanceVisual,
  pnl: ProcessPnlVisual, hiring: HiringVisual, backlog: BacklogVisual, ops: OpsQualityVisual,
};

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
  /** Tab shown first; defaults to the overview. */
  initialTab?: string;
  /** Finance sub-tab shown first (budget, grn, recent, pnl). */
  initialSub?: string;
}

/** "Generated 10:30" from the payload timestamp; empty when it does not parse. */
export function freshnessText(generatedAt: string | undefined): string {
  const t = generatedAt ? Date.parse(generatedAt) : Number.NaN;
  if (!Number.isFinite(t)) return "";
  return `Generated ${new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

export function BranchHeadReferenceLayout({ data, branchOptions, selectedBranchId = "", onBranchChange, date, onDateChange, onRefresh, stale, initialTab = "overview", initialSub }: BranchHeadLayoutProps) {
  const options = branchOptions ?? data.branches.map((b) => b.branch);
  const branchNames = Object.fromEntries(options.map((o) => [o.branchId, o.branchName]));
  const single = data.branches.length === 1;
  const [tab, setTab] = useState(BH_SECTIONS.some((t) => t.id === initialTab) ? initialTab : "overview");
  const [sub, setSub] = useState(initialSub ?? "budget");
  const go = (t: string, s?: string) => { setTab(t); if (s) setSub(s); };
  const host = useDrillHost();
  const { close } = host;
  // Another branch, date or branch list closes the drawer (its view would belong to the old data).
  const resetKey = drillResetKey(selectedBranchId, date, data.branches.map((b) => b.branch.branchId));
  useEffect(() => { close(); }, [resetKey, close]);

  const first = data.branches[0];
  const heroName = single ? first.branch.branchName : data.branches.length === 0 ? "No branch" : `${data.branches.length} branches`;
  const showProcesses = data.branches.length > 0 || Boolean(data.processesError);
  const onDownload = single ? () => {
    try { downloadBranchHealthExcel(first); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not build the Excel file"); }
  } : undefined;
  const downloadHint = single ? undefined : data.branches.length > 1 ? "Pick one branch to download its report" : undefined;

  return (
    <div className="space-y-4">
      <BranchHero branchName={heroName} status={single ? first.overview.status : undefined} date={first?.overview.date ?? date}
        homeFallback={data.scope.viaHomeFallback} activeTab={tab} onTabChange={setTab}
        controls={<BranchHeadControls variant="hero" options={options} selectedBranchId={selectedBranchId} onBranchChange={onBranchChange} date={date ?? first?.overview.date}
          onDateChange={onDateChange} onRefresh={onRefresh} onDownload={onDownload} downloadHint={downloadHint} stale={stale} freshness={freshnessText(data.generatedAt)} />} />

      {data.scope.emptyReason ? (
        <BhCard title="Nothing to show" icon={Inbox}><p className="text-[14px] text-slate-800">{data.scope.emptyReason}</p></BhCard>
      ) : null}

      <div role="tabpanel" id={panelDomId(tab)} aria-labelledby={tabDomId(tab)} tabIndex={-1} className="space-y-4 focus:outline-none">
        {tab === "processes" ? (
          showProcesses ? (
            <div className="space-y-4">
              <DataHealthChips section={data.dataHealth} />
              <ProcessCoveragePanel active={data.processes.active} unmapped={data.processes.unmapped} selectedBranchId={selectedBranchId} branchNames={branchNames} error={data.processesError} />
            </div>
          ) : null
        ) : data.branches.map(({ branch, overview, score }) => {
          const { onSelect, onOpenKpi } = drillHandlers(host.open, branch.branchId);
          const Visual = VISUALS[tab];
          return (
            <section key={branch.branchId} aria-label={`${branch.branchName} health`} className="space-y-4">
              {!single && tab !== "overview" ? (
                <h2 className="flex items-center gap-2 border-b border-slate-200 pb-1 text-[16px] font-extrabold text-slate-900">{branch.branchName}<StatusChip status={overview.status} /></h2>
              ) : null}
              {tab === "overview" ? (
                <BranchOverviewTop branch={branch} overview={overview} score={score} onOpenKpi={onOpenKpi} onGo={go} />
              ) : Visual ? <Visual overview={overview} payload={data} onSelect={onSelect} sub={sub} onSubChange={setSub} /> : null}
            </section>
          );
        })}
      </div>

      <DrillHost host={host} data={data} branchNames={branchNames} />
    </div>
  );
}
