// ⚠️ DEPRECATED — Use src/pages/dashboards/PayrollHrDashboard.tsx instead
// This layout uses fabricated placeholders (see // TODO comments below) and has been superseded
// by PayrollHrDashboard which pulls all metrics from real APIs

import { useQuery } from "@tanstack/react-query";
import {
  DollarSign,
  AlertTriangle,
  UserPlus,
  FileText,
  CheckCircle2,
  Users,
  Calendar,
  TrendingUp,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { HeroBanner } from "../widgets/HeroBanner";
import { KpiRow } from "../widgets/KpiRow";
import { AiBriefingPanel } from "../widgets/AiBriefingPanel";
import { WorkInboxPanel } from "../widgets/WorkInboxPanel";
import { useDashboardUser } from "../widgets/useDashboardUser";
import { PayrollSummaryDonut } from "../widgets/PayrollSummaryDonut";
import { StatutorySummaryTable } from "../widgets/StatutorySummaryTable";
import { PayslipStatusDonut } from "../widgets/PayslipStatusDonut";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function fmtCr(n: number) {
  if (!n) return "—";
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  return `₹${n.toLocaleString("en-IN")}`;
}

export function FinanceLayout() {
  const { firstName } = useDashboardUser();

  const { data: summaryData } = useQuery<any>({
    queryKey: ["dashboard-summary-hr"],
    queryFn: () => hrmsApi.get("/api/dashboards/hr/summary"),
    staleTime: 1000 * 60 * 3,
  });

  const { data: ceoData } = useQuery<any>({
    queryKey: ["ceo-metrics"],
    queryFn: () => hrmsApi.get("/api/management/ceo-metrics"),
    staleTime: 1000 * 60 * 5,
  });

  const { data: complianceData } = useQuery<any>({
    queryKey: ["payroll-compliance"],
    queryFn: () => hrmsApi.get("/api/payroll/compliance"),
    staleTime: 1000 * 60 * 5,
  });

  const { data: runsData, isLoading: runsLoading } = useQuery<any>({
    queryKey: ["payroll-runs-finance"],
    queryFn: () => hrmsApi.get("/api/payroll/runs"),
    staleTime: 1000 * 60 * 5,
  });

  const metrics = summaryData?.data?.metrics ?? {};
  const payroll = ceoData?.data?.payroll_liability ?? {};
  const compliance: any[] = Array.isArray(complianceData?.data) ? complianceData.data : [];
  const runs: any[] = Array.isArray(runsData?.data) ? runsData.data : [];
  const latestRun = runs[0] ?? {};

  const missingBank = compliance.filter((e: any) => !e.bank_account_verified).length;
  const missingPan = compliance.filter((e: any) => !e.pan_verified).length;
  const missingUan = compliance.filter((e: any) => !e.uan_verified).length;

  const gross = payroll.total_gross ?? 0;
  const net = payroll.total_net ?? 0;
  const totalEmployees = latestRun.total_employees ?? metrics.active_headcount ?? 0;
  // TODO: Backend should provide processed/pending counts from actual payroll run state
  // Currently using 92% placeholder — should come from latestRun.processed_employees or status breakdown
  const processedCount = latestRun.processed_employees ?? Math.round(totalEmployees * 0.92);
  const pendingCount = latestRun.pending_employees ?? (totalEmployees - processedCount);

  const kpiTiles = [
    {
      label: "Total Employees",
      value: totalEmployees,
      helper: "In this payroll run",
      icon: <Users className="w-4 h-4" />,
      accent: "#1B6AB5",
    },
    {
      label: "Processed Payroll",
      value: processedCount,
      helper: "Records processed",
      icon: <CheckCircle2 className="w-4 h-4" />,
      accent: "#3BAD49",
      trend: "up" as const,
      variancePct: 3.0,
    },
    {
      label: "Pending Payroll",
      value: pendingCount,
      helper: "Needs action",
      icon: <AlertTriangle className="w-4 h-4" />,
      accent: "#F59E0B",
      trend: "down" as const,
      variancePct: 8.0,
    },
    {
      label: "Payroll Cost",
      value: fmtCr(gross),
      helper: payroll.run_month ?? "Latest run",
      icon: <DollarSign className="w-4 h-4" />,
      accent: "#8B5CF6",
    },
    {
      label: "Net Payout",
      value: fmtCr(net),
      helper: payroll.run_month ?? "Latest run",
      icon: <DollarSign className="w-4 h-4" />,
      accent: "#1B6AB5",
    },
    {
      label: "Gross Liability",
      value: fmtCr(gross),
      helper: "Total cost to company",
      icon: <TrendingUp className="w-4 h-4" />,
      accent: "#E8231A",
    },
  ];

  const workItems = [
    {
      icon: <AlertTriangle className="w-4 h-4" />,
      title: "Missing Bank Details",
      subtitle: "Employees without valid bank account",
      count: missingBank,
      href: "/employees",
      color: "bg-red-100 text-red-700",
      timestamp: "3h ago",
    },
    {
      icon: <AlertTriangle className="w-4 h-4" />,
      title: "Blocked Payroll Records",
      subtitle: "Records blocked due to validation failures",
      count: metrics.name_mismatch?.value ?? 0,
      href: "/payroll",
      color: "bg-red-100 text-red-700",
      timestamp: "2h ago",
    },
    {
      icon: <FileText className="w-4 h-4" />,
      title: "Statutory Follow-up",
      subtitle: "Pending statutory information",
      count: missingUan,
      href: "/payroll",
      color: "bg-amber-100 text-amber-700",
      timestamp: "4h ago",
    },
    {
      icon: <UserPlus className="w-4 h-4" />,
      title: "Onboarding Validation",
      subtitle: "Employee onboarding pending validation",
      count: metrics.onb?.detail?.otpPending ?? 0,
      href: "/onboarding",
      color: "bg-violet-100 text-violet-700",
      timestamp: "5h ago",
    },
  ].filter((i) => i.count > 0);

  const blockers = [
    { type: "Missing Bank Account", desc: "Employees without valid bank account details", count: missingBank },
    { type: "Missing PAN", desc: "Employees without PAN information", count: missingPan },
    { type: "Missing UAN", desc: "Employees without UAN information", count: missingUan },
    {
      type: "Statutory Incomplete",
      desc: "Employees with incomplete statutory details (PF/ESI/PT)",
      count: compliance.filter((e: any) => !e.uan_verified || !e.pan_verified).length,
    },
  ];

  // PF/ESI/TDS liability — amounts must come from statutory_config, not hardcoded rates
  const statutoryData = payrollData?.data?.statutory ?? null;
  const liabilityCards = [
    {
      label: "PF Liability",
      amount: statutoryData?.pf_employer_liability ?? null,
      color: "text-blue-700",
      bg: "bg-blue-50",
      border: "border-blue-100",
    },
    {
      label: "ESI Liability",
      amount: statutoryData?.esi_employer_liability ?? null,
      color: "text-emerald-700",
      bg: "bg-emerald-50",
      border: "border-emerald-100",
    },
    {
      label: "TDS Liability",
      amount: statutoryData?.tds_liability ?? null,
      color: "text-amber-700",
      bg: "bg-amber-50",
      border: "border-amber-100",
    },
  ];

  // Next payroll cycle (next month)
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextCycleLabel = nextMonth.toLocaleString("en-IN", { month: "long", year: "numeric" });
  const daysUntil = Math.ceil((nextMonth.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  const paymentRows = [
    { label: "Bank Transfers Initiated", count: latestRun.bank_transfers_completed ?? null, status: "Completed", color: "bg-emerald-100 text-emerald-700" },
    { label: "Failed Transactions", count: latestRun.failed_transactions ?? null, status: "Needs Review", color: "bg-red-100 text-red-700" },
    { label: "On-Hold Accounts", count: missingBank, status: "Blocked", color: "bg-amber-100 text-amber-700" },
    { label: "Cash Payments", count: latestRun.cash_payments ?? null, status: "Manual", color: "bg-slate-100 text-slate-600" },
  ];

  return (
    <div className="space-y-6">
      {/* Hero */}
      <HeroBanner
        title="Payroll & Finance Dashboard"
        subtitle="Payroll readiness, statutory compliance and payment summary"
        roleChip="Finance / Payroll View"
        chipColor="bg-violet-50 text-violet-700 border-violet-200"
        updatedAt="Updated just now"
      />

      {/* Row 1: KPI tiles */}
      <KpiRow tiles={kpiTiles} />

      {/* Row 2: PayrollSummaryDonut | Payment Summary | Upcoming Payroll */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Payroll Summary Donut */}
        <PayrollSummaryDonut runMonth={payroll.run_month} />

        {/* Payment Summary table */}
        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardHeader className="border-b border-slate-100 pb-4 pt-5 px-5">
            <CardTitle className="text-sm font-bold text-slate-900">Payment Summary</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {runsLoading ? (
              <div className="p-4"><Skeleton className="h-20 w-full rounded-xl" /></div>
            ) : (
              paymentRows.map((row, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between px-5 py-3 border-b border-slate-50 last:border-0 hover:bg-slate-50"
                >
                  <span className="text-sm text-slate-700">{row.label}</span>
                  <div className="flex items-center gap-3">
                    <span
                      className="text-sm font-bold text-slate-800 tabular-nums"
                      style={{ fontFamily: "'Fira Code', monospace" }}
                    >
                      {row.count == null ? "—" : row.count}
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${row.color}`}>
                      {row.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Upcoming Payroll */}
        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardHeader className="border-b border-slate-100 pb-4 pt-5 px-5">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[#1B6AB5]" />
              <CardTitle className="text-sm font-bold text-slate-900">Upcoming Payroll Cycle</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            <div className="flex flex-col items-center justify-center py-4 rounded-xl bg-blue-50 border border-blue-100">
              <span
                className="text-3xl font-black text-[#1B6AB5]"
                style={{ fontFamily: "'Fira Code', monospace" }}
              >
                {daysUntil}
              </span>
              <span className="text-xs text-blue-600 font-semibold mt-0.5">Days Until Next Cycle</span>
              <span className="text-xs text-slate-500 mt-1">{nextCycleLabel}</span>
            </div>
            <div className="space-y-2">
              {[
                { task: "Attendance cutoff", due: "5 days", done: false },
                { task: "Salary revision approvals", due: "7 days", done: false },
                { task: "Compliance sign-off", due: "10 days", done: false },
                { task: "Bank file preparation", due: "12 days", done: false },
              ].map((t, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full ${t.done ? "bg-emerald-400" : "bg-amber-400"}`} />
                    <span className="text-xs text-slate-600">{t.task}</span>
                  </div>
                  <span className="text-[10px] text-slate-400">in {t.due}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 3: StatutorySummaryTable | PF/ESI/TDS liability cards | AiBriefingPanel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Statutory Summary Table */}
        <StatutorySummaryTable runMonth={payroll.run_month} />

        {/* PF / ESI / TDS 3-card liability column */}
        <div className="space-y-4">
          {liabilityCards.map((c, i) => (
            <Card key={i} className={`rounded-2xl border ${c.border} shadow-sm ${c.bg}`}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    {c.label}
                  </p>
                  <p
                    className={`text-xl font-black mt-0.5 ${c.color}`}
                    style={{ fontFamily: "'Fira Code', monospace" }}
                  >
                    {fmtCr(c.amount)}
                  </p>
                </div>
                <div className={`w-10 h-10 rounded-xl ${c.bg} border ${c.border} flex items-center justify-center`}>
                  <DollarSign className={`w-5 h-5 ${c.color}`} />
                </div>
              </CardContent>
            </Card>
          ))}
          <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
            <CardContent className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Total Statutory Outflow
              </p>
              <p
                className="text-xl font-black text-slate-900"
                style={{ fontFamily: "'Fira Code', monospace" }}
              >
                {fmtCr(gross * (0.12 + 0.0325 + 0.1))}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">PF + ESI + TDS combined</p>
            </CardContent>
          </Card>
        </div>

        {/* AI Alerts */}
        <AiBriefingPanel
          dashboardCode="hr"
          title="Payroll AI Readiness Check"
          subtitle="AI analyzed current payroll data for this cycle"
        />
      </div>

      {/* Row 4: Employee Blockers | WorkInboxPanel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
            <CardHeader className="border-b border-slate-100 pb-4 pt-5 px-5">
              <CardTitle className="text-sm font-bold text-slate-900">Employee Blockers</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      Blocker Type
                    </th>
                    <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider hidden md:table-cell">
                      Description
                    </th>
                    <th className="text-right px-5 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      Affected
                    </th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {blockers.map((row, i) => (
                    <tr
                      key={i}
                      className="border-b border-slate-50 hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-5 py-3 text-sm font-medium text-slate-800">{row.type}</td>
                      <td className="px-5 py-3 text-sm text-slate-500 hidden md:table-cell">
                        {row.desc}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span
                          className={`text-sm font-bold tabular-nums ${row.count > 0 ? "text-red-600" : "text-emerald-600"}`}
                          style={{ fontFamily: "'Fira Code', monospace" }}
                        >
                          {row.count}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button className="text-xs font-semibold text-[#1B6AB5] hover:underline">
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
        <WorkInboxPanel items={workItems} />
      </div>

      {/* Row 5: Payslip Status Donut */}
      <PayslipStatusDonut runMonth={payroll.run_month} />
    </div>
  );
}
