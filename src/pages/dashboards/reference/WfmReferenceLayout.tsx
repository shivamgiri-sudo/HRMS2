import type { ReactNode } from "react";
import { Activity, AlarmClockOff, CalendarClock, Clock3, Radio, Target, UserCheck, UserMinus, Users } from "lucide-react";

import {
  ActionCenter, DashHero, InsightGrid, LazySection, PulseGrid, PulseTile, SectionTitle, SignalList, drillHref, type HeroStat,
} from "../kit";
import { ReferenceWorkInbox } from "./ReferenceOperationalPanels";
import { AttendanceExceptionPanel, BiometricCoveragePanel } from "./ReferenceSharedPanels";
import { WfmAnalyticsPanel } from "@/components/dashboard/wfm/WfmAnalyticsPanel";
import type { ReferenceDashboardData } from "../reference-dashboard-model";
import { PayrollPrepWidget } from "@/components/dashboard/widgets/PayrollPrepWidget";
import { TodayCelebrationsWidget } from "@/components/dashboard/TodayCelebrationsWidget";
import { asNumber, metricAsOf, metricDetail, metricUnavailableReason } from "../reference-dashboard-model";
import { FloorBoard } from "./wfm/FloorBoard";
import { InsightTile, chipValue, kpiOf, tableOf } from "./wfm/insightBits";
import { ShiftHeatmap } from "./wfm/ShiftHeatmap";
import {
  LateSeverityPanel, LiveVsProcessed, OperationsAlertsPanel, ProcessedBreakdown, SyncHealthPanel, WorkforceSummary,
} from "./wfm/WfmDetailPanels";

const heroTone = (t?: string): HeroStat["tone"] => (t === "red" ? "bad" : t === "amber" ? "warn" : t === "green" ? "good" : "neutral");

/**
 * WFM dashboard: the live shift floor. Hero + tiles paint from the summary; everything fed by
 * /insights (floor board, queues, heatmaps, forecast) fills in behind skeletons without moving the layout.
 */
export function WfmReferenceLayout({ data, filters }: { data: ReferenceDashboardData; filters: ReactNode }) {
  const currentMonth = (() => {
    const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  })();

  const m = data.metrics;
  const ins = data.insights;
  const loading = data.insightsLoading;
  const drill: NonNullable<ReferenceDashboardData["drilldownFor"]> = data.drilldownFor ?? (() => ({}));
  const code = data.dashboardCode;
  const required = metricDetail(m, "hc", "required");
  const available = metricDetail(m, "hc", "available");
  const gap = required !== null && available !== null ? Math.max(0, required - available) : null;
  const rosterAdherence = asNumber(data.biometric.roster_adherence_pct) ?? kpiOf(ins, "roster_adherence")?.value ?? null;
  const missingPunch = metricDetail(m, "att", "missedPunch");
  const attendanceRate = metricDetail(m, "att", "attendanceRate");
  const asOf = metricAsOf(m, "att");
  const attReason = metricUnavailableReason(m, "att");
  const attHelper = asOf ? `processed day ${asOf}` : "latest processed day";
  const attTone = attendanceRate === null ? "slate" : attendanceRate >= 85 ? "green" : attendanceRate >= 70 ? "amber" : "red";
  const floor = tableOf(ins, "shift_floor");

  const stats: HeroStat[] = [
    { label: "Floor fill (live)", value: chipValue(kpiOf(ins, "floor_fill"), loading, "%"), href: "/wfm/live-tracker", tone: heroTone(kpiOf(ins, "floor_fill")?.tone) },
    { label: "No-shows now", value: chipValue(kpiOf(ins, "no_show_now"), loading), href: "/wfm/live-tracker", tone: (kpiOf(ins, "no_show_now")?.value ?? 0) > 0 ? "bad" : "neutral" },
    { label: "Roster vs required", value: chipValue(kpiOf(ins, "roster_vs_required"), loading, "%"), href: "/wfm/capacity-dashboard", tone: heroTone(kpiOf(ins, "roster_vs_required")?.tone) },
    { label: "Roster published 14d", value: chipValue(kpiOf(ins, "roster_published"), loading, "%"), href: "/wfm/roster-command-center", tone: heroTone(kpiOf(ins, "roster_published")?.tone) },
    { label: "Unplanned shrinkage", value: chipValue(kpiOf(ins, "unplanned_shrinkage"), loading, "%"), href: "/wfm/roster-command-center", tone: heroTone(kpiOf(ins, "unplanned_shrinkage")?.tone) },
    { label: "Abscond risk", value: chipValue(kpiOf(ins, "abscond_risk"), loading), href: "/wfm/attendance-integrity?tab=exceptions", tone: (kpiOf(ins, "abscond_risk")?.value ?? 0) > 0 ? "bad" : "neutral" },
    { label: "Tomorrow absence", value: chipValue(kpiOf(ins, "absence_forecast"), loading), href: "/wfm/roster-builder", tone: heroTone(kpiOf(ins, "absence_forecast")?.tone) },
  ];

  return (
    <div className="reference-dashboard-page space-y-5">
      <DashHero
        accent="cyan" icon={Radio} eyebrow="WFM control room" title="Live shift floor"
        subtitle="Staffing, shrinkage, roster health and approvals in one view" right={filters}
        headline={{ label: "Attendance rate", value: attendanceRate === null ? "—" : `${attendanceRate}%`, caption: attReason ?? `${attHelper}. Today is still being written, so the live floor numbers below are the real-time view.` }}
        stats={stats} health={ins?.healthScore !== undefined && ins.healthScore !== null ? { value: ins.healthScore, label: "Floor health", basis: ins.healthBasis } : null}
      />

      <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <FloorBoard table={floor} loading={loading} clock={floor ? new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(11, 16) : null} />
        <ActionCenter actions={ins?.actions} loading={loading} error={data.insightsError} title="Needs the WFM desk" limit={9} />
      </div>

      <SectionTitle hint="from the latest processed day">Core numbers</SectionTitle>
      <PulseGrid cols={4}>
        <PulseTile label="Attendance Rate" value={attendanceRate} unit="percent" tone={attTone} helper={attHelper} icon={UserCheck} unavailable={attReason}
          formula="(present + week_off_worked + 0.5 x half_day) over days expected to work; expected excludes week-off, holiday and approved leave" href={drillHref(code, "ATTENDANCE")} loading={data.loading} />
        <PulseTile label="Active Headcount" value={metricDetail(m, "hc", "active")} tone="blue" helper="employees on the books" icon={Users} unavailable={metricUnavailableReason(m, "hc")} onDrill={drill("hc").onDrilldown ?? undefined} href={drill("hc").onDrilldown ? undefined : drillHref(code, "HEADCOUNT")} loading={data.loading} />
        <PulseTile label="Required HC" value={required} tone={required === null ? "slate" : "blue"} helper={required === null ? "Planning source unavailable" : "mandate incl. shrinkage buffer"} icon={Users} href={drillHref(code, "HEADCOUNT")} loading={data.loading} />
        <PulseTile label="Available HC" value={available} tone={available === null || gap === null ? "slate" : gap > 0 ? "amber" : "green"} helper={available === null ? "Login-session source unavailable" : gap === null ? "clocked in right now" : `${gap} net gap vs mandate (live)`} icon={UserCheck} href={drillHref(code, "HEADCOUNT")} loading={data.loading} />
        <PulseTile label="Roster Adherence" value={rosterAdherence} unit="percent" tone={rosterAdherence === null ? "slate" : rosterAdherence >= 92 ? "green" : rosterAdherence >= 85 ? "amber" : "red"} helper="rostered days that ended present" icon={Target} href="/wfm/roster-command-center" loading={rosterAdherence === null && Boolean(loading)} />
        <PulseTile label="Missing Punch" value={missingPunch} tone={missingPunch && missingPunch > 0 ? "red" : "green"} helper={`attendance exceptions (${attHelper})`} icon={Clock3} unavailable={attReason} href={drillHref(code, "ATTENDANCE", { status: "missing_punch" })} loading={data.loading} />
        <PulseTile label="Absent" value={metricDetail(m, "att", "absent")} tone="red" helper={attHelper} icon={UserMinus} unavailable={attReason} href={drillHref(code, "ATTENDANCE", { status: "absent" })} loading={data.loading} />
        <PulseTile label="Late Marks" value={metricDetail(m, "att", "late")} tone="amber" helper={attHelper} icon={AlarmClockOff} unavailable={attReason} href={drillHref(code, "ATTENDANCE", { status: "late" })} loading={data.loading} />
      </PulseGrid>

      <SectionTitle hint="live and trend, computed per request">Shift pulse</SectionTitle>
      <PulseGrid cols={4}>
        {["roster_vs_required", "roster_coverage", "attendance_rate", "unplanned_shrinkage", "planned_shrinkage", "late_rate", "roster_published", "roster_horizon", "absence_forecast", "ot_hours", "break_overuse", "biometric_lag"].map((k) => (
          <InsightTile key={k} data={data} kpiKey={k} icon={k === "absence_forecast" ? CalendarClock : Activity} />
        ))}
      </PulseGrid>

      <SectionTitle hint="last 7 processed days, rostered working agents">Where it is breaking</SectionTitle>
      <LazySection minHeight={260}>
        <div className="grid gap-4 xl:grid-cols-2">
          <ShiftHeatmap table={tableOf(ins, "absence_heat")} loading={loading} title="Absenteeism by shift and day" subtitle="% of rostered agents marked absent" good={10} warn={25} />
          <ShiftHeatmap table={tableOf(ins, "late_heat")} loading={loading} title="Late-coming by shift and day" subtitle="% of rostered agents marked late" good={10} warn={25} />
        </div>
      </LazySection>

      <SectionTitle>Trends and rankings</SectionTitle>
      <InsightGrid loading={loading} series={ins?.series} tables={ins?.tables} only={["att_trend", "login_curve", "publish_by_day", "shrinkage_ranked", "status_mix", "break_by_process", "shrinkage_process", "abscond_list"]} />

      <LazySection minHeight={200}>
        <SignalList signals={ins?.signals} loading={loading} title="What the numbers say" />
      </LazySection>

      <SectionTitle hint="every pre-redesign panel, regrouped">Operational detail</SectionTitle>
      <LazySection minHeight={300}>
        <div className="space-y-4">
          <TodayCelebrationsWidget />
          <PayrollPrepWidget month={currentMonth} />
          <div className="grid gap-4 xl:grid-cols-[1.04fr_0.96fr]">
            <OperationsAlertsPanel data={data} />
            <WorkforceSummary data={data} />
          </div>
          <div className="grid gap-4 xl:grid-cols-[1.04fr_0.96fr]">
            <LateSeverityPanel data={data} />
            <ReferenceWorkInbox maxItems={4} />
          </div>
          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <ProcessedBreakdown data={data} />
            <div className="grid gap-4">
              <LiveVsProcessed data={data} />
              <SyncHealthPanel data={data} />
              <AttendanceExceptionPanel data={data} />
              <BiometricCoveragePanel data={data} />
              <div className="mt-4"><WfmAnalyticsPanel /></div>
            </div>
          </div>
        </div>
      </LazySection>
    </div>
  );
}
