/**
 * Roster Insights — the read-only half of the roster module in one page.
 *
 * Composition, not a rewrite: each tab renders an existing page unchanged, and every original
 * route stays registered as a deep link. Read-only by nature, so this is the lowest-risk step of
 * the consolidation — nothing here writes.
 *
 * Two of the three are already hidden from the nav ("superseded by import engine"), reachable only
 * by typing a URL; this gives them a home again without reviving them as separate menu entries.
 */
import { lazy, Suspense, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw } from "lucide-react";

const WorkforcePlanning = lazy(() => import("@/pages/NativeWorkforcePlanning"));
const AutoRoster        = lazy(() => import("@/pages/NativeWFMAutoRoster"));
const WeekoffFairness   = lazy(() => import("@/pages/wfm/WeekoffFairness"));
const Analytics         = lazy(() => import("@/pages/wfm/RosterAnalyticsPanel"));

const TABS = [
  {
    value: "coverage",
    label: "Coverage",
    blurb: "Headcount against requirement — where the week is short.",
    Component: WorkforcePlanning,
  },
  {
    value: "heatmap",
    label: "Heat map",
    blurb: "Interval-level coverage across the week, and post-publish change requests.",
    Component: AutoRoster,
  },
  {
    value: "fairness",
    label: "Week-off fairness",
    blurb: "Whether week-offs are being shared out evenly, per process and week.",
    Component: WeekoffFairness,
  },
  {
    value: "analytics",
    label: "Analytics",
    blurb: "Shrinkage trend, publish/acknowledge status, attrition and habitual lateness — one filter bar, one page.",
    Component: Analytics,
  },
];

const DEFAULT_TAB = TABS[0].value;

export default function RosterInsightsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const active = useMemo(() => {
    const requested = searchParams.get("tab");
    return TABS.some((t) => t.value === requested) ? (requested as string) : DEFAULT_TAB;
  }, [searchParams]);
  const activeTab = TABS.find((t) => t.value === active) ?? TABS[0];

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">WFM · Roster</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Roster Insights</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            How the roster is actually performing — coverage, gaps and fairness. Nothing here changes a roster.
          </p>
        </div>

        <Tabs
          value={active}
          onValueChange={(next) =>
            setSearchParams(next === DEFAULT_TAB ? {} : { tab: next }, { replace: true })
          }
        >
          <TabsList className="flex h-auto flex-wrap justify-start gap-1">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="text-xs sm:text-sm">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <p className="mt-3 text-sm text-slate-500">{activeTab.blurb}</p>

          {TABS.map((t) => (
            <TabsContent key={t.value} value={t.value} className="mt-4">
              <Suspense
                fallback={
                  <div className="flex items-center justify-center gap-3 py-16 text-slate-500">
                    <RefreshCw className="h-5 w-5 animate-spin" />
                    <span className="text-sm font-medium">Loading…</span>
                  </div>
                }
              >
                <t.Component />
              </Suspense>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
