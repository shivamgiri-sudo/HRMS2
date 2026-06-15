import { useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
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
  const { isAdminOrHR, isLoading: roleLoading } = useIsAdminOrHR();

  const { data: employeeGrowthData, isLoading: isLoadingGrowth } = useEmployeeGrowthData(year);
  const { data: departmentData, isLoading: isLoadingDept } = useDepartmentDistribution(year);
  const { data: leaveStats, isLoading: isLoadingLeave } = useLeaveStatistics(year);
  const { data: payrollTrendData, isLoading: isLoadingPayroll } = usePayrollTrend(year);
  const { data: headcountData, isLoading: isLoadingHeadcount } = useHeadcountSummary(year);

  // Show loading while checking role
  if (roleLoading) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[400px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  // Redirect non-admin/HR users
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
        {/* Header */}
        <div>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Analytics</p>
          <h2 className="mt-1 text-3xl font-black text-slate-950">Reports & Analytics</h2>
          <p className="text-slate-600">Insights and data visualization</p>
        </div>

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
            <div className="flex justify-end">
              <Select value={selectedYear} onValueChange={setSelectedYear}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Year" />
                </SelectTrigger>
                <SelectContent>
                  {YEARS.map((y) => (
                    <SelectItem key={y} value={y}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

        {/* Quick Reports */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {reportCards.map((report) => (
            <Card
              key={report.title}
              className="rounded-3xl border bg-white p-5 shadow-sm hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200 cursor-pointer"
              onClick={() => {
                document.getElementById(report.sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="rounded-xl bg-primary/10 p-3 text-primary">{report.icon}</div>
                </div>
                <div className="mt-4">
                  <p className="font-semibold text-foreground">{report.title}</p>
                  <p className="text-sm text-muted-foreground">{report.description}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Headcount Summary Widget */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Headcount Summary
            </CardTitle>
            <CardDescription>New hires, terminations, and net change for {selectedYear}</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingHeadcount ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-24" />
                ))}
              </div>
            ) : headcountData ? (
              <div className="space-y-6">
                {/* Summary Stats */}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                  <div className="rounded-lg border bg-muted/50 p-4">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Current Headcount</p>
                    </div>
                    <p className="mt-2 text-3xl font-bold">{headcountData.currentHeadcount}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/50 p-4">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Start of Year</p>
                    </div>
                    <p className="mt-2 text-3xl font-bold">{headcountData.startOfYearHeadcount}</p>
                  </div>
                  <div className="rounded-lg border bg-green-500/10 p-4">
                    <div className="flex items-center gap-2">
                      <UserPlus className="h-4 w-4 text-green-600" />
                      <p className="text-sm text-green-600">New Hires</p>
                    </div>
                    <p className="mt-2 text-3xl font-bold text-green-600">+{headcountData.newHires}</p>
                  </div>
                  <div className="rounded-lg border bg-red-500/10 p-4">
                    <div className="flex items-center gap-2">
                      <UserMinus className="h-4 w-4 text-red-600" />
                      <p className="text-sm text-red-600">Terminations</p>
                    </div>
                    <p className="mt-2 text-3xl font-bold text-red-600">-{headcountData.terminations}</p>
                  </div>
                  <div className={`rounded-lg border p-4 ${headcountData.netChange >= 0 ? 'bg-primary/10' : 'bg-orange-500/10'}`}>
                    <div className="flex items-center gap-2">
                      {headcountData.netChange >= 0 ? (
                        <TrendingUp className="h-4 w-4 text-primary" />
                      ) : (
                        <TrendingDown className="h-4 w-4 text-orange-600" />
                      )}
                      <p className={`text-sm ${headcountData.netChange >= 0 ? 'text-primary' : 'text-orange-600'}`}>
                        Net Change
                      </p>
                    </div>
                    <p className={`mt-2 text-3xl font-bold ${headcountData.netChange >= 0 ? 'text-primary' : 'text-orange-600'}`}>
                      {headcountData.netChange >= 0 ? '+' : ''}{headcountData.netChange}
                    </p>
                  </div>
                </div>

                {/* Monthly Breakdown Chart */}
                <div className="h-[250px]">
                  {headcountData.monthlyBreakdown.some((m) => m.hires > 0 || m.terminations > 0) ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={headcountData.monthlyBreakdown}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "8px",
                          }}
                        />
                        <Legend />
                        <Bar dataKey="hires" name="New Hires" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="terminations" name="Terminations" fill="hsl(var(--chart-8))" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <p className="text-muted-foreground">No headcount changes recorded for {selectedYear}</p>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Charts Grid */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Employee Growth */}
          <Card>
            <CardHeader>
              <CardTitle>Employee Growth</CardTitle>
              <CardDescription>Monthly headcount trend for {selectedYear}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                {isLoadingGrowth ? (
                  <Skeleton className="h-full w-full" />
                ) : employeeGrowthData && employeeGrowthData.some((d) => d.employees > 0) ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={employeeGrowthData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="employees"
                        stroke="hsl(var(--primary))"
                        strokeWidth={3}
                        dot={{ fill: "hsl(var(--primary))", strokeWidth: 2, r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <p className="text-muted-foreground">No employee data available</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Department Distribution */}
          <Card>
            <CardHeader>
              <CardTitle>Department Distribution</CardTitle>
              <CardDescription>Active employees by department</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                {isLoadingDept ? (
                  <Skeleton className="h-full w-full" />
                ) : departmentData && departmentData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={departmentData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {departmentData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <p className="text-muted-foreground">No department data available</p>
                  </div>
                )}
              </div>
              {departmentData && departmentData.length > 0 && (
                <div className="mt-4 flex flex-wrap justify-center gap-4">
                  {departmentData.map((dept) => (
                    <div key={dept.name} className="flex items-center gap-2">
                      <div
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: dept.color }}
                      />
                      <span className="text-sm text-muted-foreground">
                        {dept.name} ({dept.value})
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Leave Statistics */}
          <Card>
            <CardHeader>
              <CardTitle>Leave Statistics</CardTitle>
              <CardDescription>Leave days taken by month for {selectedYear}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                {isLoadingLeave ? (
                  <Skeleton className="h-full w-full" />
                ) : leaveStats && leaveStats.monthlyData.some((d) => 
                    leaveStats.leaveTypeKeys.some((k) => (d[k] as number) > 0)
                  ) ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={leaveStats.monthlyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                      />
                      <Legend />
                      {leaveStats.leaveTypeKeys.map((key, index) => (
                        <Bar 
                          key={key} 
                          dataKey={key} 
                          fill={LEAVE_COLORS[index % LEAVE_COLORS.length]} 
                          radius={[4, 4, 0, 0]} 
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <p className="text-muted-foreground">No leave data available for {selectedYear}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Payroll Trend */}
          <Card>
            <CardHeader>
              <CardTitle>Payroll Trend</CardTitle>
              <CardDescription>Monthly payroll expenses for {selectedYear}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                {isLoadingPayroll ? (
                  <Skeleton className="h-full w-full" />
                ) : payrollTrendData && payrollTrendData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={payrollTrendData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={12}
                        tickFormatter={(value) => `₹${(value / 1000).toFixed(0)}k`}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                        }}
                        formatter={(value: number) => [`₹${value.toLocaleString('en-IN')}`, "Amount"]}
                      />
                      <Line
                        type="monotone"
                        dataKey="amount"
                        stroke="hsl(var(--primary))"
                        strokeWidth={3}
                        dot={{ fill: "hsl(var(--primary))", strokeWidth: 2, r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <p className="text-muted-foreground">No payroll data available for {selectedYear}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Payroll Summary Report */}
        <div id="report-payroll">
          <PayrollSummaryReport />
        </div>

        {/* Leave Balance Report */}
        <div id="report-leave">
          <LeaveBalanceReport />
        </div>

        {/* Asset Inventory Report */}
        <div id="report-asset">
          <AssetInventoryReport />
        </div>

        {/* Attendance Report */}
        <div id="report-attendance">
          <AttendanceReport />
        </div>
          </TabsContent>

          <TabsContent value="employee">
            <EmployeeReport />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

export default Reports;
