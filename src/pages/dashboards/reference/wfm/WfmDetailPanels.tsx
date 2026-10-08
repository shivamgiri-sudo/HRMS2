import { Activity, CalendarClock, Clock3, Target, UserCheck, Users } from "lucide-react";
import { ReferenceListRow, ReferencePanel } from "../../ReferenceDashboardUI";
import { ReferenceAIBrief } from "../ReferenceOperationalPanels";
import type { ReferenceDashboardData } from "../../reference-dashboard-model";
import { arrayAt, asNumber, formatValue, metricAsOf, metricDetail } from "../../reference-dashboard-model";

/**
 * The pre-redesign WFM panels, regrouped under "Operational detail". Every datapoint they showed is still
 * here; where the old panel mislabelled its window or compared different days the label/logic is corrected.
 */

export function OperationsAlertsPanel({ data }: { data: ReferenceDashboardData }) {
  const rows = arrayAt(data.opsPulse, "intervention_flags");
  return (
    <ReferencePanel title="Today's Operations Alerts" action={<span className="rounded-full bg-[#ef4444] px-2 py-0.5 text-xs font-bold text-white">{formatValue(rows.length)}</span>} bodyClassName="p-0">
      <div className="divide-y divide-[#edf1f6]">
        {rows.length ? rows.slice(0, 5).map((row, index) => {
          const sev = String(row.severity ?? row.priority ?? "").toLowerCase();
          return (
            <ReferenceListRow key={String(row.id ?? row.title ?? index)} icon={index % 3 === 0 ? Users : index % 3 === 1 ? CalendarClock : Clock3}
              title={String(row.title ?? row.label ?? "Operations alert")} subtitle={String(row.detail ?? row.description ?? row.message ?? "Requires review")}
              value={String(row.severity ?? row.priority ?? "View")} tone={sev.includes("high") ? "red" : "amber"} href={String(row.action_url ?? row.href ?? "/work-inbox")} />
          );
        }) : <p className="px-4 py-8 text-center text-sm text-[#a0aec0]">No source-backed operations alerts returned</p>}
      </div>
    </ReferencePanel>
  );
}

export function WorkforceSummary({ data }: { data: ReferenceDashboardData }) {
  const m = data.metrics;
  const required = metricDetail(m, "hc", "required");
  const available = metricDetail(m, "hc", "available");
  const gap = required !== null && available !== null ? Math.max(0, required - available) : null;
  const rosterAdherence = asNumber(data.biometric.roster_adherence_pct);
  const missingPunch = metricDetail(m, "att", "missedPunch");
  const shrinkage = asNumber(data.biometric.shrinkage_pct);
  return (
    <ReferenceAIBrief title="Automated Workforce Summary" actionHref="/reports" items={[
      { label: "Headcount Gap", value: gap, text: "Mandated headcount minus agents logged in right now. Early in the day this is large by construction.", icon: Users, tone: gap === null ? "slate" : gap > 0 ? "red" : "green" },
      { label: "Roster Adherence", value: rosterAdherence === null ? null : `${rosterAdherence}%`, text: "Rostered workforce compared with actual attendance.", icon: Target, tone: rosterAdherence === null ? "slate" : "violet" },
      { label: "Missing Punch Issues", value: missingPunch, text: "Employees requiring attendance correction or punch validation.", icon: Clock3, tone: missingPunch && missingPunch > 0 ? "red" : "green" },
      { label: "Shrinkage (month to date)", value: shrinkage === null ? null : `${shrinkage}%`, text: "Absent plus approved-leave days over days people were due to work.", icon: Activity, tone: "blue" },
    ]} />
  );
}

export function LateSeverityPanel({ data }: { data: ReferenceDashboardData }) {
  const b = data.biometric;
  const items = [
    { label: "Up to 1 hr late", value: asNumber(b.variance_0_1 ?? b.variance_bucket_0_1), cls: "border-[#d7f0df] bg-[#f2fbf5] text-[#16a34a]", helper: "Minor" },
    { label: "1 – 4 hr late", value: asNumber(b.variance_1_4 ?? b.variance_bucket_1_4), cls: "border-[#fee3c5] bg-[#fff9f2] text-[#f97316]", helper: "Moderate" },
    { label: "4+ hr late", value: asNumber(b.variance_4_plus ?? b.variance_bucket_4_plus), cls: "border-[#ffdadd] bg-[#fff7f7] text-[#ef4444]", helper: "Critical" },
  ];
  return (
    <ReferencePanel title="Late-arrival severity (month to date)">
      <div className="grid gap-3 sm:grid-cols-3">
        {items.map((item) => (
          <div key={item.label} className={`rounded-lg border p-4 ${item.cls.split(" ").slice(0, 2).join(" ")}`}>
            <p className={`text-xs font-bold ${item.cls.split(" ")[2]}`}>{item.label}</p>
            <p className="mt-2 text-[25px] font-extrabold leading-none text-[#0b1f44]">{formatValue(item.value)}</p>
            <p className="mt-2 text-xs text-[#71809a]">Late marks · {item.helper}</p>
          </div>
        ))}
      </div>
    </ReferencePanel>
  );
}

export function ProcessedBreakdown({ data }: { data: ReferenceDashboardData }) {
  const m = data.metrics;
  const asOf = metricAsOf(m, "att");
  const expected = metricDetail(m, "att", "expectedToWork");
  return (
    <ReferencePanel title="Processed Attendance Breakdown" action={<span className="text-xs text-[#61708a]">{expected === null ? "source unavailable" : `${formatValue(expected)} expected to work${asOf ? ` · ${asOf}` : ""}`}</span>} bodyClassName="p-0">
      <div className="divide-y divide-[#edf1f6]">
        <ReferenceListRow icon={UserCheck} title="Present" subtitle="Full day attended" value={metricDetail(m, "att", "present")} tone="green" />
        <ReferenceListRow icon={Clock3} title="Half Day" subtitle="Counted as 0.5 of a day" value={metricDetail(m, "att", "halfDay")} tone="amber" />
        <ReferenceListRow icon={Clock3} title="Late Marks" subtitle="Flagged late on arrival" value={metricDetail(m, "att", "late")} tone="amber" />
        <ReferenceListRow icon={Clock3} title="Missing Punch" subtitle="Requires punch correction" value={metricDetail(m, "att", "missedPunch")} tone="red" />
        <ReferenceListRow icon={Users} title="Absent" subtitle="No attendance recorded" value={metricDetail(m, "att", "absent")} tone="red" />
        <ReferenceListRow icon={CalendarClock} title="On Approved Leave" subtitle="Excluded from the attendance rate" value={metricDetail(m, "att", "onLeave")} tone="blue" />
      </div>
    </ReferencePanel>
  );
}

/** Live sessions (today) beside processed present (the anchor day). Different days, so never subtracted. */
export function LiveVsProcessed({ data }: { data: ReferenceDashboardData }) {
  const m = data.metrics;
  const live = metricDetail(m, "att", "livePresent");
  const present = metricDetail(m, "att", "present");
  const asOf = metricAsOf(m, "att");
  return (
    <ReferencePanel title="Live vs Processed">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-[#dbe7f8] bg-[#f5f9ff] p-4">
          <p className="text-xs font-bold text-[#0b63e5]">Live sessions · today</p>
          <p className="mt-2 text-[25px] font-extrabold leading-none text-[#0b1f44]">{formatValue(live)}</p>
          <p className="mt-2 text-xs text-[#71809a]">Currently logged in</p>
        </div>
        <div className="rounded-lg border border-[#d7f0df] bg-[#f2fbf5] p-4">
          <p className="text-xs font-bold text-[#16a34a]">Processed present · {asOf ?? "latest day"}</p>
          <p className="mt-2 text-[25px] font-extrabold leading-none text-[#0b1f44]">{formatValue(present)}</p>
          <p className="mt-2 text-xs text-[#71809a]">Reconciled attendance</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-[#71809a]">
        These describe different days (live is today; processed trails by a day), so they are shown side by side and not subtracted. The same-day comparison is on the Attendance dashboard.
      </p>
    </ReferencePanel>
  );
}

export function SyncHealthPanel({ data }: { data: ReferenceDashboardData }) {
  // /api/integrations/cosec/sync-status returns { status, latest_run, data_confidence }.
  const status = (data.devices as Record<string, unknown>)?.integrationStatus as Record<string, unknown> | undefined;
  const state = status?.status ? String(status.status) : null;
  const confidence = asNumber(status?.data_confidence);
  const latest = status?.latest_run as Record<string, unknown> | undefined;
  return (
    <ReferencePanel title="Biometric Sync Health">
      {state === null ? <p className="py-6 text-center text-sm text-[#a0aec0]">Cosec sync status unavailable</p> : (
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between"><span className="text-[#61708a]">Status</span>
            <span className={`font-bold ${state.toLowerCase().includes("ok") || state.toLowerCase().includes("health") ? "text-[#16a34a]" : "text-[#ef4444]"}`}>{state}</span></div>
          <div className="flex items-center justify-between"><span className="text-[#61708a]">Data confidence</span><span className="font-bold text-[#0b1f44]">{formatValue(confidence, "%")}</span></div>
          <div className="flex items-center justify-between"><span className="text-[#61708a]">Last run</span><span className="font-semibold text-[#0b1f44]">{latest?.started_at ? String(latest.started_at) : "—"}</span></div>
        </div>
      )}
    </ReferencePanel>
  );
}
