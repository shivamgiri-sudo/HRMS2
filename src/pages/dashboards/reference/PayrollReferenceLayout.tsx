import type { ReactNode } from "react";
import {
  BadgeIndianRupee,
  CalendarDays,
  Clock3,
  CreditCard,
  FileCheck2,
  FileText,
  IndianRupee,
  ReceiptIndianRupee,
  ShieldCheck,
  TriangleAlert,
  Users,
  WalletCards,
} from "lucide-react";

import {
  ReferenceDonut,
  ReferenceHeader,
  ReferenceListRow,
  ReferenceMetricGrid,
  ReferencePanel,
  ReferenceProgress,
} from "../ReferenceDashboardUI";
import type { ReferenceDashboardData } from "../reference-dashboard-model";
import {
  arrayAt,
  asNumber,
  formatCurrency,
  metricDetail,
  metricUnavailableReason,
  metricValue,
  numberAt,
  read,
  stringAt,
} from "../reference-dashboard-model";
import { useReferenceDashboardShell } from "./ReferenceDashboardShell";
import { TodayCelebrationsWidget } from "@/components/dashboard/TodayCelebrationsWidget";
import {
  AttendanceExceptionPanel,
  SalaryComponentPanel,
} from "./ReferenceSharedPanels";

export function PayrollReferenceLayout({ data, filters }: { data: ReferenceDashboardData; filters?: ReactNode }) {
  const { productHeaderControls } = useReferenceDashboardShell();
  const m = data.metrics;
  const drill = data.drilldownFor ?? (() => ({}));
  const salaryBill = (read(data.payroll, "salaryBill") ?? {}) as Record<string, unknown>;
  const currentRun = (read(data.payroll, "currentRun") ?? {}) as Record<string, unknown>;
  const totalGross = asNumber(salaryBill.totalGross ?? salaryBill.total_gross);
  const totalNet = asNumber(salaryBill.totalNet ?? salaryBill.total_net);
  const deductions = asNumber(salaryBill.totalDeductions ?? salaryBill.total_deductions);
  const employerContribution = null;
  const payrollCost = totalGross;
  const currentMonth = String(data.payroll.currentMonth ?? currentRun.month ?? currentRun.run_month ?? "Current Cycle");
  const processed = asNumber(salaryBill.employeeCount ?? salaryBill.emp_count);
  // `total` was `processed`, so "Total Employees" always equalled "Processed Payroll".
  // The run header carries the real establishment count.
  const total = asNumber(currentRun.totalEmployees ?? currentRun.total_employees) ?? processed;
  const pending = total !== null && processed !== null ? Math.max(0, total - processed) : null;

  // The PAYROLL_READINESS metric returns the blocker breakdown on every load and none of
  // it was rendered — these four counts are the actionable part of the dashboard.
  const readyCount = metricDetail(m, "payroll", "readyCount");
  const blockerCount = metricDetail(m, "payroll", "blockerCount");
  const readinessTotal = metricDetail(m, "payroll", "total");
  const missingBank = metricDetail(m, "payroll", "missingBank");
  const missingPan = metricDetail(m, "payroll", "missingPan");
  const missingUan = metricDetail(m, "payroll", "missingUan");
  const readinessPct = readinessTotal && readyCount !== null && readinessTotal > 0
    ? Math.round((readyCount / readinessTotal) * 100)
    : null;

  // Incentive batch states, likewise fetched and discarded.
  const incentivePending = metricDetail(m, "incentive", "pendingBatches");
  const incentivePendingAmt = metricDetail(m, "incentive", "pendingAmount");
  const incentiveApprovedAmt = metricDetail(m, "incentive", "approvedAmount");
  const incentiveRejected = metricDetail(m, "incentive", "rejectedBatches");

  // Surfaced by the backend when a run's net exceeds its gross — arithmetically
  // impossible and true of the finalized runs today.
  const dataIntegrity = arrayAt(data.payroll, "dataIntegrity");
  const statutoryRows = arrayAt(data.payroll, "statutoryFiling");
  // branchReadiness is a single object for the run's month, not a list of branches.
  const readiness = read(data.payroll, "branchReadiness") as Record<string, unknown> | null;
  // disbursement is the run's actual disbursement record (status, amount, NEFT ref),
  // not a generation-progress breakdown. `completed`/`in_progress`/`initiated`/
  // `failed` were never returned, so the old donut summed four undefineds to 0 and
  // printed "0%" over a body that said "No data".
  const disbursement = read(data.payroll, "disbursement") as Record<string, unknown> | null;
  const payslips = read(data.payroll, "payslips") as Record<string, unknown> | null;
  const pendingQueues = (read(data.payroll, "pendingQueues") ?? {}) as Record<string, unknown>;
  const loans = (read(data.payroll, "loans") ?? {}) as Record<string, unknown>;
  const reimbursements = (read(data.payroll, "reimbursements") ?? {}) as Record<string, unknown>;
  const unavailableSources = (read(data.payroll, "unavailableSources") ?? {}) as Record<string, unknown>;
  const payDay = stringAt(data.payroll, "payDay") ?? stringAt(currentRun, "payDate");
  const payrollRuns = data.payrollRuns ?? [];
  const selectedRunId = data.selectedPayrollRunId ?? "";
  const runSelector = (
    <label className="block max-w-md text-sm font-semibold text-[#1d2b45]">
      Payroll run
      <select
        value={selectedRunId}
        onChange={(event) => data.onPayrollRunChange?.(event.target.value)}
        className="mt-2 h-10 w-full rounded-lg border border-[#d7dfeb] bg-white px-3 text-sm text-[#1d2b45]"
      >
        <option value="">Select a payroll run</option>
        {payrollRuns.map((run) => (
          <option key={String(run.id)} value={String(run.id)}>
            {String(run.run_label ?? run.run_month ?? run.id)} · {String(run.status ?? "unknown")}
          </option>
        ))}
      </select>
    </label>
  );

  const statutoryValue = (name: string) => {
    const row = statutoryRows.find((item) => String(item.filing_type ?? item.type ?? "").toLowerCase().includes(name.toLowerCase()));
    return row ? asNumber(row.amount ?? row.liability ?? row.value) : null;
  };

  const pf = statutoryValue("pf");
  const esi = statutoryValue("esi");
  const tds = statutoryValue("tds");
  const pt = statutoryValue("professional");

  if (!selectedRunId) {
    return (
      <div className="reference-dashboard-page">
        <ReferenceHeader title="Finance / Payroll Dashboard" subtitle="Manage payroll operations and financial compliance" right={filters ?? productHeaderControls} />
        <TodayCelebrationsWidget />
        <ReferencePanel title="Run Selection">
          {runSelector}
          <p className="mt-4 text-sm text-[#71809a]">
            Select a payroll run to load its population, amounts, blockers, filings, and disbursement status.
          </p>
        </ReferencePanel>
      </div>
    );
  }

  return (
    <div className="reference-dashboard-page">
      <ReferenceHeader title="Finance / Payroll Dashboard" subtitle="Manage payroll operations and financial compliance" right={filters ?? productHeaderControls} />
      <ReferencePanel title="Run Selection">{runSelector}</ReferencePanel>
      {Object.keys(unavailableSources).length ? (
        <ReferencePanel title="Run-linked Source Availability">
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(unavailableSources).map(([source, reason]) => (
              <div key={source} className="rounded-lg border border-[#e3e9f2] bg-[#f8fafc] p-3">
                <p className="text-xs font-semibold capitalize text-[#1d2b45]">{source}</p>
                <p className="mt-1 text-xs text-[#71809a]">{String(reason)}</p>
              </div>
            ))}
          </div>
        </ReferencePanel>
      ) : null}

      {dataIntegrity.length > 0 ? (
        <div className="rounded-lg border border-[#ffdadd] bg-[#fff7f7] px-4 py-3 text-sm text-[#b91c1c]">
          {dataIntegrity.map((row, i) => <p key={i}>{String(row)}</p>)}
        </div>
      ) : null}

      <ReferenceMetricGrid
        columns={5}
        loading={data.loading}
        metrics={[
          { label: "Total Employees", value: total, helper: "Active payroll population", icon: Users, tone: "violet", href: "/employees" },
          { label: "Processed Payroll", value: processed, helper: "This Month", icon: FileCheck2, tone: "green", href: "/payroll" },
          { label: "Pending Payroll", value: pending, helper: total !== null && processed !== null ? `${total} establishment vs ${processed} processed` : "This Month", icon: Clock3, tone: pending ? "amber" : "green", href: "/payroll" },
          { label: `Payroll Cost (${currentMonth})`, value: formatCurrency(payrollCost), helper: "Total Cost", icon: IndianRupee, tone: "blue", href: "/payroll" },
          {
            label: "Payroll Readiness",
            value: readinessPct,
            valueSuffix: "%",
            helper: blockerCount ? `${blockerCount} employees blocked` : "All employees payroll-ready",
            icon: ShieldCheck,
            tone: readinessPct === null ? "slate" : readinessPct >= 95 ? "green" : readinessPct >= 80 ? "amber" : "red",
            unavailableReason: metricUnavailableReason(m, "payroll"),
            ...drill("payroll"),
          },
        ]}
      />

      {/* Payroll blockers: computed on every load and previously not rendered at all.
          Counts only — no individual bank / PAN / UAN values are exposed here. */}
      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <ReferencePanel
          title="Payroll Blockers"
          action={
            <span className="text-xs text-[#61708a]">
              {readyCount !== null && readinessTotal !== null ? `${readyCount} of ${readinessTotal} ready` : "readiness source unavailable"}
            </span>
          }
          bodyClassName="p-0"
        >
          <div className="divide-y divide-[#edf1f6]">
            <ReferenceListRow icon={WalletCards} title="Missing Bank Account" subtitle="Cannot be paid by NEFT" value={missingBank} tone="red" href="/employees" />
            <ReferenceListRow icon={FileCheck2} title="Missing PAN" subtitle="Blocks TDS computation" value={missingPan} tone="red" href="/employees" />
            <ReferenceListRow icon={ShieldCheck} title="Missing UAN" subtitle="Blocks PF filing" value={missingUan} tone="amber" href="/employees" />
            <ReferenceListRow icon={Users} title="Total Blocked" subtitle="Not payroll-ready" value={blockerCount} tone="red" />
          </div>
        </ReferencePanel>

        <ReferencePanel title="Incentive Batches" bodyClassName="p-0">
          {metricUnavailableReason(m, "incentive") ? (
            <p className="px-4 py-8 text-center text-sm text-[#a0aec0]">{metricUnavailableReason(m, "incentive")}</p>
          ) : (
            <div className="divide-y divide-[#edf1f6]">
              <ReferenceListRow icon={Clock3} title="Pending Approval" value={incentivePending} tone="amber" />
              <ReferenceListRow icon={IndianRupee} title="Pending Amount" value={formatCurrency(incentivePendingAmt)} tone="amber" />
              <ReferenceListRow icon={IndianRupee} title="Approved Amount" value={formatCurrency(incentiveApprovedAmt)} tone="green" />
              <ReferenceListRow icon={Clock3} title="Rejected Batches" value={incentiveRejected} tone="red" />
            </div>
          )}
        </ReferencePanel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_1.05fr_0.9fr]">
        <ReferencePanel title={`Payroll Summary (${currentMonth})`}>
          <div className="divide-y divide-[#edf1f6]">
            <ReferenceListRow icon={IndianRupee} title="Gross Pay" value={formatCurrency(totalGross)} tone="blue" />
            <ReferenceListRow icon={WalletCards} title="Net Pay" value={formatCurrency(totalNet)} tone="green" />
            <ReferenceListRow icon={ReceiptIndianRupee} title="Employee Deductions" value={formatCurrency(deductions)} tone="amber" />
            {/* employerContribution is a hardcoded null — the run stores no employer
                cost total. Labelled as not captured rather than rendered as a blank
                currency value that looks like zero rupees. */}
            <ReferenceListRow icon={BadgeIndianRupee} title="Employer Contributions" value="Not captured" tone="slate" />
          </div>
        </ReferencePanel>

        {/* This panel re-rendered the Payroll Summary above it: "Net Pay Paid" was
            the same `totalNet` variable as "Net Pay", "Gross Pay" was the same
            `totalGross`, Employer Contributions was a hardcoded null, and
            paymentMode was never returned. Two panels showed one set of numbers,
            with the second implying money had moved.
            It now shows what was actually disbursed, which is genuinely different
            from what was computed. */}
        <ReferencePanel title={`Payment Summary (${currentMonth})`}>
          {disbursement ? (
            <div className="divide-y divide-[#edf1f6]">
              <ReferenceListRow icon={WalletCards} title="Amount Disbursed" value={formatCurrency(asNumber(disbursement.totalAmount))} tone="green" />
              <ReferenceListRow icon={BadgeIndianRupee} title="Employees Paid" value={asNumber(disbursement.employeeCount)} tone="blue" />
              <ReferenceListRow icon={ReceiptIndianRupee} title="Status" value={String(disbursement.status ?? "—")} tone={String(disbursement.status ?? "").toLowerCase() === "completed" ? "green" : "amber"} />
              <ReferenceListRow icon={CreditCard} title="Bank Reference" value={String(disbursement.bankRef ?? "—")} tone="slate" />
            </div>
          ) : (
            <p className="px-3 py-8 text-center text-xs text-[#94a3b8]">No disbursement recorded for this run</p>
          )}
        </ReferencePanel>

        <ReferencePanel title="Upcoming Payroll">
          <div className="rounded-lg border border-[#dce8fb] bg-[#f4f8ff] p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-[#0b63e5]"><CalendarDays className="h-5 w-5" /></span>
              <div><p className="text-[13px] font-bold text-[#0b63e5]">{currentMonth}</p><p className="mt-1 text-xs text-[#71809a]">Payroll cycle</p></div>
            </div>
            <div className="mt-5 rounded-lg border border-[#bcd4fb] bg-white p-4 text-center">
              <p className="text-xs text-[#61708a]">Pay Day</p>
              <p className="mt-2 text-[20px] font-extrabold text-[#0b1f44]">{payDay ? new Date(payDay).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</p>
            </div>
          </div>
        </ReferencePanel>
      </div>

      <div className="grid gap-3 sm:gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        <ReferencePanel title={`Statutory Summary (${currentMonth})`}>
          <div className="divide-y divide-[#edf1f6]">
            <ReferenceListRow title="Provident Fund (PF)" value={formatCurrency(pf)} tone="green" />
            <ReferenceListRow title="Employees' State Insurance (ESI)" value={formatCurrency(esi)} tone="green" />
            <ReferenceListRow title="Professional Tax (PT)" value={formatCurrency(pt)} tone="green" />
            <ReferenceListRow title="TDS (Tax Deducted at Source)" value={formatCurrency(tds)} tone="amber" />
          </div>
        </ReferencePanel>

        <ReferencePanel title={`PF / ESI / TDS Liability (${currentMonth})`}>
          <div className="grid grid-cols-3 gap-3">
            {([
              ["PF Liability", pf, Users, "green"],
              ["ESI Liability", esi, CreditCard, "blue"],
              ["TDS Liability", tds, FileText, "amber"],
            // as const - see CeoReferenceLayout: otherwise every slot widens to one union
            // and the first element includes the icon component type.
            ] as const).map(([label, value, Icon, tone]) => {
              const IconComponent = Icon as typeof Users;
              return <div key={String(label)} className="rounded-lg border border-[#e3e9f2] p-4 text-center"><span className={`mx-auto flex h-9 w-9 items-center justify-center rounded-full ${tone === "green" ? "bg-[#eaf8ef] text-[#16a34a]" : tone === "amber" ? "bg-[#fff4e8] text-[#f97316]" : "bg-[#edf4ff] text-[#0b63e5]"}`}><IconComponent className="h-4 w-4" /></span><p className="mt-3 text-xs text-[#61708a]">{label}</p><p className="mt-2 text-[15px] font-extrabold text-[#0b1f44]">{formatCurrency(value as number | null)}</p></div>;
            })}
          </div>
        </ReferencePanel>

        <ReferencePanel title="Important Alerts">
          <div className="divide-y divide-[#edf1f6]">
            {statutoryRows.length ? statutoryRows.slice(0, 5).map((row, index) => (
              <ReferenceListRow
                key={String(row.id ?? index)}
                icon={index === 0 ? TriangleAlert : FileText}
                title={String(row.filing_type ?? row.type ?? "Compliance filing")}
                subtitle={String(row.due_date ?? row.dueDate ?? "Due date unavailable")}
                value={String(row.status ?? "Pending")}
                tone={String(row.status ?? "").toLowerCase().includes("paid") || String(row.status ?? "").toLowerCase().includes("filed") ? "green" : index === 0 ? "red" : "amber"}
              />
            )) : <div className="px-3 py-10 text-center text-xs text-[#94a3b8]">Run-linked statutory source unavailable</div>}
          </div>
        </ReferencePanel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.8fr_0.8fr_1.1fr_1fr]">
        <ReferencePanel title="Loan & Advances Snapshot">
          <div className="divide-y divide-[#edf1f6]">
            {/* Loan balances are org-wide, not scoped to a payroll run, so this
                endpoint deliberately does not serve them — see the note in
                dashboard.routes.ts. Stated plainly rather than shown as four
                em dashes that look like missing data. */}
            <p className="px-3 py-8 text-center text-xs text-[#94a3b8]">
              Loan balances are org-wide and not scoped to a payroll run
            </p>
          </div>
        </ReferencePanel>

        <ReferencePanel title="Reimbursements Pending">
          <div className="divide-y divide-[#edf1f6]">
            {/* Same reasoning as loans: claims are org-wide, not run-scoped. */}
            <p className="px-3 py-8 text-center text-xs text-[#94a3b8]">
              Reimbursement claims are org-wide and not scoped to a payroll run
            </p>
          </div>
        </ReferencePanel>

        <ReferencePanel title="Compliance Due Dates">
          <div className="divide-y divide-[#edf1f6]">
            {statutoryRows.length ? statutoryRows.slice(0, 6).map((row, index) => (
              <ReferenceListRow key={String(row.id ?? index)} title={String(row.filing_type ?? row.type ?? "Filing")} subtitle={String(row.due_date ?? row.dueDate ?? "—")} value={String(row.status ?? "Pending")} tone={String(row.status ?? "").toLowerCase().includes("filed") ? "green" : "blue"} />
             )) : readiness ? (
               <>
                 {/* branchReadiness is an object keyed to the run's month, not a list
                     of branches. It was read with arrayAt, so it was always empty. */}
                 <ReferenceListRow title="Branches in scope" value={asNumber(readiness.branches)} tone="slate" />
                 <ReferenceListRow title="Attendance frozen" value={asNumber(readiness.attendanceFrozen)} tone={Number(readiness.attendanceFrozen ?? 0) > 0 ? "green" : "amber"} />
                 <ReferenceListRow title="Attendance data ready" value={asNumber(readiness.dataReady)} tone={Number(readiness.dataReady ?? 0) > 0 ? "green" : "amber"} />
               </>
             ) : null}
             {!statutoryRows.length && !readiness ? <p className="px-3 py-8 text-center text-xs text-[#94a3b8]">No compliance or readiness data for this run</p> : null}
          </div>
        </ReferencePanel>

        {/* The donut summed four values the endpoint never returned, so it was
            always 0 and printed "0% Generated" over a body reading "No data".
            salary_payslip is month-keyed, so generation is counted for the run's
            month against the run's own lines. */}
        <ReferencePanel title={`Payslip Generation Status (${currentMonth})`}>
          {payslips ? (
            <>
              <ReferenceDonut compact centerValue={`${asNumber(payslips.pct) ?? 0}%`} centerLabel="Generated" data={[
                { name: "Generated", value: asNumber(payslips.generated) ?? 0 },
                { name: "Pending", value: asNumber(payslips.pending) ?? 0 },
              ]} />
              <div className="mt-4 divide-y divide-[#edf1f6]">
                <ReferenceListRow title="Generated" value={asNumber(payslips.generated)} tone="green" />
                <ReferenceListRow title="Expected (run lines)" value={asNumber(payslips.expected)} tone="slate" />
              </div>
            </>
          ) : (
            <p className="px-3 py-8 text-center text-xs text-[#94a3b8]">No payroll lines in this run to generate payslips for</p>
          )}
        </ReferencePanel>

        <SalaryComponentPanel data={data} />
        <AttendanceExceptionPanel data={data} />
      </div>
    </div>
  );
}
