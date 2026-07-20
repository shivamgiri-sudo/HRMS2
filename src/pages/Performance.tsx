import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { RoleInsightsPanel } from "@/components/insights/RoleInsightsPanel";
import { hrmsApi } from "@/lib/hrmsApi";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Target, FileText, Loader2, User, BarChart3, Users, TrendingUp, Activity, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { GoalsManager } from "@/components/performance/GoalsManager";
import { PerformanceReviews } from "@/components/performance/PerformanceReviews";
import { PerformanceAnalytics } from "@/components/performance/PerformanceAnalytics";
import { TeamGoalsView } from "@/components/performance/TeamGoalsView";
import { TeamReviewsManager } from "@/components/performance/TeamReviewsManager";
import { TeamAnalytics } from "@/components/performance/TeamAnalytics";
import { AprSection } from "@/components/performance/AprSection";
import { TeamKpiView } from "@/components/performance/TeamKpiView";
import { useWorkforceAccess } from "@/hooks/useUserRole";

export interface TeamMember {
  id: string;
  employee_code: string;
  full_name: string;
  department_id: string | null;
  designation_id: string | null;
  process_id: string | null;
  cost_centre_id: string | null;
  dept_name: string | null;
  designation_name: string | null;
  process_name: string | null;
}

function employeeDisplayName(employee: any): string {
  return String(employee?.full_name ?? "").trim()
    || `${employee?.first_name ?? ""} ${employee?.last_name ?? ""}`.trim()
    || "Employee";
}

const Performance = () => {
  const { user } = useAuth();
  const { roleKeys } = useWorkforceAccess();

  // Fetch employee record
  const { data: employeeData, isLoading: empLoading } = useQuery({
    queryKey: ["my-employee", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const res = await hrmsApi.get<{ success: boolean; data: any }>("/api/employees/me");
      return res.data ?? null;
    },
    enabled: !!user?.id,
  });

  // Fetch direct reports to determine manager status — empty array = not a manager
  const { data: teamMembers = [], isLoading: teamLoading } = useQuery<TeamMember[]>({
    queryKey: ["my-team", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      try {
        const res = await hrmsApi.get<{ success: boolean; data: TeamMember[] }>("/api/employees/my-team");
        return res.data ?? [];
      } catch {
        return [];
      }
    },
    enabled: !!user?.id,
  });

  const isLoading = empLoading || teamLoading;
  const isManager = teamMembers.length > 0;

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex min-h-[400px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  if (!employeeData) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Performance</h2>
            <p className="text-muted-foreground">Track KPIs and view performance reviews</p>
          </div>
          <Card className="bg-white/80 backdrop-blur-sm border border-white/60 shadow-xl shadow-slate-200/60">
            <CardContent className="py-12 text-center">
              <User className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">No Employee Profile</h3>
              <p className="mt-2 text-muted-foreground">
                Your account is not linked to an employee profile yet. Please contact HR.
              </p>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  const employeeName = employeeDisplayName(employeeData);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm shadow-sm">
          <div className="relative p-5 sm:p-6">
            <div className="absolute inset-y-0 left-0 w-1 bg-slate-950" />
            <div className="pl-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">
                Performance Management
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                Performance
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                {isManager
                  ? `Track your KPIs, view reviews, and manage your team's performance. (${teamMembers.length} direct reports)`
                  : "Track your KPIs and view performance reviews."}
              </p>
            </div>
          </div>
        </section>

        <RoleInsightsPanel roles={roleKeys} title="Performance control insights" />

        <Tabs defaultValue="live-performance" className="space-y-4">
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="live-performance" className="gap-2">
              <Activity className="h-4 w-4" />
              My Performance
            </TabsTrigger>
            <TabsTrigger value="kpis" className="gap-2">
              <Target className="h-4 w-4" />
              Goals & KPIs
            </TabsTrigger>
            <TabsTrigger value="reviews" className="gap-2">
              <FileText className="h-4 w-4" />
              Reviews
            </TabsTrigger>
            <TabsTrigger value="analytics" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              Analytics
            </TabsTrigger>
            {isManager && (
              <TabsTrigger value="team-kpis" className="gap-2">
                <Activity className="h-4 w-4" />
                Team Performance
              </TabsTrigger>
            )}
            {isManager && (
              <TabsTrigger value="team" className="gap-2">
                <Users className="h-4 w-4" />
                Team
              </TabsTrigger>
            )}
            {isManager && (
              <TabsTrigger value="team-analytics" className="gap-2">
                <TrendingUp className="h-4 w-4" />
                Team Analytics
              </TabsTrigger>
            )}
            <TabsTrigger value="apr" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              APR
            </TabsTrigger>
          </TabsList>

          <TabsContent value="live-performance">
            <Card className="bg-white border border-slate-200 shadow-sm">
              <CardContent className="flex flex-col items-center justify-center gap-4 py-12 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50">
                  <Activity className="h-7 w-7 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">My Live KPI Scorecard</h3>
                  <p className="mt-1 max-w-sm text-sm text-slate-500">
                    View your full KPI breakdown by period — Today, WTD, MTD, and Last Month — with category cards, sparklines, and day-wise detail.
                  </p>
                </div>
                <Link
                  to="/my-kpi"
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
                >
                  Open KPI Dashboard <ArrowRight className="h-4 w-4" />
                </Link>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="kpis">
            <GoalsManager employeeId={employeeData.id} />
          </TabsContent>

          <TabsContent value="reviews">
            <PerformanceReviews
              employeeId={employeeData.id}
              employeeName={employeeName}
            />
          </TabsContent>

          <TabsContent value="analytics">
            <PerformanceAnalytics employeeId={employeeData.id} />
          </TabsContent>

          {isManager && (
            <TabsContent value="team-kpis">
              <TeamKpiView teamMembers={teamMembers} />
            </TabsContent>
          )}

          {isManager && (
            <TabsContent value="team" className="space-y-6">
              <TeamGoalsView managerId={employeeData.id} />
              <TeamReviewsManager
                managerId={employeeData.id}
                managerName={employeeName}
              />
            </TabsContent>
          )}

          {isManager && (
            <TabsContent value="team-analytics">
              <TeamAnalytics
                isManager={true}
                managerId={employeeData.id}
              />
            </TabsContent>
          )}

          <TabsContent value="apr">
            <AprSection isManager={isManager} employeeId={employeeData.id} />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

export default Performance;
