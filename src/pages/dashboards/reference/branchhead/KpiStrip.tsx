import type { BranchOverview } from "../../../../../backend/src/modules/branch-head-health/types";
import { StatTile } from "./viz";
import { buildKpis, type KpiId } from "./kpiModel";

export { KPI_TONES, KPI_IDS, buildKpis, type KpiId } from "./kpiModel";

export interface KpiStripProps {
  overview: BranchOverview;
  /** Trend values per backend metric (from useBranchTrends); sparklines draw only with >= 3 points. */
  trends: Record<string, Array<number | null>>;
  /** Required: every tile opens its metric drill-down (wired to the drawer host in Task 4). */
  onOpen: (kpi: KpiId) => void;
}

/**
 * The eight headline numbers as clickable stat tiles. Status shows only when it needs a look
 * (warning / serious / critical, icon + text); "good" stays quiet so the strip is not a wall of green.
 * The only delta is shrinkage vs yesterday, the one comparison the payload carries.
 */
export function KpiStrip({ overview, trends, onOpen }: KpiStripProps) {
  const tiles = buildKpis(overview);
  return (
    <ul aria-label="Key numbers" className="grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-4">
      {tiles.map((t) => (
        <li key={t.id} className="min-w-0">
          <StatTile
            label={t.label}
            value={t.value}
            delta={t.delta}
            hint={t.hint}
            tone={t.tone === "good" || t.tone === "neutral" ? undefined : t.tone}
            spark={t.metric ? trends[t.metric] ?? [] : undefined}
            onClick={() => onOpen(t.id)}
          />
        </li>
      ))}
    </ul>
  );
}
