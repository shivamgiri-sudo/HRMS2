STAT:
commit 23bb784eb6662b9ae0a4be5eb98fb5638e4d7daf
Author: Shivam Giri <shivamgiri@users.noreply.github.com>
Date:   Tue Aug 25 09:06:10 2026 +0530

    feat: add Performance Command Center page for HR/Ops/CEO

 src/components/layout/navConfig.tsx      |  3 ++-
 src/config/routes/performance.routes.tsx |  4 ++++
 src/pages/PerformanceCommandCenter.tsx   | 29 +++++++++++++++++++++++++++++
 3 files changed, 35 insertions(+), 1 deletion(-)

FULL DIFF:
commit 23bb784eb6662b9ae0a4be5eb98fb5638e4d7daf
Author: Shivam Giri <shivamgiri@users.noreply.github.com>
Date:   Tue Aug 25 09:06:10 2026 +0530

    feat: add Performance Command Center page for HR/Ops/CEO

diff --git a/src/components/layout/navConfig.tsx b/src/components/layout/navConfig.tsx
index 431f966b..c6b1a58d 100644
--- a/src/components/layout/navConfig.tsx
+++ b/src/components/layout/navConfig.tsx
@@ -1,20 +1,20 @@
 import type { FC, SVGProps } from "react";
 import {
   Activity, BarChart3, Bell, Briefcase, Building2, Calendar,
   CalendarClock, CalendarDays, ClipboardList, Clock, CreditCard, FileCheck,
-  FileText, GitBranch, GraduationCap, Heart, Home, Landmark,
+  FileText, GitBranch, Gauge, GraduationCap, Heart, Home, Landmark,
   Network, Package, Search, Server, Settings, Settings2, ShieldCheck, Sparkles,
   Target, TrendingUp, Upload, User, UserMinus, UserPlus, Users, Users2, Wallet,
   Zap, DollarSign, ShoppingCart, LayoutDashboard, Crown, Receipt, CheckCircle,
   Plus, Send, Lock, Shield, ShieldAlert, PenSquare, Eye, UsersRound, RotateCcw, Mail, Share2,
   Video, PenLine, Workflow, Layers3, CalendarOff, MessageSquare, AlertCircle, Trophy, History
 } from "lucide-react";
 import type { NavGroup } from "./SidebarNav";
 
 const sz = "h-[15px] w-[15px]";
 const ic = (I: FC<SVGProps<SVGSVGElement>>) => <I className={sz} />;
 
 export const navGroups: NavGroup[] = [
   /* ── OVERVIEW ─────────────────────────────────────────────── */
   {
     title: "Overview",
@@ -292,30 +292,31 @@ export const navGroups: NavGroup[] = [
           { label: "Process Metrics",     href: "/kpi/process-metrics",   icon: ic(BarChart3), pageCode: "KPI_CONFIG", description: "What each process is measured on", roles: ["super_admin","admin","qa","tq_head","process_manager"] },
         ],
       },
       {
         label: "Performance",  href: "/performance", icon: ic(Target), roles: ["admin","hr","ceo","coo","manager","process_manager","branch_head","operations_manager","qa","quality_analyst","analyst","super_admin","employee","agent","team_leader","tl"], description: "Performance management",
         children: [
           { label: "Performance Hub",      href: "/performance-hub",            icon: ic(BarChart3),    roles: ["admin","hr","ceo","coo","manager","process_manager","branch_head","operations_manager","qa","quality_analyst","analyst","super_admin"], description: "Role-scoped KPI hub" },
           { label: "Performance",          href: "/performance",                icon: ic(Target),       roles: ["admin","hr","ceo","coo","manager","process_manager","branch_head","operations_manager","qa","quality_analyst","analyst","super_admin","employee","agent","team_leader","tl"], description: "Performance" },
           { label: "Performance Command",  href: "/performance/command-center", icon: ic(Target),       pageCode: "WORKFORCE_COMMAND_CENTER", description: "Perf command" },
           { label: "Agent Performance",    href: "/agent-performance",          icon: ic(Activity),     roles: ["admin","hr","ceo","coo","qa","analyst","manager","process_manager","branch_head"], description: "Cross-source KPI" },
           { label: "KPI Config",           href: "/kpi-config",                 icon: ic(Target),       pageCode: "KPI_CONFIG", roles: ["admin","hr","manager","process_manager"], description: "KPI" },
           { label: "KPI Targets", href: "/kpi-targets", icon: ic(Target), pageCode: "KPI_MASTER", description: "Targets by process & designation" },
           { label: "KPI Master", href: "/kpi-master", icon: ic(Settings2), pageCode: "KPI_MASTER", description: "KPI master configuration" },
           { label: "My KPI", href: "/my-kpi", icon: ic(Target), pageCode: "MY_KPI", description: "Personal KPI dashboard" },
           { label: "PIP Management", href: "/pip-management", icon: ic(ClipboardList), pageCode: "PIP_MANAGEMENT", description: "Performance improvement plans" },
+          { label: "Performance Scorecard", href: "/performance-command-center", icon: ic(Gauge), pageCode: "PERFORMANCE_SCORECARD_COMMAND_CENTER", description: "Full-scope performance scorecard across your team/branch/org" },
           { label: "TAT Matrix", href: "/governance/tat-matrix", icon: ic(Settings2), pageCode: "TAT_MATRIX", description: "Turnaround-time policy" },
           { label: "TAT Dashboard", href: "/governance/tat-dashboard", icon: ic(BarChart3), pageCode: "TAT_DASHBOARD", description: "Turnaround-time monitoring" },
           { label: "Operations KPI",       href: "/operations-kpi",             icon: ic(Target),       pageCode: "OPERATIONS_KPI",          description: "Ops KPI" },
           { label: "Operations Dashboard", href: "/operations/dashboard",       icon: ic(Target),       pageCode: "OPERATIONS_DASHBOARD",    description: "Ops dashboard" },
           { label: "Feedback Assignments", href: "/performance-feedback/assignments",  icon: ic(ClipboardList), roles: ["admin","hr","manager","process_manager","super_admin"], description: "Feedback tasks" },
           { label: "Team Reports",         href: "/performance-feedback/team-reports", icon: ic(BarChart3),     roles: ["admin","hr","manager"], description: "Team feedback" },
         ],
       },
       {
         label: "Payroll",      href: "/payroll", icon: ic(CreditCard), roles: ["admin","hr","finance","payroll"], description: "Payroll & statutory",
         children: [
           // ── PAYROLL RUNS & MONITORING ────────────────────────────────────
           { label: "Payroll",              href: "/payroll",                          icon: ic(CreditCard),   roles: ["admin","hr","finance","payroll"],                                                                    description: "Payroll runs and lines" },
           { label: "Running Salary",       href: "/payroll/running-breakdown",        icon: ic(TrendingUp),   roles: ["admin","super_admin","payroll_head","payroll_branch","payroll","wfm","hr","branch_head","management"], description: "Live mid-month salary — by branch, process, cost centre or employee" },
           { label: "Readiness",            href: "/payroll/readiness",                icon: ic(Building2),    roles: ["super_admin","payroll_head","branch_head","payroll_branch","admin","hr","finance","payroll","process_manager","wfm"], description: "Branch & process payroll readiness in one view" },
diff --git a/src/config/routes/performance.routes.tsx b/src/config/routes/performance.routes.tsx
index 5a6f0cca..bdcde6a2 100644
--- a/src/config/routes/performance.routes.tsx
+++ b/src/config/routes/performance.routes.tsx
@@ -20,57 +20,61 @@ const NativeQAFormBuilder = lazy(() => import("@/pages/NativeQAFormBuilder"));
 const NativeCallMasterDashboard      = lazy(() => import("@/pages/NativeCallMasterDashboard"));
 const NativeOpsCommandCenter         = lazy(() => import("@/pages/NativeOpsCommandCenter"));
 const NativeInboundDashboard         = lazy(() => import("@/pages/NativeInboundDashboard"));
 const NativeSalesDashboard           = lazy(() => import("@/pages/NativeSalesDashboard"));
 const NativeTATMatrix                = lazy(() => import("@/pages/NativeTATMatrix"));
 const NativeTATDashboard             = lazy(() => import("@/pages/NativeTATDashboard"));
 const NativePIPManagement            = lazy(() => import("@/pages/NativePIPManagement"));
 const NativeCareerPlanning           = lazy(() => import("@/pages/NativeCareerPlanning"));
 const NativePerformanceFeedbackMyReports       = lazy(() => import("@/pages/NativePerformanceFeedbackMyReports"));
 const NativePerformanceFeedbackReportDetail    = lazy(() => import("@/pages/NativePerformanceFeedbackReportDetail"));
 const NativePerformanceFeedbackDevelopmentPlan = lazy(() => import("@/pages/NativePerformanceFeedbackDevelopmentPlan"));
 const NativePerformanceFeedbackAssignments     = lazy(() => import("@/pages/NativePerformanceFeedbackAssignments"));
 const NativePerformanceFeedbackForm            = lazy(() => import("@/pages/NativePerformanceFeedbackForm"));
 const NativePerformanceFeedbackTeamReports     = lazy(() => import("@/pages/NativePerformanceFeedbackTeamReports"));
 const PerformanceHub                 = lazy(() => import("@/pages/PerformanceHub"));
+const PerformanceCommandCenter       = lazy(() => import("@/pages/PerformanceCommandCenter"));
 const ExecutiveQualityDashboard = lazy(() => import("@/pages/ExecutiveQualityDashboard"));
 const NativeLMSMyLearning   = lazy(() => import("@/pages/NativeLMSMyLearning"));
 const NativeLMSCoordinator  = lazy(() => import("@/pages/NativeLMSCoordinator"));
 const LMSIntegrationAdmin   = lazy(() => import("@/pages/LMSIntegrationAdmin"));
 const NativeLMSIntegration  = lazy(() => import("@/pages/NativeLMSIntegration"));
 const LMSProgressDashboard  = lazy(() => import("@/pages/LMSProgressDashboard"));
 const LMSModuleLaunch       = lazy(() => import("@/pages/LMSModuleLaunch"));
 
 export const performanceRouteElements = (
   <>
       {/* Performance — redirects from legacy routes */}
       <Route path="/performance"        element={<ProtectedRoute><Performance /></ProtectedRoute>} />
       <Route path="/reviews-management" element={<Navigate to="/performance-feedback/assignments" replace />} />
       <Route path="/goals"              element={<Navigate to="/performance" replace />} />
       <Route path="/performance/command-center" element={<ProtectedRoute><Gate pageCode="WORKFORCE_COMMAND_CENTER"><UnifiedPerformanceCommandCenter /></Gate></ProtectedRoute>} />
 
       {/* Performance feedback */}
       <Route path="/performance-feedback/my-reports"      element={<ProtectedRoute><NativePerformanceFeedbackMyReports /></ProtectedRoute>} />
       <Route path="/performance-feedback/reports/:id"     element={<ProtectedRoute><NativePerformanceFeedbackReportDetail /></ProtectedRoute>} />
       <Route path="/performance-feedback/development-plan" element={<ProtectedRoute><NativePerformanceFeedbackDevelopmentPlan /></ProtectedRoute>} />
       <Route path="/performance-feedback/assignments"     element={<ProtectedRoute><NativePerformanceFeedbackAssignments /></ProtectedRoute>} />
       <Route path="/performance-feedback/form/:id"        element={<ProtectedRoute><NativePerformanceFeedbackForm /></ProtectedRoute>} />
       <Route path="/performance-feedback/team-reports"    element={<ProtectedRoute><NativePerformanceFeedbackTeamReports /></ProtectedRoute>} />
 
       {/* Performance Hub */}
       <Route path="/performance-hub" element={<ProtectedRoute><Gate pageCode="PERFORMANCE_HUB"><PerformanceHub /></Gate></ProtectedRoute>} />
 
+      {/* Performance Scorecard Command Center */}
+      <Route path="/performance-command-center" element={<ProtectedRoute><Gate pageCode="PERFORMANCE_SCORECARD_COMMAND_CENTER"><PerformanceCommandCenter /></Gate></ProtectedRoute>} />
+
       {/* Retired URLs kept resolvable.
           Both were removed from the ceo role on 31-Jul (rbacPageMatrix.ts) and deactivated
           in page_catalog by migration 1022, so the in-app launcher no longer offers them.
           Neither ever had a route, so anyone following an old link — or the URL printed in
           the UAT matrix, which is how the CEO reached them in both rounds — got a hard 404
           reading "Oops! Page not found".
           Redirecting is cheaper than building the pages and closes it for bookmarks and
           stale documents too, rather than only for the next reissue of the matrix. */}
       <Route path="/kpi/dashboard"            element={<Navigate to="/operations-kpi" replace />} />
       <Route path="/workforce/command-center" element={<Navigate to="/performance/command-center" replace />} />
 
       {/* KPI */}
       <Route path="/kpi-config"   element={<ProtectedRoute><Gate pageCode="KPI_CONFIG"><NativeKPIConfiguration /></Gate></ProtectedRoute>} />
       <Route path="/operations-kpi" element={<Navigate to="/operations-dashboard" replace />} />
       <Route path="/kpi-master"   element={<ProtectedRoute><Gate pageCode="KPI_MASTER"><KpiMasterConfig /></Gate></ProtectedRoute>} />
diff --git a/src/pages/PerformanceCommandCenter.tsx b/src/pages/PerformanceCommandCenter.tsx
new file mode 100644
index 00000000..feb0fa73
--- /dev/null
+++ b/src/pages/PerformanceCommandCenter.tsx
@@ -0,0 +1,29 @@
+import { useState } from "react";
+import PerformanceScorecardTable from "@/components/performance-scorecard/PerformanceScorecardTable";
+import { useWfmScopeFilter } from "@/hooks/useWfmScopeFilter";
+import { Input } from "@/components/ui/input";
+
+export default function PerformanceCommandCenter() {
+  const { scopeDescription } = useWfmScopeFilter();
+  const [dateFrom, setDateFrom] = useState(() => {
+    const d = new Date();
+    d.setDate(d.getDate() - 30);
+    return d.toISOString().slice(0, 10);
+  });
+  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
+
+  return (
+    <div className="p-4 sm:p-6">
+      <div className="rounded-3xl bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 text-white p-6 mb-6">
+        <h1 className="text-2xl font-bold">Performance Scorecard</h1>
+        <p className="text-white/80 text-sm mt-1">{scopeDescription}</p>
+      </div>
+      <div className="flex items-center gap-2 mb-4">
+        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
+        <span className="text-gray-400">to</span>
+        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
+      </div>
+      <PerformanceScorecardTable dateFrom={dateFrom} dateTo={dateTo} />
+    </div>
+  );
+}
