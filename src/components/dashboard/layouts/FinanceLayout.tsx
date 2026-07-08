import { useQuery } from "@tanstack/react-query";
import { DollarSign, AlertTriangle, UserPlus, FileText, CheckCircle2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { HeroBanner } from "../widgets/HeroBanner";
import { KpiRow } from "../widgets/KpiRow";
import { AiBriefingPanel } from "../widgets/AiBriefingPanel";
import { WorkInboxPanel } from "../widgets/WorkInboxPanel";
import { PayrollSummaryWidget } from "../widgets/PayrollSummaryWidget";
import { useDashboardUser } from "../widgets/useDashboardUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

  const metrics = summaryData?.data?.metrics ?? {};
  const payroll = ceoData?.data?.payroll_liability ?? {};
  const compliance: any[] = Array.isArray(complianceData?.data) ? complianceData.data : [];

  const missingBank = compliance.filter((e: any) => !e.bank_account_verified).length;
  const missingPan = compliance.filter((e: any) => !e.pan_verified).length;
  const missingUan = compliance.filter((e: any) => !e.uan_verified).length;

  const kpiTiles = [
    { label: "Payroll Readiness", value: metrics.payroll?.value ? `${metrics.payroll.value}%` : "—", helper: "vs Yesterday", icon: <CheckCircle2 className="w-4 h-4" />, accent: "#3BAD49", trend: "up" as const, variancePct: 3.0 },
    { label: "JCLR Pending", value: metrics.onb?.detail?.pending ?? metrics.onb?.value ?? 0, helper: "Needs Action", icon: <FileText className="w-4 h-4" />, accent: "#F59E0B", trend: "up" as const, variancePct: 17.1 },
    { label: "Name Mismatch", value: metrics.name_mismatch?.value ?? 0, helper: "Blocking Payroll", icon: <AlertTriangle className="w-4 h-4" />, accent: "#E8231A", trend: "down" as const, variancePct: 6.9 },
    { label: "Onboarding Validation", value: metrics.onb?.detail?.otpPending ?? 0, helper: "Pending Validation", icon: <UserPlus className="w-4 h-4" />, accent: "#8B5CF6", trend: "up" as const, variancePct: 16.7 },
    { label: "Net Payout", value: payroll.total_net ? `₹${(payroll.total_net / 10000000).toFixed(2)}Cr` : "—", helper: payroll.run_month ?? "Latest run", icon: <DollarSign className="w-4 h-4" />, accent: "#1B6AB5" },
    { label: "Gross Liability", value: payroll.total_gross ? `₹${(payroll.total_gross / 10000000).toFixed(2)}Cr` : "—", helper: "Total cost", icon: <DollarSign className="w-4 h-4" />, accent: "#8B5CF6" },
  ];

  const workItems = [
    { icon: <AlertTriangle className="w-4 h-4" />, title: "Missing Bank Details", subtitle: "Employees without valid bank account", count: missingBank, href: "/employees", color: "bg-red-100 text-red-700", timestamp: "3h ago" },
    { icon: <AlertTriangle className="w-4 h-4" />, title: "Blocked Payroll Records", subtitle: "Records blocked due to validation failures", count: metrics.name_mismatch?.value ?? 0, href: "/payroll", color: "bg-red-100 text-red-700", timestamp: "2h ago" },
    { icon: <FileText className="w-4 h-4" />, title: "Statutory Follow-up", subtitle: "Pending statutory information", count: missingUan, href: "/payroll", color: "bg-amber-100 text-amber-700", timestamp: "4h ago" },
    { icon: <UserPlus className="w-4 h-4" />, title: "Onboarding Validation", subtitle: "Employee onboarding pending validation", count: metrics.onb?.detail?.otpPending ?? 0, href: "/onboarding", color: "bg-violet-100 text-violet-700", timestamp: "5h ago" },
  ].filter((i) => i.count > 0);

  const blockers = [
    { type: "Missing Bank Account", desc: "Employees without valid bank account details", count: missingBank },
    { type: "Missing PAN", desc: "Employees without PAN information", count: missingPan },
    { type: "Missing UAN", desc: "Employees without UAN information", count: missingUan },
    { type: "Statutory Incomplete", desc: "Employees with incomplete statutory details (PF/ESI/PT)", count: compliance.filter((e: any) => !e.uan_verified || !e.pan_verified).length },
  ];

  return (
    <div className="space-y-6">
      <HeroBanner
        title="Payroll & HR Dashboard"
        subtitle="Payroll readiness, blockers and validation queue"
        roleChip="Payroll HR View"
        chipColor="bg-violet-50 text-violet-700 border-violet-200"
        updatedAt="Updated just now"
      />
      <KpiRow tiles={kpiTiles} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <AiBriefingPanel dashboardCode="hr" title="Payroll AI Readiness Check" subtitle="AI analyzed current payroll data for this cycle" />
          <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
            <CardHeader className="border-b border-slate-100 pb-4 pt-5 px-5">
              <CardTitle className="text-sm font-bold text-slate-900">Employee Blockers</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Blocker Type</th>
                    <th className="text-left px-5 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider hidden md:table-cell">Description</th>
                    <th className="text-right px-5 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Affected</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {blockers.map((row, i) => (
                    <tr key={i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3 text-sm font-medium text-slate-800">{row.type}</td>
                      <td className="px-5 py-3 text-sm text-slate-500 hidden md:table-cell">{row.desc}</td>
                      <td className="px-5 py-3 text-right">
                        <span className={`text-sm font-bold tabular-nums ${row.count > 0 ? "text-red-600" : "text-emerald-600"}`} style={{ fontFamily: "'Fira Code', monospace" }}>{row.count}</span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button className="text-xs font-semibold text-[#1B6AB5] hover:underline">View</button>
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
      <PayrollSummaryWidget />
    </div>
  );
}
