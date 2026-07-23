import {
  BadgeIndianRupee,
  CalendarDays,
  Clock3,
  CreditCard,
  FileCheck2,
  FileText,
  IndianRupee,
  ReceiptIndianRupee,
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
  metricValue,
  numberAt,
  read,
  stringAt,
} from "../reference-dashboard-model";
import { useReferenceDashboardShell } from "./ReferenceDashboardShell";

export function PayrollReferenceLayout({ data }: { data: ReferenceDashboardData }) {
  const { productHeaderControls } = useReferenceDashboardShell();
  const salaryBill = (read(data.payroll, "salaryBill") ?? {}) as Record<string, unknown>;
  const currentRun = (read(data.payroll, "currentRun") ?? {}) as Record<string, unknown>;
  const totalGross = asNumber(salaryBill.totalGross ?? salaryBill.total_gross);
  const totalNet = asNumber(salaryBill.totalNet ?? salaryBill.total_net);
  const deductions = asNumber(salaryBill.totalDeductions ?? salaryBill.total_deductions);
  const employerContribution = null;
  const payrollCost = totalGross;
  const currentMonth = String(data.payroll.currentMonth ?? currentRun.month ?? currentRun.run_month ?? "Current Cycle");
  const processed = asNumber(salaryBill.employeeCount ?? salaryBill.emp_count);
  const total = processed;
  const pending = null;
  const statutoryRows = arrayAt(data.payroll, "statutoryFiling");
  const branchReadiness = arrayAt(data.payroll, "branchReadiness");
  const disbursement = (read(data.payroll, "disbursement") ?? {}) as Record<string, unknown>;
  const disbursed = asNumber(disbursement.completed);
  const disbursalTotal = Object.values(disbursement).reduce((sum, value) => sum + (asNumber(value) ?? 0), 0);
  const payslipPct = disbursalTotal > 0 && disbursed !== null ? Math.round((disbursed / disbursalTotal) * 1000) / 10 : null;
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
        <ReferenceHeader title="Finance / Payroll Dashboard" subtitle="Manage payroll operations and financial compliance" right={productHeaderControls} />
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
      <ReferenceHeader title="Finance / Payroll Dashboard" subtitle="Manage payroll operations and financial compliance" right={productHeaderControls} />
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

      <ReferenceMetricGrid
        columns={4}
        loading={data.loading}
        metrics={[
          { label: "Total Employees", value: total, helper: "Active payroll population", icon: Users, tone: "violet" },
          { label: "Processed Payroll", value: processed, helper: "This Month", icon: FileCheck2, tone: "green" },
          { label: "Pending Payroll", value: pending, helper: "This Month", icon: Clock3, tone: "amber" },
          { label: `Payroll Cost (${currentMonth})`, value: formatCurrency(payrollCost), helper: "Total Cost", icon: IndianRupee, tone: "blue" },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[1.05fr_1.05fr_0.9fr]">
        <ReferencePanel title={`Payroll Summary (${currentMonth})`}>
          <div className="divide-y divide-[#edf1f6]">
            <ReferenceListRow icon={IndianRupee} title="Gross Pay" value={formatCurrency(totalGross)} tone="blue" />
            <ReferenceListRow icon={WalletCards} title="Net Pay" value={formatCurrency(totalNet)} tone="green" />
            <ReferenceListRow icon={ReceiptIndianRupee} title="Employee Deductions" value={formatCurrency(deductions)} tone="amber" />
            <ReferenceListRow icon={BadgeIndianRupee} title="Employer Contributions" value={formatCurrency(employerContribution)} tone="slate" />
          </div>
        </ReferencePanel>

        <ReferencePanel title={`Payment Summary (${currentMonth})`}>
          <div className="divide-y divide-[#edf1f6]">
            <ReferenceListRow icon={WalletCards} title="Net Pay Paid" value={formatCurrency(totalNet)} tone="green" />
            <ReferenceListRow icon={BadgeIndianRupee} title="Employer Contributions" value={formatCurrency(employerContribution)} tone="blue" />
            <ReferenceListRow icon={ReceiptIndianRupee} title="Gross Pay" value={formatCurrency(totalGross)} tone="slate" />
            <ReferenceListRow icon={CreditCard} title="Payment Mode" value={String(data.payroll.paymentMode ?? "—")} tone="blue" />
          </div>
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

      <div className="grid gap-4 xl:grid-cols-3">
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
            {[
              ["PF Liability", pf, Users, "green"],
              ["ESI Liability", esi, CreditCard, "blue"],
              ["TDS Liability", tds, FileText, "amber"],
            ].map(([label, value, Icon, tone]) => {
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
            <ReferenceListRow title="Total Outstanding" value={formatCurrency(asNumber(loans.totalOutstanding ?? loans.total_outstanding))} tone="blue" />
            <ReferenceListRow title="Active Loans" value={asNumber(loans.activeLoans ?? loans.active_loans)} tone="slate" />
            <ReferenceListRow title="Overdue Amount" value={formatCurrency(asNumber(loans.overdueAmount ?? loans.overdue_amount))} tone="red" />
            <ReferenceListRow title="Overdue Loans" value={asNumber(loans.overdueLoans ?? loans.overdue_loans)} tone="red" />
          </div>
        </ReferencePanel>

        <ReferencePanel title="Reimbursements Pending">
          <div className="divide-y divide-[#edf1f6]">
            <ReferenceListRow title="Total Pending" value={formatCurrency(asNumber(reimbursements.totalPending ?? reimbursements.total_pending))} tone="slate" />
            <ReferenceListRow title="Pending Requests" value={asNumber(reimbursements.pendingRequests ?? reimbursements.pending_requests)} tone="slate" />
            <ReferenceListRow title="Overdue Requests" value={asNumber(reimbursements.overdueRequests ?? reimbursements.overdue_requests)} tone="red" />
            <ReferenceListRow title="Avg. TAT" value={reimbursements.avgTat ?? reimbursements.avg_tat ?? "—"} tone="blue" />
          </div>
        </ReferencePanel>

        <ReferencePanel title="Compliance Due Dates">
          <div className="divide-y divide-[#edf1f6]">
            {statutoryRows.length ? statutoryRows.slice(0, 6).map((row, index) => (
              <ReferenceListRow key={String(row.id ?? index)} title={String(row.filing_type ?? row.type ?? "Filing")} subtitle={String(row.due_date ?? row.dueDate ?? "—")} value={String(row.status ?? "Pending")} tone={String(row.status ?? "").toLowerCase().includes("filed") ? "green" : "blue"} />
             )) : branchReadiness.slice(0, 5).map((row, index) => (
               <ReferenceListRow key={String(row.branch_id ?? index)} title={String(row.branch_name ?? "Branch readiness")} subtitle={String(row.readiness_status ?? "Status")} value={row.readiness_score} tone={asNumber(row.readiness_score) !== null && Number(row.readiness_score) >= 90 ? "green" : "amber"} />
             ))}
             {!statutoryRows.length && !branchReadiness.length ? <p className="px-3 py-8 text-center text-xs text-[#94a3b8]">Run-linked compliance source unavailable</p> : null}
          </div>
        </ReferencePanel>

        <ReferencePanel title={`Payslip Generation Status (${currentMonth})`}>
          <ReferenceDonut compact centerValue={payslipPct === null ? null : `${payslipPct}%`} centerLabel="Generated" data={[
            { name: "Generated", value: disbursed ?? 0 },
            { name: "In Progress", value: asNumber(disbursement.in_progress) ?? 0 },
            { name: "Pending", value: (asNumber(disbursement.initiated) ?? 0) + (asNumber(disbursement.failed) ?? 0) },
          ]} />
          <div className="mt-4 space-y-3">
             <ReferenceProgress label="Payroll readiness" value={null} max={100} suffix="%" tone="slate" />
            <ReferenceProgress label="Pending queues" value={asNumber(pendingQueues.total)} max={Math.max(1, total ?? 1)} tone="amber" />
          </div>
        </ReferencePanel>
      </div>
    </div>
  );
}
