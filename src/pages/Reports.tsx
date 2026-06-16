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
  const { data: leaveStats, isLoading: isLoadingLeave } = useLeaveStatistics(year);
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
        <div>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Analytics</p>
          <h2 className="mt-1 text-3xl font-black text-slate-950">Reports & Analytics</h2>
          <p className="text-slate-600">Insights and data visualization</p>
        </div>

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
            <div className="flex justify-end">
              <Select value={selectedYear} onValueChange={setSelectedYear}>
                <SelectTrigger className="w-[140px] bg-white !text-slate-900 [&>span]:!text-slate-900">
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
            </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {reportCards.map((report) => (
            <Card
              key={report.title}
              className="cursor-pointer hover:shadow-md transition-shadow"
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

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Start of Year</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoadingHeadcount ? <Skeleton className="h-8 w-20" /> : (
                <>
                  <div className="text-2xl font-bold">{headcountData?.startOfYear ?? 0}</div>
                  <p className="text-xs text-muted-foreground">Employees on Jan 1</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Current Headcount</CardTitle>
              <UserPlus className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoadingHeadcount ? <Skeleton className="h-8 w-20" /> : (
                <>
                  <div className="text-2xl font-bold">{headcountData?.currentHeadcount ?? 0}</div>
                  <p className="text-xs text-muted-foreground">Active employees</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">New Joiners</CardTitle>
              <TrendingUp className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              {isLoadingHeadcount ? <Skeleton className="h-8 w-20" /> : (
                <>
                  <div className="text-2xl font-bold text-green-600">+{headcountData?.newJoiners ?? 0}</div>
                  <p className="text-xs text-muted-foreground">This year</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Terminations</CardTitle>
              <TrendingDown className="h-4 w-4 text-red-600" />
            </CardHeader>
            <CardContent>
              {isLoadingHeadcount ? <Skeleton className="h-8 w-20" /> : (
                <>
                  <div className="text-2xl font-bold text-red-600">-{headcountData?.terminations ?? 0}</div>
                  <p className="text-xs text-muted-foreground">This year</p>
                </>
              )}
            </CardContent>
          </Card>
        </div>

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

          <Card>
            <CardHeader>
              <CardTitle>Leave Statistics</CardTitle>
              <CardDescription>Leave usage by type</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingLeave ? (
                <div className="h-[300px] flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={leaveStats}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="days" fill="hsl(var(--primary))">
                      {leaveStats?.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={LEAVE_COLORS[index % LEAVE_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
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
                  <YAxis />
                  <Tooltip formatter={(value) => `₹${Number(value).toLocaleString('en-IN')}`} />
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
