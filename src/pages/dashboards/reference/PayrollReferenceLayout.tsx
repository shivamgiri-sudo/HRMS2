import type { ReactNode } from "react";
import { BadgeIndianRupee } from "lucide-react";
import { ActionCenter, DashHero, DashSkeleton, InsightGrid, LazySection, Panel, SectionTitle, SeriesPanel, SignalList, drillHref, type HeroStat } from "../kit";
import type { ReferenceDashboardData } from "../reference-dashboard-model";
import { arrayAt, asNumber, metricDetail, metricUnavailableReason, read, stringAt } from "../reference-dashboard-model";
import { TodayCelebrationsWidget } from "@/components/dashboard/TodayCelebrationsWidget";
import { useReferenceDashboardShell } from "./ReferenceDashboardShell";
import { AttendanceExceptionPanel, SalaryComponentPanel } from "./ReferenceSharedPanels";
import { RunPipeline } from "./payroll/RunPipeline";
import { PayrollKpiGrid } from "./payroll/PayrollKpiGrid";
import { BlockersPanel, IncentivePanel, NoticeBar } from "./payroll/BlockerPanels";
import { AbnormalPanel, BranchCostPanel, DisbursalPanel, HeadcountPanel, RunComparePanel, StatutoryPanel } from "./payroll/PayrollPanels";
import { buildLocalActions, formatPayDate, payrollHealth, readRunData, stageProgress } from "./payroll/payrollModel";

export function PayrollReferenceLayout({ data, filters }: { data: ReferenceDashboardData; filters?: ReactNode }) {
  const { productHeaderControls } = useReferenceDashboardShell();
  const m = data.metrics;
  const drill: (key: string) => { onDrilldown?: () => void } = data.drilldownFor ?? (() => ({}));
  const code = data.dashboardCode || "PAYROLL_HR_DASHBOARD";
  const run = readRunData(data.payroll);
  const currentRun = (read(data.payroll, "currentRun") ?? {}) as Record<string, unknown>;
  const currentMonth = String(data.payroll.currentMonth ?? currentRun.month ?? "Current cycle");
  // The run header's total is stale (it disagreed with the line count by 12 on the live run); kept only to say so.
  const totalEmployees = asNumber(currentRun.totalEmployees ?? currentRun.total_employees);
  const runStatus = String(currentRun.status ?? "unknown");

  // PAYROLL_READINESS breakdown (counts only).
  const readyCount = metricDetail(m, "payroll", "readyCount");
  const blockerCount = metricDetail(m, "payroll", "blockerCount");
  const readinessTotal = metricDetail(m, "payroll", "total");
  const missingBank = metricDetail(m, "payroll", "missingBank");
  const missingNeftBank = metricDetail(m, "payroll", "missingNeftBank");
  const missingPan = metricDetail(m, "payroll", "missingPan");
  const invalidPan = metricDetail(m, "payroll", "invalidPan");
  const missingUan = metricDetail(m, "payroll", "missingUan");
  const readinessPct = readinessTotal && readyCount !== null && readinessTotal > 0 ? Math.round((readyCount / readinessTotal) * 100) : null;
  const readinessReason = metricUnavailableReason(m, "payroll");

  const incentivePending = metricDetail(m, "incentive", "pendingBatches");
  const dataIntegrity = arrayAt(data.payroll, "dataIntegrity").map((x) => String(x));
  const unavailableSources = (read(data.payroll, "unavailableSources") ?? {}) as Record<string, unknown>;
  const attendanceBlockers = metricDetail(m, "attException", "blockers");

  const payrollRuns = data.payrollRuns ?? [];
  const selectedRunId = data.selectedPayrollRunId ?? "";
  const newestRunId = payrollRuns[0] ? String(payrollRuns[0].id) : "";
  const runSelector = (
    <label className="block text-[12px] font-semibold text-slate-700">
      Payroll run
      <select value={selectedRunId} onChange={(e) => data.onPayrollRunChange?.(e.target.value)} className="mt-1 h-9 w-full min-w-[200px] rounded-lg border border-slate-200 bg-white px-2 text-[13px] text-slate-800">
        <option value="">Select a payroll run</option>
        {payrollRuns.map((r) => <option key={String(r.id)} value={String(r.id)}>{String(r.run_label ?? r.run_month ?? r.id)} · {String(r.status ?? "unknown")}</option>)}
      </select>
    </label>
  );
  const heroRight = <div className="flex flex-wrap items-end gap-3">{runSelector}{filters ?? productHeaderControls}</div>;

  const insights = data.insights;
  const loansKpi = insights?.kpis.find((k) => k.key === "loans");
  const localActions = buildLocalActions({ run, missingBank, missingPan, invalidPan, missingUan, attendanceBlockers });
  const actions = [...(insights?.actions ?? []), ...localActions];
  const health = payrollHealth({ readinessPct, run });

  if (!selectedRunId) {
    return (
      <div className="space-y-5">
        <DashHero eyebrow="Payroll command" title="Payroll Dashboard" subtitle="Select a payroll run to load its pipeline, amounts, blockers and filings." accent="indigo" icon={BadgeIndianRupee} right={heroRight} />
        <p className="text-sm text-slate-500">Select a payroll run to load its population, amounts, blockers, filings, and disbursement status.</p>
        <TodayCelebrationsWidget />
        <div className="grid gap-4 xl:grid-cols-2">
          <ActionCenter actions={actions} loading={data.insightsLoading} error={data.insightsError} limit={12} />
          <SignalList signals={insights?.signals} loading={data.insightsLoading} />
        </div>
      </div>
    );
  }

  if (data.loading && !run) return <div className="space-y-5"><DashHero eyebrow="Payroll command" title="Payroll Dashboard" accent="indigo" icon={BadgeIndianRupee} right={heroRight} /><DashSkeleton /></div>;

  const p = run?.pipeline;
  const days = p?.daysToPayDate ?? null;
  const prog = run ? stageProgress(run.pipeline.stages) : null;
  const stuck = p?.stuckLabel ?? null;
  const stats: HeroStat[] = [
    { label: "Stuck at", value: stuck ?? (run ? "Complete" : "—"), tone: stuck ? (days !== null && days < 0 ? "bad" : "warn") : "good", href: run?.pipeline.stages.find((s) => s.key === p?.stuckAt)?.href },
    { label: "Net pay", value: run ? <>{(run.totals.net / 100000).toFixed(2)} L</> : "—", href: "/payroll" },
    { label: "Employees paid", value: run ? run.totals.employees.toLocaleString("en-IN") : "—", href: "/payroll" },
    { label: "Blocked employees", value: blockerCount ?? "—", tone: blockerCount ? "bad" : "good", onClick: drill("payroll").onDrilldown, href: drill("payroll").onDrilldown ? undefined : drillHref(code, "PAYROLL_READINESS") },
    { label: "Pipeline", value: prog ? `${prog.done}/${prog.total} stages` : "—" },
    { label: "Pay date", value: formatPayDate(p?.payDate ?? stringAt(data.payroll, "payDay")), href: "/payroll/calendar" },
  ];

  return (
    <div className="space-y-5">
      <DashHero
        eyebrow="Payroll command" title={`Payroll run ${currentMonth}`} accent="indigo" icon={BadgeIndianRupee}
        subtitle={`Status: ${runStatus}${p?.lastActivityDays !== null && p?.lastActivityDays !== undefined ? ` · last activity ${p.lastActivityDays}d ago` : ""}`}
        headline={days === null ? { label: "Days to pay date", value: "—", caption: "No pay date in the payroll calendar for this month" } : { label: days < 0 ? "Days past pay date" : "Days to pay date", value: Math.abs(days), caption: days < 0 && stuck ? `Run is still waiting at ${stuck}` : stuck ? `Next: ${stuck}` : "Every stage is complete" }}
        health={health ? { value: health.value, label: "Payroll health", basis: health.basis } : null}
        stats={stats} right={heroRight}
      >
        {run ? <RunPipeline pipeline={run.pipeline} />
          : data.payrollLoading ? <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 xl:grid-cols-7" aria-busy="true" aria-label="Loading run analytics">{Array.from({ length: 7 }, (_, i) => <div key={i} className="kit-shimmer h-[92px] rounded-2xl" />)}</div>
          : <p className="text-[13px] text-amber-700">Run analytics could not be computed{data.payrollError ? ` (${data.payrollError})` : ""} - see the unavailable sources below.</p>}
      </DashHero>

      <NoticeBar integrity={dataIntegrity} unavailable={unavailableSources} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <ActionCenter actions={actions} loading={data.insightsLoading && !localActions.length} error={data.insightsError} limit={12} subtitle={data.insightsLoading ? "Loading approval queues…" : undefined} />
        <PayrollKpiGrid
          run={run} loading={data.loading || Boolean(data.payrollLoading)} totalEmployees={totalEmployees} readinessPct={readinessPct} readinessReason={readinessReason} blockerCount={blockerCount}
          incentivePending={incentivePending} loansActive={loansKpi?.value ?? null} readinessHref={drillHref(code, "PAYROLL_READINESS")} costHref={drillHref(code, "SALARY_COMPONENTS")}
          onReadinessDrill={drill("payroll").onDrilldown}
        />
      </div>

      {run ? (
        <>
          <SectionTitle hint="vs previous run">Cost & headcount</SectionTitle>
          <div className="grid gap-4 lg:grid-cols-2">
            <LazySection eager><RunComparePanel run={run} /></LazySection>
            <LazySection eager><HeadcountPanel h={run.headcount} totalEmployees={totalEmployees} /></LazySection>
          </div>
        </>
      ) : null}

      <SectionTitle hint="what stops this run">Blockers & approvals</SectionTitle>
      <div className="grid gap-4 lg:grid-cols-2">
        <LazySection>
          <BlockersPanel
            v={{ readyCount, readinessTotal, blockerCount, missingBank, missingNeftBank, missingPan, invalidPan, missingUan, noStructure: run?.headcount.missingNoStructure ?? null, unfrozenUnits: run?.readinessUnits ?? null, zeroNet: run?.totals.zeroNet ?? null, unavailable: readinessReason }}
            onDrill={drill("payroll").onDrilldown}
          />
        </LazySection>
        <LazySection>
          <IncentivePanel pending={incentivePending} pendingAmount={metricDetail(m, "incentive", "pendingAmount")} approvedAmount={metricDetail(m, "incentive", "approvedAmount")} rejected={metricDetail(m, "incentive", "rejectedBatches")} unavailable={metricUnavailableReason(m, "incentive")} />
        </LazySection>
      </div>

      <SectionTitle hint="all runs">Trends</SectionTitle>
      <div className="grid gap-4 lg:grid-cols-3">
        {data.insightsLoading && !insights ? [0, 1, 2].map((i) => <div key={i} className="kit-shimmer h-60 rounded-2xl" />) : (insights?.series ?? []).map((s) => <LazySection key={s.key}><SeriesPanel series={s} /></LazySection>)}
      </div>

      {run ? (
        <>
          <SectionTitle hint="selected run">Branches & exceptions</SectionTitle>
          <div className="grid gap-4 lg:grid-cols-2">
            <LazySection><BranchCostPanel run={run} /></LazySection>
            <LazySection><AbnormalPanel run={run} /></LazySection>
          </div>
          <SectionTitle hint="PF, ESI, TDS, LWF">Statutory, disbursal & payslips</SectionTitle>
          <div className="grid gap-4 lg:grid-cols-2">
            <LazySection><StatutoryPanel filings={run.filings} totals={run.totals} month={currentMonth} /></LazySection>
            <LazySection><DisbursalPanel run={run} status={runStatus} /></LazySection>
          </div>
        </>
      ) : null}

      <SectionTitle hint="cycle calendar and branch attendance lock">Calendar & readiness</SectionTitle>
      <InsightGrid tables={insights?.tables} loading={data.insightsLoading} />

      <SectionTitle>Insights</SectionTitle>
      <SignalList signals={insights?.signals} loading={data.insightsLoading} />

      <SectionTitle hint="latest run, not the selected one">Salary components & attendance exceptions</SectionTitle>
      {selectedRunId !== newestRunId && newestRunId ? <p className="text-[12px] text-amber-700">The component split describes the newest run, not the one selected above.</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <LazySection><SalaryComponentPanel data={data} /></LazySection>
        <LazySection><AttendanceExceptionPanel data={data} /></LazySection>
      </div>

      <Panel title="Loans & reimbursements" subtitle="Org-wide, not scoped to a run" href="/payroll/loans" hrefLabel="Loans">
        <p className="text-[12px] text-slate-600">{loansKpi?.helper ? `Active loans: ${loansKpi.value} - ${loansKpi.helper}.` : "Loan position unavailable."} Reimbursement claims awaiting action appear in the action list above.</p>
      </Panel>
    </div>
  );
}
