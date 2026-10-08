import { Suspense, lazy, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, Gauge, Radio, RefreshCcw, ShieldCheck, Sparkles, Telescope, UsersRound } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { CCFrame, CCHero, CCTabs, HeroStat, LiveBadge } from "@/components/ats/cc/cc-kit";
import { useAtsOverview } from "@/hooks/useAtsOverview";
import { CountUp } from "@/components/ats/overview/viz";
import { CCProvider } from "@/components/ats/cc/cc-context";
import { PulseTab } from "@/components/ats/cc/PulseTab";
import { PulseScopedTab } from "@/components/ats/cc/PulseScopedTab";
import { useDrill } from "@/hooks/useAtsDashboards";
import NativeATSFullParityCommandCenter from "./NativeATSFullParityCommandCenter";

const LiveOpsTab = lazy(() => import("@/components/ats/cc/LiveOpsTab").then((m) => ({ default: m.LiveOpsTab })));
const SourcingRecruitersTab = lazy(() => import("@/components/ats/cc/SourcingRecruitersTab").then((m) => ({ default: m.SourcingRecruitersTab })));
const OutcomesTab = lazy(() => import("@/components/ats/cc/OutcomesTab").then((m) => ({ default: m.OutcomesTab })));
const OutcomesScopedTab = lazy(() => import("@/components/ats/cc/OutcomesScopedTab").then((m) => ({ default: m.OutcomesScopedTab })));
const ControlsTab = lazy(() => import("@/components/ats/cc/ControlsTab").then((m) => ({ default: m.ControlsTab })));

/**
 * Roles the new Command Center serves. Its aggregates are org-wide (or pinned to one branch for hr / manager) and cached,
 * exactly like the Insights tab it replaces (DASH_AGG_ROLES in ats.routes.ts). Everyone else keeps the previous page.
 */
export const COMMAND_CENTER_V2_ROLES = ["super_admin", "admin", "hr", "manager", "ceo"] as const;
/**
 * Roles served in scoped mode: branch heads and process managers see the new Command Center, but only through the row-scoped
 * endpoints (drill, candidates, stage dwell, cohorts, leakage, branch activity), which already limit every number to the
 * caller's own branch and assigned processes. The org-wide / branch-pinned aggregates (overview, insights, sourcing,
 * operations) are not used for them: a process manager would otherwise see their whole branch.
 */
export const COMMAND_CENTER_SCOPED_ROLES = ["branch_head", "process_manager"] as const;

const TABS = [
  { id: "pulse", label: "Pulse", icon: <Gauge className="h-4 w-4" /> },
  { id: "live", label: "Live Ops", icon: <Radio className="h-4 w-4" /> },
  { id: "sourcing", label: "Sourcing & Recruiters", icon: <UsersRound className="h-4 w-4" /> },
  { id: "outcomes", label: "Quality & Outcomes", icon: <Telescope className="h-4 w-4" /> },
  { id: "controls", label: "Candidates & Controls", icon: <ShieldCheck className="h-4 w-4" /> },
] as const;
type TabId = (typeof TABS)[number]["id"];

/** Old tab names (bookmarks, links in emails) land on the tab that now holds that content. */
const LEGACY_TAB: Record<string, TabId> = {
  cover: "pulse", dashboard: "pulse", trends: "pulse", insights: "pulse", rejections: "outcomes", recruiters: "sourcing", sourcing: "sourcing",
  "live queue": "live", "branch activity": "live", journey: "controls", health: "controls", bmi: "controls",
};
export const toTab = (raw: string | null): TabId => {
  const v = (raw ?? "").toLowerCase();
  return (TABS.find((t) => t.id === v)?.id ?? LEGACY_TAB[v] ?? "pulse") as TabId;
};

const TabFallback = () => <div className="space-y-4"><Skeleton className="h-14 rounded-2xl" /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}</div><Skeleton className="h-80 rounded-2xl" /></div>;

/** Scoped roles: today's numbers from the row-scoped drill, so they cover only the caller's own branch and processes. */
export function ScopedTodayStrip() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const { data } = useDrill({ from: today, to: today });
  if (!data) return null;
  const k = data.kpis;
  return (
    <div className="relative mt-5 flex flex-wrap gap-3" aria-label="Today at a glance">
      <HeroStat label="Registered today" value={<CountUp value={k.total} />} sub={k.total ? undefined : "none yet today"} />
      <HeroStat label="Selected today" value={<CountUp value={k.selected} />} tone="good" sub={`${k.selRate}% of registered`} />
      <HeroStat label="Rejected today" value={<CountUp value={k.rejected} />} sub={`${k.rejRate}% of registered`} />
      <HeroStat label="No-show today" value={<CountUp value={k.noShow} />} tone={k.noShowRate > 20 ? "bad" : "default"} sub={`${k.noShowRate}% of registered`} />
    </div>
  );
}

/** Today at a glance, shown in the hero on every tab. Reads the same overview aggregate as Pulse (cached), so it costs no extra request there. */
export function TodayStrip() {
  const { data } = useAtsOverview("today", "");
  if (!data) return null;
  const k = data.kpis, q = data.queue;
  return (
    <div className="relative mt-5 flex flex-wrap gap-3" aria-label="Today at a glance">
      <HeroStat label="Registered today" value={<CountUp value={k.registered.value} />} sub={k.registered.value > 0 && k.registered.delta != null ? `${k.registered.delta > 0 ? "+" : ""}${k.registered.delta}% vs yesterday` : "none yet today"} />
      <HeroStat label="Selected today" value={<CountUp value={k.selected.value} />} tone="good" sub={`${k.selected.rate ?? 0}% of registered`} />
      <HeroStat label="Waiting now" value={<CountUp value={q.active} />} sub={`avg wait ${q.avgWaitMin} min`} />
      <HeroStat label="SLA breaches" value={<CountUp value={q.slaBreach} />} tone={q.slaBreach > 0 ? "bad" : "default"} sub={`${q.slaMinutes}-minute SLA`} />
      <HeroStat label="Walk-out rate" value={<CountUp value={k.walkoutRate} suffix="%" />} sub="left before interview" />
    </div>
  );
}

function CommandCenterV2({ scoped = false }: { scoped?: boolean }) {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const tab = useMemo(() => toTab(params.get("tab")), [params]);
  const setTab = (t: TabId) => setParams((p) => { const n = new URLSearchParams(p); n.set("tab", t); return n; }, { replace: true });

  return (
    <DashboardLayout>
      <CCProvider scoped={scoped}>
        <CCFrame>
          <CCHero live eyebrow="Talent Acquisition" title="ATS Command Center"
            subtitle={scoped ? "Your branch and assigned processes only. Click any number to open it." : "Pipeline health, live queue, sourcing, decision quality and system controls in one place. Click any number to open it."}
            right={<>
              <LiveBadge onDark />
              <button onClick={() => void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("ats-") })}
                className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3.5 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
                <RefreshCcw className="h-4 w-4" aria-hidden />Refresh
              </button>
            </>}>
            {scoped ? <ScopedTodayStrip /> : <TodayStrip />}
          </CCHero>
          <CCTabs tabs={TABS.map((t) => ({ ...t }))} value={tab} onChange={setTab} />
          <div role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
            <Suspense fallback={<TabFallback />}>
              {tab === "pulse" && (scoped ? <PulseScopedTab /> : <PulseTab />)}
              {tab === "live" && <LiveOpsTab />}
              {tab === "sourcing" && <SourcingRecruitersTab />}
              {tab === "outcomes" && (scoped ? <OutcomesScopedTab /> : <OutcomesTab />)}
              {tab === "controls" && <ControlsTab />}
            </Suspense>
          </div>
          <p className="flex items-center gap-1.5 pb-2 text-center text-[11px] text-muted-foreground"><Sparkles className="h-3 w-3" aria-hidden /><Activity className="h-3 w-3" aria-hidden />Numbers on every tab come from the same candidate data, so a figure here matches its drill-down.</p>
        </CCFrame>
      </CCProvider>
    </DashboardLayout>
  );
}

/** Route element for /ats/command-center: the full new experience for the aggregate roles, the scoped one for branch heads and process managers, the previous page for everyone else (or ?legacy=1). */
export default function ATSCommandCenterRoute() {
  const { hasAnyRole, isResolved } = useWorkforceAccess();
  const [params] = useSearchParams();
  if (!isResolved) return <DashboardLayout><TabFallback /></DashboardLayout>;
  if (params.get("legacy") === "1") return <NativeATSFullParityCommandCenter />;
  if (hasAnyRole(...COMMAND_CENTER_V2_ROLES)) return <CommandCenterV2 />;
  if (hasAnyRole(...COMMAND_CENTER_SCOPED_ROLES)) return <CommandCenterV2 scoped />;
  return <NativeATSFullParityCommandCenter />;
}
