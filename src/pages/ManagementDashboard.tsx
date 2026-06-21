/**
 * ManagementDashboard — Tabbed dashboard for team overview, agent performance,
 * payroll projection, and training needs.
 *
 * Route: /management/team
 * Roles: admin, hr, manager, branch_head, ceo, process_manager
 *
 * NOTE: This is a NEW page separate from NativeManagementDashboard (/management/dashboard).
 */
import { useState } from "react";
import { BarChart3, TrendingUp, DollarSign, GraduationCap, AlertTriangle } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { TeamScorecard } from "@/components/management-dashboard/TeamScorecard";
import { AgentPerformanceTable } from "@/components/management-dashboard/AgentPerformanceTable";
import { PayrollChart } from "@/components/management-dashboard/PayrollChart";
import { TrainingList } from "@/components/management-dashboard/TrainingList";

const ALLOWED_ROLES = ["admin", "hr", "manager", "branch_head", "ceo", "process_manager"] as const;

type TabId = "overview" | "performance" | "payroll" | "training";

interface Tab {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const TABS: Tab[] = [
  { id: "overview", label: "Overview", icon: <BarChart3 className="h-4 w-4" /> },
  { id: "performance", label: "Performance", icon: <TrendingUp className="h-4 w-4" /> },
  { id: "payroll", label: "Payroll", icon: <DollarSign className="h-4 w-4" /> },
  { id: "training", label: "Training", icon: <GraduationCap className="h-4 w-4" /> },
];

export default function ManagementDashboard() {
  const { roleKeys } = useWorkforceAccess();
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  const hasAccess = ALLOWED_ROLES.some((role) => roleKeys.includes(role));

  if (!hasAccess) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <div className="rounded-3xl bg-red-50 p-6 text-red-700">
            <AlertTriangle className="mx-auto mb-3 h-10 w-10" />
            <p className="text-lg font-black text-red-900">Access Restricted</p>
            <p className="mt-2 text-sm font-semibold text-red-700">
              You do not have permission to view the Management Dashboard.
            </p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Management</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">Team Dashboard</h1>
            <p className="mt-2 max-w-2xl text-slate-600">
              Team scorecard, agent performance, payroll forecast and training needs overview.
            </p>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex w-fit items-center gap-1 rounded-2xl border bg-slate-50 p-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                activeTab === tab.id
                  ? "bg-white text-slate-950 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div>
          {activeTab === "overview" && (
            <div className="space-y-6">
              <TeamScorecard />
            </div>
          )}

          {activeTab === "performance" && (
            <div className="space-y-4">
              <h2 className="text-xl font-black text-slate-950">Agent Performance</h2>
              <p className="text-sm text-slate-500">
                Click column headers to sort. Agents with coaching needed are flagged.
              </p>
              <AgentPerformanceTable />
            </div>
          )}

          {activeTab === "payroll" && (
            <div className="space-y-4">
              <h2 className="text-xl font-black text-slate-950">Payroll Projection</h2>
              <p className="text-sm text-slate-500">30-day cost forecast vs actuals.</p>
              <PayrollChart />
            </div>
          )}

          {activeTab === "training" && (
            <div className="space-y-4">
              <h2 className="text-xl font-black text-slate-950">Training Needs</h2>
              <p className="text-sm text-slate-500">Agents with identified skill gaps, ranked by priority.</p>
              <TrainingList />
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
