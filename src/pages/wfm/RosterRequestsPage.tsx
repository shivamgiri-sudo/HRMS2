/**
 * Roster Requests — one inbox for everything raised against a published roster.
 *
 * Replaces the bare NativeRosterManagerQueue that /wfm/roster-requests pointed at, keeping the same
 * URL so the route does not move. Composition, not a rewrite: both tabs render existing pages
 * unchanged, and their original routes stay registered.
 *
 * The two halves are genuinely one job: an employee rejects a day (My Roster) and a manager settles
 * it here, or two employees want to swap and a manager approves that here. Splitting them across
 * two menu entries is why the second one was never wired up at all.
 */
import { lazy, Suspense, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw } from "lucide-react";

const ManagerQueue  = lazy(() => import("@/pages/NativeRosterManagerQueue"));
const WFMExtensions = lazy(() => import("@/pages/NativeWFMExtensions"));

const TABS = [
  {
    value: "disputes",
    label: "Disputes & week-offs",
    blurb: "Roster disputes, and the week-offs employees have rejected and need a decision on.",
    Component: ManagerQueue,
  },
  {
    value: "swaps",
    label: "Swaps & conflicts",
    blurb: "Shift-swap requests between employees, and roster conflicts needing resolution.",
    Component: WFMExtensions,
  },
];

const DEFAULT_TAB = TABS[0].value;

export default function RosterRequestsPage() {
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
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Roster Requests</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Everything raised against a published roster, waiting on a decision.
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
