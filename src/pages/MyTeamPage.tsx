import { useState } from "react";
import { Link } from "react-router-dom";
import { ShieldX, Users2, Activity, ClipboardCheck, BarChart2, Star, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useUserRole } from "@/hooks/useUserRole";
import TeamOverviewTab from "@/components/my-team/TeamOverviewTab";
import TeamAttendanceTab from "@/components/my-team/TeamAttendanceTab";
import TeamLeaveTab from "@/components/my-team/TeamLeaveTab";
import TeamPerformanceTab from "@/components/my-team/TeamPerformanceTab";
import TeamQualityTab from "@/components/my-team/TeamQualityTab";
import TeamActionsTab from "@/components/my-team/TeamActionsTab";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

const MANAGER_ROLES = [
  "super_admin", "admin", "hr",
  "manager", "process_manager", "tl", "team_leader", "assistant_manager", "branch_head",
];

const TABS = [
  { value: "overview",    label: "Overview",    icon: Users2 },
  { value: "attendance",  label: "Attendance",  icon: Activity },
  { value: "leave",       label: "Leave",       icon: ClipboardCheck },
  { value: "performance", label: "Performance", icon: BarChart2 },
  { value: "quality",     label: "Quality",     icon: Star },
  { value: "actions",     label: "Actions",     icon: Inbox },
] as const;

type TabValue = typeof TABS[number]["value"];

export default function MyTeamPage() {
  const { data: roleData, isLoading: roleLoading } = useUserRole();
  const [activeTab, setActiveTab] = useState<TabValue>("overview");

  // Badge counts for tabs
  const { data: alertsData } = useQuery({
    queryKey: ["management", "alerts", "unack"],
    queryFn: () => hrmsApi.get<any>("/api/management/alerts?acknowledged=false"),
  });
  const { data: leaveData } = useQuery({
    queryKey: ["team-leaves", "pending"],
    queryFn: () => hrmsApi.get<any>("/api/leave/requests?status=pending&limit=200"),
  });

  const alertCount = ((alertsData as any)?.data ?? []).length;
  const leaveCount = ((leaveData as any)?.data ?? []).length;

  if (!roleLoading) {
    const allowed = MANAGER_ROLES.some((r) => (roleData?.roleKeys ?? []).includes(r));
    if (!allowed) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
          <div className="max-w-sm w-full rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
              <ShieldX className="h-7 w-7 text-red-500" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900 mb-1">Access Restricted</h2>
            <p className="text-sm text-slate-500 mb-5">
              This page is accessible to managers and team leadership roles only.
            </p>
            <Button asChild variant="outline" className="rounded-xl">
              <Link to="/dashboard">Go to Dashboard</Link>
            </Button>
          </div>
        </div>
      );
    }
  }

  const badges: Partial<Record<TabValue, number>> = {
    leave: leaveCount > 0 ? leaveCount : undefined,
    actions: alertCount > 0 ? alertCount : undefined,
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── Rich gradient page header ── */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 px-4 pb-0 pt-6 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center gap-3 mb-1">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 backdrop-blur-sm">
              <Users2 className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">My Team</h1>
              <p className="text-xs text-slate-400">Live team activity · attendance · leave · KPI · quality · approvals</p>
            </div>
          </div>

          {/* ── Tabs integrated into header ── */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
            <TabsList className="mt-4 h-auto gap-0 bg-transparent p-0 border-0 w-full overflow-x-auto flex-nowrap">
              {TABS.map(({ value, label, icon: Icon }) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className={[
                    "relative flex items-center gap-1.5 rounded-none border-b-2 px-4 py-3 text-sm font-medium transition-all duration-200",
                    "text-slate-400 border-transparent hover:text-slate-200",
                    "data-[state=active]:text-white data-[state=active]:border-indigo-400 data-[state=active]:bg-white/5",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                  ].join(" ")}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="whitespace-nowrap">{label}</span>
                  {badges[value] != null && (
                    <span className="ml-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                      {badges[value]}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>

            {/* ── Content area ── */}
            <div className="mx-auto max-w-7xl px-0 py-6">
              <TabsContent value="overview"    className="mt-0 focus-visible:outline-none">
                <TeamOverviewTab onActionsClick={() => setActiveTab("actions")} />
              </TabsContent>
              <TabsContent value="attendance"  className="mt-0 focus-visible:outline-none">
                <TeamAttendanceTab />
              </TabsContent>
              <TabsContent value="leave"       className="mt-0 focus-visible:outline-none">
                <TeamLeaveTab />
              </TabsContent>
              <TabsContent value="performance" className="mt-0 focus-visible:outline-none">
                <TeamPerformanceTab />
              </TabsContent>
              <TabsContent value="quality"     className="mt-0 focus-visible:outline-none">
                <TeamQualityTab />
              </TabsContent>
              <TabsContent value="actions"     className="mt-0 focus-visible:outline-none">
                <TeamActionsTab />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
