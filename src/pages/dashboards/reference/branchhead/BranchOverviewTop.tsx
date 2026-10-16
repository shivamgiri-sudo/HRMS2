import { useState } from "react";
import { Panel } from "../../kit";
import type { BranchHeadHealthPayload } from "../../../../../backend/src/modules/branch-head-health/types";
import { useBranchTrends } from "@/hooks/useBranchTrends";
import { HeroScore } from "./HeroScore";
import { KpiStrip } from "./KpiStrip";
import { KPI_TREND_METRICS, type KpiId } from "./kpiModel";
import { AttentionBoard } from "./AttentionBoard";

type BranchRow = BranchHeadHealthPayload["branches"][number];

const TREND_METRICS = ["score", ...KPI_TREND_METRICS];

export interface BranchOverviewTopProps extends BranchRow {
  /** KPI tile click; Task 4 connects it to the drill-down host. */
  onOpenKpi: (kpi: KpiId) => void;
  /** Attention chip click (item id); Task 4 may route it to a metric drawer. */
  onOpenAttentionItem: (id: string) => void;
}

/** Per-branch top area: hero, KPI strip and attention board, sharing one trends fetch and the attention drawer. */
export function BranchOverviewTop({ branch, overview, score, onOpenKpi, onOpenAttentionItem }: BranchOverviewTopProps) {
  const { data: trends } = useBranchTrends(branch.branchId || null, TREND_METRICS);
  const [attentionOpen, setAttentionOpen] = useState(false);
  return (
    <div className="space-y-4">
      <HeroScore branch={branch} overview={overview} score={score} trend={trends.score} onOpenAttention={() => setAttentionOpen(true)} />
      <KpiStrip overview={overview} trends={trends} onOpen={onOpenKpi} />
      <Panel title="Attention and wins">
        <AttentionBoard items={overview.attention} positives={overview.positives} onOpenItem={onOpenAttentionItem}
          drawerOpen={attentionOpen} onDrawerChange={setAttentionOpen} />
      </Panel>
    </div>
  );
}
