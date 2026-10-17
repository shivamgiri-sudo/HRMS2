import { Activity, Clock3, FileCheck2, PiggyBank, TrendingUp, UserMinus, UserPlus, Users, type LucideIcon } from "lucide-react";
import type { BranchOverview } from "../../../../../backend/src/modules/branch-head-health/types";
import { GradientKpi, KpiCell, KpiGrid, type KpiHue, type KpiStatus } from "./look";
import { buildKpis, type KpiId, type KpiTile } from "./kpiModel";

export { KPI_TONES, KPI_IDS, buildKpis, type KpiId } from "./kpiModel";

export interface KpiStripProps {
  overview: BranchOverview;
  /** Trend values per backend metric; kept for callers, the tiles draw no sparkline. */
  trends?: Record<string, Array<number | null>>;
  /** Required: every tile opens its metric drill-down. */
  onOpen: (kpi: KpiId) => void;
}

const ICONS: Record<KpiId, LucideIcon> = {
  shrinkage: Activity, late: Clock3, headcount: Users, attrition: UserMinus, profit: TrendingUp, budget: PiggyBank, grn: FileCheck2, openings: UserPlus,
};
/** A different hue per metric (Process Operations look); a critical status turns the tile rose. */
export const KPI_HUE: Record<KpiId, KpiHue> = {
  shrinkage: "cyan", late: "orange", headcount: "navy", attrition: "violet", profit: "emerald", budget: "indigo", grn: "teal", openings: "amber",
};

/** Status shows only when a tile needs a look: Warning, or Critical for serious/critical. Always as text + icon. */
export function kpiStatus(t: KpiTile): KpiStatus | null {
  if (t.tone === "warning") return "warning";
  if (t.tone === "serious" || t.tone === "critical") return "critical";
  return null;
}

function subOf(t: KpiTile): string {
  return [t.delta?.text, t.hint].filter(Boolean).join(" · ");
}

/**
 * The eight headline numbers as clickable solid gradient tiles. "Good" stays quiet so the strip is not a
 * wall of status chips. The only delta is shrinkage vs yesterday, the one comparison the payload carries.
 */
export function KpiStrip({ overview, onOpen }: KpiStripProps) {
  const tiles = buildKpis(overview);
  return (
    <KpiGrid label="Key numbers">
      {tiles.map((t) => (
        <KpiCell key={t.id}>
          <GradientKpi icon={ICONS[t.id]} label={t.label} value={t.value} sub={subOf(t)} hue={KPI_HUE[t.id]} status={kpiStatus(t)} onClick={() => onOpen(t.id)} />
        </KpiCell>
      ))}
    </KpiGrid>
  );
}
