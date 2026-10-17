import { useState } from "react";
import { CheckCircle2, CircleSlash, Clock3, Layers, ShieldAlert, TrendingUp, Unlink } from "lucide-react";
import type { BranchHeadHealthPayload } from "../../../../../../backend/src/modules/branch-head-health/types";
import type { BranchProcess, CoverageTier } from "../../../../../../backend/src/modules/branch-head-health/processes";
import { formatCount } from "../format";
import { isStillCalculating } from "../pending";
import { ChartCard, DonutChart, GradientKpi, KpiCell, KpiGrid, PAL } from "../look";
import { ProcessCoveragePanel, coverageLabel, type CoverageFilter } from "../ProcessCoveragePanel";
import { freshness } from "../processRows";
import { DataHealthChips, OVER_MANDATE_ID } from "./DataHealthChips";

export const COVERAGE_ID = "bh-process-coverage";

/** Headline counts for the Processes tab; data-health counts are null when that section is not loaded. */
export function processKpis(processes: BranchHeadHealthPayload["processes"], dataHealth: BranchHeadHealthPayload["dataHealth"], asOf?: string) {
  const live = (processes?.active ?? []).filter((p) => !p.billingMirror);
  const dh = dataHealth?.status === "ok" ? dataHealth.data : null;
  return {
    active: live.length,
    mirrors: (processes?.active ?? []).length - live.length,
    full: live.filter((p) => p.tier === "full").length,
    baseline: live.filter((p) => p.tier === "baseline").length,
    stale: live.filter((p) => freshness(p.latestMetricDate, asOf) === "stale").length,
    unmapped: (processes?.unmapped ?? []).length,
    ccWithoutProcess: dh ? dh.costCentresWithoutProcess : null,
    overMandate: dh ? dh.overMandate.length : null,
    dhNote: dh ? null : dataHealth?.status === "error" && isStillCalculating(dataHealth.message) ? "Calculating" : "Data health unavailable",
  };
}

const TIERS: CoverageTier[] = ["full", "inbound_quality", "outbound_sale", "baseline", "not_wired"];
const TIER_COLORS: Record<CoverageTier, string> = { full: PAL.s3, inbound_quality: PAL.s1, outbound_sale: "#7c3aed", baseline: PAL.s4, not_wired: PAL.other };

export function coverageMix(active: BranchProcess[]) {
  const live = active.filter((p) => !p.billingMirror);
  return TIERS.map((t) => ({ key: t, label: coverageLabel(t), value: live.filter((p) => p.tier === t).length, color: TIER_COLORS[t] }));
}

function scrollTo(id: string) {
  if (typeof document !== "undefined") document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function ProcessKpiTiles({ k, onFilter }: { k: ReturnType<typeof processKpis>; onFilter: (f: CoverageFilter | null) => void }) {
  const pick = (f: CoverageFilter | null) => () => { onFilter(f); scrollTo(COVERAGE_ID); };
  const dhSub = (n: number | null, text: string) => (n == null ? k.dhNote ?? "" : text);
  return (
    <KpiGrid label="Process coverage summary" cols={4}>
      <KpiCell><GradientKpi icon={Layers} hue="navy" label="Active processes" value={formatCount(k.active)} sub="Excluding billing mirrors" onClick={k.active ? pick(null) : undefined} /></KpiCell>
      <KpiCell><GradientKpi icon={CheckCircle2} hue="emerald" label="Full coverage" value={formatCount(k.full)} sub={k.active ? `${Math.round((k.full / k.active) * 100)}% report quality and sales` : "No active processes"}
        onClick={k.full ? pick("full") : undefined} /></KpiCell>
      <KpiCell><GradientKpi icon={TrendingUp} hue="amber" label="Baseline only" value={formatCount(k.baseline)} sub={k.baseline ? "Headcount only, no quality feed" : "None"}
        status={k.baseline ? "warning" : null} onClick={k.baseline ? pick("baseline") : undefined} /></KpiCell>
      <KpiCell><GradientKpi icon={Clock3} hue="orange" label="Stale processes" value={formatCount(k.stale)} sub={k.stale ? "No new metric in 14+ days" : "All reporting processes current"}
        status={k.stale ? "warning" : null} onClick={k.stale ? pick("stale") : undefined} /></KpiCell>
      <KpiCell><GradientKpi icon={Unlink} hue="violet" label="Unmapped processes" value={formatCount(k.unmapped)} sub={k.unmapped ? "No cost centre; mostly idle mirrors" : "Every process has a cost centre"}
        status={k.unmapped ? "warning" : null} onClick={k.unmapped ? pick("unmapped") : undefined} /></KpiCell>
      <KpiCell><GradientKpi icon={CircleSlash} hue="slate" label="Cost centres without a process" value={formatCount(k.ccWithoutProcess)}
        sub={dhSub(k.ccWithoutProcess, k.ccWithoutProcess ? "Map them to a process to see their data" : "Every cost centre has a process")}
        status={k.ccWithoutProcess ? "warning" : null} /></KpiCell>
      <KpiCell><GradientKpi icon={ShieldAlert} hue="rose" label="Cost centres over mandate" value={formatCount(k.overMandate)}
        sub={dhSub(k.overMandate, k.overMandate ? "Headcount above mandated seats" : "None over mandate")}
        status={k.overMandate ? "critical" : null} onClick={k.overMandate ? () => scrollTo(OVER_MANDATE_ID) : undefined} /></KpiCell>
      <KpiCell><GradientKpi icon={Layers} hue="teal" label="Billing mirrors" value={formatCount(k.mirrors)} sub={k.mirrors ? "Idle BSS_* processes, listed last" : "None"} /></KpiCell>
    </KpiGrid>
  );
}

/** Processes tab: coverage tiles, coverage mix and cost centres over mandate, then the process coverage table. */
export function ProcessesTab({ data, selectedBranchId, branchNames, onOpenProcess }: {
  data: BranchHeadHealthPayload; selectedBranchId: string; branchNames: Record<string, string>; onOpenProcess?: (p: BranchProcess) => void;
}) {
  const [filter, setFilter] = useState<CoverageFilter | null>(null);
  const asOf = data.branches[0]?.overview.date;
  const k = processKpis(data.processes, data.dataHealth, asOf);
  const mix = coverageMix(data.processes?.active ?? []);
  return (
    <div className="space-y-4">
      <h2 className="sr-only">Processes and data health</h2>
      <ProcessKpiTiles k={k} onFilter={setFilter} />
      <div className="bhl-grid bhl-grid-2">
        <ChartCard title="Coverage mix" accent="violet" chip={`${formatCount(k.active)} active`}
          table={{ caption: "Active processes by coverage", columns: ["Coverage", "Processes"], rows: mix.map((m) => [m.label, formatCount(m.value)]) }}>
          <DonutChart label="Active processes by coverage" center={formatCount(k.active)} centerLabel="Active" height={240} slices={mix} format={formatCount} />
        </ChartCard>
        <DataHealthChips section={data.dataHealth} />
      </div>
      <div id={COVERAGE_ID} className="scroll-mt-4">
        <ProcessCoveragePanel active={data.processes.active} unmapped={data.processes.unmapped} selectedBranchId={selectedBranchId} branchNames={branchNames}
          error={data.processesError} asOf={asOf} filter={filter} onClearFilter={() => setFilter(null)} onOpenProcess={onOpenProcess} />
      </div>
    </div>
  );
}
