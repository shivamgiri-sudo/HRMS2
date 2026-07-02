import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Database,
  GitBranch,
  Lock,
  Server,
  Shield,
  TrendingUp,
  Users,
  XCircle,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useExecutiveQualitySummary } from "@/hooks/useExecutiveQuality";
import { useOrgKpiSummary } from "@/hooks/useOrgKpiSummary";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SystemMetrics {
  totalUsers: number;
  activeEmployees: number;
  totalRoles: number;
  totalPages: number;
  activeIntegrations: number;
  configuredIntegrations: number;
  systemHealth: "healthy" | "warning" | "critical";
}

interface ModuleHealth {
  module: string;
  status: "operational" | "degraded" | "down";
  lastActivity?: string | null;
  errorCount: number;
  recordCount: number;
}

interface RecentActivity {
  id: string;
  type: string;
  user: string;
  action: string;
  timestamp: string;
  status: "success" | "warning" | "error";
}

interface SystemDashboardData {
  metrics: SystemMetrics;
  modules: ModuleHealth[];
  activities: RecentActivity[];
}

// ─── Components ──────────────────────────────────────────────────────────────

interface MetricCardProps {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  trend?: string;
  loading?: boolean;
  color: "blue" | "emerald" | "amber" | "violet";
}

function MetricCard({ title, value, icon, trend, loading, color }: MetricCardProps) {
  const colorClasses = {
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    violet: "bg-violet-50 text-violet-700 border-violet-200",
  };

  if (loading) {
    return (
      <Card className="border-slate-200">
        <CardHeader className="pb-3">
          <Skeleton className="h-4 w-24" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-16" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-slate-200 hover:shadow-md transition-shadow cursor-pointer">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardDescription className="text-xs font-semibold uppercase tracking-wider text-slate-600">
          {title}
        </CardDescription>
        <div className={`rounded-xl p-2 ${colorClasses[color]}`}>{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-black tracking-tight text-slate-900">{value}</div>
        {trend && (
          <p className="mt-1 flex items-center gap-1 text-xs font-medium text-slate-500">
            <TrendingUp className="h-3 w-3" />
            {trend}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

interface ModuleCardProps {
  module: ModuleHealth;
}

function ModuleHealthCard({ module }: ModuleCardProps) {
  const statusConfig = {
    operational: { icon: CheckCircle2, color: "text-emerald-600 bg-emerald-50", label: "Operational" },
    degraded: { icon: AlertCircle, color: "text-amber-600 bg-amber-50", label: "Degraded" },
    down: { icon: XCircle, color: "text-red-600 bg-red-50", label: "Down" },
  };

  const config = statusConfig[module.status];
  const Icon = config.icon;

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-bold text-slate-900">{module.module}</CardTitle>
          <Badge variant="secondary" className={`${config.color} border-0`}>
            <Icon className="mr-1 h-3 w-3" />
            {config.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs font-medium text-slate-500">Records</p>
            <p className="font-mono text-sm font-semibold text-slate-900">
              {module.recordCount.toLocaleString("en-IN")}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">Errors</p>
            <p className="font-mono text-sm font-semibold text-slate-900">{module.errorCount}</p>
          </div>
        </div>
        {module.lastActivity && (
          <div className="text-xs text-slate-500">
            Last activity: {formatIST(module.lastActivity)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function SuperAdminDashboardV2() {
  const [activeTab, setActiveTab] = useState<"system" | "business">("system");

  const { data: systemData, isLoading: metricsLoading } = useQuery<SystemDashboardData>({
    queryKey: ["super-admin-system-dashboard"],
    queryFn: async () => {
      const response = await hrmsApi.get<{ data: SystemDashboardData }>(
        "/api/management/system-dashboard"
      );
      return response.data;
    },
    refetchInterval: 60_000,
  });

  const { data: execQuality } = useExecutiveQualitySummary(30);
  const { data: orgKpi } = useOrgKpiSummary();

  const metrics = systemData?.metrics;
  const modules = systemData?.modules ?? [];
  const activities = systemData?.activities ?? [];
  const isHealthy = metrics?.systemHealth === "healthy";

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-2">
          <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">System Control</p>
          <h1 className="text-3xl font-black tracking-tight text-slate-950">Super Admin Dashboard</h1>
          <p className="text-slate-600">
            Real-time system monitoring, access control, and operational metrics
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200">
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "system"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
            onClick={() => setActiveTab("system")}
          >
            System Overview
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "business"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
            onClick={() => setActiveTab("business")}
          >
            Business Overview
          </button>
        </div>

        {/* ── System Overview Tab ── */}
        {activeTab === "system" && (
        <div className="space-y-6">

        {/* System Metrics Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Total Users"
            value={metrics?.totalUsers ?? 0}
            icon={<Users className="h-5 w-5" />}
            trend={`${metrics?.activeEmployees ?? 0} active employees`}
            loading={metricsLoading}
            color="blue"
          />
          <MetricCard
            title="Active Roles"
            value={metrics?.totalRoles ?? 0}
            icon={<Shield className="h-5 w-5" />}
            loading={metricsLoading}
            color="emerald"
          />
          <MetricCard
            title="System Pages"
            value={metrics?.totalPages ?? 0}
            icon={<Lock className="h-5 w-5" />}
            loading={metricsLoading}
            color="violet"
          />
          <MetricCard
            title="Integrations"
            value={metrics?.activeIntegrations ?? 0}
            icon={<GitBranch className="h-5 w-5" />}
            trend={`${metrics?.configuredIntegrations ?? 0} total configured`}
            loading={metricsLoading}
            color="amber"
          />
        </div>

        {/* System Health Badge */}
        <Card className={isHealthy
          ? "border-emerald-200 bg-gradient-to-br from-emerald-50 to-white"
          : "border-amber-200 bg-gradient-to-br from-amber-50 to-white"
        }>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-emerald-100 p-2">
                <Server className={`h-6 w-6 ${isHealthy ? "text-emerald-600" : "text-amber-600"}`} />
              </div>
              <div>
                <CardTitle className="text-xl font-black text-slate-900">System Status</CardTitle>
                <CardDescription className="text-sm">
                  {isHealthy ? "All monitored modules are operational" : "One or more modules need attention"}
                </CardDescription>
              </div>
              <Badge className={isHealthy
                ? "ml-auto border-emerald-300 bg-emerald-100 text-emerald-800"
                : "ml-auto border-amber-300 bg-amber-100 text-amber-800"
              }>
                {isHealthy
                  ? <CheckCircle2 className="mr-1 h-3 w-3" />
                  : <AlertCircle className="mr-1 h-3 w-3" />
                }
                {isHealthy ? "Healthy" : "Attention"}
              </Badge>
            </div>
          </CardHeader>
        </Card>

        {/* Module Health Grid */}
        <div>
          <h2 className="mb-4 text-lg font-bold text-slate-900">Module Health</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {modules.map((module) => (
              <ModuleHealthCard key={module.module} module={module} />
            ))}
          </div>
        </div>

        {/* Recent Activity */}
        <Card className="border-slate-200">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-slate-600" />
              <CardTitle className="text-lg font-bold text-slate-900">Recent Activity</CardTitle>
            </div>
            <CardDescription>Latest system events and administrative actions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {activities.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">No recent activity</p>
              ) : (
                activities.map((activity) => (
                  <div
                    key={activity.id}
                    className="flex items-start gap-3 rounded-lg border border-slate-100 p-3 hover:bg-slate-50 transition-colors"
                  >
                    <div className="mt-0.5 rounded-full bg-blue-50 p-1.5">
                      <Database className="h-3.5 w-3.5 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900">{activity.action}</p>
                      <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                        <span className="font-medium">{activity.user}</span>
                        <span>•</span>
                        <span>{formatIST(activity.timestamp)}</span>
                      </div>
                    </div>
                    <Badge
                      variant={activity.status === "success" ? "default" : "destructive"}
                      className="ml-2 shrink-0"
                    >
                      {activity.status}
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle className="text-lg font-bold text-slate-900">Quick Actions</CardTitle>
            <CardDescription>Common administrative tasks</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <button
                onClick={() => (window.location.href = "/settings/access-control")}
                className="flex items-center gap-3 rounded-lg border border-slate-200 p-4 text-left hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <Shield className="h-5 w-5 text-blue-600" />
                <div>
                  <p className="font-semibold text-slate-900">Access Control</p>
                  <p className="text-xs text-slate-500">Manage permissions</p>
                </div>
              </button>
              <button
                onClick={() => (window.location.href = "/integration-hub")}
                className="flex items-center gap-3 rounded-lg border border-slate-200 p-4 text-left hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <GitBranch className="h-5 w-5 text-emerald-600" />
                <div>
                  <p className="font-semibold text-slate-900">Integrations</p>
                  <p className="text-xs text-slate-500">Manage connectors</p>
                </div>
              </button>
              <button
                onClick={() => (window.location.href = "/settings/org-masters")}
                className="flex items-center gap-3 rounded-lg border border-slate-200 p-4 text-left hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <Database className="h-5 w-5 text-violet-600" />
                <div>
                  <p className="font-semibold text-slate-900">Org Masters</p>
                  <p className="text-xs text-slate-500">Configure masters</p>
                </div>
              </button>
              <button
                onClick={() => (window.location.href = "/employees")}
                className="flex items-center gap-3 rounded-lg border border-slate-200 p-4 text-left hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <Users className="h-5 w-5 text-amber-600" />
                <div>
                  <p className="font-semibold text-slate-900">Employees</p>
                  <p className="text-xs text-slate-500">View all employees</p>
                </div>
              </button>
            </div>
          </CardContent>
        </Card>

        </div>
        )}

        {/* ── Business Overview Tab ── */}
        {activeTab === "business" && (
          <div className="space-y-6">
            {/* Quality Overview */}
            {execQuality && execQuality.process_performance && execQuality.process_performance.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Process Quality Scorecard (Last 30 Days)</h3>
                <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Process</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Avg Score</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Agents</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Calls</th>
                          <th className="px-4 py-2 text-center text-xs font-medium text-gray-500">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {execQuality.process_performance.map((p, i) => (
                          <tr key={p.process || i} className="hover:bg-gray-50">
                            <td className="px-4 py-2 font-medium text-gray-800">{p.process || "—"}</td>
                            <td className="px-4 py-2 text-right font-semibold">{p.avg_quality}%</td>
                            <td className="px-4 py-2 text-right text-gray-600">{p.agent_count}</td>
                            <td className="px-4 py-2 text-right text-gray-600">{p.calls_handled?.toLocaleString()}</td>
                            <td className="px-4 py-2 text-center">
                              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                                p.status === "On Track" ? "bg-green-100 text-green-700" :
                                p.status === "At Risk"  ? "bg-amber-100 text-amber-700" :
                                                          "bg-red-100 text-red-700"
                              }`}>
                                {p.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* KPI Summary */}
            {orgKpi && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">
                  KPI Performance — {orgKpi.periodLabel}
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-white rounded-xl p-4 shadow-sm border">
                    <p className="text-xs text-gray-500">Org Avg KPI Score</p>
                    <p className="text-2xl font-bold text-blue-600">{orgKpi.orgAvgScore}%</p>
                  </div>
                  <div className="bg-white rounded-xl p-4 shadow-sm border">
                    <p className="text-xs text-gray-500">Best Process</p>
                    <p className="text-lg font-bold text-green-600">{orgKpi.topProcess?.processName ?? "—"}</p>
                    <p className="text-sm text-gray-500">{orgKpi.topProcess?.avgScore ?? ""}%</p>
                  </div>
                  <div className="bg-white rounded-xl p-4 shadow-sm border">
                    <p className="text-xs text-gray-500">Needs Attention</p>
                    <p className="text-lg font-bold text-red-500">{orgKpi.bottomProcess?.processName ?? "—"}</p>
                    <p className="text-sm text-gray-500">{orgKpi.bottomProcess?.avgScore ?? ""}%</p>
                  </div>
                </div>
              </div>
            )}

            {!execQuality && !orgKpi && (
              <div className="text-center py-12 text-gray-400 text-sm">
                No business data available
              </div>
            )}
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
