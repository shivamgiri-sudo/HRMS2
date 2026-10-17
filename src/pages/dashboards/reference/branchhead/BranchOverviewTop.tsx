import { useState } from "react";
import type { BranchHeadHealthPayload } from "../../../../../backend/src/modules/branch-head-health/types";
import { useBranchTrends } from "@/hooks/useBranchTrends";
import { HeroScore } from "./HeroScore";
import { KpiStrip } from "./KpiStrip";
import { KPI_TREND_METRICS, type KpiId } from "./kpiModel";
import { AttentionBoard } from "./AttentionBoard";
import { CoverageStrip } from "./CoverageStrip";
import { AccentCard } from "./look";

type BranchRow = BranchHeadHealthPayload["branches"][number];

const TREND_METRICS = ["score", ...KPI_TREND_METRICS];

export interface BranchOverviewTopProps extends BranchRow {
  /** KPI tile click: opens that metric in the drill-down host. */
  onOpenKpi: (kpi: KpiId) => void;
  /** Coverage strip: switch to a tab (and Finance sub-tab). */
  onGo?: (tab: string, sub?: string) => void;
}

/** Overview: score card, the 8 gradient KPI tiles, attention and wins (email section 11) and the report coverage strip. */
export function BranchOverviewTop({ branch, overview, score, onOpenKpi, onGo }: BranchOverviewTopProps) {
  const { data: trends } = useBranchTrends(branch.branchId || null, TREND_METRICS);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const n = overview.attention.length;
  return (
    <div className="space-y-4">
      <KpiStrip overview={overview} trends={trends} onOpen={onOpenKpi} />
      <HeroScore branch={branch} overview={overview} score={score} trend={trends.score} onOpenAttention={() => setAttentionOpen(true)} />
      <AccentCard title="Attention and wins" accent="rose" chip={`${n} to act on · ${overview.positives.length} going well`}>
        {/* Attention chips open this board's own drawer (full list with details), not the drill host. */}
        <AttentionBoard items={overview.attention} positives={overview.positives}
          drawerOpen={attentionOpen} onDrawerChange={setAttentionOpen} />
      </AccentCard>
      {onGo ? <CoverageStrip onGo={onGo} /> : null}
    </div>
  );
}
