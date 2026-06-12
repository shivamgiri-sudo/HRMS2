import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Target, FileText, Loader2, User, BarChart3, Users, TrendingUp } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { GoalsManager } from "@/components/performance/GoalsManager";
import { PerformanceReviews } from "@/components/performance/PerformanceReviews";
import { PerformanceAnalytics } from "@/components/performance/PerformanceAnalytics";
import { TeamGoalsView } from "@/components/performance/TeamGoalsView";
import { TeamReviewsManager } from "@/components/performance/TeamReviewsManager";
import { TeamAnalytics } from "@/components/performance/TeamAnalytics";
import { AprSection } from "@/components/performance/AprSection";

const Performance = () => {
  const { user } = useAuth();

  // Get current employee ID, name, and check if they're a manager
  const { data: employeeData, isLoading } = useQuery({
    queryKey: ["my-employee-with-team", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;

      const empRes = await hrmsApi.get<{success:boolean;data:any}>("/api/employees");
      const employee = empRes.data;
      if (!employee) return null;

      return {
        ...employee,
        isManager: false,
      };
    },
    enabled: !!user?.id,
  });

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

  const employeeName = `${employeeData.first_name} ${employeeData.last_name}`;

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
                {employeeData.isManager
                  ? "Track your KPIs, view reviews, and manage your team's performance."
                  : "Track your KPIs and view performance reviews."}
              </p>
            </div>
          </div>
        </section>

        <Tabs defaultValue="kpis" className="space-y-4">
          <TabsList>
            <TabsTrigger value="kpis" className="gap-2">
              <Target className="h-4 w-4" />
              KPIs
            </TabsTrigger>
            <TabsTrigger value="reviews" className="gap-2">
              <FileText className="h-4 w-4" />
              Reviews
            </TabsTrigger>
            <TabsTrigger value="analytics" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              Analytics
            </TabsTrigger>
            {employeeData.isManager && (
              <TabsTrigger value="team" className="gap-2">
                <Users className="h-4 w-4" />
                Team
              </TabsTrigger>
            )}
            {employeeData.isManager && (
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

          {employeeData.isManager && (
            <TabsContent value="team" className="space-y-6">
              <TeamGoalsView managerId={employeeData.id} />
              <TeamReviewsManager 
                managerId={employeeData.id} 
                managerName={employeeName}
              />
            </TabsContent>
          )}

          {employeeData.isManager && (
            <TabsContent value="team-analytics">
              <TeamAnalytics
                isManager={true}
                managerId={employeeData.id}
              />
            </TabsContent>
          )}

          <TabsContent value="apr">
            <AprSection isManager={employeeData.isManager} employeeId={employeeData.id} />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

export default Performance;
