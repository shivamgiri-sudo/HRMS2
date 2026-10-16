import { Activity, CalendarX2, Clock3, FileCheck2, PiggyBank, TrendingUp, UserMinus, UserPlus, Users, type LucideIcon } from "lucide-react";
import { KpiCard, type KpiTone } from "@/components/process-performance/DashboardKit";
import type { BranchOverview } from "../../../../../backend/src/modules/branch-head-health/types";
import { TONE_LABEL } from "./viz";
import { buildKpis, type KpiId, type KpiTile } from "./kpiModel";

export { KPI_TONES, KPI_IDS, buildKpis, type KpiId } from "./kpiModel";

export interface KpiStripProps {
  overview: BranchOverview;
  /** Trend values per backend metric; kept for callers, the compact cards draw no sparkline. */
  trends?: Record<string, Array<number | null>>;
  /** Required: every tile opens its metric drill-down. */
  onOpen: (kpi: KpiId) => void;
}

const ICONS: Record<KpiId, LucideIcon> = {
  shrinkage: Activity, late: Clock3, headcount: Users, attrition: UserMinus, profit: TrendingUp, budget: PiggyBank, grn: FileCheck2, openings: UserPlus,
};
/** Fixed domain tone per KPI, used while the status is quiet. */
const DOMAIN_TONE: Record<KpiId, KpiTone> = {
  shrinkage: "sky", late: "amber", headcount: "blue", attrition: "violet", profit: "emerald", budget: "indigo", grn: "teal", openings: "cyan",
};

function toneOf(t: KpiTile): KpiTone {
  if (t.tone === "warning") return "amber";
  if (t.tone === "serious" || t.tone === "critical") return "rose";
  return DOMAIN_TONE[t.id];
}

/** Status stays text (not colour alone): the status word leads the sub line when a tile needs a look. */
function subOf(t: KpiTile): string {
  const parts: string[] = [];
  if (t.tone === "warning" || t.tone === "serious" || t.tone === "critical") parts.push(TONE_LABEL[t.tone]);
  if (t.delta) parts.push(t.delta.text);
  if (t.hint) parts.push(t.hint);
  return parts.join(" · ");
}

/**
 * The eight headline numbers as clickable kit KPI cards (equal height). Status shows only when it needs a
 * look (warning / serious / critical); "good" stays quiet so the strip is not a wall of green. The only
 * delta is shrinkage vs yesterday, the one comparison the payload carries.
 */
export function KpiStrip({ overview, onOpen }: KpiStripProps) {
  const tiles = buildKpis(overview);
  return (
    <ul aria-label="Key numbers" className="grid list-none grid-cols-2 items-stretch gap-2.5 p-0 sm:grid-cols-4">
      {tiles.map((t) => (
        <li key={t.id} className="flex min-w-0 [&>*]:min-h-[56px]">
          <KpiCard icon={ICONS[t.id] ?? CalendarX2} label={t.label} value={t.value} sub={subOf(t)} tone={toneOf(t)} onClick={() => onOpen(t.id)} />
        </li>
      ))}
    </ul>
  );
}
