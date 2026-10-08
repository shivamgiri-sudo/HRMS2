import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChartEmpty, Panel, RankedBars, TONE, type Tone } from "../../kit";
import type { ReferenceDashboardData } from "../../reference-dashboard-model";
import { asArray, asNumber, asRecord, metricAsOf } from "../../reference-dashboard-model";
import { deriveAtsStageSnapshot } from "../../dashboard-data-contracts";
import { bgvClearRate, onboardingSubmitRate, summaryFigures } from "./hrModel";

/** One rate row; null renders an em dash, never a 0% bar. */
function RateRow({ label, value, tone, helper, href }: { label: string; value: number | null; tone: Tone; helper?: string; href?: string }) {
  const body = (
    <div>
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="kit-num font-extrabold text-slate-900">{value === null ? "—" : `${value}%`}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
        {value !== null ? <div className={cn("h-full rounded-full", TONE[tone].solid)} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} /> : null}
      </div>
      {helper ? <p className="mt-1 text-[11px] text-slate-400">{helper}</p> : null}
    </div>
  );
  return href ? <Link to={href} className="block rounded-md hover:bg-slate-50">{body}</Link> : body;
}

/**
 * Onboarding submit rate, attendance and BGV clear rate. Each is null (not 0) when an input is missing.
 * BGV clear rate = cleared / (cleared + pending + flagged + breached), all candidates; the old gauge divided
 * pending background checks by employees on the payroll, then by a "cleared" that included stale pending.
 */
export function HrRatesPanel({ data }: { data: ReferenceDashboardData }) {
  const f = summaryFigures(data);
  const onb = onboardingSubmitRate(f.onbSubmitted, f.onbPending);
  const bgv = bgvClearRate(f.bgvCleared, f.bgvPending, f.bgvFlagged, f.bgvBreached);
  const att = f.attendanceRate === null ? null : Math.round(f.attendanceRate);
  const asOf = metricAsOf(data.metrics, "att");
  return (
    <Panel title="Pipeline health" subtitle="Rates computed from live queues" bodyClassName="space-y-4">
      <RateRow label="Onboarding submitted" value={onb} tone={onb !== null && onb >= 60 ? "green" : "amber"} helper="profiles submitted / (submitted + pending)" href="/ats/onboarding-requests" />
      <RateRow label="Attendance" value={att} tone={att !== null && att >= 90 ? "green" : att !== null && att >= 75 ? "amber" : "red"} helper={asOf ? `processed attendance, ${asOf}` : "processed attendance"} href="/wfm-attendance" />
      <RateRow label="BGV cleared" value={bgv} tone={bgv !== null && bgv >= 70 ? "green" : "amber"} helper="cleared / (cleared + pending + flagged), candidates" href="/ats/bgv" />
    </Panel>
  );
}

/** Today's processed attendance from the organisation-wide aggregate, labelled with the day it describes. */
export function HrAttendanceTodayPanel({ data }: { data: ReferenceDashboardData }) {
  const agg = asRecord(data.workforce.attendance);
  const statuses = asArray(agg.statuses);
  if (!statuses.length) {
    return <Panel title="Processed attendance" href="/wfm-attendance"><ChartEmpty text="Attendance data not available" /></Panel>;
  }
  const pick = (name: string) => {
    const hit = statuses.find((s) => String(s.label ?? "").toLowerCase() === name);
    return hit ? asNumber(hit.value) : null;
  };
  const cells: Array<[string, number | null, Tone]> = [
    ["Present", pick("present"), "green"], ["Absent", pick("absent"), "red"], ["Half day", pick("half_day"), "amber"], ["Missing punch", pick("missing_punch"), "violet"],
  ];
  const date = String(agg.record_date ?? "");
  const behind = asNumber(agg.data_age_days);
  return (
    <Panel title="Processed attendance" subtitle={`${(asNumber(agg.total) ?? 0).toLocaleString("en-IN")} employees${date ? ` · ${date.slice(0, 10)}` : ""}${behind ? ` (${behind}d behind)` : ""}`} href="/wfm-attendance">
      <div className="grid grid-cols-2 gap-2">
        {cells.map(([label, v, tone]) => (
          <div key={label} className={cn("rounded-xl p-3 text-center", TONE[tone].soft)}>
            <p className={cn("kit-num text-[22px] font-extrabold", TONE[tone].text)}>{v === null ? "—" : v.toLocaleString("en-IN")}</p>
            <p className="text-[11px] text-slate-500">{label}</p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/** Leave by status: today's queue vs the open backlog are different counts and both are shown. */
export function HrLeavePanel({ data }: { data: ReferenceDashboardData }) {
  const f = summaryFigures(data);
  const byStatus: Record<string, number> = {};
  for (const row of asArray(data.workforce.leave_summary ?? data.workforce.leaveSummary)) {
    const key = String(row.status ?? "").toLowerCase();
    const n = asNumber(row.count);
    if (key && n !== null) byStatus[key] = n;
  }
  const items: Array<[string, number | null, Tone]> = [
    ["Pending approval", byStatus.pending ?? null, "amber"], ["Open backlog", f.leavePending, "violet"], ["Approved", byStatus.approved ?? null, "green"],
  ];
  const has = items.some(([, v]) => v !== null);
  return (
    <Panel title="Leave summary" subtitle={f.legacyLeave ? `${f.legacyLeave.toLocaleString("en-IN")} migrated requests held out as legacy` : undefined} href="/leaves" hrefLabel="Open leave">
      {has ? (
        <div className="grid grid-cols-3 gap-2">
          {items.map(([label, v, tone]) => (
            <div key={label} className={cn("rounded-xl p-3 text-center", TONE[tone].soft)}>
              <p className={cn("kit-num text-[20px] font-extrabold", TONE[tone].text)}>{v === null ? "—" : v.toLocaleString("en-IN")}</p>
              <p className="text-[11px] text-slate-500">{label}</p>
            </div>
          ))}
        </div>
      ) : <ChartEmpty text="Leave data not available" />}
    </Panel>
  );
}

/** Current candidates by ATS stage. These are disjoint "sitting at this stage now" counts, not a drop-off funnel. */
export function HrAtsStagePanel({ data }: { data: ReferenceDashboardData }) {
  const total = asNumber(data.ats.total_candidates ?? data.ats.total_applications);
  const s = deriveAtsStageSnapshot(data.ats.by_stage, total);
  const points = ([["All candidates", s.applications], ["At screening", s.screened], ["At interview", s.interviewed], ["At offer", s.offered], ["Joined / converted", s.joined]] as const)
    .filter(([, v]) => v !== null).map(([label, value]) => ({ label, value }));
  return (
    <Panel title="Candidate pipeline by stage" subtitle="Where candidates sit right now; not a drop-off funnel" href="/ats/dashboard" hrefLabel="Open ATS">
      {points.length ? <RankedBars points={points} unit="count" tone="violet" /> : <ChartEmpty text="ATS pipeline data not available" />}
    </Panel>
  );
}

/** Branch headcount mix from the workforce feed. */
export function HrBranchMixPanel({ data }: { data: ReferenceDashboardData }) {
  const list = asArray(data.workforce.branches ?? data.workforce.process_breakdown ?? data.workforce.processBreakdown ?? data.workforce.department_breakdown ?? data.workforce.departmentBreakdown);
  const points = list.map((d) => ({
    label: String(d.branch_name ?? d.branchName ?? d.process_name ?? d.processName ?? d.department ?? d.name ?? "Unknown"),
    value: asNumber(d.employee_count ?? d.headcount ?? d.count ?? d.total) ?? 0,
  })).filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
  return (
    <Panel title="Headcount by branch" href="/employees" hrefLabel="Employees">
      {points.length ? <RankedBars points={points} unit="count" limit={8} /> : <ChartEmpty text="Branch breakdown not available" />}
    </Panel>
  );
}

const COLORS = ["from-blue-500 to-indigo-600", "from-violet-500 to-fuchsia-600", "from-emerald-500 to-teal-600", "from-amber-500 to-orange-600", "from-cyan-500 to-blue-600", "from-rose-500 to-pink-600"];

/** Latest joiners from the workforce feed. */
export function HrRecentJoinersPanel({ data }: { data: ReferenceDashboardData }) {
  const w = data.workforce;
  const raw = asArray(w.recent_joiners ?? w.recentJoiners ?? w.recent_joins ?? w.recentJoins ?? w.new_employees ?? w.newEmployees).slice(0, 6);
  return (
    <Panel title="Recent joiners" href="/employees" hrefLabel="View all">
      {raw.length ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {raw.map((e, i) => {
            const name = String(e.employee_name ?? e.employeeName ?? e.name ?? e.full_name ?? "Unknown");
            const role = String(e.designation_name ?? e.designationName ?? e.designation ?? e.role ?? e.job_title ?? "");
            const dept = String(e.branch_name ?? e.branchName ?? e.department ?? e.process_name ?? e.processName ?? "");
            return (
              <li key={`${name}-${i}`} className="flex items-center gap-3 rounded-xl p-2 hover:bg-slate-50">
                <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-[13px] font-bold text-white", COLORS[i % COLORS.length])}>
                  {name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-slate-800">{name}</span>
                  <span className="block truncate text-[11px] text-slate-500">{[role, dept].filter(Boolean).join(" · ")}</span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : <ChartEmpty text="No recent joins data available" />}
    </Panel>
  );
}

/** The four onboarding stages with a live total, each linking to the page where it is worked. */
export function HrApprovalStages({ data }: { data: ReferenceDashboardData }) {
  const f = summaryFigures(data);
  const stages: Array<[string, number | null, string]> = [
    ["Onboarding", f.onbPending, "/ats/onboarding-requests"], ["BGV verify", f.bgvPending, "/ats/bgv"],
    ["Appointment e-sign", f.appointmentEsign, "/provisioning/appointment-letter"], ["Joining docs", f.joiningDocEsign, "/ats/joining-documents-tracker"],
  ];
  const known = stages.filter(([, v]) => v !== null);
  const total = known.reduce((s, [, v]) => s + (v ?? 0), 0);
  return (
    <Panel title="Pending approvals summary" subtitle={known.length === stages.length ? `${total.toLocaleString("en-IN")} across onboarding, BGV, e-sign and joining docs` : `${total.toLocaleString("en-IN")} across the stages that loaded`}>
      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stages.map(([name, v, href], i) => (
          <li key={name}>
            <Link to={href} className="group flex flex-col items-center gap-2 rounded-xl p-2 text-center hover:bg-slate-50">
              <span className={cn("kit-num flex h-12 w-12 items-center justify-center rounded-full text-[15px] font-extrabold ring-2", v === null ? "bg-slate-50 text-slate-400 ring-slate-200" : i === 0 ? "bg-indigo-600 text-white ring-indigo-200" : "bg-white text-slate-800 ring-slate-200")}>
                {v === null ? "—" : v.toLocaleString("en-IN")}
              </span>
              <span className="flex items-center gap-1 text-[12px] font-semibold text-slate-700">{name}<ArrowRight className="h-3 w-3 text-slate-300 group-hover:text-slate-600" /></span>
            </Link>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
