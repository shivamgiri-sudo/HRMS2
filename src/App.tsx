import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import CookieConsent from "@/components/layout/CookieConsent";
import { OfflineFallback } from "@/components/layout/OfflineFallback";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import WorkforcePageGate from "@/components/security/WorkforcePageGate";
import ScrollToTop from "@/components/layout/ScrollToTop";
import { PortalRoute } from "./components/portal/PortalRoute";

// ── Core (eager — needed before auth resolves) ────────────────────────────────
import Auth from "./pages/AuthClean";
import ResetPassword from "./pages/ResetPassword";
import NotFound from "./pages/NotFound";

// ── Lazy page chunks ──────────────────────────────────────────────────────────
const Landing                       = lazy(() => import("./pages/Landing"));
const Features                      = lazy(() => import("./pages/Features"));
const HowItWorks                    = lazy(() => import("./pages/HowItWorks"));
const Pricing                       = lazy(() => import("./pages/Pricing"));
const PrivacyPolicy                 = lazy(() => import("./pages/PrivacyPolicy"));
const TermsOfService                = lazy(() => import("./pages/TermsOfService"));
const Security                      = lazy(() => import("./pages/Security"));
const Index                         = lazy(() => import("./pages/Index"));
const Employees                     = lazy(() => import("./pages/Employees"));
const Onboarding                    = lazy(() => import("./pages/Onboarding"));
const Leaves                        = lazy(() => import("./pages/Leaves"));
const Assets                        = lazy(() => import("./pages/Assets"));
const Payroll                       = lazy(() => import("./pages/Payroll"));
const Reports                       = lazy(() => import("./pages/Reports"));
const Settings                      = lazy(() => import("./pages/Settings"));
const Profile                       = lazy(() => import("./pages/Profile"));
const Performance                   = lazy(() => import("./pages/Performance"));
const ReviewsManagement             = lazy(() => import("./pages/ReviewsManagement"));
const Attendance                    = lazy(() => import("./pages/Attendance"));
const AttendanceRegularization      = lazy(() => import("./pages/AttendanceRegularization"));
const BulkUploadHub                 = lazy(() => import("./pages/BulkUploadHub"));
const Departments                   = lazy(() => import("./pages/Departments"));
const CompanyCalendar               = lazy(() => import("./pages/CompanyCalendar"));
const NotificationPreferences       = lazy(() => import("./pages/NotificationPreferences"));
const Changelog                     = lazy(() => import("./pages/Changelog"));
const ModuleLauncher                = lazy(() => import("./pages/ModuleLauncher"));
const Notifications                 = lazy(() => import("./pages/Notifications"));

// ATS Onboarding
const CandidateOnboardingPage       = lazy(() => import("./pages/CandidateOnboardingPage"));
const CandidateOnboardingFullPage   = lazy(() => import("./pages/CandidateOnboardingFullPage"));
const NativeHROnboardingRequests    = lazy(() => import("./pages/NativeHROnboardingRequests"));
const NativeBranchHeadApproval      = lazy(() => import("./pages/NativeBranchHeadApproval"));
const NativeBGVVerificationCenter   = lazy(() => import("./pages/NativeBGVVerificationCenter"));

// ATS
const NativeBGVReport               = lazy(() => import("./pages/NativeBGVReport"));
const NativeATSDashboardReplica     = lazy(() => import("./pages/NativeATSDashboardReplica"));
const NativeATSCandidateRegistration = lazy(() => import("./pages/NativeATSCandidateRegistration"));
const NativeATSRecruiterDashboard   = lazy(() => import("./pages/NativeATSRecruiterWorkspace"));
const NativeATSOnboardingBridge     = lazy(() => import("./pages/NativeATSOnboardingBridge"));
const NativeATSWaitingQueue         = lazy(() => import("./pages/NativeATSWaitingQueue"));
const NativeATSCandidateMaster      = lazy(() => import("./pages/NativeATSCandidateMaster"));
const NativeATSRecruiterWorkspace   = lazy(() => import("./pages/NativeATSRecruiterWorkspace"));
const NativeATSDashboardV2          = lazy(() => import("./pages/NativeATSDashboardV2"));
const NativeATSSourcingAnalysis     = lazy(() => import("./pages/NativeATSSourcingAnalysis"));
const NativeATSExtensions           = lazy(() => import("./pages/NativeATSExtensions"));
const NativeATSFormConfig           = lazy(() => import("./pages/NativeATSFormConfig"));
const NativeATSFullParityCommandCenter = lazy(() => import("./pages/NativeATSFullParityCommandCenter"));

// LMS
const NativeLMSMyLearning           = lazy(() => import("./pages/NativeLMSMyLearning"));
const NativeLMSCoordinator         = lazy(() => import("./pages/NativeLMSCoordinator"));
const LMSIntegrationAdmin           = lazy(() => import("./pages/LMSIntegrationAdmin"));
const NativePlaceholderPage         = lazy(() => import("./pages/NativePlaceholderPage"));
const NativeLMSIntegration          = lazy(() => import("./pages/NativeLMSIntegration"));

// WFM
const NativeWFMRoster               = lazy(() => import("./pages/NativeWFMRoster"));
const NativeWFMExtensions           = lazy(() => import("./pages/NativeWFMExtensions"));

// Performance & Management
const UnifiedPerformanceCommandCenter = lazy(() => import("./pages/UnifiedPerformanceCommandCenter"));
const UnifiedAccessControl          = lazy(() => import("./pages/UnifiedAccessControl"));
const SuperAdminAccessControl       = lazy(() => import("./pages/SuperAdminAccessControl"));
const NativeManagementDashboard     = lazy(() => import("./pages/NativeManagementDashboard"));
const ManagementDashboard           = lazy(() => import("./pages/ManagementDashboard"));
const NativeQualityDashboard        = lazy(() => import("./pages/NativeQualityDashboard"));
const AgentQualityDashboard         = lazy(() => import("./pages/AgentQualityDashboard"));
const ManagerQualityDashboard       = lazy(() => import("./pages/ManagerQualityDashboard"));
const QADashboard                   = lazy(() => import("./pages/QADashboard"));
const ExecutiveQualityDashboard     = lazy(() => import("./pages/ExecutiveQualityDashboard"));
const NativeOperationsDashboard     = lazy(() => import("./pages/NativeOperationsDashboard"));
const NativeSecurityCenter          = lazy(() => import("./pages/NativeSecurityCenter"));
const NativeBusinessActionQueue     = lazy(() => import("./pages/NativeBusinessActionQueue"));
const NativeBusinessCommandCenter   = lazy(() => import("./pages/NativeBusinessCommandCenter"));
const NativeAgentPerformanceDashboard = lazy(() => import("./pages/NativeAgentPerformanceDashboard"));
const NativePeopleExperienceCommandCenter = lazy(() => import("./pages/NativePeopleExperienceCommandCenter"));
const NativeSupportCommandCenter    = lazy(() => import("./pages/NativeSupportCommandCenter"));
const NativeGrievanceCommandCenter  = lazy(() => import("./pages/NativeGrievanceCommandCenter"));
const NativeCEOCommandCenter        = lazy(() => import("./pages/NativeCEOCommandCenter"));

// Performance Feedback
const NativePerformanceFeedbackMyReports = lazy(() => import("./pages/NativePerformanceFeedbackMyReports"));
const NativePerformanceFeedbackReportDetail = lazy(() => import("./pages/NativePerformanceFeedbackReportDetail"));
const NativePerformanceFeedbackDevelopmentPlan = lazy(() => import("./pages/NativePerformanceFeedbackDevelopmentPlan"));
const NativePerformanceFeedbackAssignments = lazy(() => import("./pages/NativePerformanceFeedbackAssignments"));
const NativePerformanceFeedbackForm = lazy(() => import("./pages/NativePerformanceFeedbackForm"));
const NativePerformanceFeedbackTeamReports = lazy(() => import("./pages/NativePerformanceFeedbackTeamReports"));

// People
const NativeEmployeeStatCard        = lazy(() => import("./pages/NativeEmployeeStatCard"));
const NativeEmployee360             = lazy(() => import("./pages/NativeEmployee360"));

// Engagement
const NativeEngagement                = lazy(() => import("./pages/NativeEngagement"));
const NativeBadges                    = lazy(() => import("./pages/NativeBadges"));
const NativeKudos                     = lazy(() => import("./pages/NativeKudos"));
const NativeSurveys                   = lazy(() => import("./pages/NativeSurveys"));
const NativeLeaderboard               = lazy(() => import("./pages/NativeLeaderboard"));
const NativeEngagementCommandCenter   = lazy(() => import("./pages/NativeEngagementCommandCenter"));

// Exit
const NativeExitCommandCenter         = lazy(() => import("./pages/NativeExitCommandCenter"));

// Offer Letters & Master Reports
const NativeOfferLetterGeneration   = lazy(() => import("./pages/NativeOfferLetterGeneration"));
const NativeMasterReports           = lazy(() => import("./pages/NativeMasterReports"));

// HR Ops
const NativeAssetsManager           = lazy(() => import("./pages/NativeAssetsManager"));
const NativeHelpdesk                = lazy(() => import("./pages/NativeHelpdesk"));
const NativeLetters                 = lazy(() => import("./pages/NativeLetters"));
const NativeLifecycle               = lazy(() => import("./pages/NativeLifecycle"));
const NativeEmployeeLifecycle       = lazy(() => import("./pages/NativeEmployeeLifecycle"));
const NativeOrgMasters              = lazy(() => import("./pages/NativeOrgMasters"));
const NativeWorkflowAdmin           = lazy(() => import("./pages/NativeWorkflowAdmin"));
const NativeBenefitsClaims          = lazy(() => import("./pages/NativeBenefitsClaims"));
const NativeCareerPlanning          = lazy(() => import("./pages/NativeCareerPlanning"));
const NativePIPManagement           = lazy(() => import("./pages/NativePIPManagement"));
const NativeERP                     = lazy(() => import("./pages/NativeERP"));
const NativeGoalsAppraisal          = lazy(() => import("./pages/NativeGoalsAppraisal"));
const NativeWorkInbox               = lazy(() => import("./pages/NativeWorkInbox"));
const NativeMobilityManagement      = lazy(() => import("./pages/NativeMobilityManagement"));
const NativeJobsPortal              = lazy(() => import("./pages/NativeJobsPortal"));
const NativeAdvancedReports         = lazy(() => import("./pages/NativeAdvancedReports"));
const NativeEnterpriseReports       = lazy(() => import("./pages/NativeEnterpriseReports"));
const NativeStatutoryCompliance     = lazy(() => import("./pages/NativeStatutoryCompliance"));
const NativeLabourCompliance        = lazy(() => import("./pages/NativeLabourCompliance"));
const NativeDPDPCompliance          = lazy(() => import("./pages/NativeDPDPCompliance"));
const NativeMaternityLeave          = lazy(() => import("./pages/NativeMaternityLeave"));
const NativeIntegrationHub          = lazy(() => import("./pages/NativeIntegrationHub"));
const NativeClientMaster            = lazy(() => import("./pages/NativeClientMaster"));
const EnhancedClientMaster          = lazy(() => import("./pages/EnhancedClientMaster"));
const NativeLocationPolicyMasters   = lazy(() => import("./pages/NativeLocationPolicyMasters"));

// Payroll
const NativePayslipCenter           = lazy(() => import("./pages/NativePayslipCenter"));
const NativeTaxDeclaration          = lazy(() => import("./pages/NativeTaxDeclaration"));
const NativeFullFinal               = lazy(() => import("./pages/NativeFullFinal"));
const NativeStatutoryConfig         = lazy(() => import("./pages/NativeStatutoryConfig"));
const NativeSalaryPackages          = lazy(() => import("./pages/NativeSalaryPackages"));

// Communication
const NativeTemplateManager         = lazy(() => import("./pages/NativeTemplateManager"));
const NativeDispatchCenter          = lazy(() => import("./pages/NativeDispatchCenter"));
const NativeDispatchHistory         = lazy(() => import("./pages/NativeDispatchHistory"));
const NativeNotificationPreferences = lazy(() => import("./pages/NativeNotificationPreferences"));
const NativeCommunicationConfig     = lazy(() => import("./pages/NativeCommunicationConfig"));

// Call Centre Config
const NativeCallCentreConfig        = lazy(() => import("./pages/NativeCallCentreConfig"));

// Document Verification & Roster Preferences
const NativeDocumentVerification    = lazy(() => import("./pages/NativeDocumentVerification"));
const NativeRosterPreference        = lazy(() => import("./pages/NativeRosterPreference"));

// Dashboards
const Dashboard                     = lazy(() => import("./pages/Dashboard"));
const SuperAdminDashboardV2         = lazy(() => import("./pages/SuperAdminDashboardV2"));
const LMSProgressDashboard          = lazy(() => import("./pages/LMSProgressDashboard"));
const CandidatePortalDashboard      = lazy(() => import("./pages/CandidatePortalDashboard"));

// System
const NativeMigrationConsole        = lazy(() => import("./pages/NativeMigrationConsole"));
const NativeExitManagement          = lazy(() => import("./pages/NativeExitManagement"));
const NativeKPIConfiguration        = lazy(() => import("./pages/NativeKPIConfiguration"));
const NativeProcessConfig           = lazy(() => import("./pages/NativeProcessConfig"));
const NativeOperationsKPI           = lazy(() => import("./pages/NativeOperationsKPI"));
const KpiMasterConfig               = lazy(() => import("./pages/KpiMasterConfig"));
const MyKpiDashboard                = lazy(() => import("./pages/MyKpiDashboard"));
const NativePortalDataManager       = lazy(() => import("./pages/NativePortalDataManager"));
const NativeLeaveTypeConfig         = lazy(() => import("./pages/NativeLeaveTypeConfig"));
const NativeMyRoster                = lazy(() => import("./pages/NativeMyRoster"));
const NativeRosterManagerQueue      = lazy(() => import("./pages/NativeRosterManagerQueue"));
const NativeRosterMasterBuilder     = lazy(() => import("./pages/NativeRosterMasterBuilder"));
const NativeWeekOffPreferences      = lazy(() => import("./pages/NativeWeekOffPreferences"));
const NativeRosterCapacityConfig    = lazy(() => import("./pages/NativeRosterCapacityConfig"));
const NativeWFMAutoRoster           = lazy(() => import("./pages/NativeWFMAutoRoster"));
const NativeWFMPlanningRules        = lazy(() => import("./pages/NativeWFMPlanningRules"));
const NativeSlotRequirementBuilder  = lazy(() => import("./pages/NativeSlotRequirementBuilder"));
const NativeWeekOffDayRuleConfig    = lazy(() => import("./pages/NativeWeekOffDayRuleConfig"));
const NativeAttendanceDisputes       = lazy(() => import("./pages/NativeAttendanceDisputes"));
const NativePayrollAttendanceOverrides = lazy(() => import("./pages/NativePayrollAttendanceOverrides"));
const NativeAuditLog                 = lazy(() => import("./pages/NativeAuditLog"));
const NativeAttendanceExceptionEngine = lazy(() => import("./pages/NativeAttendanceExceptionEngine"));
const NativeCosecSyncMonitoring     = lazy(() => import("./pages/NativeCosecSyncMonitoring"));
const NativePayrollReadiness        = lazy(() => import("./pages/NativePayrollReadiness"));
const NativeWorkforcePlanning       = lazy(() => import("./pages/NativeWorkforcePlanning"));
const NativeITProvisioningTracker   = lazy(() => import("./pages/NativeITProvisioningTracker"));
const NativeControlTower            = lazy(() => import("./pages/NativeControlTower"));
const NativeBiometricCommandCenter  = lazy(() => import("./pages/NativeBiometricCommandCenter"));
const NativeRTABoard                = lazy(() => import("./pages/NativeRTABoard"));
const NativeWalkinQueue             = lazy(() => import("./pages/NativeWalkinQueueEnhanced"));
const NativeAttendanceRulesMaster   = lazy(() => import("./pages/NativeAttendanceRulesMaster"));
const NativeCustomizationManager    = lazy(() => import("./pages/customization/NativeCustomizationManager"));
const NativeCustomizationRuleEditor = lazy(() => import("./pages/customization/NativeCustomizationRuleEditor"));

// Portal
const PortalLogin                   = lazy(() => import("./pages/portal/PortalLogin"));
const PortalOverview                = lazy(() => import("./pages/portal/PortalOverview"));
const PortalProcessDashboard        = lazy(() => import("./pages/portal/PortalProcessDashboard"));

// ── Helpers ───────────────────────────────────────────────────────────────────
const queryClient = new QueryClient();

const Gate = ({ pageCode, children }: { pageCode: string; children: React.ReactNode }) => (
  <WorkforcePageGate pageCode={pageCode}>{children}</WorkforcePageGate>
);

const PageLoader = () => (
  <div className="flex h-screen items-center justify-center bg-slate-50">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <ScrollToTop />
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<Navigate to="/auth" replace />} />
              <Route path="/features" element={<Features />} />
              <Route path="/how-it-works" element={<HowItWorks />} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/privacy-policy" element={<PrivacyPolicy />} />
              <Route path="/terms-of-service" element={<TermsOfService />} />
              <Route path="/security" element={<Security />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/onboard" element={<CandidateOnboardingPage />} />

              <Route path="/interview-registration" element={<NativeATSCandidateRegistration />} />
              <Route path="/candidate-registration" element={<Navigate to="/interview-registration" replace />} />
              <Route path="/walkin-registration" element={<Navigate to="/interview-registration" replace />} />

              <Route path="/dashboard" element={<ProtectedRoute><Index /></ProtectedRoute>} />

              {/* Dashboard Variants */}
              <Route path="/dashboard/home" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/dashboard/admin" element={<ProtectedRoute roles={['admin', 'super_admin']}><SuperAdminDashboardV2 /></ProtectedRoute>} />
              <Route path="/dashboard/quality" element={<ProtectedRoute><Gate pageCode="QUALITY_DASHBOARD"><NativeQualityDashboard /></Gate></ProtectedRoute>} />
              <Route path="/dashboard/performance" element={<ProtectedRoute><Gate pageCode="AGENT_PERFORMANCE"><NativeAgentPerformanceDashboard /></Gate></ProtectedRoute>} />
              <Route path="/dashboard/operations" element={<ProtectedRoute><Gate pageCode="OPERATIONS_DASHBOARD"><NativeOperationsDashboard /></Gate></ProtectedRoute>} />
              <Route path="/dashboard/management" element={<ProtectedRoute><Gate pageCode="MANAGEMENT_DASHBOARD"><NativeManagementDashboard /></Gate></ProtectedRoute>} />
              <Route path="/dashboard/kpi" element={<ProtectedRoute><Gate pageCode="KPI_CONFIG"><MyKpiDashboard /></Gate></ProtectedRoute>} />
              <Route path="/dashboard/lms" element={<ProtectedRoute><Gate pageCode="LMS_MY_LEARNING"><LMSProgressDashboard /></Gate></ProtectedRoute>} />
              <Route path="/dashboard/ats" element={<ProtectedRoute><Gate pageCode="ATS_DASHBOARD"><NativeATSDashboardV2 /></Gate></ProtectedRoute>} />
              <Route path="/dashboard/ats-replica" element={<ProtectedRoute><Gate pageCode="ATS_DASHBOARD"><NativeATSDashboardReplica /></Gate></ProtectedRoute>} />
              <Route path="/dashboard/candidate-portal" element={<CandidatePortalDashboard />} />
              <Route path="/dashboard/payroll" element={<ProtectedRoute roles={['admin', 'finance', 'payroll', 'super_admin']}><Payroll /></ProtectedRoute>} />

              <Route path="/employees" element={<ProtectedRoute><Employees /></ProtectedRoute>} />
              <Route path="/employees/:id/360" element={<ProtectedRoute><Gate pageCode="EMPLOYEE_MANAGEMENT"><NativeEmployee360 /></Gate></ProtectedRoute>} />
              <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
              <Route path="/onboarding-requests" element={<Navigate to="/onboarding?tab=requests" replace />} />
              <Route path="/leaves" element={<ProtectedRoute><Leaves /></ProtectedRoute>} />
              <Route path="/leave-approvals" element={<Navigate to="/leaves" replace />} />
              <Route path="/assets" element={<ProtectedRoute><Assets /></ProtectedRoute>} />
              <Route path="/payroll" element={<ProtectedRoute><Payroll /></ProtectedRoute>} />
              <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
              <Route path="/reports/enterprise" element={<ProtectedRoute><Gate pageCode="ADVANCED_REPORTS"><NativeEnterpriseReports /></Gate></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
              <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
              <Route path="/performance" element={<ProtectedRoute><Performance /></ProtectedRoute>} />
              <Route path="/reviews-management" element={<ProtectedRoute><ReviewsManagement /></ProtectedRoute>} />
              <Route path="/attendance" element={<ProtectedRoute><Attendance /></ProtectedRoute>} />
              <Route path="/attendance-regularization" element={<ProtectedRoute><AttendanceRegularization /></ProtectedRoute>} />
              <Route path="/attendance/regularizations" element={<ProtectedRoute><AttendanceRegularization /></ProtectedRoute>} />
              <Route path="/bulk-upload" element={<ProtectedRoute><BulkUploadHub /></ProtectedRoute>} />
              <Route path="/departments" element={<ProtectedRoute><Departments /></ProtectedRoute>} />
              <Route path="/calendar" element={<ProtectedRoute><CompanyCalendar /></ProtectedRoute>} />
              <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
              <Route path="/notification-preferences" element={<ProtectedRoute><NotificationPreferences /></ProtectedRoute>} />

              <Route path="/modules" element={<ProtectedRoute><ModuleLauncher /></ProtectedRoute>} />

              {/* ATS */}
              <Route path="/ats/dashboard" element={<ProtectedRoute><Gate pageCode="ATS_DASHBOARD"><NativeATSDashboardReplica /></Gate></ProtectedRoute>} />
              <Route path="/ats/candidate-registration" element={<ProtectedRoute><NativeATSCandidateRegistration /></ProtectedRoute>} />
              <Route path="/ats/recruiter/my-candidates" element={<ProtectedRoute><Gate pageCode="ATS_RECRUITER_QUEUE"><NativeATSRecruiterDashboard /></Gate></ProtectedRoute>} />
              <Route path="/ats/onboarding-bridge" element={<ProtectedRoute><Gate pageCode="ATS_ONBOARDING_BRIDGE"><NativeATSOnboardingBridge /></Gate></ProtectedRoute>} />
              <Route path="/ats/waiting-queue" element={<ProtectedRoute><Gate pageCode="ATS_WAITING_QUEUE"><NativeATSWaitingQueue /></Gate></ProtectedRoute>} />
              <Route path="/ats/candidate-master" element={<ProtectedRoute><Gate pageCode="ATS_CANDIDATE_MASTER"><NativeATSCandidateMaster /></Gate></ProtectedRoute>} />
              <Route path="/ats/recruiter/workspace" element={<ProtectedRoute><Gate pageCode="ATS_RECRUITER_WORKSPACE"><NativeATSRecruiterWorkspace /></Gate></ProtectedRoute>} />
              <Route path="/ats/dashboard-v2" element={<ProtectedRoute><Gate pageCode="ATS_DASHBOARD"><NativeATSDashboardV2 /></Gate></ProtectedRoute>} />
              <Route path="/ats/sourcing-analysis" element={<ProtectedRoute><Gate pageCode="ATS_DASHBOARD"><NativeATSSourcingAnalysis /></Gate></ProtectedRoute>} />
              <Route path="/ats/extensions" element={<ProtectedRoute><Gate pageCode="ATS_EXTENSIONS"><NativeATSExtensions /></Gate></ProtectedRoute>} />
              <Route path="/ats/form-config" element={<ProtectedRoute><NativeATSFormConfig /></ProtectedRoute>} />
              <Route path="/ats/command-center" element={<ProtectedRoute><Gate pageCode="ATS_DASHBOARD"><NativeATSFullParityCommandCenter /></Gate></ProtectedRoute>} />
              <Route path="/ats/onboarding-requests" element={<ProtectedRoute><NativeHROnboardingRequests /></ProtectedRoute>} />
              <Route path="/ats/offer-approvals" element={<ProtectedRoute><NativeBranchHeadApproval /></ProtectedRoute>} />
              <Route path="/onboard-full" element={<CandidateOnboardingFullPage />} />
              <Route path="/ats/bgv" element={<ProtectedRoute><Gate pageCode="ATS_BGV"><NativeBGVVerificationCenter /></Gate></ProtectedRoute>} />
              <Route path="/ats/bgv-report" element={<ProtectedRoute><Gate pageCode="ATS_BGV"><NativeBGVReport /></Gate></ProtectedRoute>} />

              {/* LMS */}
              <Route path="/lms/my-learning" element={<ProtectedRoute><Gate pageCode="LMS_MY_LEARNING"><NativeLMSMyLearning /></Gate></ProtectedRoute>} />
              <Route path="/lms/coordinator" element={<ProtectedRoute><Gate pageCode="LMS_COORDINATOR"><NativeLMSCoordinator /></Gate></ProtectedRoute>} />
              <Route path="/lms/admin" element={<ProtectedRoute><Gate pageCode="LMS_ADMIN"><LMSIntegrationAdmin /></Gate></ProtectedRoute>} />
              <Route path="/lms/management-dashboard" element={<ProtectedRoute><Gate pageCode="LMS_MANAGEMENT_DASHBOARD"><LMSIntegrationAdmin /></Gate></ProtectedRoute>} />
              <Route path="/lms/integration" element={<ProtectedRoute><Gate pageCode="LMS_INTEGRATION"><NativeLMSIntegration /></Gate></ProtectedRoute>} />

              {/* WFM */}
              <Route path="/wfm/roster" element={<ProtectedRoute><Gate pageCode="WFM_ROSTER"><NativeWFMRoster /></Gate></ProtectedRoute>} />
              <Route path="/wfm-roster" element={<Navigate to="/wfm/roster" replace />} />
              <Route path="/wfm/live-tracker" element={<ProtectedRoute><Gate pageCode="WFM_LIVE_TRACKER"><NativeBiometricCommandCenter /></Gate></ProtectedRoute>} />
              <Route path="/wfm/adherence-command-center" element={<ProtectedRoute><Gate pageCode="WFM_LIVE_TRACKER"><NativeBiometricCommandCenter /></Gate></ProtectedRoute>} />
              <Route path="/wfm/agent-attendance-view" element={<ProtectedRoute><Gate pageCode="WFM_LIVE_TRACKER"><NativeBiometricCommandCenter /></Gate></ProtectedRoute>} />
              <Route path="/wfm/attendance-exceptions" element={<ProtectedRoute><Gate pageCode="WFM_LIVE_TRACKER"><NativeAttendanceExceptionEngine /></Gate></ProtectedRoute>} />
              <Route path="/wfm/cosec-monitoring" element={<ProtectedRoute><Gate pageCode="WFM_LIVE_TRACKER"><NativeCosecSyncMonitoring /></Gate></ProtectedRoute>} />
              <Route path="/wfm/extensions" element={<ProtectedRoute><Gate pageCode="WFM_EXTENSIONS"><NativeWFMExtensions /></Gate></ProtectedRoute>} />
              <Route path="/roster-preference" element={<ProtectedRoute><NativeRosterPreference /></ProtectedRoute>} />

              {/* Quality / Ops */}
              <Route path="/quality/dashboard" element={<ProtectedRoute><Gate pageCode="QUALITY_DASHBOARD"><NativeQualityDashboard /></Gate></ProtectedRoute>} />
              <Route path="/quality/my-dashboard" element={<ProtectedRoute><AgentQualityDashboard /></ProtectedRoute>} />
              <Route path="/quality/team" element={<ProtectedRoute><ManagerQualityDashboard /></ProtectedRoute>} />
              <Route path="/quality/audit" element={<ProtectedRoute><QADashboard /></ProtectedRoute>} />
              <Route path="/quality/executive" element={<ProtectedRoute><ExecutiveQualityDashboard /></ProtectedRoute>} />
              <Route path="/operations/dashboard" element={<ProtectedRoute><Gate pageCode="OPERATIONS_DASHBOARD"><NativeOperationsDashboard /></Gate></ProtectedRoute>} />
              <Route path="/business-command-center" element={<ProtectedRoute roles={['admin', 'ceo', 'hr', 'manager', 'process_manager']}><NativeBusinessCommandCenter /></ProtectedRoute>} />
              <Route path="/business-actions" element={<ProtectedRoute roles={['admin', 'ceo', 'hr', 'manager', 'process_manager', 'team_leader', 'tl']}><NativeBusinessActionQueue /></ProtectedRoute>} />

              {/* Agent Performance */}
              <Route path="/agent-performance" element={<ProtectedRoute><Gate pageCode="AGENT_PERFORMANCE"><NativeAgentPerformanceDashboard /></Gate></ProtectedRoute>} />

              {/* People Experience / Support */}
              <Route path="/people-experience/command-center" element={<ProtectedRoute><Gate pageCode="PEOPLE_EXPERIENCE"><NativePeopleExperienceCommandCenter /></Gate></ProtectedRoute>} />
              <Route path="/support/command-center" element={<ProtectedRoute><Gate pageCode="SUPPORT_COMMAND_CENTER"><NativeSupportCommandCenter /></Gate></ProtectedRoute>} />
              <Route path="/support/grievance-command-center" element={<ProtectedRoute><Gate pageCode="GRIEVANCE_COMMAND_CENTER"><NativeGrievanceCommandCenter /></Gate></ProtectedRoute>} />

              {/* Performance */}
              <Route path="/performance/command-center" element={<ProtectedRoute><Gate pageCode="WORKFORCE_COMMAND_CENTER"><UnifiedPerformanceCommandCenter /></Gate></ProtectedRoute>} />
              <Route path="/settings/access-control" element={<ProtectedRoute><Gate pageCode="ACCESS_CONTROL"><UnifiedAccessControl /></Gate></ProtectedRoute>} />
              <Route path="/super-admin/page-access" element={<ProtectedRoute roles={['admin']}><SuperAdminAccessControl /></ProtectedRoute>} />
              <Route path="/settings/call-centre-config" element={<ProtectedRoute><NativeCallCentreConfig /></ProtectedRoute>} />

              {/* Performance Feedback */}
              <Route path="/performance-feedback/my-reports" element={<ProtectedRoute><NativePerformanceFeedbackMyReports /></ProtectedRoute>} />
              <Route path="/performance-feedback/reports/:id" element={<ProtectedRoute><NativePerformanceFeedbackReportDetail /></ProtectedRoute>} />
              <Route path="/performance-feedback/development-plan" element={<ProtectedRoute><NativePerformanceFeedbackDevelopmentPlan /></ProtectedRoute>} />
              <Route path="/performance-feedback/assignments" element={<ProtectedRoute><NativePerformanceFeedbackAssignments /></ProtectedRoute>} />
              <Route path="/performance-feedback/form/:id" element={<ProtectedRoute><NativePerformanceFeedbackForm /></ProtectedRoute>} />
              <Route path="/performance-feedback/team-reports" element={<ProtectedRoute><NativePerformanceFeedbackTeamReports /></ProtectedRoute>} />

              {/* Engagement */}
              <Route path="/engagement" element={<ProtectedRoute><NativeEngagement /></ProtectedRoute>} />
              <Route path="/engagement/badges" element={<ProtectedRoute><NativeBadges /></ProtectedRoute>} />
              <Route path="/engagement/kudos" element={<ProtectedRoute><NativeKudos /></ProtectedRoute>} />
              <Route path="/engagement/surveys" element={<ProtectedRoute><NativeSurveys /></ProtectedRoute>} />
              <Route path="/engagement/leaderboard" element={<ProtectedRoute><NativeLeaderboard /></ProtectedRoute>} />
              <Route path="/engagement/command-center" element={<ProtectedRoute><Gate pageCode="ENGAGEMENT_COMMAND_CENTER"><NativeEngagementCommandCenter /></Gate></ProtectedRoute>} />

              {/* Employee Stat Card / Journey */}
              <Route path="/employee-stat-card" element={<ProtectedRoute><NativeEmployeeStatCard /></ProtectedRoute>} />
              <Route path="/employee-stat-card/:id" element={<ProtectedRoute><NativeEmployeeStatCard /></ProtectedRoute>} />

              {/* Client Portal */}
              <Route path="/portal/login" element={<PortalLogin />} />
              <Route path="/portal" element={<PortalRoute><PortalOverview /></PortalRoute>} />
              <Route path="/portal/processes/:id" element={<PortalRoute><PortalProcessDashboard /></PortalRoute>} />

              {/* Offer Letters & Master Reports */}
              <Route path="/offer-letter" element={<ProtectedRoute><NativeOfferLetterGeneration /></ProtectedRoute>} />
              <Route path="/master-reports" element={<ProtectedRoute><NativeMasterReports /></ProtectedRoute>} />

              {/* HR Ops */}
              <Route path="/document-verification" element={<ProtectedRoute><NativeDocumentVerification /></ProtectedRoute>} />
              <Route path="/assets-manager" element={<ProtectedRoute><Gate pageCode="ASSETS_MANAGER"><NativeAssetsManager /></Gate></ProtectedRoute>} />
              <Route path="/helpdesk" element={<ProtectedRoute><Gate pageCode="HELPDESK"><NativeHelpdesk /></Gate></ProtectedRoute>} />
              <Route path="/letters" element={<ProtectedRoute><Gate pageCode="LETTERS"><NativeLetters /></Gate></ProtectedRoute>} />
              <Route path="/maternity-leave" element={<ProtectedRoute><NativeMaternityLeave /></ProtectedRoute>} />
              <Route path="/employee-lifecycle" element={<ProtectedRoute><Gate pageCode="EMPLOYEE_LIFECYCLE"><NativeLifecycle /></Gate></ProtectedRoute>} />
              <Route path="/employee-lifecycle-v2" element={<ProtectedRoute><Gate pageCode="EMPLOYEE_LIFECYCLE"><NativeEmployeeLifecycle /></Gate></ProtectedRoute>} />
              <Route path="/org-masters" element={<ProtectedRoute><Gate pageCode="ORG_MASTERS"><NativeOrgMasters /></Gate></ProtectedRoute>} />
              <Route path="/org-masters/locations-policies" element={<ProtectedRoute><Gate pageCode="ORG_MASTERS"><NativeLocationPolicyMasters /></Gate></ProtectedRoute>} />
              <Route path="/workflow-admin" element={<ProtectedRoute><Gate pageCode="WORKFLOW_ADMIN"><NativeWorkflowAdmin /></Gate></ProtectedRoute>} />
              <Route path="/management/dashboard" element={<ProtectedRoute><Gate pageCode="MANAGEMENT_DASHBOARD"><NativeManagementDashboard /></Gate></ProtectedRoute>} />
              <Route path="/management/team" element={<ProtectedRoute roles={['admin', 'hr', 'manager', 'branch_head', 'ceo', 'process_manager']}><ManagementDashboard /></ProtectedRoute>} />
              <Route path="/management/ceo-command-center" element={<ProtectedRoute roles={['admin', 'hr', 'ceo', 'finance', 'process_manager', 'manager']}><NativeCEOCommandCenter /></ProtectedRoute>} />
              <Route path="/benefits" element={<ProtectedRoute><Gate pageCode="BENEFITS"><NativeBenefitsClaims /></Gate></ProtectedRoute>} />
              <Route path="/career-planning" element={<ProtectedRoute><Gate pageCode="CAREER_PLANNING"><NativeCareerPlanning /></Gate></ProtectedRoute>} />
              <Route path="/pip-management" element={<ProtectedRoute><Gate pageCode="PIP_MANAGEMENT"><NativePIPManagement /></Gate></ProtectedRoute>} />
              <Route path="/erp" element={<ProtectedRoute><Gate pageCode="ERP"><NativeERP /></Gate></ProtectedRoute>} />
              <Route path="/goals" element={<ProtectedRoute><Gate pageCode="GOALS"><NativeGoalsAppraisal /></Gate></ProtectedRoute>} />
              <Route path="/work-inbox" element={<ProtectedRoute><Gate pageCode="WORK_INBOX"><NativeWorkInbox /></Gate></ProtectedRoute>} />
              <Route path="/mobility" element={<ProtectedRoute><Gate pageCode="MOBILITY"><NativeMobilityManagement /></Gate></ProtectedRoute>} />
              <Route path="/jobs" element={<ProtectedRoute><Gate pageCode="JOBS_PORTAL"><NativeJobsPortal /></Gate></ProtectedRoute>} />
              <Route path="/advanced-reports" element={<ProtectedRoute><Gate pageCode="ADVANCED_REPORTS"><NativeAdvancedReports /></Gate></ProtectedRoute>} />
              <Route path="/compliance/statutory" element={<ProtectedRoute><Gate pageCode="STATUTORY_COMPLIANCE"><NativeStatutoryCompliance /></Gate></ProtectedRoute>} />
              <Route path="/compliance/labour" element={<ProtectedRoute><Gate pageCode="LABOUR_COMPLIANCE"><NativeLabourCompliance /></Gate></ProtectedRoute>} />
              <Route path="/compliance/dpdp" element={<ProtectedRoute><Gate pageCode="DPDP_COMPLIANCE"><NativeDPDPCompliance /></Gate></ProtectedRoute>} />
              <Route path="/integration-hub" element={<ProtectedRoute><Gate pageCode="INTEGRATION_HUB"><NativeIntegrationHub /></Gate></ProtectedRoute>} />
              <Route path="/client-master" element={<ProtectedRoute><Gate pageCode="CLIENT_MASTER"><EnhancedClientMaster /></Gate></ProtectedRoute>} />
              <Route path="/customization" element={<ProtectedRoute><Gate pageCode="CUSTOMIZATION_MANAGER"><NativeCustomizationManager /></Gate></ProtectedRoute>} />
              <Route path="/customization/new" element={<ProtectedRoute><Gate pageCode="CUSTOMIZATION_MANAGER"><NativeCustomizationRuleEditor /></Gate></ProtectedRoute>} />
              <Route path="/customization/:id/edit" element={<ProtectedRoute><Gate pageCode="CUSTOMIZATION_MANAGER"><NativeCustomizationRuleEditor /></Gate></ProtectedRoute>} />

              {/* Payroll */}
              <Route path="/payroll/payslips" element={<ProtectedRoute><Gate pageCode="PAYROLL_PAYSLIPS"><NativePayslipCenter /></Gate></ProtectedRoute>} />
              <Route path="/payroll/readiness" element={<ProtectedRoute><Gate pageCode="PAYROLL"><NativePayrollReadiness /></Gate></ProtectedRoute>} />
              <Route path="/payroll/tax-declaration" element={<ProtectedRoute><Gate pageCode="TAX_DECLARATION"><NativeTaxDeclaration /></Gate></ProtectedRoute>} />
              <Route path="/payroll/full-final" element={<ProtectedRoute><Gate pageCode="FULL_FINAL"><NativeFullFinal /></Gate></ProtectedRoute>} />
              <Route path="/payroll/statutory-config" element={<ProtectedRoute><Gate pageCode="STATUTORY_CONFIG"><NativeStatutoryConfig /></Gate></ProtectedRoute>} />
              <Route path="/payroll/salary-packages" element={<ProtectedRoute><Gate pageCode="PAYROLL"><NativeSalaryPackages /></Gate></ProtectedRoute>} />

              {/* Communication */}
              <Route path="/communication/templates" element={<ProtectedRoute><NativeTemplateManager /></ProtectedRoute>} />
              <Route path="/communication/dispatch"  element={<ProtectedRoute roles={['admin', 'hr']}><NativeDispatchCenter /></ProtectedRoute>} />
              <Route path="/communication/history"   element={<ProtectedRoute><NativeDispatchHistory /></ProtectedRoute>} />
              <Route path="/communication/preferences" element={<ProtectedRoute><NativeNotificationPreferences /></ProtectedRoute>} />
              <Route
                path="/settings/communication-config"
                element={
                  <ProtectedRoute>
                    <Suspense fallback={<PageLoader />}>
                      <NativeCommunicationConfig />
                    </Suspense>
                  </ProtectedRoute>
                }
              />

              {/* System */}
              <Route path="/migration-console" element={<ProtectedRoute roles={['admin']}><NativeMigrationConsole /></ProtectedRoute>} />
              <Route path="/exit-management" element={<ProtectedRoute><NativeExitManagement /></ProtectedRoute>} />
              <Route path="/exit/command-center" element={<ProtectedRoute><Gate pageCode="EXIT_COMMAND_CENTER"><NativeExitCommandCenter /></Gate></ProtectedRoute>} />
              <Route path="/kpi-config" element={<ProtectedRoute><Gate pageCode="KPI_CONFIG"><NativeKPIConfiguration /></Gate></ProtectedRoute>} />
              <Route path="/operations-kpi" element={<ProtectedRoute><Gate pageCode="OPERATIONS_KPI"><NativeOperationsKPI /></Gate></ProtectedRoute>} />
              <Route path="/portal-data-manager" element={<ProtectedRoute><Gate pageCode="PORTAL_DATA_MANAGER"><NativePortalDataManager /></Gate></ProtectedRoute>} />
              <Route path="/process-config" element={<ProtectedRoute><Gate pageCode="PROCESS_CONFIG"><NativeProcessConfig /></Gate></ProtectedRoute>} />
              <Route path="/leave-types" element={<ProtectedRoute><Gate pageCode="LEAVE_TYPES"><NativeLeaveTypeConfig /></Gate></ProtectedRoute>} />
              <Route path="/my-roster" element={<ProtectedRoute><NativeMyRoster /></ProtectedRoute>} />
              <Route path="/wfm/roster-dispute-queue" element={<ProtectedRoute roles={['admin','hr','wfm','manager','branch_head','super_admin']}><NativeRosterManagerQueue /></ProtectedRoute>} />
              <Route path="/roster-master-builder" element={<ProtectedRoute><Gate pageCode="ROSTER_MASTER"><NativeRosterMasterBuilder /></Gate></ProtectedRoute>} />
              <Route path="/week-off-preferences" element={<ProtectedRoute><NativeWeekOffPreferences /></ProtectedRoute>} />
              <Route path="/attendance/disputes" element={<ProtectedRoute><NativeAttendanceDisputes /></ProtectedRoute>} />
              <Route path="/payroll/attendance-overrides" element={<ProtectedRoute roles={['admin','super_admin','payroll_head','payroll_admin']}><NativePayrollAttendanceOverrides /></ProtectedRoute>} />
              <Route path="/audit-log" element={<ProtectedRoute roles={['admin','super_admin','payroll_head','hr','wfm']}><NativeAuditLog /></ProtectedRoute>} />
              <Route path="/roster-capacity-config" element={<ProtectedRoute><Gate pageCode="ROSTER_MASTER"><NativeRosterCapacityConfig /></Gate></ProtectedRoute>} />
              <Route path="/wfm/auto-roster" element={<ProtectedRoute><Gate pageCode="WFM_AUTO_ROSTER"><NativeWFMAutoRoster /></Gate></ProtectedRoute>} />
              <Route path="/wfm/planning-rules" element={<ProtectedRoute roles={['admin','hr','wfm','manager','super_admin']}><NativeWFMPlanningRules /></ProtectedRoute>} />
              <Route path="/wfm/slot-requirements" element={<ProtectedRoute roles={['admin','hr','wfm','manager','super_admin']}><NativeSlotRequirementBuilder /></ProtectedRoute>} />
              <Route path="/wfm/weekoff-day-rules" element={<ProtectedRoute roles={['admin','hr','wfm','manager','super_admin']}><NativeWeekOffDayRuleConfig /></ProtectedRoute>} />
              <Route path="/workforce-planning" element={<ProtectedRoute><Gate pageCode="WFM_AUTO_ROSTER"><NativeWorkforcePlanning /></Gate></ProtectedRoute>} />
              <Route path="/control-tower" element={<ProtectedRoute><Gate pageCode="CONTROL_TOWER"><NativeControlTower /></Gate></ProtectedRoute>} />
              <Route path="/rta-board" element={<ProtectedRoute><Gate pageCode="RTA_BOARD"><NativeRTABoard /></Gate></ProtectedRoute>} />
              <Route path="/ats/walkin-queue" element={<ProtectedRoute><Gate pageCode="ATS_WAITING_QUEUE"><NativeWalkinQueue /></Gate></ProtectedRoute>} />
              <Route path="/attendance-rules-master" element={<ProtectedRoute><NativeAttendanceRulesMaster /></ProtectedRoute>} />
              <Route path="/changelog" element={<ProtectedRoute><Changelog /></ProtectedRoute>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
          <CookieConsent />
          <OfflineFallback />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
