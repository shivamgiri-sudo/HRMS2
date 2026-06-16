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
import ChangePassword from "./pages/ChangePassword";
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
const Notifications                 = lazy(() => import("./pages/Notifications"));
const Changelog                     = lazy(() => import("./pages/Changelog"));
const ModuleLauncher                = lazy(() => import("./pages/ModuleLauncher"));

// ATS Onboarding
const CandidateOnboardingPage       = lazy(() => import("./pages/CandidateOnboardingPage"));
const CandidateOnboardingFullPage   = lazy(() => import("./pages/CandidateOnboardingFullPage"));
const NativeHROnboardingRequests    = lazy(() => import("./pages/NativeHROnboardingRequests"));
const NativeBranchHeadApproval      = lazy(() => import("./pages/NativeBranchHeadApproval"));
const NativeBGVVerificationCenter   = lazy(() => import("./pages/NativeBGVVerificationCenter"));

// ATS
const NativeATSDashboardReplica     = lazy(() => import("./pages/NativeATSDashboardReplica"));
const NativeATSCandidateRegistration = lazy(() => import("./pages/NativeATSCandidateRegistration"));
const NativeATSRegistrationEnhanced = lazy(() => import("./pages/NativeATSRegistrationEnhanced"));
const NativeATSOnboardingBridge     = lazy(() => import("./pages/NativeATSOnboardingBridge"));
const NativeATSWaitingQueue         = lazy(() => import("./pages/NativeATSWaitingQueue"));
const NativeATSCandidateMaster      = lazy(() => import("./pages/NativeATSCandidateMaster"));
const NativeATSRecruiterWorkspace   = lazy(() => import("./pages/NativeATSRecruiterWorkspace"));
const NativeATSDashboardV2          = lazy(() => import("./pages/NativeATSDashboardV2"));
const NativeATSSourcingAnalysis     = lazy(() => import("./pages/NativeATSSourcingAnalysis"));
const NativeATSExtensions           = lazy(() => import("./pages/NativeATSExtensions"));
const NativeATSFormConfig           = lazy(() => import("./pages/NativeATSFormConfig"));
const NativeATSFullParityCommandCenter = lazy(() => import("./pages/NativeATSFullParityCommandCenter"));
const NativeRecruiterPortal         = lazy(() => import("./pages/NativeRecruiterPortal"));
const NativePayrollHRValidation     = lazy(() => import("./pages/NativePayrollHRValidation"));
const CandidatePortalLogin          = lazy(() => import("./pages/CandidatePortalLogin"));
const CandidatePortalDashboard      = lazy(() => import("./pages/CandidatePortalDashboard"));
const BranchHeadApproval            = lazy(() => import("./pages/BranchHeadApproval"));
const SuperAdminModuleAccess        = lazy(() => import("./pages/SuperAdminModuleAccess"));
const SuperAdminDashboardV2         = lazy(() => import("./pages/SuperAdminDashboardV2"));
const ATSCommandCentre              = lazy(() => import("./pages/ATSCommandCentre"));
const NativeBGVEnhanced             = lazy(() => import("./pages/NativeBGVEnhanced"));

// LMS
const NativeLMSMyLearning           = lazy(() => import("./pages/NativeLMSMyLearning"));
const NativeLMSCoordinator         = lazy(() => import("./pages/NativeLMSCoordinator"));
const LMSIntegrationAdmin           = lazy(() => import("./pages/LMSIntegrationAdmin"));
const NativePlaceholderPage         = lazy(() => import("./pages/NativePlaceholderPage"));
const NativeLMSIntegration          = lazy(() => import("./pages/NativeLMSIntegration"));

// WFM
const NativeWFMRoster               = lazy(() => import("./pages/NativeWFMRoster"));
const NativeWFMExtensions           = lazy(() => import("./pages/NativeWFMExtensions"));
const NativeWFMManagerApproval      = lazy(() => import("./pages/NativeWFMManagerApproval"));
const NativeBiometricCommandCenter  = lazy(() => import("./pages/NativeBiometricCommandCenter"));

// Performance & Management
const UnifiedPerformanceCommandCenter = lazy(() => import("./pages/UnifiedPerformanceCommandCenter"));
const UnifiedAccessControl          = lazy(() => import("./pages/UnifiedAccessControl"));
const SuperAdminAccessControl       = lazy(() => import("./pages/SuperAdminAccessControl"));
const NativeManagementDashboard     = lazy(() => import("./pages/NativeManagementDashboard"));

// Performance Feedback
const NativePerformanceFeedbackMyReports = lazy(() => import("./pages/NativePerformanceFeedbackMyReports"));
const NativePerformanceFeedbackReportDetail = lazy(() => import("./pages/NativePerformanceFeedbackReportDetail"));
const NativePerformanceFeedbackDevelopmentPlan = lazy(() => import("./pages/NativePerformanceFeedbackDevelopmentPlan"));
const NativePerformanceFeedbackAssignments = lazy(() => import("./pages/NativePerformanceFeedbackAssignments"));
const NativePerformanceFeedbackForm = lazy(() => import("./pages/NativePerformanceFeedbackForm"));
const NativePerformanceFeedbackTeamReports = lazy(() => import("./pages/NativePerformanceFeedbackTeamReports"));

// People
const NativeEmployeeStatCard        = lazy(() => import("./pages/NativeEmployeeStatCard"));

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
const NativeStatutoryCompliance     = lazy(() => import("./pages/NativeStatutoryCompliance"));
const NativeLabourCompliance        = lazy(() => import("./pages/NativeLabourCompliance"));
const NativeDPDPCompliance          = lazy(() => import("./pages/NativeDPDPCompliance"));
const NativeMaternityLeave          = lazy(() => import("./pages/NativeMaternityLeave"));
const NativeIntegrationHub          = lazy(() => import("./pages/NativeIntegrationHub"));
const EnhancedClientMaster          = lazy(() => import("./pages/EnhancedClientMaster"));
const NativeLocationPolicyMasters   = lazy(() => import("./pages/NativeLocationPolicyMasters"));

// Payroll
const NativePayslipCenter           = lazy(() => import("./pages/NativePayslipCenter"));
const NativeTaxDeclaration          = lazy(() => import("./pages/NativeTaxDeclaration"));
const NativeFullFinal               = lazy(() => import("./pages/NativeFullFinal"));
const NativeStatutoryConfig         = lazy(() => import("./pages/NativeStatutoryConfig"));
const NativePayrollMasters          = lazy(() => import("./pages/NativePayrollMasters"));
const NativeSalaryPackages          = lazy(() => import("./pages/NativeSalaryPackages"));
const NativeIncentives              = lazy(() => import("./pages/NativeIncentives"));

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
const NativeRosterMasterBuilder     = lazy(() => import("./pages/NativeRosterMasterBuilder"));
const NativeWeekOffPreferences      = lazy(() => import("./pages/NativeWeekOffPreferences"));
const NativeRosterCapacityConfig    = lazy(() => import("./pages/NativeRosterCapacityConfig"));
const NativeWFMAutoRoster           = lazy(() => import("./pages/NativeWFMAutoRoster"));
const NativeControlTower            = lazy(() => import("./pages/NativeControlTower"));
const NativeRTABoard                = lazy(() => import("./pages/NativeRTABoard"));
const NativeWalkinQueue             = lazy(() => import("./pages/NativeWalkinQueueEnhanced"));
const NativeAttendanceRulesMaster   = lazy(() => import("./pages/NativeAttendanceRulesMaster"));
const NativeCustomizationManager    = lazy(() => import("./pages/customization/NativeCustomizationManager"));
const NativeCustomizationRuleEditor = lazy(() => import("./pages/customization/NativeCustomizationRuleEditor"));
const EmployeeJourney               = lazy(() => import("./pages/EmployeeJourney"));

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
              <Route path="/change-password" element={<ProtectedRoute><ChangePassword /></ProtectedRoute>} />
              <Route path="/onboard" element={<CandidateOnboardingPage />} />
              <Route path="/candidate-onboarding/:token" element={<CandidateOnboardingFullPage />} />
              <Route path="/candidate-portal/login" element={<CandidatePortalLogin />} />
              <Route path="/candidate-portal/dashboard" element={<CandidatePortalDashboard />} />
              <Route path="/dashboard" element={<ProtectedRoute><Index /></ProtectedRoute>} />
              <Route path="/employees" element={<ProtectedRoute><Employees /></ProtectedRoute>} />
              <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
              <Route path="/leaves" element={<ProtectedRoute><Leaves /></ProtectedRoute>} />
              <Route path="/assets" element={<ProtectedRoute><Assets /></ProtectedRoute>} />
              <Route path="/payroll" element={<ProtectedRoute><Payroll /></ProtectedRoute>} />
              <Route path="/reports" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
              <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
              <Route path="/performance" element={<ProtectedRoute><Performance /></ProtectedRoute>} />
              <Route path="/reviews" element={<ProtectedRoute><ReviewsManagement /></ProtectedRoute>} />
              <Route path="/attendance" element={<ProtectedRoute><Attendance /></ProtectedRoute>} />
              <Route path="/attendance/regularization" element={<ProtectedRoute><AttendanceRegularization /></ProtectedRoute>} />
              <Route path="/bulk-upload" element={<ProtectedRoute><BulkUploadHub /></ProtectedRoute>} />
              <Route path="/departments" element={<ProtectedRoute><Departments /></ProtectedRoute>} />
              <Route path="/calendar" element={<ProtectedRoute><CompanyCalendar /></ProtectedRoute>} />
              <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
              <Route path="/notification-preferences" element={<ProtectedRoute><NotificationPreferences /></ProtectedRoute>} />
              <Route path="/changelog-public" element={<Changelog />} />
              <Route path="/module-launcher" element={<ProtectedRoute><ModuleLauncher /></ProtectedRoute>} />
              <Route path="/week-off-preferences" element={<ProtectedRoute><NativeWeekOffPreferences /></ProtectedRoute>} />
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
