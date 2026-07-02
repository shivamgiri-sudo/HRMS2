import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  EnterprisePageHeader,
  KpiCard,
  KpiCardGrid,
} from "@/components/enterprise";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
} from "recharts";
import { Download, FileText, Users, Calendar, CreditCard, TrendingUp, TrendingDown, UserPlus, UserMinus, Loader2, ShieldAlert, User } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PayrollSummaryReport } from "@/components/reports/PayrollSummaryReport";
import { LeaveBalanceReport } from "@/components/reports/LeaveBalanceReport";
import { AssetInventoryReport } from "@/components/reports/AssetInventoryReport";
import { AttendanceReport } from "@/components/reports/AttendanceReport";
import { EmployeeReport } from "@/components/reports/EmployeeReport";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsAdminOrHR } from "@/hooks/useUserRole";
import { RoleInsightsPanel } from "@/components/insights/RoleInsightsPanel";
import {
  useEmployeeGrowthData,
  useDepartmentDistribution,
  useLeaveStatistics,
  usePayrollTrend,
  useHeadcountSummary,
} from "@/hooks/useReportsData";

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => String(currentYear - i));

const LEAVE_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

const reportCards = [
  { title: "Attendance Report", description: "Monthly attendance tracking", icon: <Users className="h-5 w-5" />, sectionId: "report-attendance" },
  { title: "Leave Summary", description: "Leave balance and usage report", icon: <Calendar className="h-5 w-5" />, sectionId: "report-leave" },
  { title: "Payroll Report", description: "Monthly payroll breakdown", icon: <CreditCard className="h-5 w-5" />, sectionId: "report-payroll" },
  { title: "Asset Report", description: "Asset inventory and assignments", icon: <FileText className="h-5 w-5" />, sectionId: "report-asset" },
];

const Reports = () => {
  const [selectedYear, setSelectedYear] = useState(String(currentYear));
  const year = parseInt(selectedYear);
  const { isAdminOrHR, isLoading: roleLoading, roleKeys } = useIsAdminOrHR();

  const { data: employeeGrowthData, isLoading: isLoadingGrowth } = useEmployeeGrowthData(year);
  const { data: departmentData, isLoading: isLoadingDept } = useDepartmentDistribution(year);
  const { data: leaveStats, monthlyData: leaveMonthlyData, leaveTypeKeys, leaveTypeLabels, isLoading: isLoadingLeave } = useLeaveStatistics(year);
  const { data: payrollTrendData, isLoading: isLoadingPayroll } = usePayrollTrend(year);
  const { data: headcountData, isLoading: isLoadingHeadcount } = useHeadcountSummary(year);

  if (roleLoading) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[400px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  if (!isAdminOrHR) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[400px] flex-col items-center justify-center space-y-4">
          <ShieldAlert className="h-16 w-16 text-destructive" />
          <h2 className="text-2xl font-bold text-foreground">Access Denied</h2>
          <p className="text-muted-foreground">You don't have permission to access this page.</p>
          <p className="text-sm text-muted-foreground">Only administrators and HR personnel can view reports.</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <EnterprisePageHeader
          eyebrow="Analytics"
          title="Reports Library"
          description="Browse statutory, payroll, attendance, employee, leave and asset reports from one consistent workspace."
          status="info"
          rightSlot={
            <Select value={selectedYear} onValueChange={setSelectedYear}>
              <SelectTrigger className="w-full bg-white !text-slate-900 sm:w-[140px] [&>span]:!text-slate-900">
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent className="bg-white !text-slate-900">
                {YEARS.map((y) => (
                  <SelectItem key={y} value={y}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />

        <RoleInsightsPanel roles={roleKeys} title="Report control insights" />

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList>
            <TabsTrigger value="overview">
              <FileText className="mr-2 h-4 w-4" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="employee">
              <User className="mr-2 h-4 w-4" />
              Employee Report
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {reportCards.map((report) => (
            <Card
              key={report.title}
              className="cursor-pointer rounded-[var(--r-lg)] border-[var(--border-hairline)] bg-[var(--surface-0)] shadow-[var(--shadow-xs)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]"
              onClick={() => document.getElementById(report.sectionId)?.scrollIntoView({ behavior: "smooth" })}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{report.title}</CardTitle>
                {report.icon}
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">{report.description}</p>
                <Button variant="ghost" size="sm" className="mt-4 w-full">
                  View Report
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        <KpiCardGrid>
          <KpiCard title="Start of Year" value={headcountData?.startOfYear ?? 0} description="Employees on Jan 1" icon={<Users className="h-5 w-5" />} tone="people" loading={isLoadingHeadcount} />
          <KpiCard title="Current Headcount" value={headcountData?.currentHeadcount ?? 0} description="Active employees" icon={<UserPlus className="h-5 w-5" />} tone="success" loading={isLoadingHeadcount} />
          <KpiCard title="New Joiners" value={`+${headcountData?.newJoiners ?? 0}`} description="This year" icon={<TrendingUp className="h-5 w-5" />} tone="brand" loading={isLoadingHeadcount} />
          <KpiCard title="Terminations" value={`-${headcountData?.terminations ?? 0}`} description="This year" icon={<TrendingDown className="h-5 w-5" />} tone="danger" loading={isLoadingHeadcount} />
        </KpiCardGrid>

        <Card>
          <CardHeader>
            <CardTitle>Employee Growth Trend</CardTitle>
            <CardDescription>Monthly headcount changes</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingGrowth ? (
              <div className="h-[300px] flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={employeeGrowthData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="headcount" stroke="hsl(var(--primary))" strokeWidth={2} name="Headcount" />
                  <Line type="monotone" dataKey="joiners" stroke="hsl(var(--chart-2))" strokeWidth={2} name="Joiners" />
                  <Line type="monotone" dataKey="exits" stroke="hsl(var(--chart-3))" strokeWidth={2} name="Exits" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Department Distribution</CardTitle>
              <CardDescription>Employee distribution by department</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingDept ? (
                <div className="h-[300px] flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={departmentData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                      {departmentData?.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={`hsl(var(--chart-${(index % 5) + 1}))`} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="flex flex-col">
            <CardHeader>
              <CardTitle>Leave Statistics</CardTitle>
              <CardDescription>
                Approved leave days by type — {selectedYear} · Company-wide
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 space-y-4">
              {isLoadingLeave ? (
                <div className="h-[300px] flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>
              ) : !leaveStats?.length ? (
                <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
                  No approved leave records for {selectedYear}
                </div>
              ) : (
                <>
                  {/* Stacked monthly trend */}
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={leaveMonthlyData} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip
                        formatter={(value: number, key: string) => [
                          `${value} day${value !== 1 ? "s" : ""}`,
                          leaveTypeLabels[key] ?? key,
                        ]}
                        contentStyle={{ borderRadius: 8, fontSize: 12 }}
                      />
                      <Legend
                        formatter={(key) => leaveTypeLabels[key] ?? key}
                        wrapperStyle={{ fontSize: 11 }}
                      />
                      {leaveTypeKeys.map((key, i) => (
                        <Bar
                          key={key}
                          dataKey={key}
                          stackId="a"
                          fill={LEAVE_COLORS[i % LEAVE_COLORS.length]}
                          radius={i === leaveTypeKeys.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>

                  {/* Summary table */}
                  <div className="rounded-md border text-sm">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b bg-muted/50 text-xs font-semibold text-muted-foreground">
                          <th className="px-3 py-2 text-left">Leave Type</th>
                          <th className="px-3 py-2 text-right">Days Taken</th>
                          <th className="px-3 py-2 text-right">Employees</th>
                          <th className="px-3 py-2 text-right">Requests</th>
                          <th className="px-3 py-2 text-right">Avg Days/Emp</th>
                        </tr>
                      </thead>
                      <tbody>
                        {leaveStats.map((row, i) => (
                          <tr key={row.name} className="border-b last:border-0">
                            <td className="px-3 py-2 flex items-center gap-2">
                              <span
                                className="inline-block h-2.5 w-2.5 rounded-sm flex-shrink-0"
                                style={{ background: LEAVE_COLORS[i % LEAVE_COLORS.length] }}
                              />
                              {row.name}
                            </td>
                            <td className="px-3 py-2 text-right font-medium tabular-nums">{row.days}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{row.employees}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{row.requests}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                              {row.employees > 0 ? (row.days / row.employees).toFixed(1) : "—"}
                            </td>
                          </tr>
                        ))}
                        <tr className="bg-muted/30 font-semibold text-xs">
                          <td className="px-3 py-2">Total</td>
                          <td className="px-3 py-2 text-right tabular-nums">{leaveStats.reduce((s, r) => s + r.days, 0)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                            {leaveStats.reduce((s, r) => s + r.employees, 0)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                            {leaveStats.reduce((s, r) => s + r.requests, 0)}
                          </td>
                          <td className="px-3 py-2" />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Payroll Trend</CardTitle>
            <CardDescription>Monthly payroll expenses</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingPayroll ? (
              <div className="h-[300px] flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={payrollTrendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis tickFormatter={(value) => `${(Number(value) / 100000).toFixed(1)}L`} />
                  <Tooltip
                    formatter={(value) => {
                      const lakhs = (Number(value) / 100000).toFixed(2);
                      return [`₹${lakhs}L (${Number(value).toLocaleString('en-IN')})`, 'Payroll Amount'];
                    }}
                  />
                  <Line type="monotone" dataKey="amount" stroke="hsl(var(--primary))" strokeWidth={2} name="Payroll Amount" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

            <div id="report-attendance"><AttendanceReport /></div>
            <div id="report-leave"><LeaveBalanceReport /></div>
            <div id="report-payroll"><PayrollSummaryReport /></div>
            <div id="report-asset"><AssetInventoryReport /></div>
          </TabsContent>

          <TabsContent value="employee" className="space-y-6">
            <EmployeeReport />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

export default Reports;
