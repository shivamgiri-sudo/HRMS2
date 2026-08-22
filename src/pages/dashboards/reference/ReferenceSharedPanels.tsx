/**
 * Panels shared by several role dashboards.
 *
 * The ATTENDANCE, ONBOARDING and PAYROLL_READINESS metrics each return a full breakdown
 * on every dashboard load, and most layouts rendered only the single headline number —
 * 172 datapoints across the twelve dashboards were fetched and discarded. Rather than
 * copy the same panel into eight layouts, each breakdown lives here once.
 *
 * Every value comes from a metric already in the dashboard's bundle: no new endpoint and
 * no new query. Where a metric's source is empty or failed, the panel says so instead of
 * rendering zeros.
 */
import {
  BookOpen,
  CalendarClock,
  Clock3,
  Fingerprint,
  FileCheck2,
  FileWarning,
  GraduationCap,
  ShieldCheck,
  TrendingUp,
  TriangleAlert,
  UserCheck,
  UserSearch,
  Users,
  WalletCards,
} from "lucide-react";

import { ReferenceListRow, ReferencePanel } from "../ReferenceDashboardUI";
import type { ReferenceDashboardData } from "../reference-dashboard-model";
import { formatValue, metricAsOf, metricDetail, metricUnavailableReason } from "../reference-dashboard-model";

/**
 * `drilldownFor` is optional on the model, and an inline `() => ({})` fallback types as
 * `{}` — which has no `onDrilldown` property. This keeps the return type explicit so a
 * panel can ask for a drill-down handler without a cast.
 */
function drilldownHandler(
  data: ReferenceDashboardData,
  metricKey: string,
): (() => void) | undefined {
  return data.drilldownFor?.(metricKey).onDrilldown;
}

/**
 * Processed attendance breakdown for the latest complete attendance day.
 *
 * Anchored server-side on the last substantially-processed day rather than today,
 * because today is typically partial and reads as 0% attendance.
 */
export function AttendanceBreakdownPanel({ data }: { data: ReferenceDashboardData }) {
  const m = data.metrics;
  const reason = metricUnavailableReason(m, "att");
  const expected = metricDetail(m, "att", "expectedToWork");
  const rate = metricDetail(m, "att", "attendanceRate");
  const noSource = metricDetail(m, "att", "noAttendanceSource");
  // The day this actually describes, and how much of it is still unreconciled.
  // Without both, a 19% reading looks like a broken panel rather than a day whose
  // punches have not been processed yet.
  const asOf = metricAsOf(m, "att");
  const unreconciledPct = metricDetail(m, "att", "unreconciledPct");
  const missedPunch = metricDetail(m, "att", "missedPunch");
  const totalRecords = metricDetail(m, "att", "totalRecords");

  return (
    <ReferencePanel
      title="Processed Attendance Breakdown"
      action={
        <span className="text-xs text-[#61708a]">
          {reason
            ? reason
            : expected === null
              ? "denominator unavailable"
              : `${formatValue(rate, "%")} of ${formatValue(expected)} expected to work${asOf ? ` · as of ${asOf}` : ""}`}
        </span>
      }
      bodyClassName="p-0"
    >
      {!reason && unreconciledPct !== null && unreconciledPct >= 40 ? (
        <div className="border-b border-[#fde68a] bg-[#fffbeb] px-4 py-2 text-xs text-[#92400e]">
          {formatValue(missedPunch)} of {formatValue(totalRecords)} punches on {asOf ?? "this day"} are
          still unreconciled, so the present figure understates actual attendance.
        </div>
      ) : null}
      {reason ? (
        <p className="px-4 py-8 text-center text-sm text-[#a0aec0]">{reason}</p>
      ) : (
        <div className="divide-y divide-[#edf1f6]">
          <ReferenceListRow icon={UserCheck} title="Present" subtitle="Full day attended" value={metricDetail(m, "att", "present")} tone="green" />
          <ReferenceListRow icon={Clock3} title="Half Day" subtitle="Counted as half a day in the rate" value={metricDetail(m, "att", "halfDay")} tone="amber" />
          <ReferenceListRow icon={Clock3} title="Late Marks" subtitle="Flagged late on arrival" value={metricDetail(m, "att", "late")} tone="amber" />
          <ReferenceListRow icon={TriangleAlert} title="Missing Punch" subtitle="Needs punch correction" value={metricDetail(m, "att", "missedPunch")} tone="red" href="/wfm/attendance-exceptions" />
          <ReferenceListRow icon={Users} title="Absent" subtitle="No attendance recorded" value={metricDetail(m, "att", "absent")} tone="red" />
          <ReferenceListRow icon={CalendarClock} title="On Approved Leave" subtitle="Excluded from the attendance rate" value={metricDetail(m, "att", "onLeave")} tone="blue" href="/leaves" />
          {/*
            Distinguishes "cannot register a punch" from "did not attend". 352 of 1,344
            active employees have produced no biometric minute in 30 days, so a quarter of
            the denominator can never be marked present — which is why the org rate reads
            far lower than the workforce actually behaves. Without this row the rate looks
            like an attendance collapse rather than an enrolment gap.
          */}
          {noSource !== null && noSource > 0 ? (
            <ReferenceListRow
              icon={TriangleAlert}
              title="No Attendance Source"
              subtitle="Active employees with no biometric punch in 30 days — they cannot be marked present"
              value={noSource}
              tone="amber"
              href="/wfm/mismatch-queue"
            />
          ) : null}
        </div>
      )}
    </ReferencePanel>
  );
}

/**
 * Live login sessions versus reconciled attendance. A wide gap means the reconciliation
 * engine is behind — the single most useful signal for a WFM or operations owner.
 */
export function LiveVsProcessedPanel({ data }: { data: ReferenceDashboardData }) {
  const m = data.metrics;
  const live = metricDetail(m, "att", "livePresent");
  const processed = metricDetail(m, "att", "present");
  const gap = live !== null && processed !== null ? live - processed : null;

  return (
    <ReferencePanel title="Live vs Processed">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-[#dbe7f8] bg-[#f5f9ff] p-4">
          <p className="text-xs font-bold text-[#0b63e5]">Live sessions</p>
          <p className="mt-2 text-[25px] font-extrabold leading-none text-[#0b1f44]">{formatValue(live)}</p>
          <p className="mt-2 text-xs text-[#71809a]">Currently logged in</p>
        </div>
        <div className="rounded-lg border border-[#d7f0df] bg-[#f2fbf5] p-4">
          <p className="text-xs font-bold text-[#16a34a]">Processed present</p>
          <p className="mt-2 text-[25px] font-extrabold leading-none text-[#0b1f44]">{formatValue(processed)}</p>
          <p className="mt-2 text-xs text-[#71809a]">Reconciled attendance</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-[#71809a]">
        {gap === null
          ? "One of the two sources is unavailable, so the gap cannot be computed."
          : `${formatValue(Math.abs(gap))} ${gap >= 0 ? "more live than processed" : "more processed than live"} — a large gap means reconciliation is behind.`}
      </p>
    </ReferencePanel>
  );
}

/** Onboarding pipeline funnel from the ONBOARDING metric's detail. */
export function OnboardingFunnelPanel({ data }: { data: ReferenceDashboardData }) {
  const m = data.metrics;
  const reason = metricUnavailableReason(m, "onb");
  const total = metricDetail(m, "onb", "total");

  return (
    <ReferencePanel
      title="Onboarding Pipeline"
      action={<span className="text-xs text-[#61708a]">{reason ? reason : `${formatValue(total)} candidates`}</span>}
      bodyClassName="p-0"
    >
      {reason ? (
        <p className="px-4 py-8 text-center text-sm text-[#a0aec0]">{reason}</p>
      ) : (
        <div className="divide-y divide-[#edf1f6]">
          <ReferenceListRow icon={Clock3} title="Pending" subtitle="Awaiting candidate submission" value={metricDetail(m, "onb", "pending")} tone="amber" href="/ats/onboarding-requests" />
          <ReferenceListRow icon={FileCheck2} title="Profile Submitted" subtitle="Ready for HR review" value={metricDetail(m, "onb", "submitted")} tone="blue" href="/ats/onboarding-bridge" />
          <ReferenceListRow icon={UserCheck} title="Joined" subtitle="Converted to employee" value={metricDetail(m, "onb", "joined")} tone="green" href="/ats/joining-control-room" />
          <ReferenceListRow icon={TriangleAlert} title="Stuck" subtitle="Beyond the ageing threshold" value={metricDetail(m, "onb", "stuck")} tone="red" href="/ats/onboarding-requests" />
          {/* Reads otpVerified, which is what the query counts. The old key was
              named otpPending while counting the opposite. */}
          <ReferenceListRow icon={ShieldCheck} title="OTP Verified" subtitle="Candidate identity confirmed" value={metricDetail(m, "onb", "otpVerified")} tone="blue" />
        </div>
      )}
    </ReferencePanel>
  );
}

/**
 * Payroll readiness blockers. Counts only — never per-employee bank / PAN / UAN values,
 * since this panel appears on dashboards whose viewers are not payroll roles.
 */
export function PayrollBlockersPanel({ data }: { data: ReferenceDashboardData }) {
  const m = data.metrics;
  const reason = metricUnavailableReason(m, "payroll");
  const ready = metricDetail(m, "payroll", "readyCount");
  const total = metricDetail(m, "payroll", "total");

  return (
    <ReferencePanel
      title="Payroll Readiness Blockers"
      action={
        <span className="text-xs text-[#61708a]">
          {reason ? reason : ready !== null && total !== null ? `${ready} of ${total} ready` : "readiness unavailable"}
        </span>
      }
      bodyClassName="p-0"
    >
      {reason ? (
        <p className="px-4 py-8 text-center text-sm text-[#a0aec0]">{reason}</p>
      ) : (
        <div className="divide-y divide-[#edf1f6]">
          <ReferenceListRow icon={WalletCards} title="Missing Bank Account" subtitle="Cannot be paid by NEFT" value={metricDetail(m, "payroll", "missingBank")} tone="red" href="/employees" />
          <ReferenceListRow icon={FileCheck2} title="Missing PAN" subtitle="Blocks TDS computation" value={metricDetail(m, "payroll", "missingPan")} tone="red" href="/employees" />
          <ReferenceListRow icon={ShieldCheck} title="Missing UAN" subtitle="Blocks PF filing" value={metricDetail(m, "payroll", "missingUan")} tone="amber" href="/employees" />
          <ReferenceListRow icon={Users} title="Total Blocked" subtitle="Not payroll-ready" value={metricDetail(m, "payroll", "blockerCount")} tone="red" />
        </div>
      )}
    </ReferencePanel>
  );
}

/**
 * eSign and verification splits: who is actually blocking each document.
 *
 * The APPOINTMENT_ESIGN and BGV metrics return these breakdowns on every HR load and
 * only their headline counts were shown — so "10 pending" gave no indication whether
 * the candidate or the company was holding it up, and "73 BGV pending" hid that 60
 * cases had already come back flagged.
 */
export function EsignVerificationPanel({ data }: { data: ReferenceDashboardData }) {
  const m = data.metrics;
  const aeReason = metricUnavailableReason(m, "appointmentEsign");
  const bgvReason = metricUnavailableReason(m, "bgv");

  return (
    <ReferencePanel title="eSign & Verification Detail" bodyClassName="p-0">
      <div className="divide-y divide-[#edf1f6]">
        {aeReason ? (
          <p className="px-4 py-4 text-sm text-[#a0aec0]">Appointment letters: {aeReason}</p>
        ) : (
          <>
            <ReferenceListRow icon={FileCheck2} title="Awaiting Candidate Signature" subtitle="Appointment letter sent, not signed" value={metricDetail(m, "appointmentEsign", "candidatePending")} tone="amber" href="/provisioning/appointment-letter" />
            <ReferenceListRow icon={FileCheck2} title="Awaiting Company Signature" subtitle="Candidate signed, company has not" value={metricDetail(m, "appointmentEsign", "companyPending")} tone="red" href="/provisioning/appointment-letter" />
            <ReferenceListRow icon={TriangleAlert} title="Manual Override Requested" subtitle="Bypassing eSign, needs approval" value={metricDetail(m, "appointmentEsign", "overrideRequested")} tone="red" />
          </>
        )}
        {bgvReason ? (
          <p className="px-4 py-4 text-sm text-[#a0aec0]">BGV: {bgvReason}</p>
        ) : (
          <>
            <ReferenceListRow icon={ShieldCheck} title="BGV Cleared" subtitle="Verification passed" value={metricDetail(m, "bgv", "cleared")} tone="green" href="/ats/bgv" />
            <ReferenceListRow icon={TriangleAlert} title="BGV Flagged" subtitle="Failed or mismatched — needs review" value={metricDetail(m, "bgv", "flagged")} tone="red" href="/ats/bgv" />
          </>
        )}
        <ReferenceListRow icon={FileCheck2} title="Joining Documents Outstanding" subtitle="eSign checklist items not complete" value={metricDetail(m, "joiningDocEsign", "total")} tone="amber" href="/ats/joining-documents-tracker" />
      </div>
    </ReferencePanel>
  );
}

/** Exit / resignation pipeline from the RESIGNATION metric's detail. */
export function ExitPipelinePanel({ data }: { data: ReferenceDashboardData }) {
  const m = data.metrics;
  const reason = metricUnavailableReason(m, "resign");
  const total = metricDetail(m, "resign", "totalActive");

  return (
    <ReferencePanel
      title="Exit Pipeline"
      action={<span className="text-xs text-[#61708a]">{reason ? reason : `${formatValue(total)} active`}</span>}
      bodyClassName="p-0"
    >
      {reason ? (
        <p className="px-4 py-8 text-center text-sm text-[#a0aec0]">{reason}</p>
      ) : (
        <div className="divide-y divide-[#edf1f6]">
          <ReferenceListRow icon={Clock3} title="Pending Discussion" subtitle="Awaiting manager conversation" value={metricDetail(m, "resign", "pendingDiscussion")} tone="amber" href="/exit/command-center" />
          <ReferenceListRow icon={UserCheck} title="Accepted" subtitle="Resignation approved" value={metricDetail(m, "resign", "accepted")} tone="blue" href="/exit/command-center" />
          <ReferenceListRow icon={TriangleAlert} title="Withdrawn" subtitle="Employee retained" value={metricDetail(m, "resign", "withdrawn")} tone="green" href="/exit/command-center" />
        </div>
      )}
    </ReferencePanel>
  );
}

/**
 * Open attendance reconciliation exceptions — the queue that blocks payroll.
 *
 * `payableMismatch` is the one that literally stops a run, so it leads. `unscopeable`
 * is shown because ~23% of these issues carry no employee link (mostly unmapped COSEC
 * users, which by definition have no employee yet) and so appear in no branch's count;
 * without the line, a branch head's total would silently under-report the org backlog.
 */
export function AttendanceExceptionPanel({ data }: { data: ReferenceDashboardData }) {
  const m = data.metrics;
  const reason = metricUnavailableReason(m, "attException");
  const blockers = metricDetail(m, "attException", "blockers");
  const unscopeable = metricDetail(m, "attException", "unscopeable");

  return (
    <ReferencePanel
      title="Attendance Exceptions"
      action={
        <span className="text-xs text-[#61708a]">
          {reason ? reason : blockers === null ? "severity unavailable" : `${formatValue(blockers)} blocking payroll`}
        </span>
      }
      bodyClassName="p-0"
      onDrilldown={drilldownHandler(data, "attException")}
    >
      {reason ? (
        <p className="px-4 py-8 text-center text-sm text-[#a0aec0]">{reason}</p>
      ) : (
        <div className="divide-y divide-[#edf1f6]">
          {/* Every row here is counted from `attendance_reconciliation_issue`, so each link
              carries its own filter into the exception engine, which now reads that same
              table. Payable Days Mismatch previously pointed at /wfm/mismatch-queue, which
              reads `attendance_daily_record` and could never show these rows. */}
          <ReferenceListRow icon={WalletCards} title="Payable Days Mismatch" subtitle="Blocks the payroll run until reconciled" value={metricDetail(m, "attException", "payableMismatch")} tone="red" href="/wfm/attendance-exceptions?issueType=salary_payable_days_mismatch&status=open" />
          <ReferenceListRow icon={FileWarning} title="Missing Attendance Record" subtitle="No daily record was created" value={metricDetail(m, "attException", "missingAdr")} tone="red" href="/wfm/attendance-exceptions?issueType=missing_adr&status=open" />
          <ReferenceListRow icon={Fingerprint} title="Unmapped Biometric User" subtitle="Punches cannot be matched to an employee" value={metricDetail(m, "attException", "unmappedCosec")} tone="amber" href="/wfm/attendance-exceptions?issueType=unmapped_cosec_user&status=open" />
          <ReferenceListRow icon={TriangleAlert} title="Warnings" subtitle="Non-blocking, needs review" value={metricDetail(m, "attException", "warnings")} tone="amber" href="/wfm/attendance-exceptions?severity=warning&status=open" />
          <ReferenceListRow icon={UserCheck} title="Resolved (30d)" subtitle="Cleared in the last 30 days" value={metricDetail(m, "attException", "resolved")} tone="green" href="/wfm/attendance-exceptions?status=resolved" />
          <ReferenceListRow icon={FileWarning} title="Total Open" subtitle="All unresolved exceptions in the last 30 days" value={metricDetail(m, "attException", "openTotal")} tone="amber" href="/wfm/attendance-exceptions?status=open" />
          {unscopeable !== null && unscopeable > 0 ? (
            <ReferenceListRow icon={Users} title="No Employee Link" subtitle="Counted org-wide only — cannot be attributed to a branch" value={unscopeable} tone="blue" />
          ) : null}
        </div>
      )}
    </ReferencePanel>
  );
}

/**
 * Document compliance for active employees.
 *
 * Scoped to active employees deliberately: the table holds 207k documents across 22.6k
 * employees, but only ~1.3k are active, so the full backlog is historical debt that never
 * reaches zero. Document expiry is not shown — `expiry_date` is 0% populated for active
 * employees, so an "expiring soon" row would be a permanent, misleading zero.
 */
export function DocumentCompliancePanel({ data }: { data: ReferenceDashboardData }) {
  const m = data.metrics;
  const reason = metricUnavailableReason(m, "docCompliance");
  const coverage = metricDetail(m, "docCompliance", "coveragePct");
  const active = metricDetail(m, "docCompliance", "activeEmployees");

  return (
    <ReferencePanel
      title="Document Compliance"
      action={
        <span className="text-xs text-[#61708a]">
          {reason
            ? reason
            : coverage === null
              ? "coverage unavailable"
              : `${formatValue(coverage, "%")} of ${formatValue(active)} active employees have a document`}
        </span>
      }
      bodyClassName="p-0"
      onDrilldown={drilldownHandler(data, "docCompliance")}
    >
      {reason ? (
        <p className="px-4 py-8 text-center text-sm text-[#a0aec0]">{reason}</p>
      ) : (
        <div className="divide-y divide-[#edf1f6]">
          <ReferenceListRow icon={FileWarning} title="No Document On File" subtitle="Active employees with nothing uploaded" value={metricDetail(m, "docCompliance", "employeesWithNoDocs")} tone="red" href="/document-verification" />
          <ReferenceListRow icon={FileCheck2} title="Employees With Documents" subtitle="At least one document uploaded" value={metricDetail(m, "docCompliance", "employeesWithDocs")} tone="green" href="/document-verification" />
          <ReferenceListRow icon={ShieldCheck} title="Verified Documents" subtitle="Checked and approved" value={metricDetail(m, "docCompliance", "verifiedDocs")} tone="green" href="/document-verification" />
          <ReferenceListRow icon={Clock3} title="Awaiting Verification" subtitle="Uploaded but not yet checked" value={metricDetail(m, "docCompliance", "unverifiedDocs")} tone="amber" href="/document-verification" />
          <ReferenceListRow icon={FileCheck2} title="Documents On File" subtitle="Total uploaded for active employees" value={metricDetail(m, "docCompliance", "totalDocs")} tone="blue" href="/document-verification" />
        </div>
      )}
    </ReferencePanel>
  );
}

/**
 * Biometric punch coverage for the latest complete day.
 *
 * Sourced from integration_biometric_daily, not cosec_punch_sync: that table holds 3.19M
 * rows but stopped being written on 2026-06-18, so it would present six-week-old data as
 * today's. Anchored before today because a partial day reads as mass early departure.
 */
export function BiometricCoveragePanel({ data }: { data: ReferenceDashboardData }) {
  const m = data.metrics;
  const reason = metricUnavailableReason(m, "biometric");
  const avgHours = metricDetail(m, "biometric", "avgHours");
  const singlePct = metricDetail(m, "biometric", "singlePunchPct");

  return (
    <ReferencePanel
      title="Biometric Punch Coverage"
      action={
        <span className="text-xs text-[#61708a]">
          {reason ? reason : avgHours === null ? "hours unavailable" : `${formatValue(avgHours)} avg hours on device`}
        </span>
      }
      bodyClassName="p-0"
      onDrilldown={drilldownHandler(data, "biometric")}
    >
      {reason ? (
        <p className="px-4 py-8 text-center text-sm text-[#a0aec0]">{reason}</p>
      ) : (
        <div className="divide-y divide-[#edf1f6]">
          <ReferenceListRow icon={Fingerprint} title="Employees With Punches" subtitle="Recorded on the latest complete day" value={metricDetail(m, "biometric", "employees")} tone="blue" />
          <ReferenceListRow icon={UserCheck} title="Complete In/Out Pairs" subtitle="Two or more punches captured" value={metricDetail(m, "biometric", "completePunchPairs")} tone="green" />
          <ReferenceListRow
            icon={TriangleAlert}
            title="Single Punch Only"
            subtitle={
              singlePct === null
                ? "No out-punch captured — becomes an attendance exception"
                : `${formatValue(singlePct, "%")} of punched employees — becomes an attendance exception`
            }
            value={metricDetail(m, "biometric", "singlePunchOnly")}
            tone="red"
            href="/wfm/attendance-exceptions"
          />
          <ReferenceListRow icon={Clock3} title="Average Punches Per Employee" subtitle="Device events recorded" value={metricDetail(m, "biometric", "avgPunches")} tone="blue" />
        </div>
      )}
    </ReferencePanel>
  );
}

/**
 * Component-level split of the latest payroll run.
 *
 * PAYROLL ONLY. This panel carries rupee amounts, so per CLAUDE.md it must never be
 * mounted on a management, CEO or client surface — a backend test asserts
 * SALARY_COMPONENTS stays out of every other dashboard's metric bundle.
 */
export function SalaryComponentPanel({ data }: { data: ReferenceDashboardData }) {
  const m = data.metrics;
  const reason = metricUnavailableReason(m, "salaryComponents");
  const earnings = metricDetail(m, "salaryComponents", "earningTotal");
  const deductions = metricDetail(m, "salaryComponents", "deductionTotal");
  const codes = metricDetail(m, "salaryComponents", "componentCodes");

  return (
    <ReferencePanel
      title="Salary Component Split (latest run)"
      action={
        <span className="text-xs text-[#61708a]">
          {reason ? reason : codes === null ? "components unavailable" : `${formatValue(codes)} component codes`}
        </span>
      }
      onDrilldown={drilldownHandler(data, "salaryComponents")}
    >
      {reason ? (
        <p className="px-4 py-8 text-center text-sm text-[#a0aec0]">{reason}</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-[#d7f0df] bg-[#f2fbf5] p-4">
              <p className="text-xs font-bold text-[#16a34a]">Earnings</p>
              <p className="mt-2 text-[22px] font-extrabold leading-none text-[#0b1f44]">{formatValue(earnings)}</p>
              <p className="mt-2 text-xs text-[#71809a]">{formatValue(metricDetail(m, "salaryComponents", "earningLines"))} component lines</p>
            </div>
            <div className="rounded-lg border border-[#f6dcdc] bg-[#fef6f6] p-4">
              <p className="text-xs font-bold text-[#dc2626]">Deductions</p>
              <p className="mt-2 text-[22px] font-extrabold leading-none text-[#0b1f44]">{formatValue(deductions)}</p>
              <p className="mt-2 text-xs text-[#71809a]">{formatValue(metricDetail(m, "salaryComponents", "deductionLines"))} component lines</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-[#71809a]">
            {earnings !== null && deductions !== null && deductions > earnings
              ? "Deductions exceed earnings on this run — that is not possible for a payable register and indicates a component-mapping fault."
              : `Covering ${formatValue(metricDetail(m, "salaryComponents", "employees"))} employees; ${formatValue(metricDetail(m, "salaryComponents", "taxableLines"))} lines are taxable.`}
          </p>
        </>
      )}
    </ReferencePanel>
  );
}

/**
 * Recruiter funnel over the last 30 days.
 *
 * Recruiters are identified by name snapshot: the activity table's recruiter FK columns
 * are populated on only 10 of 16,857 rows, so grouping by them would discard almost all
 * the data. Offers are not shown at all because `offer_letter_status` is 100% NULL.
 */
export function RecruiterFunnelPanel({ data }: { data: ReferenceDashboardData }) {
  const m = data.metrics;
  const reason = metricUnavailableReason(m, "recruiterActivity");
  const conversion = metricDetail(m, "recruiterActivity", "conversionPct");
  const recruiters = metricDetail(m, "recruiterActivity", "recruiters");

  return (
    <ReferencePanel
      title="Recruiter Funnel (30 days)"
      action={
        <span className="text-xs text-[#61708a]">
          {reason ? reason : `${formatValue(recruiters)} recruiters active`}
        </span>
      }
      bodyClassName="p-0"
      onDrilldown={drilldownHandler(data, "recruiterActivity")}
    >
      {reason ? (
        <p className="px-4 py-8 text-center text-sm text-[#a0aec0]">{reason}</p>
      ) : (
        <div className="divide-y divide-[#edf1f6]">
          <ReferenceListRow icon={UserSearch} title="Leads Worked" subtitle="Activity rows in the last 30 days" value={metricDetail(m, "recruiterActivity", "leads")} tone="blue" href="/ats/recruiter/hiring-dashboard" />
          <ReferenceListRow icon={Users} title="Contacted" subtitle="Recruiter reached the candidate" value={metricDetail(m, "recruiterActivity", "contacted")} tone="blue" href="/ats/recruiter/hiring-dashboard" />
          <ReferenceListRow icon={CalendarClock} title="Walk-ins" subtitle="Candidate attended in person" value={metricDetail(m, "recruiterActivity", "walkins")} tone="blue" href="/ats/walkin-queue" />
          <ReferenceListRow icon={FileCheck2} title="HR Screened" subtitle="HR interview outcome recorded" value={metricDetail(m, "recruiterActivity", "hrScreened")} tone="amber" href="/ats/recruiter/hiring-dashboard" />
          <ReferenceListRow icon={UserCheck} title="Selected" subtitle="Final selection made" value={metricDetail(m, "recruiterActivity", "selected")} tone="green" href="/ats/candidate-master" />
          <ReferenceListRow
            icon={TrendingUp}
            title="Joined"
            subtitle={conversion === null ? "Converted to an employee" : `${formatValue(conversion, "%")} of those selected actually joined`}
            value={metricDetail(m, "recruiterActivity", "joined")}
            tone="green"
            href="/employees"
          />
        </div>
      )}
    </ReferencePanel>
  );
}

/**
 * Training progress from the LMS snapshot synced into mas_hrms.
 *
 * Reads the synced snapshot only — the deployed LMS stays the system of record for
 * curriculum, assessments and certification, per the CLAUDE.md LMS boundary.
 */
export function TrainingProgressPanel({ data }: { data: ReferenceDashboardData }) {
  const m = data.metrics;
  const reason = metricUnavailableReason(m, "training");
  const learners = metricDetail(m, "training", "learners");
  const avgScore = metricDetail(m, "training", "avgScore");

  return (
    <ReferencePanel
      title="Training Progress"
      action={
        <span className="text-xs text-[#61708a]">
          {reason ? reason : `${formatValue(learners)} learners${avgScore === null ? "" : ` · avg score ${formatValue(avgScore)}`}`}
        </span>
      }
      bodyClassName="p-0"
      onDrilldown={drilldownHandler(data, "training")}
    >
      {reason ? (
        <p className="px-4 py-8 text-center text-sm text-[#a0aec0]">{reason}</p>
      ) : (
        <div className="divide-y divide-[#edf1f6]">
          <ReferenceListRow icon={GraduationCap} title="Completed" subtitle="Course finished" value={metricDetail(m, "training", "completed")} tone="green" href="/lms/progress-dashboard" />
          <ReferenceListRow icon={BookOpen} title="In Progress" subtitle="Started but not finished" value={metricDetail(m, "training", "inProgress")} tone="amber" href="/lms/progress-dashboard" />
          <ReferenceListRow icon={TriangleAlert} title="Not Started" subtitle="Assigned but never opened" value={metricDetail(m, "training", "notStarted")} tone="red" href="/lms/progress-dashboard" />
          <ReferenceListRow icon={BookOpen} title="Courses Assigned" subtitle="Distinct courses in scope" value={metricDetail(m, "training", "courses")} tone="blue" href="/lms/progress-dashboard" />
          <ReferenceListRow icon={TrendingUp} title="Average Completion" subtitle="Mean progress across assignments" value={metricDetail(m, "training", "avgCompletionPct")} tone="blue" />
          <ReferenceListRow icon={BookOpen} title="Total Assignments" subtitle="Denominator behind the completion rate" value={metricDetail(m, "training", "assignments")} tone="blue" href="/lms/progress-dashboard" />
        </div>
      )}
    </ReferencePanel>
  );
}

/**
 * Pending leave approvals.
 *
 * `oldestPendingDays` is surfaced rather than just the count because the live pending
 * queue is a legacy import: the oldest request has been waiting ~2,900 days. A bare
 * "14 pending" would read as today's workload.
 */
export function LeaveApprovalPanel({ data }: { data: ReferenceDashboardData }) {
  const m = data.metrics;
  const reason = metricUnavailableReason(m, "leaveApprovals");
  const oldest = metricDetail(m, "leaveApprovals", "oldestPendingDays");
  const pending = metricDetail(m, "leaveApprovals", "pending");

  return (
    <ReferencePanel
      title="Leave Approvals"
      action={
        <span className="text-xs text-[#61708a]">
          {reason
            ? reason
            : pending === 0
              ? "nothing pending"
              : oldest === null
                ? `${formatValue(pending)} pending`
                : `oldest waiting ${formatValue(oldest)} days`}
        </span>
      }
      bodyClassName="p-0"
      onDrilldown={drilldownHandler(data, "leaveApprovals")}
    >
      {reason ? (
        <p className="px-4 py-8 text-center text-sm text-[#a0aec0]">{reason}</p>
      ) : (
        <div className="divide-y divide-[#edf1f6]">
          <ReferenceListRow icon={CalendarClock} title="Pending Approval" subtitle="Awaiting an approver decision" value={pending} tone="amber" href="/leaves" />
          <ReferenceListRow icon={TriangleAlert} title="Start Date Already Passed" subtitle="Cannot be approved in time" value={metricDetail(m, "leaveApprovals", "pendingAlreadyStarted")} tone="red" href="/leaves" />
          <ReferenceListRow icon={UserCheck} title="Needs Branch Head" subtitle="Escalated approval required" value={metricDetail(m, "leaveApprovals", "needsBranchHead")} tone="amber" href="/leaves" />
          <ReferenceListRow icon={UserCheck} title="Approved" subtitle="Decision recorded" value={metricDetail(m, "leaveApprovals", "approved")} tone="green" href="/leaves" />
          <ReferenceListRow icon={Users} title="Rejected" subtitle="Declined by an approver" value={metricDetail(m, "leaveApprovals", "rejected")} tone="blue" href="/leaves" />
        </div>
      )}
    </ReferencePanel>
  );
}

/**
 * The real work inbox.
 *
 * Reads the union of work_item and work_inbox_item. Dashboards previously read work_item
 * alone — 2 rows — while work_inbox_item held 65k and was written continuously, so every
 * dashboard reported an empty inbox to a user who actually had 40 items waiting.
 *
 * `aged` rather than `overdue` for the inbox rows: that table carries no due date, so an
 * unactioned age is reported as an age and never dressed up as a missed deadline.
 */
export function WorkInboxPanel({ data }: { data: ReferenceDashboardData }) {
  const inbox = data.summary?.workItems;
  const topTypes = (inbox?.by_type ?? []).slice(0, 6);

  return (
    <ReferencePanel
      title="My Work Inbox"
      action={
        <span className="text-xs text-[#61708a]">
          {inbox ? `${formatValue(inbox.pending_count)} open · ${formatValue(inbox.unread_count ?? 0)} unread` : "inbox unavailable"}
        </span>
      }
      bodyClassName="p-0"
    >
      {!inbox || (inbox.pending_count ?? 0) === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-[#a0aec0]">
          {inbox ? "Nothing waiting on you." : "The work inbox could not be read."}
        </p>
      ) : (
        <div className="divide-y divide-[#edf1f6]">
          {topTypes.map((item) => (
            <ReferenceListRow
              key={`${item.type}-${item.priority}`}
              icon={item.priority === "urgent" || item.priority === "critical" ? TriangleAlert : Clock3}
              title={humaniseInboxType(item.type)}
              subtitle={`${item.priority} priority`}
              value={item.count}
              tone={item.priority === "urgent" || item.priority === "critical" ? "red" : item.priority === "high" ? "amber" : "blue"}
              href={item.actionUrl ?? undefined}
            />
          ))}
          {inbox.overdue_count > 0 ? (
            <ReferenceListRow icon={TriangleAlert} title="Past Due Date" subtitle="Items with a real due date that has passed" value={inbox.overdue_count} tone="red" href="/work-inbox" />
          ) : null}
          {(inbox.aged_count ?? 0) > 0 ? (
            <ReferenceListRow icon={Clock3} title="Waiting Over 7 Days" subtitle="Unactioned — these carry no due date" value={inbox.aged_count ?? 0} tone="amber" href="/work-inbox" />
          ) : null}
        </div>
      )}
    </ReferencePanel>
  );
}

/** `attendance_missing_punch` -> `Attendance Missing Punch`. */
function humaniseInboxType(type: string): string {
  return type
    .split(/[_\-]/)
    .filter(Boolean)
    .map((word) => (word.length <= 3 ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1)))
    .join(" ");
}
