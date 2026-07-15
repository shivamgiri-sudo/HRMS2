import {
  BadgeIndianRupee,
  CalendarDays,
  CheckCircle2,
  Clock3,
  CreditCard,
  FileCheck2,
  FileText,
  IndianRupee,
  Landmark,
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
  formatValue,
  metricDetail,
  metricValue,
  numberAt,
  read,
  stringAt,
} from "../reference-dashboard-model";

export function PayrollReferenceLayout({ data }: { data: ReferenceDashboardData }) {
  const m = data.metrics;
  const active = metricDetail(m, "hc", "active") ?? metricValue(m, "hc");
  const ready = metricDetail(m, "payroll", "readyCount") ?? metricValue(m, "payroll");
  const blocked = metricDetail(m, "payroll", "blockerCount");
  const total = ready !== null && blocked !== null ? ready + blocked : active;
  const salaryBill = (read(data.payroll, "salaryBill") ?? {}) as Record<string, unknown>;
  const currentRun = (read(data.payroll, "currentRun") ?? {}) as Record<string, unknown>;
  const totalGross = asNumber(salaryBill.totalGross ?? salaryBill.total_gross) ?? numberAt(data.pnl, "payroll_liability", "total_gross");
  const totalNet = asNumber(salaryBill.totalNet ?? salaryBill.total_net) ?? numberAt(data.pnl, "payroll_liability", "total_net");
  const deductions = asNumber(salaryBill.totalDeductions ?? salaryBill.total_deductions);
  const employerContribution = numberAt(data.pnl, "payroll_liability", "employer_statutory");
  const payrollCost = totalGross ?? numberAt(data.pnl, "kpis", "organisationPayrollCost") ?? numberAt(data.pnl, "kpis", "totalDirectCost");
  const currentMonth = String(data.payroll.currentMonth ?? currentRun.month ?? currentRun.run_month ?? "Current Cycle");
  const processed = asNumber(salaryBill.employeeCount ?? salaryBill.emp_count) ?? ready;
  const pending = total !== null && processed !== null ? Math.max(0, total - processed) : blocked;
  const statutoryRows = arrayAt(data.payroll, "statutoryFiling");
  const branchReadiness = arrayAt(data.payroll, "branchReadiness");
  const disbursement = (read(data.payroll, "disbursement") ?? {}) as Record<string, unknown>;
  const disbursed = asNumber(disbursement.completed);
  const disbursalTotal = Object.values(disbursement).reduce((sum, value) => sum + (asNumber(value) ?? 0), 0);
  const payslipPct = disbursalTotal > 0 && disbursed !== null ? Math.round((disbursed / disbursalTotal) * 1000) / 10 : null;
  const pendingQueues = (read(data.payroll, "pendingQueues") ?? {}) as Record<string, unknown>;
  const loans = (read(data.payroll, "loans") ?? {}) as Record<string, unknown>;
  const reimbursements = (read(data.payroll, "reimbursements") ?? {}) as Record<string, unknown>;
  const payDay = stringAt(data.payroll, "payDay") ?? stringAt(currentRun, "payDate") ?? stringAt(currentRun, "closedAt");

  const statutoryValue = (name: string) => {
    const row = statutoryRows.find((item) => String(item.filing_type ?? item.type ?? "").toLowerCase().includes(name.toLowerCase()));
    return row ? asNumber(row.amount ?? row.liability ?? row.value) : null;
  };

  const pf = statutoryValue("pf");
  const esi = statutoryValue("esi");
  const tds = statutoryValue("tds");
  const pt = statutoryValue("professional");

  return (
    <div className="reference-dashboard-page">
      <ReferenceHeader title="Finance / Payroll Dashboard" subtitle="Manage payroll operations and financial compliance" />

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
          <ReferenceDonut
            centerValue={formatCurrency(payrollCost)}
            centerLabel="Total Payroll Cost"
            data={[
              { name: "Basic / Gross Pay", value: totalGross ?? 0 },
              { name: "Net Pay", value: totalNet ?? 0 },
              { name: "Deductions", value: deductions ?? 0 },
              { name: "Employer Contributions", value: employerContribution ?? 0 },
            ]}
          />
        </ReferencePanel>

        <ReferencePanel title={`Payment Summary (${currentMonth})`}>
          <div className="divide-y divide-[#edf1f6]">
            <ReferenceListRow icon={WalletCards} title="Net Pay Paid" value={formatCurrency(totalNet)} tone="green" />
            <ReferenceListRow icon={BadgeIndianRupee} title="Employer Contributions" value={formatCurrency(employerContribution)} tone="blue" />
            <ReferenceListRow icon={ReceiptIndianRupee} title="Total Payments" value={formatCurrency(totalGross)} tone="slate" />
            <ReferenceListRow icon={CreditCard} title="Payment Mode" value={String(data.payroll.paymentMode ?? "Bank Transfer")} tone="blue" />
          </div>
        </ReferencePanel>

        <ReferencePanel title="Upcoming Payroll">
          <div className="rounded-lg border border-[#dce8fb] bg-[#f4f8ff] p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-[#0b63e5]"><CalendarDays className="h-5 w-5" /></span>
              <div><p className="text-[13px] font-bold text-[#0b63e5]">{currentMonth}</p><p className="mt-1 text-[9px] text-[#71809a]">Payroll cycle</p></div>
            </div>
            <div className="mt-5 rounded-lg border border-[#bcd4fb] bg-white p-4 text-center">
              <p className="text-[10px] text-[#61708a]">Pay Day</p>
              <p className="mt-2 text-[20px] font-extrabold text-[#0b1f44]">{payDay ? new Date(payDay).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</p>
            </div>
          </div>
        </ReferencePanel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr_1fr]">
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
              return <div key={String(label)} className="rounded-lg border border-[#e3e9f2] p-4 text-center"><span className={`mx-auto flex h-9 w-9 items-center justify-center rounded-full ${tone === "green" ? "bg-[#eaf8ef] text-[#16a34a]" : tone === "amber" ? "bg-[#fff4e8] text-[#f97316]" : "bg-[#edf4ff] text-[#0b63e5]"}`}><IconComponent className="h-4 w-4" /></span><p className="mt-3 text-[9px] text-[#61708a]">{label}</p><p className="mt-2 text-[15px] font-extrabold text-[#0b1f44]">{formatCurrency(value as number | null)}</p></div>;
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
            )) : <div className="px-3 py-10 text-center text-[10px] text-[#94a3b8]">No statutory alerts available</div>}
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
          </div>
        </ReferencePanel>

        <ReferencePanel title={`Payslip Generation Status (${currentMonth})`}>
          <ReferenceDonut compact centerValue={payslipPct === null ? null : `${payslipPct}%`} centerLabel="Generated" data={[
            { name: "Generated", value: disbursed ?? 0 },
            { name: "In Progress", value: asNumber(disbursement.in_progress) ?? 0 },
            { name: "Pending", value: (asNumber(disbursement.initiated) ?? 0) + (asNumber(disbursement.failed) ?? 0) },
          ]} />
          <div className="mt-4 space-y-3">
            <ReferenceProgress label="Payroll readiness" value={ready !== null && total ? (ready / total) * 100 : null} max={100} suffix="%" tone="green" />
            <ReferenceProgress label="Pending queues" value={asNumber(pendingQueues.total)} max={Math.max(1, total ?? 1)} tone="amber" />
          </div>
        </ReferencePanel>
      </div>
    </div>
  );
}
