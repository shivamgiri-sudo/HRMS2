import { Route, Navigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { lazy } from "./lazy";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import WorkforcePageGate from "@/components/security/WorkforcePageGate";

const Gate = ({ pageCode, children }: { pageCode: string; children: React.ReactNode }) =>
  <WorkforcePageGate pageCode={pageCode}>{children}</WorkforcePageGate>;

const Performance                    = lazy(() => import("@/pages/Performance"));
const UnifiedPerformanceCommandCenter = lazy(() => import("@/pages/UnifiedPerformanceCommandCenter"));
const NativeKPIConfiguration         = lazy(() => import("@/pages/NativeKPIConfiguration"));
const NativeOperationsKPI            = lazy(() => import("@/pages/NativeOperationsKPI"));
const KpiMasterConfig                = lazy(() => import("@/pages/KpiMasterConfig"));
const MyKpiDashboard                 = lazy(() => import("@/pages/MyKpiDashboard"));
const NativeAgentPerformanceDashboard = lazy(() => import("@/pages/NativeAgentPerformanceDashboard"));
const NativeQualityDashboard         = lazy(() => import("@/pages/NativeQualityDashboard"));
const ExecutiveQualityDashboard      = lazy(() => import("@/pages/ExecutiveQualityDashboard"));
const ManagerQualityDashboard        = lazy(() => import("@/pages/ManagerQualityDashboard"));
const AgentQualityDashboard          = lazy(() => import("@/pages/AgentQualityDashboard"));
const NativeOperationsDashboard      = lazy(() => import("@/pages/NativeOperationsDashboard"));
const NativeCallMasterDashboard      = lazy(() => import("@/pages/NativeCallMasterDashboard"));
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
      <Route path="/performance-hub" element={<ProtectedRoute><PerformanceHub /></ProtectedRoute>} />

      {/* KPI */}
      <Route path="/kpi-config"   element={<ProtectedRoute><Gate pageCode="KPI_CONFIG"><NativeKPIConfiguration /></Gate></ProtectedRoute>} />
      <Route path="/operations-kpi" element={<ProtectedRoute><Gate pageCode="OPERATIONS_KPI"><NativeOperationsKPI /></Gate></ProtectedRoute>} />
      <Route path="/kpi-master"   element={<ProtectedRoute><Gate pageCode="KPI_MASTER"><KpiMasterConfig /></Gate></ProtectedRoute>} />
      <Route path="/my-kpi"       element={<ProtectedRoute><Gate pageCode="MY_KPI"><DashboardLayout><MyKpiDashboard /></DashboardLayout></Gate></ProtectedRoute>} />
      <Route path="/agent-performance" element={<ProtectedRoute><NativeAgentPerformanceDashboard /></ProtectedRoute>} />
      <Route path="/pip-management" element={<ProtectedRoute roles={['admin','hr','super_admin','manager']}><Gate pageCode="PIP_MANAGEMENT"><NativePIPManagement /></Gate></ProtectedRoute>} />
      <Route path="/career-planning" element={<ProtectedRoute><Gate pageCode="CAREER_PLANNING"><NativeCareerPlanning /></Gate></ProtectedRoute>} />

      {/* Quality */}
      <Route path="/quality/dashboard" element={<ProtectedRoute><Gate pageCode="QUALITY_DASHBOARD"><NativeQualityDashboard /></Gate></ProtectedRoute>} />
      {/* Duplicate eliminated — redirect to canonical */}
      <Route path="/quality/audit"     element={<Navigate to="/quality/dashboard" replace />} />
      <Route path="/quality/executive" element={<ProtectedRoute roles={['super_admin','admin','ceo']}><ExecutiveQualityDashboard /></ProtectedRoute>} />
      <Route path="/quality/team"      element={<ProtectedRoute roles={['super_admin','admin','manager','process_manager','branch_head','team_leader']}><ManagerQualityDashboard /></ProtectedRoute>} />
      <Route path="/quality/my-dashboard" element={<ProtectedRoute><AgentQualityDashboard /></ProtectedRoute>} />

      {/* Operations */}
      <Route path="/operations/dashboard" element={<ProtectedRoute><Gate pageCode="OPERATIONS_DASHBOARD"><NativeOperationsDashboard /></Gate></ProtectedRoute>} />
      <Route path="/call-master" element={<ProtectedRoute roles={['super_admin','admin','ceo','manager','process_manager','operations_manager','qa','quality_analyst']}><NativeCallMasterDashboard /></ProtectedRoute>} />
      <Route path="/call-master/inbound" element={<ProtectedRoute roles={['super_admin','admin','ceo','manager','process_manager','operations_manager','qa','quality_analyst']}><NativeInboundDashboard /></ProtectedRoute>} />
      <Route path="/call-master/inbound/:projectKey" element={<ProtectedRoute roles={['super_admin','admin','ceo','manager','process_manager','operations_manager','qa','quality_analyst']}><NativeInboundDashboard /></ProtectedRoute>} />
      <Route path="/sales/brand-analytics" element={<ProtectedRoute roles={['super_admin','admin','ceo','manager','process_manager','operations_manager']}><NativeSalesDashboard /></ProtectedRoute>} />

      {/* TAT / Governance */}
      <Route path="/governance/tat-matrix" element={<ProtectedRoute roles={['admin','hr','super_admin']}><Gate pageCode="TAT_MATRIX"><NativeTATMatrix /></Gate></ProtectedRoute>} />
      <Route path="/governance/tat-dashboard" element={<ProtectedRoute><Gate pageCode="TAT_DASHBOARD"><NativeTATDashboard /></Gate></ProtectedRoute>} />

      {/* LMS Integration */}
      <Route path="/lms"                     element={<Navigate to="/lms/my-learning" replace />} />
      <Route path="/lms/my-learning"         element={<ProtectedRoute><Gate pageCode="LMS_MY_LEARNING"><NativeLMSMyLearning /></Gate></ProtectedRoute>} />
      <Route path="/lms/coordinator"         element={<ProtectedRoute><Gate pageCode="LMS_COORDINATOR"><NativeLMSCoordinator /></Gate></ProtectedRoute>} />
      <Route path="/lms/admin"               element={<ProtectedRoute><Gate pageCode="LMS_ADMIN"><LMSIntegrationAdmin /></Gate></ProtectedRoute>} />
      <Route path="/lms/management-dashboard" element={<Navigate to="/lms/admin" replace />} />
      <Route path="/lms/integration"         element={<ProtectedRoute><Gate pageCode="LMS_INTEGRATION"><NativeLMSIntegration /></Gate></ProtectedRoute>} />
      <Route path="/lms/progress-dashboard"  element={<ProtectedRoute><Gate pageCode="LMS_PROGRESS_DASHBOARD"><LMSProgressDashboard /></Gate></ProtectedRoute>} />
      <Route path="/lms/module-launch"       element={<ProtectedRoute><Gate pageCode="LMS_MODULE_LAUNCH"><LMSModuleLaunch /></Gate></ProtectedRoute>} />
  </>
);
