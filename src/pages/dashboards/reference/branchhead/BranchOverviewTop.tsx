import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { BhCard } from "./ui";
import type { BranchHeadHealthPayload } from "../../../../../backend/src/modules/branch-head-health/types";
import { useBranchTrends } from "@/hooks/useBranchTrends";
import { HeroScore } from "./HeroScore";
import { KpiStrip } from "./KpiStrip";
import { KPI_TREND_METRICS, type KpiId } from "./kpiModel";
import { AttentionBoard } from "./AttentionBoard";

type BranchRow = BranchHeadHealthPayload["branches"][number];

const TREND_METRICS = ["score", ...KPI_TREND_METRICS];

export interface BranchOverviewTopProps extends BranchRow {
  /** KPI tile click: opens that metric in the drill-down host. */
  onOpenKpi: (kpi: KpiId) => void;
}

/** Per-branch top area: hero, KPI strip and attention board, sharing one trends fetch and the attention drawer. */
export function BranchOverviewTop({ branch, overview, score, onOpenKpi }: BranchOverviewTopProps) {
  const { data: trends } = useBranchTrends(branch.branchId || null, TREND_METRICS);
  const [attentionOpen, setAttentionOpen] = useState(false);
  return (
    <div className="space-y-4">
      <HeroScore branch={branch} overview={overview} score={score} trend={trends.score} onOpenAttention={() => setAttentionOpen(true)} />
      <KpiStrip overview={overview} trends={trends} onOpen={onOpenKpi} />
      <BhCard title="Attention and wins" icon={ShieldAlert} tone="rose">
        {/* Attention chips open this board's own drawer (full list with details), not the drill host. */}
        <AttentionBoard items={overview.attention} positives={overview.positives}
          drawerOpen={attentionOpen} onDrawerChange={setAttentionOpen} />
      </BhCard>
    </div>
  );
}
