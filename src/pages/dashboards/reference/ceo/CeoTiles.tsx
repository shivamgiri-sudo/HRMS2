import { BadgeCheck, CalendarClock, ClipboardList, FileCheck2, Fingerprint, GraduationCap, ShieldCheck, Target, UserCheck, UserMinus } from "lucide-react";
import type { ReferenceDashboardData } from "../../reference-dashboard-model";
import { metricUnavailableReason } from "../../reference-dashboard-model";
import { PulseGrid, PulseTile, type RoleInsights } from "../../kit";
import type { CeoModel } from "./ceoModel";
import { drillTo, kpiOf } from "./ceoModel";

/** Scroll to a section of this page — used where no separate page exists for the CEO to open. */
export function jumpTo(id: string) {
  if (typeof document !== "undefined") document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * Operations & compliance pulse. Every tile is a drill target — a full-page drill route for metrics the
 * CEO bundle carries, a real page where the CEO can act. `drill()` opens the shared drawer when the
 * full-page route is not wanted.
 */
export function CeoTiles({ data, model, insights, loading, drillFor }: {
  data: ReferenceDashboardData; model: CeoModel; insights?: RoleInsights; loading?: boolean;
  /** Opens the shared drawer for a bundle metric key (owned by ReferenceRoleDashboard). */
  drillFor: (metricKey: string, filters?: Record<string, string>) => (() => void) | undefined;
}) {
  const m = data.metrics;
  const k = (key: string) => kpiOf(insights?.kpis, key);
  const summaryLoading = data.loading;
  const filings = k("filings_overdue");
  const runs = k("payroll_runs_open");
  const lwd = k("lwd_14d");
  const early = k("early_exits");
  return (
    <PulseGrid cols={4}>
      <PulseTile label="Payroll data readiness" value={model.payrollReadiness} unit="percent" icon={Target} tone={model.payrollReadiness !== null && model.payrollReadiness >= 90 ? "green" : "amber"}
        helper={model.payrollBlocked === null ? "Employees with bank + PAN" : `${model.payrollBlocked.toLocaleString("en-IN")} employees blocked`}
        formula="Share of employees with complete bank and PAN details (past the 30-day grace window). UAN is reported beside it but is not part of the gate"
        unavailable={metricUnavailableReason(m, "payroll")} href={drillTo("PAYROLL_READINESS")} onDrill={drillFor("payroll")} loading={summaryLoading && model.payrollReadiness === null} />
      <PulseTile label="Payroll runs not finalized" value={runs?.value ?? null} unit="count" icon={CalendarClock} tone={runs?.tone ?? "amber"} higherIsBetter={false} helper={runs?.helper}
        formula={runs?.formula} href={runs?.href} onDrill={runs?.href ? undefined : () => jumpTo("ceo-compliance")} unavailable={runs?.unavailable} loading={loading && !runs} />
      <PulseTile label="Statutory filings overdue" value={filings?.value ?? null} unit="count" icon={FileCheck2} tone={filings?.tone ?? "amber"} higherIsBetter={false} helper={filings?.helper}
        formula={filings?.formula} onDrill={() => jumpTo("ceo-compliance")} unavailable={filings?.unavailable} loading={loading && !filings} />
      <PulseTile label="Attendance exceptions" value={model.exceptionsOpen} unit="count" icon={Fingerprint} tone="amber" higherIsBetter={false} helper="Open reconciliation issues"
        formula="Open attendance_reconciliation_issue rows; the blockers among them stop a payroll run" unavailable={metricUnavailableReason(m, "attException")} href={drillTo("ATTENDANCE_EXCEPTIONS")} onDrill={drillFor("attException")} loading={summaryLoading && model.exceptionsOpen === null} />
      <PulseTile label="Resignations in approval" value={model.resignationInApproval} unit="count" icon={UserMinus} tone="red" higherIsBetter={false} helper="Manager / HR / admin review"
        formula="Exit requests still moving through approval (submitted, manager / HR / admin review)" unavailable={metricUnavailableReason(m, "resign")} href={drillTo("RESIGNATION")} onDrill={drillFor("resign")} loading={summaryLoading && model.resignationInApproval === null} />
      <PulseTile label="Last working days in 14d" value={lwd?.value ?? null} unit="count" icon={UserMinus} tone={lwd?.tone ?? "slate"} helper={lwd?.helper} formula={lwd?.formula} href={drillTo("RESIGNATION")} unavailable={lwd?.unavailable} loading={loading && !lwd} />
      <PulseTile label="Exits in first 90 days" value={early?.value ?? null} unit="percent" icon={UserMinus} tone={early?.tone ?? "amber"} higherIsBetter={false} helper={early?.helper} formula={early?.formula} href={drillTo("RESIGNATION")} unavailable={early?.unavailable} loading={loading && !early} />
      <PulseTile label="Onboarding pending" value={model.onboarding} unit="count" icon={UserCheck} tone="green" higherIsBetter={false} helper="Joiners awaiting completion"
        formula="Genuine candidates in the onboarding bridge that are pending or initiated, not yet converted to employees" unavailable={metricUnavailableReason(m, "onb")} href={drillTo("ONBOARDING", { bucket: "pending" })} onDrill={drillFor("onb", { bucket: "pending" })} loading={summaryLoading && model.onboarding === null} />
      <PulseTile label="BGV pending" value={model.bgv} unit="count" icon={ShieldCheck} tone="violet" higherIsBetter={false} helper="Candidates awaiting verification"
        formula="Distinct candidates with at least one outstanding background check" unavailable={metricUnavailableReason(m, "bgv")} href={drillTo("BGV")} onDrill={drillFor("bgv")} loading={summaryLoading && model.bgv === null} />
      <PulseTile label="Document coverage" value={model.docCoverage} unit="percent" icon={BadgeCheck} tone="green" helper="Employees with a document on file"
        formula="Active employees with at least one document ÷ active employees" unavailable={metricUnavailableReason(m, "docCompliance")} href={drillTo("DOC_COMPLIANCE")} onDrill={drillFor("docCompliance")} loading={summaryLoading && model.docCoverage === null} />
      <PulseTile label="Training completion" value={model.trainingCompletion} unit="percent" icon={GraduationCap} tone="amber" helper={model.certified === null ? "Course assignments completed" : `${model.certified.toLocaleString("en-IN")} certified learners (LMS, all-time)`}
        formula="Completed ÷ all course assignments in the LMS progress snapshot (active employees)" unavailable={metricUnavailableReason(m, "training")} href={drillTo("TRAINING_PROGRESS")} onDrill={drillFor("training")} loading={summaryLoading && model.trainingCompletion === null} />
      <PulseTile label="Quality score" value={model.qualityNote ? null : model.qualityScore} unit="score" icon={ClipboardList} tone={model.qualityScore !== null && model.qualityTarget !== null && model.qualityScore >= model.qualityTarget ? "green" : "red"}
        helper={model.qualityTarget === null ? "Org average, 30 days" : `target ${model.qualityTarget}`} unavailable={model.qualityNote} formula="Average audited-call quality %, last 30 days" href="/quality/executive" />
    </PulseGrid>
  );
}
