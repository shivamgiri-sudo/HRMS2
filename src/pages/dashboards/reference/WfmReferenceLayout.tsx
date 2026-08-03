import {
  Activity,
  CalendarClock,
  Clock3,
  Target,
  UserCheck,
  Users,
} from "lucide-react";

import {
  ReferenceHeader,
  ReferenceListRow,
  ReferenceMetricGrid,
  ReferencePanel,
} from "../ReferenceDashboardUI";
import { ReferenceAIBrief, ReferenceWorkInbox } from "./ReferenceOperationalPanels";
import {
  AttendanceExceptionPanel,
  BiometricCoveragePanel,
} from "./ReferenceSharedPanels";
import type { ReferenceDashboardData } from "../reference-dashboard-model";
import { PayrollPrepWidget } from "@/components/dashboard/widgets/PayrollPrepWidget";
import { TodayCelebrationsWidget } from "@/components/dashboard/TodayCelebrationsWidget";
import {
  arrayAt,
  asNumber,
  formatValue,
  metricDetail,
  metricUnavailableReason,
} from "../reference-dashboard-model";

export function WfmReferenceLayout({
  data,
  filters,
}: {
  data: ReferenceDashboardData;
  filters: React.ReactNode;
}) {
  const currentMonth = (() => {
    const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  })();

  const m = data.metrics;
  const drill = data.drilldownFor ?? (() => ({}));
  const required = metricDetail(m, "hc", "required");
  const available = metricDetail(m, "hc", "available");
  const missingPunch = metricDetail(m, "att", "missedPunch");
  const rosterAdherence = asNumber(data.biometric.roster_adherence_pct);
  const gap = required !== null && available !== null ? Math.max(0, required - available) : null;
  const shrinkage = asNumber(data.biometric.shrinkage_pct);
  const interventionRows = arrayAt(data.opsPulse, "intervention_flags");

  const variance = {
    low: asNumber(data.biometric.variance_0_1 ?? data.biometric.variance_bucket_0_1),
    medium: asNumber(data.biometric.variance_1_4 ?? data.biometric.variance_bucket_1_4),
    high: asNumber(data.biometric.variance_4_plus ?? data.biometric.variance_bucket_4_plus),
  };

  // The ATTENDANCE metric returns a full breakdown on every WFM load, of which only
  // missedPunch was being read. The rest is the core of a WFM view.
  const present = metricDetail(m, "att", "present");
  const halfDay = metricDetail(m, "att", "halfDay");
  const absent = metricDetail(m, "att", "absent");
  const late = metricDetail(m, "att", "late");
  const onLeave = metricDetail(m, "att", "onLeave");
  const livePresent = metricDetail(m, "att", "livePresent");
  const expectedToWork = metricDetail(m, "att", "expectedToWork");
  const attendanceRate = metricDetail(m, "att", "attendanceRate");

  // Live sessions versus processed attendance. A wide gap means the reconciliation
  // engine is behind, which is exactly what a WFM owner needs to see.
  const liveVsProcessed = livePresent !== null && present !== null ? livePresent - present : null;

  // /api/integrations/cosec/sync-status returns { status, latest_run, data_confidence }.
  // The response was fetched on every WFM load and discarded — the layout expected a
  // device array that this endpoint has never returned.
  const syncStatus = (data.devices as Record<string, unknown>)?.integrationStatus as
    | Record<string, unknown>
    | undefined;
  const syncState = syncStatus?.status ? String(syncStatus.status) : null;
  const syncConfidence = asNumber(syncStatus?.data_confidence);
  const syncLatestRun = syncStatus?.latest_run as Record<string, unknown> | undefined;

  return (
    <div className="reference-dashboard-page">
      <ReferenceHeader
        title="WFM Dashboard"
        subtitle="Workforce management — headcount, roster and attendance"
        badge="WFM View"
        right={filters}
      />

      <TodayCelebrationsWidget />
      <PayrollPrepWidget month={currentMonth} />

      <ReferenceMetricGrid
        columns={5}
        loading={data.loading}
        metrics={[
          { label: "Attendance Rate", value: attendanceRate, valueSuffix: "%", helper: "Latest processed attendance day", icon: UserCheck, tone: attendanceRate === null ? "slate" : attendanceRate >= 85 ? "green" : attendanceRate >= 70 ? "amber" : "red", unavailableReason: metricUnavailableReason(m, "att"), ...drill("att") },
          { label: "Active Headcount", value: metricDetail(m, "hc", "active"), helper: "employees on the books", icon: Users, tone: "blue", href: "/employees", unavailableReason: metricUnavailableReason(m, "hc"), ...drill("hc") },
          { label: "Required HC", value: required, helper: required === null ? "Planning source unavailable" : "Planned or mandated requirement", icon: Users, tone: required === null ? "slate" : "blue", ...drill("hc") },
          { label: "Available HC", value: available, helper: available === null ? "Login-session source unavailable" : gap === null ? "Clocked-in workforce" : `${formatValue(gap)} net gap`, icon: UserCheck, tone: available === null || gap === null ? "slate" : gap > 0 ? "amber" : "green" },
          { label: "Roster Adherence", value: rosterAdherence, valueSuffix: "%", helper: "Rostered versus actual attendance", icon: Target, tone: rosterAdherence === null ? "slate" : "violet" },
          { label: "Missing Punch", value: missingPunch, helper: "Attendance exceptions", icon: Clock3, tone: missingPunch && missingPunch > 0 ? "red" : "green", ...drill("att") },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[1.04fr_0.96fr]">
        <ReferencePanel
          title="Today's Operations Alerts"
          action={<span className="rounded-full bg-[#ef4444] px-2 py-0.5 text-xs font-bold text-white">{formatValue(interventionRows.length)}</span>}
          bodyClassName="p-0"
        >
          <div className="divide-y divide-[#edf1f6]">
            {interventionRows.length ? interventionRows.slice(0, 4).map((row, index) => (
              <ReferenceListRow
                key={String(row.id ?? row.title ?? index)}
                icon={index % 3 === 0 ? Users : index % 3 === 1 ? CalendarClock : Clock3}
                title={String(row.title ?? row.label ?? "Operations alert")}
                subtitle={String(row.detail ?? row.description ?? row.message ?? "Requires review")}
                value={String(row.severity ?? row.priority ?? "View")}
                tone={String(row.severity ?? row.priority).toLowerCase().includes("high") ? "red" : "amber"}
                href={String(row.action_url ?? row.href ?? "/work-inbox")}
              />
            )) : (
              <p className="px-4 py-8 text-center text-sm text-[#a0aec0]">
                No source-backed operations alerts returned
              </p>
            )}
          </div>
        </ReferencePanel>

        <ReferenceAIBrief
          title="Automated Workforce Summary"
          actionHref="/reports"
          items={[
            { label: "Headcount Gap", value: gap, text: "Required versus available workforce in the selected branch and process.", icon: Users, tone: gap === null ? "slate" : gap > 0 ? "red" : "green" },
            { label: "Roster Adherence", value: rosterAdherence === null ? null : `${rosterAdherence}%`, text: "Rostered workforce compared with actual attendance.", icon: Target, tone: rosterAdherence === null ? "slate" : "violet" },
            { label: "Missing Punch Issues", value: missingPunch, text: "Employees requiring attendance correction or punch validation.", icon: Clock3, tone: missingPunch && missingPunch > 0 ? "red" : "green" },
            { label: "Shrinkage", value: shrinkage === null ? null : `${shrinkage}%`, text: "Current shrinkage calculated from live workforce and attendance data.", icon: Activity, tone: "blue" },
          ]}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.04fr_0.96fr]">
        <ReferencePanel title="Attendance Variance Buckets (vs Scheduled Hours)">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { label: "0 – 1 hr", value: variance.low, tone: "green" as const, helper: "Minor variance" },
              { label: "1 – 4 hr", value: variance.medium, tone: "amber" as const, helper: "Moderate variance" },
              { label: "4+ hr", value: variance.high, tone: "red" as const, helper: "Critical variance" },
            ].map((item) => (
              <div key={item.label} className={`rounded-lg border p-4 ${item.tone === "green" ? "border-[#d7f0df] bg-[#f2fbf5]" : item.tone === "amber" ? "border-[#fee3c5] bg-[#fff9f2]" : "border-[#ffdadd] bg-[#fff7f7]"}`}>
                <p className={`text-xs font-bold ${item.tone === "green" ? "text-[#16a34a]" : item.tone === "amber" ? "text-[#f97316]" : "text-[#ef4444]"}`}>{item.label}</p>
                <p className="mt-2 text-[25px] font-extrabold leading-none text-[#0b1f44]">{formatValue(item.value)}</p>
                <p className="mt-2 text-xs text-[#71809a]">Employees · {item.helper}</p>
              </div>
            ))}
          </div>
        </ReferencePanel>
        <ReferenceWorkInbox maxItems={4} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <ReferencePanel
          title="Processed Attendance Breakdown"
          action={
            <span className="text-xs text-[#61708a]">
              {expectedToWork === null ? "source unavailable" : `${formatValue(expectedToWork)} expected to work`}
            </span>
          }
          bodyClassName="p-0"
        >
          <div className="divide-y divide-[#edf1f6]">
            <ReferenceListRow icon={UserCheck} title="Present" subtitle="Full day attended" value={present} tone="green" />
            <ReferenceListRow icon={Clock3} title="Half Day" subtitle="Counted as 0.5 of a day" value={halfDay} tone="amber" />
            <ReferenceListRow icon={Clock3} title="Late Marks" subtitle="Flagged late on arrival" value={late} tone="amber" />
            <ReferenceListRow icon={Clock3} title="Missing Punch" subtitle="Requires punch correction" value={missingPunch} tone="red" />
            <ReferenceListRow icon={Users} title="Absent" subtitle="No attendance recorded" value={absent} tone="red" />
            <ReferenceListRow icon={CalendarClock} title="On Approved Leave" subtitle="Excluded from the attendance rate" value={onLeave} tone="blue" />
          </div>
        </ReferencePanel>

        <div className="grid gap-4">
          <ReferencePanel title="Live vs Processed">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-[#dbe7f8] bg-[#f5f9ff] p-4">
                <p className="text-xs font-bold text-[#0b63e5]">Live sessions</p>
                <p className="mt-2 text-[25px] font-extrabold leading-none text-[#0b1f44]">{formatValue(livePresent)}</p>
                <p className="mt-2 text-xs text-[#71809a]">Currently logged in</p>
              </div>
              <div className="rounded-lg border border-[#d7f0df] bg-[#f2fbf5] p-4">
                <p className="text-xs font-bold text-[#16a34a]">Processed present</p>
                <p className="mt-2 text-[25px] font-extrabold leading-none text-[#0b1f44]">{formatValue(present)}</p>
                <p className="mt-2 text-xs text-[#71809a]">Reconciled attendance</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-[#71809a]">
              {liveVsProcessed === null
                ? "One of the two sources is unavailable, so the gap cannot be computed."
                : `${formatValue(Math.abs(liveVsProcessed))} ${liveVsProcessed >= 0 ? "more live than processed" : "more processed than live"} — a large gap means reconciliation is behind.`}
            </p>
          </ReferencePanel>

          <ReferencePanel title="Biometric Sync Health">
            {syncState === null ? (
              <p className="py-6 text-center text-sm text-[#a0aec0]">Cosec sync status unavailable</p>
            ) : (
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[#61708a]">Status</span>
                  <span className={`font-bold ${syncState.toLowerCase().includes("ok") || syncState.toLowerCase().includes("health") ? "text-[#16a34a]" : "text-[#ef4444]"}`}>
                    {syncState}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#61708a]">Data confidence</span>
                  <span className="font-bold text-[#0b1f44]">{formatValue(syncConfidence, "%")}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#61708a]">Last run</span>
                  <span className="font-semibold text-[#0b1f44]">
                    {syncLatestRun?.started_at ? String(syncLatestRun.started_at) : "—"}
                  </span>
                </div>
              </div>
            )}
          </ReferencePanel>

          <AttendanceExceptionPanel data={data} />
          <BiometricCoveragePanel data={data} />
        </div>
      </div>
    </div>
  );
}
