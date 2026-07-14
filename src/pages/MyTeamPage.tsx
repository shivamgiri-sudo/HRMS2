import { useState, useRef } from "react";
import { Link } from "react-router-dom";
import { ShieldX, Users2, Activity, ClipboardCheck, BarChart2, Star, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUserRole } from "@/hooks/useUserRole";
import TeamOverviewTab from "@/components/my-team/TeamOverviewTab";
import TeamAttendanceTab from "@/components/my-team/TeamAttendanceTab";
import TeamLeaveTab from "@/components/my-team/TeamLeaveTab";
import TeamPerformanceTab from "@/components/my-team/TeamPerformanceTab";
import TeamQualityTab from "@/components/my-team/TeamQualityTab";
import TeamActionsTab from "@/components/my-team/TeamActionsTab";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";

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

  // Track which tabs have been visited — mount on first visit, keep mounted after
  const mounted = useRef<Set<TabValue>>(new Set(["overview"]));
  function handleTabChange(v: string) {
    const tab = v as TabValue;
    mounted.current.add(tab);
    setActiveTab(tab);
  }

  // Badge counts — low staleTime, no heavy queries
  const { data: alertsData } = useQuery({
    queryKey: ["management", "alerts", "unack"],
    queryFn: () => hrmsApi.get<any>("/api/management/alerts?acknowledged=false"),
    staleTime: 60_000,
  });
  const { data: leaveData } = useQuery({
    queryKey: ["team-leaves", "pending"],
    queryFn: () => hrmsApi.get<any>("/api/leave/requests?status=pending&limit=50"),
    staleTime: 60_000,
  });

  const alertCount = ((alertsData as any)?.data ?? []).length;
  const leaveCount = ((leaveData as any)?.data ?? []).length;

  if (!roleLoading) {
    const allowed = MANAGER_ROLES.some((r) => (roleData?.roleKeys ?? []).includes(r));
    if (!allowed) {
      return (
        <DashboardLayout>
          <div className="flex min-h-[60vh] items-center justify-center p-4">
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
        </DashboardLayout>
      );
    }
  }

  const badges: Partial<Record<TabValue, number>> = {
    leave: leaveCount > 0 ? leaveCount : undefined,
    actions: alertCount > 0 ? alertCount : undefined,
  };

  return (
    <DashboardLayout>
      {/* ── Rich gradient page header ── */}
      <div className="-mx-4 -mt-5 bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 px-4 pb-0 pt-6 sm:-mx-5 sm:px-6 lg:-mx-6">
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

          {/* ── Tabs ── */}
          <Tabs value={activeTab} onValueChange={handleTabChange}>
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

            {/* ── Content area — lazy-mount: render only after first visit ── */}
            <div className="py-6">
              <div hidden={activeTab !== "overview"}>
                {mounted.current.has("overview") && (
                  <TeamOverviewTab onActionsClick={() => handleTabChange("actions")} />
                )}
              </div>
              <div hidden={activeTab !== "attendance"}>
                {mounted.current.has("attendance") && <TeamAttendanceTab />}
              </div>
              <div hidden={activeTab !== "leave"}>
                {mounted.current.has("leave") && <TeamLeaveTab />}
              </div>
              <div hidden={activeTab !== "performance"}>
                {mounted.current.has("performance") && <TeamPerformanceTab />}
              </div>
              <div hidden={activeTab !== "quality"}>
                {mounted.current.has("quality") && <TeamQualityTab />}
              </div>
              <div hidden={activeTab !== "actions"}>
                {mounted.current.has("actions") && <TeamActionsTab />}
              </div>
            </div>
          </Tabs>
        </div>
      </div>
    </DashboardLayout>
  );
}
