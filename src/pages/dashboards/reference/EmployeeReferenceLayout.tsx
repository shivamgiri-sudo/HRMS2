import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarX2, ExternalLink, Clock3, TriangleAlert, UserCheck, Wallet, Zap } from "lucide-react";

import { ActionCenter, InsightGrid, KpiTiles, PulseGrid, PulseTile, SectionTitle, SignalList, TablePanel } from "../kit";
import type { InsightAction } from "../kit";
import type { ReferenceDashboardData } from "../reference-dashboard-model";
import { asNumber } from "../reference-dashboard-model";
import { AttendanceCalendar } from "./employee/AttendanceCalendar";
import { LeaveAndHolidays } from "./employee/LeaveAndHolidays";
import { LegacyDetails } from "./employee/LegacyDetails";
import { MyHero } from "./employee/MyHero";
import { PayAndPerformance } from "./employee/PayAndPerformance";
import { indexInsights } from "./employee/insightIndex";
import { CompanyFeedSidePanel } from "@/components/dashboard/CompanyFeedSidePanel";
import { TodayCelebrationsWidget } from "@/components/dashboard/TodayCelebrationsWidget";
import { EngagementPromoBanner } from "@/components/engagement/EngagementPromoBanner";
import { WeeklyWinnersWidget } from "@/components/engagement/WeeklyWinnersWidget";
import { SocialFeedWidget } from "@/components/social/SocialFeedWidget";
import { VideoModal } from "@/components/social/VideoModal";
import { MyMeetingsWidget } from "@/components/mcnmeet/MyMeetingsWidget";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LiveCallScoreStrip } from "@/components/my-kpi/LiveCallScoreStrip";
import { AhtTrendChart } from "@/components/my-kpi/AhtTrendChart";
import { HeroScoreDial } from "@/components/my-kpi/HeroScoreDial";

/**
 * Employee self-service "My Day": a personal card stack (hero -> what I must do -> attendance &
 * LOP risk -> leave -> pay & performance -> requests), fed by the per-user insights provider.
 * The hero and attendance tiles paint from the summary/loader feeds first; insight-fed cards show
 * skeletons until /insights resolves. Every pre-redesign datapoint lives in <LegacyDetails/>.
 */
export function EmployeeReferenceLayout({ data, employeeName }: { data: ReferenceDashboardData; employeeName: string }) {
  const [videoModal, setVideoModal] = useState<{ id: string; title: string } | null>(null);
  const drill: NonNullable<ReferenceDashboardData["drilldownFor"]> = data.drilldownFor ?? (() => ({}));
  const ix = useMemo(() => indexInsights(data.insights), [data.insights]);
  const loading = Boolean(data.insightsLoading);
  const attendance = data.employee.attendance;
  const hour = new Date(Date.now() + 5.5 * 3_600_000).getUTCHours();

  // Summary-feed fallbacks, used only until (or unless) the provider answers.
  // Once the provider has answered for a KPI its value (even null = "no completed days") is the truth.
  const fallback = (key: string, ...raw: unknown[]): number | null => {
    const k = ix.kpi(key);
    return k ? k.value : raw.map(asNumber).find((v) => v !== null) ?? null;
  };
  const attendanceMissing = (data.employee.sourceErrors ?? []).some((m) => m.startsWith("Attendance:"));
  const unavailable = (key: string) => ix.kpi(key)?.unavailable ?? (attendanceMissing && !ix.kpi(key) ? "No attendance data for this month yet" : null);
  const attDrill = drill("att").onDrilldown;

  // Onboarding is not in the provider (the loader already owns it): turn it into a queue row here.
  const onboarding = data.employee.onboarding;
  const onboardingPct = asNumber(onboarding.percentComplete ?? onboarding.percent_complete);
  const totalSteps = asNumber(onboarding.totalSteps ?? onboarding.total_steps);
  const doneSteps = asNumber(onboarding.completedSteps ?? onboarding.completed_steps);
  const actions: InsightAction[] = useMemo(() => {
    const list = [...ix.actions];
    if (onboardingPct !== null && onboardingPct < 100) {
      list.push({
        id: "onboarding", label: "Finish my onboarding", group: "Onboarding", severity: "high", href: "/profile",
        count: totalSteps !== null && doneSteps !== null ? Math.max(1, totalSteps - doneSteps) : 1,
        hint: `${onboardingPct}% complete — open your profile to upload what is missing`,
      });
    }
    return list;
  }, [ix.actions, onboardingPct, totalSteps, doneSteps]);

  return (
    <div className="space-y-0">
      <Tabs defaultValue="home" className="w-full">
        <TabsList className="mb-5 h-auto gap-1 rounded-xl border border-slate-200 bg-white p-1">
          {([
            { value: "home", label: "Home" },
            { value: "my-kpi", label: "My KPI" },
            { value: "live", label: "Live Performance", icon: Zap },
          ] as Array<{ value: string; label: string; icon?: typeof Zap }>).map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm">
              {Icon && <Icon size={12} />}
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="home" className="focus-visible:outline-none">
          <div className="grid gap-4 md:gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="min-w-0 space-y-4">
              <MyHero ix={ix} name={employeeName} hour={hour} loading={loading} fallbackPct={asNumber(attendance.attendancePct ?? attendance.attendance_pct)} />
              {data.insightsError ? <p role="status" className="rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-800">Some personal insights could not be loaded ({data.insightsError}). Your summary below still works.</p> : null}

              <TodayCelebrationsWidget />
              <EngagementPromoBanner />

              <div className="grid gap-4 lg:grid-cols-5">
                <div id="my-actions" className="scroll-mt-4 lg:col-span-3">
                  <ActionCenter title="What I need to do" subtitle={loading ? "Loading…" : undefined} actions={actions} loading={loading && !actions.length} error={data.insightsError} limit={10} />
                </div>
                <div className="lg:col-span-2"><SignalList title="Heads-up" signals={ix.signals} loading={loading} /></div>
              </div>

              <SectionTitle hint={ix.kpi("att_pct")?.helper}>Attendance & LOP risk</SectionTitle>
              <PulseGrid cols={5}>
                <PulseTile label="Present" icon={UserCheck} tone="green" unit="days" loading={loading && !ix.kpi("att_present") && !attendance.presentDays}
                  value={fallback("att_present", attendance.presentDays, attendance.present)} helper={ix.kpi("att_present")?.helper ?? "Full days"}
                  unavailable={unavailable("att_present")} onDrill={attDrill} formula="Days marked present (incl. week-off worked) on completed days" />
                <PulseTile label="Half days" icon={Clock3} tone={(ix.kpi("att_half")?.value ?? 0) > 0 ? "amber" : "green"} unit="days" loading={loading && !ix.kpi("att_half") && !attendance.halfDays}
                  value={fallback("att_half", attendance.halfDays, attendance.half_day)} helper={ix.kpi("att_half")?.helper ?? "Counts as 0.5"}
                  unavailable={unavailable("att_half")} onDrill={attDrill} formula="Days with worked time under the full-day rule" />
                <PulseTile label="Absent" icon={TriangleAlert} tone={(ix.kpi("att_absent")?.value ?? 0) > 0 ? "red" : "green"} unit="days" higherIsBetter={false} loading={loading && !ix.kpi("att_absent") && !attendance.absentDays}
                  value={fallback("att_absent", attendance.absentDays, attendance.absent)} helper={ix.kpi("att_absent")?.helper ?? "Day"}
                  unavailable={unavailable("att_absent")} onDrill={attDrill} formula="Completed days marked absent (1 LOP day each)" />
                <PulseTile label="Late marks" icon={CalendarX2} tone={ix.kpi("att_late")?.tone ?? "blue"} unit="count" higherIsBetter={false} loading={loading && !ix.kpi("att_late") && !attendance.lateDays}
                  value={fallback("att_late", attendance.lateDays, attendance.late)} helper={ix.kpi("att_late")?.helper ?? "Days"}
                  unavailable={unavailable("att_late")} onDrill={attDrill} formula="Days clocked in after the grace period" />
                <PulseTile label="LOP booked" icon={Wallet} tone={ix.kpi("att_lop")?.tone ?? "slate"} unit="days" higherIsBetter={false} loading={loading && !ix.kpi("att_lop")}
                  value={ix.kpi("att_lop")?.value ?? null} helper={ix.kpi("att_lop")?.helper} unavailable={ix.kpi("att_lop")?.unavailable ?? (loading ? null : "Needs the personal insights feed")}
                  onDrill={attDrill} formula={ix.kpi("att_lop")?.formula} />
              </PulseGrid>
              <KpiTiles kpis={ix.kpis(["att_pct"])} loading={loading} cols={3} />

              <div className="grid gap-4 lg:grid-cols-5">
                <div className="lg:col-span-3"><AttendanceCalendar series={ix.series("att_calendar")} loading={loading} /></div>
                <div className="space-y-4 lg:col-span-2">
                  {ix.table("att_rule") ? <TablePanel table={ix.table("att_rule")!} /> : loading ? <div className="kit-shimmer h-48 rounded-2xl" /> : null}
                  {ix.table("my_regularisations") ? <TablePanel table={ix.table("my_regularisations")!} /> : null}
                </div>
              </div>

              <SectionTitle hint="Balances, accrual, what lapses and the next holidays">Leave & holidays</SectionTitle>
              <LeaveAndHolidays ix={ix} loading={loading} />
              {ix.table("my_leave_requests") ? <TablePanel table={ix.table("my_leave_requests")!} /> : null}

              <PayAndPerformance ix={ix} loading={loading} employee={data.employee} />

              {ix.table("team_moments") ? <><SectionTitle>Team feed</SectionTitle><InsightGrid tables={[ix.table("team_moments")!]} /></> : null}

              <details className="kit-card group">
                <summary className="cursor-pointer select-none px-4 py-3 text-[13px] font-bold text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
                  All my details, onboarding, training &amp; data sources
                </summary>
                <div className="border-t border-slate-100 p-3"><LegacyDetails data={data} ix={ix} /></div>
              </details>

              <WeeklyWinnersWidget />
              <MyMeetingsWidget />
              <SocialFeedWidget onPlayVideo={(id, title) => setVideoModal({ id, title })} />
              {videoModal && <VideoModal videoId={videoModal.id} title={videoModal.title} onClose={() => setVideoModal(null)} />}

              <div className="xl:hidden"><CompanyFeedSidePanel /></div>
            </div>

            <aside className="hidden xl:block"><div className="sticky top-4"><CompanyFeedSidePanel /></div></aside>
          </div>
        </TabsContent>

        <TabsContent value="my-kpi" className="space-y-5 focus-visible:outline-none">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4">
            <div>
              <p className="text-sm font-bold text-blue-800">Your Performance Overview</p>
              <p className="mt-0.5 text-xs text-blue-600">Condensed view — open the full hub for all 4 tabs, drill-downs and trends.</p>
            </div>
            <Link to="/my-kpi" className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-bold text-blue-600 transition-all hover:bg-blue-600 hover:text-white">
              View Full Hub <ExternalLink size={12} />
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex items-center gap-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <HeroScoreDial score={ix.kpi("kpi_score")?.value ?? 0} rating={null} ratingColor={null} size={88} />
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Month-to-date score</p>
                <p className="mt-1 text-xs text-slate-400">{ix.kpi("kpi_score")?.value == null ? (ix.kpi("kpi_score")?.unavailable ?? "Open the full hub for live data.") : "Weighted against your targets."}</p>
                <Link to="/my-kpi" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline">Load live data <ExternalLink size={11} /></Link>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-500">Quick Actions</p>
              <div className="space-y-2">
                {[
                  { label: "Performance KPIs", href: "/my-kpi", color: "text-blue-600" },
                  { label: "Call Quality & CLAP", href: "/my-kpi?tab=quality", color: "text-emerald-600" },
                  { label: "Learning & TNI", href: "/my-kpi?tab=learning", color: "text-purple-600" },
                ].map(({ label, href, color }) => (
                  <Link key={href} to={href} className={`flex items-center justify-between text-xs font-semibold ${color} hover:underline`}>{label}<ExternalLink size={11} /></Link>
                ))}
              </div>
            </div>
          </div>
          <LiveCallScoreStrip refetchInterval={60_000} />
        </TabsContent>

        <TabsContent value="live" className="space-y-5 focus-visible:outline-none">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" />
              <p className="text-xs font-bold uppercase tracking-widest text-slate-700">Live Data — refreshes every 60s</p>
            </div>
            <Link to="/my-kpi?tab=live" className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-bold text-blue-600 transition-all hover:bg-blue-600 hover:text-white">
              Full Analysis <ExternalLink size={12} />
            </Link>
          </div>
          <LiveCallScoreStrip refetchInterval={60_000} showLiveBadge />
          <AhtTrendChart refetchInterval={60_000} compactMode />
        </TabsContent>
      </Tabs>
    </div>
  );
}
