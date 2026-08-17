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
const KpiMasterConfig                = lazy(() => import("@/pages/KpiMasterConfig"));
const KpiTargetMatrix                = lazy(() => import("@/pages/KpiTargetMatrix"));
const MyKpiDashboard                 = lazy(() => import("@/pages/MyKpiDashboard"));
const NativeAgentPerformanceDashboard = lazy(() => import("@/pages/NativeAgentPerformanceDashboard"));
const NativeProcessMetricConfig = lazy(() => import("@/pages/NativeProcessMetricConfig"));
const NativeQAFileAudit = lazy(() => import("@/pages/NativeQAFileAudit"));
const NativeQAFormBuilder = lazy(() => import("@/pages/NativeQAFormBuilder"));
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
      <Route path="/kpi-targets"  element={<ProtectedRoute><Gate pageCode="KPI_MASTER"><KpiTargetMatrix /></Gate></ProtectedRoute>} />
      <Route path="/my-kpi"       element={<ProtectedRoute><Gate pageCode="MY_KPI"><DashboardLayout><MyKpiDashboard /></DashboardLayout></Gate></ProtectedRoute>} />
      <Route path="/agent-performance" element={<ProtectedRoute><Gate pageCode="AGENT_PERFORMANCE"><NativeAgentPerformanceDashboard /></Gate></ProtectedRoute>} />
      <Route path="/pip-management" element={<ProtectedRoute roles={['admin','hr','super_admin','manager']}><Gate pageCode="PIP_MANAGEMENT"><NativePIPManagement /></Gate></ProtectedRoute>} />
      <Route path="/career-planning" element={<ProtectedRoute><Gate pageCode="CAREER_PLANNING"><NativeCareerPlanning /></Gate></ProtectedRoute>} />

      {/* Quality — consolidated into one role-based drill-down page at /quality-dashboard.
          Old role-specific routes below now redirect there instead of rendering their own
          page; the underlying page components are left on disk per CLAUDE.md (never delete
          existing routes/pages solely to simplify) but are no longer reachable by route.
          See docs/superpowers/specs/2026-08-04-unified-quality-operations-dashboards-design.md

          EXCEPTION — /quality/executive, 2026-08-17: QualityDashboard.tsx's Drill-Down/
          Heatmap/Agent Risk/Inbound/CLAP VOC/Sales & Funnel/AI & ROI tabs moved to
          ExecutiveQualityDashboard.tsx (user's explicit choice, made after being told this
          route had been redirected here since the consolidation above). This one route now
          renders that page instead of redirecting; QUALITY_EXECUTIVE's role_page_access was
          widened by migration 1143_quality_executive_page_access.sql to match everyone who
          can already reach /quality-dashboard, so this is additive, not a narrowing. */}
      <Route path="/quality/dashboard"    element={<Navigate to="/quality-dashboard" replace />} />
      <Route path="/quality/audit"        element={<Navigate to="/quality-dashboard" replace />} />
      <Route path="/quality/executive"    element={<ProtectedRoute><Gate pageCode="QUALITY_EXECUTIVE"><ExecutiveQualityDashboard /></Gate></ProtectedRoute>} />
      <Route path="/quality/team"         element={<Navigate to="/quality-dashboard" replace />} />
      <Route path="/quality/my-dashboard" element={<Navigate to="/quality-dashboard" replace />} />
      <Route path="/kpi/process-metrics" element={<ProtectedRoute roles={['super_admin','admin','qa','tq_head','process_manager']}><Gate pageCode="KPI_CONFIG"><NativeProcessMetricConfig /></Gate></ProtectedRoute>} />
      <Route path="/quality/file-audit" element={<ProtectedRoute roles={['super_admin','admin','qa','quality_analyst','tq_head']}><Gate pageCode="QUALITY_DASHBOARD"><NativeQAFileAudit /></Gate></ProtectedRoute>} />
      <Route path="/quality/audit-forms" element={<ProtectedRoute roles={['super_admin','admin','qa','tq_head']}><Gate pageCode="QA_EVALUATION"><NativeQAFormBuilder /></Gate></ProtectedRoute>} />

      {/* Operations — consolidated into one role-based drill-down page at /operations-dashboard. */}
      <Route path="/operations/dashboard" element={<Navigate to="/operations-dashboard" replace />} />
      <Route path="/call-master" element={<ProtectedRoute roles={['super_admin','admin','ceo','manager','process_manager','operations_manager','qa','quality_analyst']}><Gate pageCode="CALL_MASTER"><NativeCallMasterDashboard /></Gate></ProtectedRoute>} />
      <Route path="/call-master/inbound" element={<ProtectedRoute roles={['super_admin','admin','ceo','manager','process_manager','operations_manager','qa','quality_analyst']}><Gate pageCode="CALL_MASTER_INBOUND"><NativeInboundDashboard /></Gate></ProtectedRoute>} />
      <Route path="/call-master/inbound/:projectKey" element={<ProtectedRoute roles={['super_admin','admin','ceo','manager','process_manager','operations_manager','qa','quality_analyst']}><Gate pageCode="CALL_MASTER_INBOUND"><NativeInboundDashboard /></Gate></ProtectedRoute>} />
      <Route path="/sales/brand-analytics" element={<ProtectedRoute roles={['super_admin','admin','ceo','manager','process_manager','operations_manager']}><Gate pageCode="SALES_BRAND_ANALYTICS"><NativeSalesDashboard /></Gate></ProtectedRoute>} />

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
