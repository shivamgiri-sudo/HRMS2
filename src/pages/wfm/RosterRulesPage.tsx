/**
 * Roster Rules — the single home for roster configuration.
 *
 * Consolidates seven separate config screens into one tabbed page. It is deliberately a COMPOSITION,
 * not a rewrite: each tab renders the existing page component unchanged, so none of the working
 * config logic, API calls or permissions move. Nothing is deleted either — every original route
 * stays registered and keeps working as a deep link, so bookmarks and hard-coded links survive.
 *
 * Why this is safe to do now: six of the seven pages already wrap themselves in <DashboardLayout>,
 * and a nested DashboardLayout now renders its children straight through (see
 * CompactDashboardLayout's InsideDashboardLayout context). That is what lets them be hosted here
 * without editing them.
 *
 * Four of the seven are already hidden from the nav by an earlier cleanup ("Hidden — volume-based /
 * superseded by import engine"), so folding them in costs nothing: no user is looking at them today,
 * and this gives them a discoverable home again rather than leaving them reachable only by typing a
 * URL.
 *
 * The active tab is kept in the query string (?tab=) so a specific rules screen stays linkable and
 * survives a refresh — which is what the standalone routes were mostly being used for.
 */
import { lazy, Suspense, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw } from "lucide-react";

// Lazily loaded for the same reason the router loads them lazily: this page would otherwise pull
// seven config screens into one chunk and make the first paint slower than any of them alone.
const WeekOffDayRules   = lazy(() => import("@/pages/NativeWeekOffDayRuleConfig"));
const WeekOffDefault    = lazy(() => import("@/pages/NativeWeekOffDefaultConfig"));
const RestPolicy        = lazy(() => import("@/pages/NativeWFMRestPolicyConfig"));
const PlanningRules     = lazy(() => import("@/pages/NativeWFMPlanningRules"));
const SlotRequirements  = lazy(() => import("@/pages/NativeSlotRequirementBuilder"));
const CapacityConfig    = lazy(() => import("@/pages/NativeRosterCapacityConfig"));
const BranchSpocConfig  = lazy(() => import("@/pages/NativeBranchWFMSpocConfig"));

type RulesTab = {
  /** Query-string value. Stable — these are linkable. */
  value: string;
  label: string;
  /** What this tab configures, in the operator's words rather than the table's. */
  blurb: string;
  /** The route this screen still lives at on its own. */
  standalone: string;
  Component: React.ComponentType;
};

const TABS: RulesTab[] = [
  {
    value: "week-off",
    label: "Week-off rules",
    blurb: "How many people may be off on each weekday, per process.",
    standalone: "/wfm/weekoff-day-rules",
    Component: WeekOffDayRules,
  },
  {
    value: "week-off-default",
    label: "Week-off default",
    blurb: "The fallback week-off day when nothing else resolves one.",
    standalone: "/wfm/week-off-default",
    Component: WeekOffDefault,
  },
  {
    value: "rest",
    label: "Minimum rest",
    blurb: "Minimum gap between two shifts, and whether a breach warns or blocks.",
    standalone: "/wfm/rest-policy",
    Component: RestPolicy,
  },
  {
    value: "capacity",
    label: "Capacity",
    blurb: "Per-process, per-weekday headcount capacity.",
    standalone: "/roster-capacity-config",
    Component: CapacityConfig,
  },
  {
    value: "demand",
    label: "Demand",
    blurb: "Interval-level headcount requirements a roster has to cover.",
    standalone: "/wfm/slot-requirements",
    Component: SlotRequirements,
  },
  {
    value: "planning",
    label: "Planning rules",
    blurb: "Shift-planning constraints applied when a roster is generated.",
    standalone: "/wfm/planning-rules",
    Component: PlanningRules,
  },
  {
    value: "approvers",
    label: "Approvers",
    blurb: "Who signs off a roster for each branch, and their backup.",
    standalone: "/wfm/branch-spoc-config",
    Component: BranchSpocConfig,
  },
];

const DEFAULT_TAB = TABS[0].value;

function TabFallback() {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-slate-500">
      <RefreshCw className="h-5 w-5 animate-spin" />
      <span className="text-sm font-medium">Loading…</span>
    </div>
  );
}

export default function RosterRulesPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // An unrecognised ?tab= falls back rather than rendering an empty page — these links get shared
  // and edited by hand, and a typo should not produce a blank screen.
  const active = useMemo(() => {
    const requested = searchParams.get("tab");
    return TABS.some((t) => t.value === requested) ? (requested as string) : DEFAULT_TAB;
  }, [searchParams]);

  const activeTab = TABS.find((t) => t.value === active) ?? TABS[0];

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            WFM · Roster
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Roster Rules</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Everything that constrains how a roster is built — capacity, week-offs, rest, demand
            and who approves it.
          </p>
        </div>

        <Tabs
          value={active}
          onValueChange={(next) => {
            // replace: true — switching tabs should not stack history entries, so Back leaves the
            // page rather than walking the user through every tab they looked at.
            setSearchParams(next === DEFAULT_TAB ? {} : { tab: next }, { replace: true });
          }}
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
            // Only the active tab's content is mounted (Radix unmounts inactive TabsContent by
            // default), so switching tabs does not leave six config screens polling in the
            // background.
            <TabsContent key={t.value} value={t.value} className="mt-4">
              <Suspense fallback={<TabFallback />}>
                <t.Component />
              </Suspense>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
