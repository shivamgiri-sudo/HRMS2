/**
 * Trends & Publish — shrinkage trend, team shrinkage, roster publish/acknowledge status,
 * attrition by tenure and lateness for the console's shared filters.
 *
 * Every section is a lazily loaded file under ./trends (charts stay out of the initial bundle);
 * every table row and chart segment opens a right-hand DetailDrawer backed by a dedicated GET
 * endpoint (/api/roster-analytics/trends/*). The numbers come from one set of shared SQL
 * definitions (backend roster-trends.sql.ts) so the trend, the team table and the drawers agree.
 */
import { lazy, Suspense, useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import { PanelHeader } from "@/components/wfm/console/PanelHeader";
import { cn } from "@/lib/utils";
import { scopeParams } from "./filterState";
import { useRosterConsoleFilters } from "./RosterConsoleFilterContext";
import { InsightStrip } from "./trends/InsightStrip";
import { useTrends } from "./trends/useTrendsQuery";
import { buildInsights, type SectionKey } from "./trends/trendsCalc";
import type { LatenessOverview, PublishOverview, ShrinkageTrend } from "./trends/trendsTypes";

const ShrinkageSection = lazy(() => import("./trends/ShrinkageSection"));
const TeamShrinkageSection = lazy(() => import("./trends/TeamShrinkageSection"));
const PublishSection = lazy(() => import("./trends/PublishSection"));
const AttritionSection = lazy(() => import("./trends/AttritionSection"));
const LatenessSection = lazy(() => import("./trends/LatenessSection"));

const SECTIONS: Array<{ value: SectionKey; label: string }> = [
  { value: "shrinkage", label: "Shrinkage Trend" },
  { value: "team-shrinkage", label: "Team Shrinkage" },
  { value: "publish", label: "Publish & Acknowledge" },
  { value: "attrition", label: "Attrition" },
  { value: "lateness", label: "Lateness" },
];

function SectionSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading section">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-[112px] animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none" />)}
      </div>
      <div className="h-[300px] animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none" />
    </div>
  );
}

export default function TrendsPanel() {
  const { filters } = useRosterConsoleFilters();
  const [section, setSection] = useState<SectionKey>("shrinkage");

  // One query string for every section and drawer: from/to plus branch/process/lob (never "all").
  const qs = useMemo(
    () => scopeParams(filters, { from: filters.from, to: filters.to }).toString(),
    [filters],
  );

  // Alert strip: the three summary queries share cache keys with their sections (no double fetch).
  const shrink = useTrends<ShrinkageTrend>("shrinkage", "shrinkage", qs);
  const publish = useTrends<PublishOverview>("publish", "publish", qs);
  const late = useTrends<LatenessOverview>("lateness", "lateness", qs);
  const insights = useMemo(
    () => buildInsights({ shrink: shrink.data, publish: publish.data, late: late.data }),
    [shrink.data, publish.data, late.data],
  );

  return (
    <div className="space-y-4">
      <PanelHeader
        icon={TrendingUp}
        title="Trends & Publish"
        description="Shrinkage trend, roster publish status, attrition by tenure and lateness for the selected dates"
      />

      <InsightStrip insights={insights} onSelect={(i) => setSection(i.section)} />

      <div role="tablist" aria-label="Trends sections" className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
        {SECTIONS.map((s) => (
          <button
            key={s.value}
            type="button"
            role="tab"
            id={`trends-tab-${s.value}`}
            aria-selected={section === s.value}
            aria-controls="trends-section"
            onClick={() => setSection(s.value)}
            className={cn(
              "min-h-[44px] cursor-pointer rounded-md px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none sm:min-h-[32px]",
              section === s.value ? "bg-primary text-primary-foreground" : "text-slate-700 hover:bg-muted",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div id="trends-section" role="tabpanel" aria-labelledby={`trends-tab-${section}`} className="min-h-[480px]">
        <Suspense fallback={<SectionSkeleton />}>
          {section === "shrinkage" && <ShrinkageSection qs={qs} />}
          {section === "team-shrinkage" && <TeamShrinkageSection qs={qs} />}
          {section === "publish" && <PublishSection qs={qs} />}
          {section === "attrition" && <AttritionSection qs={qs} from={filters.from} to={filters.to} />}
          {section === "lateness" && <LatenessSection qs={qs} />}
        </Suspense>
      </div>
    </div>
  );
}
