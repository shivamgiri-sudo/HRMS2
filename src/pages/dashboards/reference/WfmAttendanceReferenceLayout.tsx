import type { ReactNode } from "react";
import { AttritionPulseCard } from "@/components/analytics/attrition/AttritionPulseCard";
import { AlarmClockOff, CalendarClock, Clock3, Fingerprint, Network, ShieldCheck, UserCheck, UserMinus, Users } from "lucide-react";

import {
  ActionCenter, DashHero, InsightGrid, LazySection, PulseGrid, PulseTile, SectionTitle, SignalList, drillHref, type HeroStat,
} from "../kit";
import { ReferenceDonut, ReferencePanel } from "../ReferenceDashboardUI";
import type { ReferenceDashboardData } from "../reference-dashboard-model";
import { asNumber, metricAsOf, metricDetail, metricUnavailableReason, metricValue, numberAt } from "../reference-dashboard-model";
import { useReferenceDashboardShell } from "./ReferenceDashboardShell";
import { AttendanceBreakdownPanel, AttendanceExceptionPanel, BiometricCoveragePanel } from "./ReferenceSharedPanels";
import { InsightTile, chipValue, kpiOf } from "./wfm/insightBits";
import { LiveVsProcessed } from "./wfm/WfmDetailPanels";
import { PipelineStrip } from "./wfmattendance/PipelineStrip";
import {
  AlertsAndActions, DeviceStatusPanel, LateArrivalsPanel, ManualPunchPanel, OvertimeAndCompliancePanels, RegularizationSummaryPanel, ShiftSummaryPanel,
} from "./wfmattendance/AttendanceDeskPanels";

const heroTone = (t?: string): HeroStat["tone"] => (t === "red" ? "bad" : t === "amber" ? "warn" : t === "green" ? "good" : "neutral");

/**
 * WFM Attendance: the data-integrity desk. Where the WFM dashboard asks "is the floor staffed", this asks
 * "can the attendance record be trusted before payroll takes it". The page is organised along the pipeline
 * (punch feed -> processing -> reconciliation -> corrections -> payroll cutoff).
 */
export function WfmAttendanceReferenceLayout({ data, filters }: { data: ReferenceDashboardData; filters?: ReactNode }) {
  const { productHeaderControls } = useReferenceDashboardShell();
  const m = data.metrics;
  const ins = data.insights;
  const loading = data.insightsLoading;
  const drill: NonNullable<ReferenceDashboardData["drilldownFor"]> = data.drilldownFor ?? (() => ({}));
  const code = data.dashboardCode;
  const active = metricDetail(m, "hc", "active") ?? metricValue(m, "hc");
  const present = metricDetail(m, "att", "present");
  const absent = metricDetail(m, "att", "absent");
  const late = metricDetail(m, "att", "late");
  const halfDay = metricDetail(m, "att", "halfDay");
  const missingPunch = metricDetail(m, "att", "missedPunch");
  const onLeave = metricDetail(m, "att", "onLeave") ?? numberAt(data.biometric, "on_leave");
  const attendanceRate = metricDetail(m, "att", "attendanceRate") ?? metricValue(m, "att");
  const workingRemotely = numberAt(data.biometric, "working_remotely");
  const latePct = asNumber(data.biometric.late_pct);
  const noRecord = kpiOf(ins, "no_record")?.value ?? null;
  const asOf = metricAsOf(m, "att");
  const attReason = metricUnavailableReason(m, "att");
  const attHelper = asOf ? `processed day ${asOf}` : "latest processed day";
  const rosterCoverage = asNumber(data.biometric.roster_coverage_pct ?? data.biometric.coverage_pct);

  const blockers = ins?.actions.find((a) => a.id === "integrity_blockers");
  const stats: HeroStat[] = [
    { label: "Feed lag", value: chipValue(kpiOf(ins, "cosec_sync_lag"), loading, "h"), href: "/wfm/attendance-integrity?tab=biometric", tone: heroTone(kpiOf(ins, "cosec_sync_lag")?.tone) },
    { label: "Punched, unprocessed", value: chipValue(kpiOf(ins, "punch_pipeline"), loading), href: "/wfm/attendance-integrity?tab=biometric", tone: heroTone(kpiOf(ins, "punch_pipeline")?.tone) },
    { label: "Missed punches", value: chipValue(kpiOf(ins, "missed_punch"), loading), href: "/wfm/attendance-integrity?tab=mismatches", tone: heroTone(kpiOf(ins, "missed_punch")?.tone) },
    { label: "Corrections open", value: loading && !ins ? "…" : ins?.actions.find((a) => a.id === "reg_other") ? String((ins.actions.find((a) => a.id === "reg_other")?.count ?? 0) + (ins.actions.find((a) => a.id === "reg_wfh")?.count ?? 0)) : "—", href: "/attendance-regularization", tone: "warn" },
    { label: "Biometric coverage", value: chipValue(kpiOf(ins, "biometric_coverage"), loading, "%"), href: "/wfm/attendance-integrity?tab=biometric", tone: heroTone(kpiOf(ins, "biometric_coverage")?.tone) },
    { label: "Abscond risk", value: chipValue(kpiOf(ins, "abscond_risk"), loading), href: "/wfm/attendance-integrity?tab=exceptions", tone: (kpiOf(ins, "abscond_risk")?.value ?? 0) > 0 ? "bad" : "neutral" },
    { label: "Days to cutoff", value: chipValue(kpiOf(ins, "payroll_lock"), loading), href: "/wfm/attendance-integrity?tab=mismatches", tone: heroTone(kpiOf(ins, "payroll_lock")?.tone) },
  ];

  return (
    <div className="reference-dashboard-page space-y-5">
      <DashHero
        accent="slate" icon={ShieldCheck} eyebrow="Data-integrity desk" title="Attendance integrity"
        subtitle="Punches, processing, corrections and the payroll cutoff in one chain" right={filters ?? productHeaderControls}
        headline={{
          label: "Payroll-blocking issues open",
          value: blockers?.count == null ? (loading ? "…" : "—") : blockers.count.toLocaleString("en-IN"),
          caption: blockers ? `${(blockers.overdue ?? 0).toLocaleString("en-IN")} older than 7 days; oldest ${blockers.oldestDays ?? "—"} days. Attendance rate ${attendanceRate === null ? "unavailable" : `${attendanceRate}%`} (${attHelper}).` : "Open reconciliation findings that block payroll until corrected.",
        }}
        stats={stats} health={ins?.healthScore != null ? { value: ins.healthScore, label: "Integrity", basis: ins.healthBasis } : null}
      />

      <PipelineStrip insights={ins} loading={loading} />

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <ActionCenter actions={ins?.actions} loading={loading} error={data.insightsError} title="Corrections and approvals" limit={9} />
        <SignalList signals={ins?.signals} loading={loading} title="Integrity signals" />
      </div>

      <SectionTitle hint={attHelper}>Attendance today</SectionTitle>
      <PulseGrid cols={6}>
        <PulseTile label="Total Employees" value={active} tone="blue" helper="in selected scope" icon={Users} unavailable={metricUnavailableReason(m, "hc")} href={drill("hc").onDrilldown ? undefined : drillHref(code, "HEADCOUNT")} onDrill={drill("hc").onDrilldown ?? undefined} loading={data.loading} />
        <PulseTile label="Present" value={present} tone="green" helper={attendanceRate === null ? attHelper : `${attendanceRate}% · ${attHelper}`} icon={UserCheck} unavailable={attReason} href={drillHref(code, "ATTENDANCE")} loading={data.loading} />
        <PulseTile label="Late Arrivals" value={late} tone="amber" helper={latePct === null ? attHelper : `${latePct}% month to date`} icon={Clock3} unavailable={attReason} href={drillHref(code, "ATTENDANCE", { status: "late" })} loading={data.loading} />
        <PulseTile label="Absent" value={absent} tone="red" helper={attHelper} icon={UserMinus} unavailable={attReason} href={drillHref(code, "ATTENDANCE", { status: "absent" })} loading={data.loading} />
        <PulseTile label="On Leave" value={onLeave} tone="blue" helper="approved leave" icon={CalendarClock} unavailable={attReason} href="/leaves" loading={data.loading} />
        <PulseTile label="Working Remotely" value={workingRemotely} tone="violet" helper="WFH / remote, today" icon={Network} href="/attendance-regularization" loading={data.loading} />
      </PulseGrid>

      <SectionTitle hint="measured per request">Integrity pulse</SectionTitle>
      <PulseGrid cols={4}>
        {["missed_punch_rate", "punch_pipeline", "anomalous_punches", "biometric_coverage", "cosec_raw_lag", "kiosks_silent", "reg_median_age", "half_day_rule", "late_rate", "no_record", "abscond_risk", "payroll_lock"].map((k) => (
          <InsightTile key={k} data={data} kpiKey={k} icon={k === "cosec_raw_lag" || k === "biometric_coverage" ? Fingerprint : AlarmClockOff} />
        ))}
      </PulseGrid>

      <SectionTitle hint="what is stuck, and for how long">Where records are breaking</SectionTitle>
      <InsightGrid loading={loading} series={ins?.series} tables={ins?.tables}
        only={["issue_types", "issue_table", "missed_trend", "reg_age", "reg_by_type", "late_bands", "coverage_gap", "att_trend", "abscond_list"]} />

      <SectionTitle hint="pre-redesign panels, corrected">Processed attendance detail</SectionTitle>
      <LazySection minHeight={280}>
        <div className="grid gap-4 xl:grid-cols-[0.9fr_1.05fr_1fr]">
          <ReferencePanel title="Processed Attendance Status">
            <ReferenceDonut compact centerValue={attendanceRate === null ? null : `${attendanceRate}%`} centerLabel="Attendance" data={[
              { name: "Present", value: present ?? 0 },
              { name: "Half day", value: halfDay ?? 0 },
              { name: "Absent", value: absent ?? 0 },
              { name: "On leave", value: onLeave ?? 0 },
              { name: "Missing punch", value: missingPunch ?? 0 },
              { name: "No record", value: noRecord ?? 0 },
            ]} />
            <p className="mt-2 text-xs text-[#71809a]">Last updated from finalized attendance records ({asOf ?? "latest day"}). Late and remote are flags on these days, not separate slices.</p>
          </ReferencePanel>
          <LateArrivalsPanel data={data} />
          <RegularizationSummaryPanel data={data} />
        </div>
      </LazySection>

      <LazySection minHeight={280}>
        <div className="grid gap-4 xl:grid-cols-[0.75fr_1.25fr_1fr]">
          <DeviceStatusPanel data={data} />
          <ShiftSummaryPanel data={data} />
          <ReferencePanel title="Roster Coverage">
            <ReferenceDonut compact centerValue={rosterCoverage === null ? null : `${rosterCoverage}%`} centerLabel="Coverage" data={[
              { name: "Fully Covered", value: asNumber(data.biometric.fully_covered) ?? 0 },
              { name: "Partially Covered", value: asNumber(data.biometric.partially_covered) ?? 0 },
              { name: "Understaffed", value: asNumber(data.biometric.understaffed) ?? 0 },
            ]} />
            <p className="mt-2 text-xs text-[#71809a]">Processes by share present on the latest complete day.</p>
          </ReferencePanel>
        </div>
      </LazySection>

      <LazySection minHeight={260}>
        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr_0.8fr_0.65fr_0.72fr]">
          <ManualPunchPanel data={data} />
          <OvertimeAndCompliancePanels data={data} />
          <AlertsAndActions data={data} />
        </div>
      </LazySection>

      <LazySection minHeight={300}>
        <div className="grid gap-4 xl:grid-cols-2">
          <AttendanceBreakdownPanel data={data} />
          <LiveVsProcessed data={data} />
          <AttendanceExceptionPanel data={data} />
          <BiometricCoveragePanel data={data} />
        </div>
      </LazySection>
      <AttritionPulseCard />
    </div>
  );
}
