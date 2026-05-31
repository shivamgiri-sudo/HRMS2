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
import Auth from "./pages/Auth";
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

// ATS
const NativeATSDashboardReplica     = lazy(() => import("./pages/NativeATSDashboardReplica"));
const NativeATSCandidateRegistration = lazy(() => import("./pages/NativeATSCandidateRegistration"));
const NativeATSRecruiterDashboard   = lazy(() => import("./pages/NativeATSRecruiterDashboard"));
const NativeATSOnboardingBridge     = lazy(() => import("./pages/NativeATSOnboardingBridge"));
const NativeATSWaitingQueue         = lazy(() => import("./pages/NativeATSWaitingQueue"));
const NativeATSCandidateMaster      = lazy(() => import("./pages/NativeATSCandidateMaster"));
const NativeATSRecruiterWorkspace   = lazy(() => import("./pages/NativeATSRecruiterWorkspace"));
const NativeATSDashboardV2          = lazy(() => import("./pages/NativeATSDashboardV2"));
const NativeATSSourcingAnalysis     = lazy(() => import("./pages/NativeATSSourcingAnalysis"));
const NativeATSExtensions           = lazy(() => import("./pages/NativeATSExtensions"));

// LMS
const NativeLMSMyLearning           = lazy(() => import("./pages/NativeLMSMyLearning"));
const NativeLMSCoordinator         = lazy(() => import("./pages/NativeLMSCoordinator"));
const NativePlaceholderPage         = lazy(() => import("./pages/NativePlaceholderPage"));
const NativeLMSIntegration          = lazy(() => import("./pages/NativeLMSIntegration"));

// WFM
const NativeWFMRoster               = lazy(() => import("./pages/NativeWFMRoster"));
const NativeWFMExtensions           = lazy(() => import("./pages/NativeWFMExtensions"));

// Performance & Management
const UnifiedPerformanceCommandCenter = lazy(() => import("./pages/UnifiedPerformanceCommandCenter"));
const UnifiedAccessControl          = lazy(() => import("./pages/UnifiedAccessControl"));
const NativeManagementDashboard     = lazy(() => import("./pages/NativeManagementDashboard"));

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
const NativeStatutoryCompliance     = lazy(() => import("./pages/NativeStatutoryCompliance"));
const NativeLabourCompliance        = lazy(() => import("./pages/NativeLabourCompliance"));
const NativeDPDPCompliance          = lazy(() => import("./pages/NativeDPDPCompliance"));
const NativeIntegrationHub          = lazy(() => import("./pages/NativeIntegrationHub"));
const NativeClientMaster            = lazy(() => import("./pages/NativeClientMaster"));
const NativeLocationPolicyMasters   = lazy(() => import("./pages/NativeLocationPolicyMasters"));

// Payroll
const NativePayslipCenter           = lazy(() => import("./pages/NativePayslipCenter"));
const NativeTaxDeclaration          = lazy(() => import("./pages/NativeTaxDeclaration"));
const NativeFullFinal               = lazy(() => import("./pages/NativeFullFinal"));
const NativeStatutoryConfig         = lazy(() => import("./pages/NativeStatutoryConfig"));

// System
const NativeMigrationConsole        = lazy(() => import("./pages/NativeMigrationConsole"));
const NativeExitManagement          = lazy(() => import("./pages/NativeExitManagement"));
const NativeKPIConfiguration        = lazy(() => import("./pages/NativeKPIConfiguration"));
const NativeProcessConfig           = lazy(() => import("./pages/NativeProcessConfig"));
const NativeOperationsKPI           = lazy(() => import("./pages/NativeOperationsKPI"));
const NativePortalDataManager       = lazy(() => import("./pages/NativePortalDataManager"));
const NativeLeaveTypeConfig         = lazy(() => import("./pages/NativeLeaveTypeConfig"));
const NativeMyRoster                = lazy(() => import("./pages/NativeMyRoster"));
const NativeRTABoard                = lazy(() => import("./pages/NativeRTABoard"));
const NativeWalkinQueue             = lazy(() => import("./pages/NativeWalkinQueue"));

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

              <Route path="/interview-registration" element={<NativeATSCandidateRegistration />} />
              <Route path="/candidate-registration" element={<Navigate to="/interview-registration" replace />} />
              <Route path="/walkin-registration" element={<Navigate to="/interview-registration" replace />} />

              <Route path="/dashboard" element={<ProtectedRoute><Index /></ProtectedRoute>} />
              <Route path="/employees" element={<ProtectedRoute><Employees /></ProtectedRoute>} />
              <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
              <Route path="/onboarding-requests" element={<Navigate to="/onboarding?tab=requests" replace />} />
              <Route path="/leaves" element={<ProtectedRoute><Leaves /></ProtectedRoute>} />
              <Route path="/leave-approvals" element={<Navigate to="/leaves" replace />} />
              <Route path="/assets" element={<ProtectedRoute><Assets /></ProtectedRoute>} />
              <Route path="/payroll" element={<ProtectedRoute><Payroll /></ProtectedRoute>} />
              <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
              <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
              <Route path="/performance" element={<ProtectedRoute><Performance /></ProtectedRoute>} />
              <Route path="/reviews-management" element={<ProtectedRoute><ReviewsManagement /></ProtectedRoute>} />
              <Route path="/attendance" element={<ProtectedRoute><Attendance /></ProtectedRoute>} />
              <Route path="/attendance-regularization" element={<ProtectedRoute><AttendanceRegularization /></ProtectedRoute>} />
              <Route path="/bulk-upload" element={<ProtectedRoute><BulkUploadHub /></ProtectedRoute>} />
              <Route path="/departments" element={<ProtectedRoute><Departments /></ProtectedRoute>} />
              <Route path="/calendar" element={<ProtectedRoute><CompanyCalendar /></ProtectedRoute>} />
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

              {/* LMS */}
              <Route path="/lms/my-learning" element={<ProtectedRoute><Gate pageCode="LMS_MY_LEARNING"><NativeLMSMyLearning /></Gate></ProtectedRoute>} />
              <Route path="/lms/coordinator" element={<ProtectedRoute><Gate pageCode="LMS_COORDINATOR"><NativeLMSCoordinator /></Gate></ProtectedRoute>} />
              <Route path="/lms/admin" element={<ProtectedRoute><Gate pageCode="LMS_ADMIN"><NativePlaceholderPage title="LMS Admin" module="LMS" /></Gate></ProtectedRoute>} />
              <Route path="/lms/management-dashboard" element={<ProtectedRoute><Gate pageCode="LMS_MANAGEMENT_DASHBOARD"><NativePlaceholderPage title="LMS Management Dashboard" module="LMS" /></Gate></ProtectedRoute>} />
              <Route path="/lms/integration" element={<ProtectedRoute><Gate pageCode="LMS_INTEGRATION"><NativeLMSIntegration /></Gate></ProtectedRoute>} />

              {/* WFM */}
              <Route path="/wfm/roster" element={<ProtectedRoute><Gate pageCode="WFM_ROSTER"><NativeWFMRoster /></Gate></ProtectedRoute>} />
              <Route path="/wfm/live-tracker" element={<ProtectedRoute><Gate pageCode="WFM_LIVE_TRACKER"><NativePlaceholderPage title="WFM Live Tracker" module="WFM" /></Gate></ProtectedRoute>} />
              <Route path="/wfm/extensions" element={<ProtectedRoute><Gate pageCode="WFM_EXTENSIONS"><NativeWFMExtensions /></Gate></ProtectedRoute>} />

              {/* Quality / Ops */}
              <Route path="/quality/dashboard" element={<ProtectedRoute><Gate pageCode="QUALITY_DASHBOARD"><NativePlaceholderPage title="Quality Dashboard" module="Quality" /></Gate></ProtectedRoute>} />
              <Route path="/operations/dashboard" element={<ProtectedRoute><Gate pageCode="OPERATIONS_DASHBOARD"><NativePlaceholderPage title="Operations Dashboard" module="Operations" /></Gate></ProtectedRoute>} />

              {/* Performance */}
              <Route path="/performance/command-center" element={<ProtectedRoute><Gate pageCode="WORKFORCE_COMMAND_CENTER"><UnifiedPerformanceCommandCenter /></Gate></ProtectedRoute>} />
              <Route path="/settings/access-control" element={<ProtectedRoute><Gate pageCode="ACCESS_CONTROL"><UnifiedAccessControl /></Gate></ProtectedRoute>} />

              {/* Client Portal */}
              <Route path="/portal/login" element={<PortalLogin />} />
              <Route path="/portal" element={<PortalRoute><PortalOverview /></PortalRoute>} />
              <Route path="/portal/processes/:id" element={<PortalRoute><PortalProcessDashboard /></PortalRoute>} />

              {/* HR Ops */}
              <Route path="/assets-manager" element={<ProtectedRoute><Gate pageCode="ASSETS_MANAGER"><NativeAssetsManager /></Gate></ProtectedRoute>} />
              <Route path="/helpdesk" element={<ProtectedRoute><Gate pageCode="HELPDESK"><NativeHelpdesk /></Gate></ProtectedRoute>} />
              <Route path="/letters" element={<ProtectedRoute><Gate pageCode="LETTERS"><NativeLetters /></Gate></ProtectedRoute>} />
              <Route path="/employee-lifecycle" element={<ProtectedRoute><Gate pageCode="EMPLOYEE_LIFECYCLE"><NativeLifecycle /></Gate></ProtectedRoute>} />
              <Route path="/employee-lifecycle-v2" element={<ProtectedRoute><Gate pageCode="EMPLOYEE_LIFECYCLE"><NativeEmployeeLifecycle /></Gate></ProtectedRoute>} />
              <Route path="/org-masters" element={<ProtectedRoute><Gate pageCode="ORG_MASTERS"><NativeOrgMasters /></Gate></ProtectedRoute>} />
              <Route path="/org-masters/locations-policies" element={<ProtectedRoute><Gate pageCode="ORG_MASTERS"><NativeLocationPolicyMasters /></Gate></ProtectedRoute>} />
              <Route path="/workflow-admin" element={<ProtectedRoute><Gate pageCode="WORKFLOW_ADMIN"><NativeWorkflowAdmin /></Gate></ProtectedRoute>} />
              <Route path="/management/dashboard" element={<ProtectedRoute><Gate pageCode="MANAGEMENT_DASHBOARD"><NativeManagementDashboard /></Gate></ProtectedRoute>} />
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
              <Route path="/client-master" element={<ProtectedRoute><Gate pageCode="CLIENT_MASTER"><NativeClientMaster /></Gate></ProtectedRoute>} />

              {/* Payroll */}
              <Route path="/payroll/payslips" element={<ProtectedRoute><Gate pageCode="PAYROLL_PAYSLIPS"><NativePayslipCenter /></Gate></ProtectedRoute>} />
              <Route path="/payroll/tax-declaration" element={<ProtectedRoute><Gate pageCode="TAX_DECLARATION"><NativeTaxDeclaration /></Gate></ProtectedRoute>} />
              <Route path="/payroll/full-final" element={<ProtectedRoute><Gate pageCode="FULL_FINAL"><NativeFullFinal /></Gate></ProtectedRoute>} />
              <Route path="/payroll/statutory-config" element={<ProtectedRoute><Gate pageCode="STATUTORY_CONFIG"><NativeStatutoryConfig /></Gate></ProtectedRoute>} />

              {/* System */}
              <Route path="/migration-console" element={<ProtectedRoute><NativeMigrationConsole /></ProtectedRoute>} />
              <Route path="/exit-management" element={<ProtectedRoute><NativeExitManagement /></ProtectedRoute>} />
              <Route path="/kpi-config" element={<ProtectedRoute><Gate pageCode="KPI_CONFIG"><NativeKPIConfiguration /></Gate></ProtectedRoute>} />
              <Route path="/operations-kpi" element={<ProtectedRoute><Gate pageCode="OPERATIONS_KPI"><NativeOperationsKPI /></Gate></ProtectedRoute>} />
              <Route path="/portal-data-manager" element={<ProtectedRoute><Gate pageCode="PORTAL_DATA_MANAGER"><NativePortalDataManager /></Gate></ProtectedRoute>} />
              <Route path="/process-config" element={<ProtectedRoute><Gate pageCode="PROCESS_CONFIG"><NativeProcessConfig /></Gate></ProtectedRoute>} />
              <Route path="/leave-types" element={<ProtectedRoute><Gate pageCode="LEAVE_TYPES"><NativeLeaveTypeConfig /></Gate></ProtectedRoute>} />
              <Route path="/my-roster" element={<ProtectedRoute><NativeMyRoster /></ProtectedRoute>} />
              <Route path="/rta-board" element={<ProtectedRoute><Gate pageCode="RTA_BOARD"><NativeRTABoard /></Gate></ProtectedRoute>} />
              <Route path="/ats/walkin-queue" element={<ProtectedRoute><Gate pageCode="ATS_WAITING_QUEUE"><NativeWalkinQueue /></Gate></ProtectedRoute>} />
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
