import { Suspense, lazy as reactLazy } from "react";
import type { ComponentType } from "react";
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
import { ErrorBoundary } from "@/components/ErrorBoundary";

import Auth from "./pages/AuthClean";
import ResetPassword from "./pages/ResetPassword";
import ChangePassword from "./pages/ChangePassword";
import TwoFactor from "./pages/TwoFactor";
import NotFound from "./pages/NotFound";

function lazyWithRecovery<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) {
  return reactLazy(async () => {
    try {
      return await factory();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "");
      const isChunkFailure =
        /Failed to fetch dynamically imported module/i.test(message)
        || /Importing a module script failed/i.test(message)
        || /error loading dynamically imported module/i.test(message);

      if (isChunkFailure && typeof window !== "undefined") {
        const reloadKey = "hrms-chunk-reload";
        if (sessionStorage.getItem(reloadKey) !== "1") {
          sessionStorage.setItem(reloadKey, "1");
          window.location.reload();
          return new Promise<never>(() => {});
        }
      }

      throw error;
    }
  });
}

const lazy = lazyWithRecovery;

const Landing = lazy(() => import("./pages/Landing"));
const Features = lazy(() => import("./pages/Features"));
const HowItWorks = lazy(() => import("./pages/HowItWorks"));
const Pricing = lazy(() => import("./pages/Pricing"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const TermsOfService = lazy(() => import("./pages/TermsOfService"));
const Security = lazy(() => import("./pages/Security"));
const Index = lazy(() => import("./pages/Index"));
const Employees = lazy(() => import("./pages/Employees"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Leaves = lazy(() => import("./pages/Leaves"));
const Assets = lazy(() => import("./pages/Assets"));
const Payroll = lazy(() => import("./pages/Payroll"));
const Settings = lazy(() => import("./pages/Settings"));
const Profile = lazy(() => import("./pages/Profile"));
const Performance = lazy(() => import("./pages/Performance"));
const Attendance = lazy(() => import("./pages/Attendance"));
const AttendanceRegularization = lazy(() => import("./pages/AttendanceRegularization"));
const BulkUploadHub = lazy(() => import("./pages/BulkUploadHub"));
const Departments = lazy(() => import("./pages/Departments"));
const CompanyCalendar = lazy(() => import("./pages/CompanyCalendar"));
const NotificationPreferences = lazy(() => import("./pages/NotificationPreferences"));
const Notifications = lazy(() => import("./pages/Notifications"));
const Changelog = lazy(() => import("./pages/Changelog"));
const ModuleLauncher = lazy(() => import("./pages/ModuleLauncher"));

// ATS Onboarding
const CandidateOnboardingPage       = lazy(() => import("./pages/CandidateOnboardingPage"));
const CandidateOnboardingFullPage   = lazy(() => import("./pages/CandidateOnboardingFullPage"));
const CandidateOnboardingV2         = lazy(() => import("./pages/CandidateOnboardingV2"));
const NativeHROnboardingRequests    = lazy(() => import("./pages/NativeHROnboardingRequests"));
const NativeBranchHeadApproval      = lazy(() => import("./pages/NativeBranchHeadApproval"));
const NativeBGVVerificationCenter   = lazy(() => import("./pages/NativeBGVVerificationCenter"));
const NativePayrollHRValidation     = lazy(() => import("./pages/NativePayrollHRValidation"));
const NativePayrollHOQueues         = lazy(() => import("./pages/NativePayrollHOQueues"));
const NativeChequeNameValidation    = lazy(() => import("./pages/NativeChequeNameValidation"));
const NativeSalaryPackageAdmin      = lazy(() => import("./pages/NativeSalaryPackageAdmin"));
const NativeGRNManagement           = lazy(() => import("./pages/NativeGRNManagement"));
const NativeJoiningControlRoom      = lazy(() => import("./pages/NativeJoiningControlRoom"));

const NativeATSDashboardReplica = lazy(() => import("./pages/NativeATSDashboardReplica"));
const NativeATSCandidateRegistration = lazy(() => import("./pages/NativeATSCandidateRegistration"));
const NativeATSRegistrationEnhanced = lazy(() => import("./pages/NativeATSRegistrationEnhanced"));
const NativeATSOnboardingBridge = lazy(() => import("./pages/NativeATSOnboardingBridge"));
const NativeATSWaitingQueue = lazy(() => import("./pages/NativeATSWaitingQueue"));
const NativeATSCandidateMaster = lazy(() => import("./pages/NativeATSCandidateMaster"));
const NativeATSRecruiterWorkspace = lazy(() => import("./pages/NativeATSRecruiterWorkspace"));
const NativeATSDashboardV2 = lazy(() => import("./pages/NativeATSDashboardV2"));
const NativeATSHiringEntry = lazy(() => import("./pages/NativeATSHiringEntry"));
const NativeATSHiringDashboard = lazy(() => import("./pages/NativeATSHiringDashboard"));
const NativeATSSourcingAnalysis = lazy(() => import("./pages/NativeATSSourcingAnalysis"));
const NativeATSExtensions = lazy(() => import("./pages/NativeATSExtensions"));
const NativeATSFormConfig = lazy(() => import("./pages/NativeATSFormConfig"));
const NativeATSFullParityCommandCenter = lazy(() => import("./pages/NativeATSFullParityCommandCenter"));
const NativeRecruiterPortal = lazy(() => import("./pages/NativeRecruiterPortal"));

const CandidatePortalLogin = lazy(() => import("./pages/CandidatePortalLogin"));
const BranchHeadApproval = lazy(() => import("./pages/BranchHeadApproval"));
const SuperAdminModuleAccess = lazy(() => import("./pages/SuperAdminModuleAccess"));
const ATSCommandCentre = lazy(() => import("./pages/ATSCommandCentre"));
const NativeBGVEnhanced = lazy(() => import("./pages/NativeBGVEnhanced"));
const NativeBGVReport = lazy(() => import("./pages/NativeBGVReport"));
const NativeBGVReportView = lazy(() => import("./pages/NativeBGVReportView"));
const NativeBGVAPIMonitor = lazy(() => import("./pages/NativeBGVAPIMonitor"));
const NativeEmployeeBGVStatus = lazy(() => import("./pages/NativeEmployeeBGVStatus"));

const NativeLMSMyLearning = lazy(() => import("./pages/NativeLMSMyLearning"));
const NativeLMSCoordinator = lazy(() => import("./pages/NativeLMSCoordinator"));
const LMSIntegrationAdmin = lazy(() => import("./pages/LMSIntegrationAdmin"));
const NativePlaceholderPage = lazy(() => import("./pages/NativePlaceholderPage"));
const NativeOperationsDashboard = lazy(() => import("./pages/NativeOperationsDashboard"));
const NativeQualityDashboard = lazy(() => import("./pages/NativeQualityDashboard"));
const NativeAgentPerformanceDashboard = lazy(() => import("./pages/NativeAgentPerformanceDashboard"));
const NativeLMSIntegration = lazy(() => import("./pages/NativeLMSIntegration"));
const NativeAppointmentEsign = lazy(() => import("./pages/NativeAppointmentEsign"));
const NativeMyResignation = lazy(() => import("./pages/NativeMyResignation"));

const NativeWFMRoster = lazy(() => import("./pages/NativeWFMRoster"));
const NativeWFMExtensions = lazy(() => import("./pages/NativeWFMExtensions"));
const NativeWFMManagerApproval = lazy(() => import("./pages/NativeWFMManagerApproval"));
const NativeBusinessCommandCenter = lazy(() => import("./pages/NativeBusinessCommandCenter"));
const NativeBusinessActionQueue = lazy(() => import("./pages/NativeBusinessActionQueue"));

const UnifiedPerformanceCommandCenter = lazy(() => import("./pages/UnifiedPerformanceCommandCenter"));
const UnifiedAccessControl = lazy(() => import("./pages/UnifiedAccessControl"));
const SuperAdminAccessControl = lazy(() => import("./pages/SuperAdminAccessControl"));
const NativeManagementDashboard = lazy(() => import("./pages/NativeManagementDashboard"));
const NativeCallMasterDashboard = lazy(() => import("./pages/NativeCallMasterDashboard"));
const NativeInboundDashboard = lazy(() => import("./pages/NativeInboundDashboard"));
const NativeSalesDashboard = lazy(() => import("./pages/NativeSalesDashboard"));
const ExecutiveQualityDashboard = lazy(() => import("./pages/ExecutiveQualityDashboard"));
const ManagerQualityDashboard = lazy(() => import("./pages/ManagerQualityDashboard"));
const AgentQualityDashboard = lazy(() => import("./pages/AgentQualityDashboard"));
const NativeSecurityCenter = lazy(() => import("./pages/NativeSecurityCenter"));

const NativePerformanceFeedbackMyReports = lazy(() => import("./pages/NativePerformanceFeedbackMyReports"));
const NativePerformanceFeedbackReportDetail = lazy(() => import("./pages/NativePerformanceFeedbackReportDetail"));
const NativePerformanceFeedbackDevelopmentPlan = lazy(() => import("./pages/NativePerformanceFeedbackDevelopmentPlan"));
const NativePerformanceFeedbackAssignments = lazy(() => import("./pages/NativePerformanceFeedbackAssignments"));
const NativePerformanceFeedbackForm = lazy(() => import("./pages/NativePerformanceFeedbackForm"));
const NativePerformanceFeedbackTeamReports = lazy(() => import("./pages/NativePerformanceFeedbackTeamReports"));

// People
const NativeOrgChart                = lazy(() => import("./pages/NativeOrgChart"));
const OrgChartSettings              = lazy(() => import("./pages/OrgChartSettings"));
const NativeEmployeeStatCard        = lazy(() => import("./pages/NativeEmployeeStatCard"));
const NativeEmployee360             = lazy(() => import("./pages/NativeEmployee360"));
const EmployeeJoiningDocumentsPage  = lazy(() => import("./pages/EmployeeJoiningDocumentsPage"));
const JoiningDocumentsTrackerPage   = lazy(() => import("./pages/JoiningDocumentsTrackerPage"));
const JoiningDocumentTemplateAdmin  = lazy(() => import("./pages/JoiningDocumentTemplateAdmin"));
const ATSBulkImportPage             = lazy(() => import("./pages/ATSBulkImportPage"));
const EmployeeEpfCompliancePage     = lazy(() => import("./pages/EmployeeEpfCompliancePage"));
const PayrollEpfCompliancePage      = lazy(() => import("./pages/PayrollEpfCompliancePage"));
const PfCreationQueuePage           = lazy(() => import("./pages/payroll/PfCreationQueuePage"));
const PfBatchesPage                 = lazy(() => import("./pages/payroll/PfBatchesPage"));
const EmployeeDocumentEsignReviewPage = lazy(() => import("./pages/EmployeeDocumentEsignReviewPage"));
const EmployeeEpfComplianceReviewPage = lazy(() => import("./pages/EmployeeEpfComplianceReviewPage"));
const NativePeopleExperienceCommandCenter = lazy(() => import("./pages/NativePeopleExperienceCommandCenter"));

// Engagement
const NativeEngagement                = lazy(() => import("./pages/NativeEngagement"));
const NativeBadges                    = lazy(() => import("./pages/NativeBadges"));
const NativeKudos                     = lazy(() => import("./pages/NativeKudos"));
const NativeSurveys                   = lazy(() => import("./pages/NativeSurveys"));
const NativeLeaderboard               = lazy(() => import("./pages/NativeLeaderboard"));
// Exit
const NativeExitCommandCenter         = lazy(() => import("./pages/NativeExitCommandCenter"));
const NativeEmployeeReactivation      = lazy(() => import("./pages/NativeEmployeeReactivation"));

// Offer Letters & Master Reports
const NativeOfferLetterGeneration   = lazy(() => import("./pages/NativeOfferLetterGeneration"));
const NativeReportsCenter           = lazy(() => import("./pages/NativeReportsCenter"));

// HR Ops
const NativeAssetsManager           = lazy(() => import("./pages/NativeAssetsManager"));
const PublicEmployeeVerify          = lazy(() => import("./pages/PublicEmployeeVerify").then(m => ({ default: m.PublicEmployeeVerify })));
const PublicPayslipVerify           = lazy(() => import("./pages/PublicEmployeeVerify").then(m => ({ default: m.PublicPayslipVerify })));
const NativeHelpdesk                = lazy(() => import("./pages/NativeHelpdesk"));
const NativeSupportCommandCenter    = lazy(() => import("./pages/NativeSupportCommandCenter"));
const NativeGrievanceCommandCenter  = lazy(() => import("./pages/NativeGrievanceCommandCenter"));
const NativeLetters                 = lazy(() => import("./pages/NativeLetters"));
const NativeLetterPreview           = lazy(() => import("./pages/NativeLetterPreview"));
const NativeLifecycle               = lazy(() => import("./pages/NativeLifecycle"));
const NativeEmployeeLifecycle       = lazy(() => import("./pages/NativeEmployeeLifecycle"));
const NativeOrgMasters              = lazy(() => import("./pages/NativeOrgMasters"));
const NativeWorkflowAdmin           = lazy(() => import("./pages/NativeWorkflowAdmin"));
const NativeBenefitsClaims          = lazy(() => import("./pages/NativeBenefitsClaims"));
const NativeCareerPlanning          = lazy(() => import("./pages/NativeCareerPlanning"));
const NativeERP                     = lazy(() => import("./pages/NativeERP"));
const NativeVendorPaymentTracking   = lazy(() => import("./pages/NativeVendorPaymentTracking"));
const NativeWorkInbox               = lazy(() => import("./pages/NativeWorkInbox"));
const NativeMobilityManagement      = lazy(() => import("./pages/NativeMobilityManagement"));
const NativeSalaryIncrement         = lazy(() => import("./pages/NativeSalaryIncrement"));
const NativeStatutoryCompliance     = lazy(() => import("./pages/NativeStatutoryCompliance"));
const NativeLabourCompliance        = lazy(() => import("./pages/NativeLabourCompliance"));
const NativeComplianceAuditReport   = lazy(() => import("./pages/NativeComplianceAuditReport"));
const NativeDPDPCompliance          = lazy(() => import("./pages/NativeDPDPCompliance"));
const NativeDPDPWithdrawal          = lazy(() => import("./pages/NativeDPDPWithdrawal"));
const NativeDPDPWithdrawalAdmin     = lazy(() => import("./pages/NativeDPDPWithdrawalAdmin"));
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
const PayrollOvertimeManagement     = lazy(() => import("./pages/PayrollOvertimeManagement"));
const PayrollConfigFlags            = lazy(() => import("./pages/payroll/PayrollConfigFlags"));
const RecalculationQueue            = lazy(() => import("./pages/payroll/RecalculationQueue"));
const RunningPayrollBreakdown       = lazy(() => import("./pages/payroll/RunningPayrollBreakdown"));
const HolidayMaster                 = lazy(() => import("./pages/payroll/HolidayMaster"));
const DisbursalManagement           = lazy(() => import("./pages/payroll/DisbursalManagement"));
const HolidayWorkRequest            = lazy(() => import("./pages/payroll/HolidayWorkRequest"));
const HolidayWorkApprovals          = lazy(() => import("./pages/payroll/HolidayWorkApprovals"));
const PayrollValidationScreen       = lazy(() => import("./pages/payroll/PayrollValidationScreen"));
const NocManagement                 = lazy(() => import("./pages/payroll/NocManagement"));
const BranchPayrollReadiness        = lazy(() => import("./pages/payroll/BranchPayrollReadiness"));
const PayrollCalendar               = lazy(() => import("./pages/payroll/PayrollCalendar"));
const PayrollCostSummary            = lazy(() => import("./pages/payroll/PayrollCostSummary"));
const StatutoryFilingTracker        = lazy(() => import("./pages/payroll/StatutoryFilingTracker"));
const PayrollAuditTrail             = lazy(() => import("./pages/payroll/PayrollAuditTrail"));
const PayrollVarianceReport         = lazy(() => import("./pages/payroll/PayrollVarianceReport"));
const BulkOutputs                   = lazy(() => import("./pages/payroll/BulkOutputs"));
const LoanManagement                = lazy(() => import("./pages/payroll/LoanManagement"));
const PayrollSignOff                = lazy(() => import("./pages/payroll/PayrollSignOff"));
const SalaryCertificate             = lazy(() => import("./pages/payroll/SalaryCertificate"));
const ReimbursementManagement       = lazy(() => import("./pages/payroll/ReimbursementManagement"));
const WeekoffFairness               = lazy(() => import("./pages/wfm/WeekoffFairness"));

// Communication
const NativeTemplateManager             = lazy(() => import("./pages/NativeTemplateManager"));
const NativeEmailTemplateBulkImport     = lazy(() => import("./pages/NativeEmailTemplateBulkImport"));
const NativeDispatchCenter          = lazy(() => import("./pages/NativeDispatchCenter"));
const NativeDispatchHistory         = lazy(() => import("./pages/NativeDispatchHistory"));
const NativeNotificationPreferences = lazy(() => import("./pages/NativeNotificationPreferences"));
const NativeCommunicationConfig     = lazy(() => import("./pages/NativeCommunicationConfig"));
const NativeCallCentreConfig        = lazy(() => import("./pages/NativeCallCentreConfig"));
const NativeDocumentVerification    = lazy(() => import("./pages/NativeDocumentVerification"));
const NativeRosterPreference        = lazy(() => import("./pages/NativeRosterPreference"));

// Dashboards
const SuperAdminDashboardV2         = lazy(() => import("./pages/SuperAdminDashboardV2"));
const LMSProgressDashboard          = lazy(() => import("./pages/LMSProgressDashboard"));
const LMSModuleLaunch               = lazy(() => import("./pages/LMSModuleLaunch"));
const CandidatePortalDashboard      = lazy(() => import("./pages/CandidatePortalDashboard"));

// System
const NativeMigrationConsole        = lazy(() => import("./pages/NativeMigrationConsole"));
const NativeAuditLog                = lazy(() => import("./pages/NativeAuditLog"));
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
const NativeAttendanceDisputes      = lazy(() => import("./pages/NativeAttendanceDisputes"));
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
const NativeAttendanceMismatchQueue = lazy(() => import("./pages/NativeAttendanceMismatchQueue"));
const NativeAttendanceBillingConfig = lazy(() => import("./pages/NativeAttendanceBillingConfig"));
const AdminAttendanceView           = lazy(() => import("./pages/AdminAttendanceView"));

// AI & PeopleOS
const AIProviderSettings = lazy(() => import("./pages/AIProviderSettings"));
const PeopleOSCopilot = lazy(() => import("./pages/PeopleOSCopilot"));
const NativeCustomizationManager    = lazy(() => import("./pages/customization/NativeCustomizationManager"));
const NativeCustomizationRuleEditor = lazy(() => import("./pages/customization/NativeCustomizationRuleEditor"));
const EmployeeJourney = lazy(() => import("./pages/EmployeeJourney"));

// Role dashboards
const CeoDashboard          = lazy(() => import("./pages/dashboards/CeoDashboard"));
const PayrollHrDashboard    = lazy(() => import("./pages/dashboards/PayrollHrDashboard"));
const WfmDashboard          = lazy(() => import("./pages/dashboards/WfmDashboard"));
const HrDashboard           = lazy(() => import("./pages/dashboards/HrDashboard"));
const EmployeeSelfDashboard = lazy(() => import("./pages/dashboards/EmployeeSelfDashboard"));
const ManagerDashboard      = lazy(() => import("./pages/dashboards/ManagerDashboard"));
const MyTeamPage            = lazy(() => import("./pages/MyTeamPage"));

// Expenses
const MyExpenses = lazy(() => import("./pages/expenses/MyExpenses"));
const NewExpenseClaim = lazy(() => import("./pages/expenses/NewExpenseClaim"));
const ExpenseApprovals = lazy(() => import("./pages/expenses/ExpenseApprovals"));
const FinanceQueue = lazy(() => import("./pages/expenses/FinanceQueue"));
const ExpenseReports = lazy(() => import("./pages/expenses/ExpenseReports"));

const PortalLogin = lazy(() => import("./pages/portal/PortalLogin"));
const PortalOverview = lazy(() => import("./pages/portal/PortalOverview"));
const PortalProcessDashboard = lazy(() => import("./pages/portal/PortalProcessDashboard"));
const BreakDesk = lazy(() => import("./pages/BreakDesk"));
const BreakDeskDevices = lazy(() => import("./pages/BreakDeskDevices"));
const WaitingRoomDisplay = lazy(() => import("./pages/WaitingRoomDisplay"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,          // 30 s — avoids refetch on every window focus
      gcTime: 5 * 60_000,         // 5 min cache retention after unmount
      refetchOnWindowFocus: false, // prevent refetch storms on tab switch
      retry: 1,
    },
  },
});
const Gate = ({ pageCode, children }: { pageCode: string; children: React.ReactNode }) => <WorkforcePageGate pageCode={pageCode}>{children}</WorkforcePageGate>;
const PageLoader = () => <div className="flex h-screen items-center justify-center bg-slate-50"><div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800" /></div>;

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <ScrollToTop />
          <ErrorBoundary>
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
              <Route path="/login" element={<Auth />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/change-password" element={<ProtectedRoute><ChangePassword /></ProtectedRoute>} />
              <Route path="/two-factor" element={<ProtectedRoute><TwoFactor /></ProtectedRoute>} />
              <Route path="/verify/emp/:employeeCode" element={<PublicEmployeeVerify />} />
              <Route path="/verify/payslip/:employeeCode/:monthYear" element={<PublicPayslipVerify />} />
              <Route path="/onboard" element={<CandidateOnboardingPage />} />
              <Route path="/interview-registration" element={<NativeATSCandidateRegistration />} />
              <Route path="/candidate-registration" element={<Navigate to="/interview-registration" replace />} />
              <Route path="/walkin-registration" element={<Navigate to="/interview-registration" replace />} />
              <Route path="/dashboard" element={<ProtectedRoute><Index /></ProtectedRoute>} />
              <Route path="/employees" element={<ProtectedRoute><Gate pageCode="EMPLOYEE_MANAGEMENT"><Employees /></Gate></ProtectedRoute>} />
              <Route path="/org-chart" element={<ProtectedRoute><Gate pageCode="ORG_CHART"><NativeOrgChart /></Gate></ProtectedRoute>} />
              <Route path="/org-chart/settings" element={<ProtectedRoute><OrgChartSettings /></ProtectedRoute>} />
              <Route path="/employees/:id/360" element={<ProtectedRoute><Gate pageCode="EMPLOYEE_MANAGEMENT"><NativeEmployee360 /></Gate></ProtectedRoute>} />
              <Route path="/employees/:id" element={<ProtectedRoute><Gate pageCode="EMPLOYEE_MANAGEMENT"><NativeEmployeeStatCard /></Gate></ProtectedRoute>} />
              <Route path="/employees/:employeeId/joining-documents" element={<ProtectedRoute roles={['admin', 'super_admin', 'hr', 'manager', 'payroll_hr', 'payroll', 'employee']}><EmployeeJoiningDocumentsPage /></ProtectedRoute>} />
              <Route path="/ats/joining-documents-tracker" element={<ProtectedRoute roles={['admin', 'super_admin', 'hr', 'payroll_hr', 'branch_head']}><Gate pageCode="ATS_JOINING_DOCUMENTS_TRACKER"><JoiningDocumentsTrackerPage /></Gate></ProtectedRoute>} />
              <Route path="/ats/bulk-import" element={<ProtectedRoute roles={['admin', 'super_admin']}><Gate pageCode="ATS_BULK_IMPORT"><ATSBulkImportPage /></Gate></ProtectedRoute>} />
              <Route path="/employees/:employeeId/epf-compliance" element={<ProtectedRoute roles={['admin', 'super_admin', 'hr', 'manager', 'payroll_hr', 'payroll', 'employee']}><EmployeeEpfCompliancePage /></ProtectedRoute>} />
              <Route path="/onboarding" element={<ProtectedRoute roles={['admin','hr']}><Onboarding /></ProtectedRoute>} />
              <Route path="/onboarding-requests" element={<Navigate to="/onboarding?tab=requests" replace />} />
              <Route path="/leaves" element={<ProtectedRoute><Leaves /></ProtectedRoute>} />
              <Route path="/leave-approvals" element={<Navigate to="/leaves" replace />} />
              <Route path="/assets" element={<ProtectedRoute><Assets /></ProtectedRoute>} />
              <Route path="/payroll" element={<ProtectedRoute><Gate pageCode="PAYROLL"><Payroll /></Gate></ProtectedRoute>} />
              <Route path="/reports" element={<ProtectedRoute><NativeReportsCenter /></ProtectedRoute>} />
              <Route path="/reports/enterprise" element={<Navigate to="/reports" replace />} />
              <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
              <Route path="/profile" element={<ProtectedRoute><Gate pageCode="MY_PROFILE"><Profile /></Gate></ProtectedRoute>} />
              <Route path="/employee-journey" element={<ProtectedRoute><EmployeeJourney /></ProtectedRoute>} />
              <Route path="/performance" element={<ProtectedRoute><Performance /></ProtectedRoute>} />
              <Route path="/reviews-management" element={<Navigate to="/dashboard" replace />} />
              <Route path="/attendance" element={<ProtectedRoute><Attendance /></ProtectedRoute>} />
              <Route path="/attendance-regularization" element={<ProtectedRoute><Gate pageCode="ATTENDANCE_REGULARIZATION"><AttendanceRegularization /></Gate></ProtectedRoute>} />
              <Route path="/attendance/regularizations" element={<ProtectedRoute><Gate pageCode="ATTENDANCE_REGULARIZATION"><AttendanceRegularization /></Gate></ProtectedRoute>} />
              <Route path="/bulk-upload" element={<ProtectedRoute roles={['admin','hr','super_admin','wfm','payroll','payroll_hr']}><BulkUploadHub /></ProtectedRoute>} />
              <Route path="/departments" element={<ProtectedRoute><Departments /></ProtectedRoute>} />
              <Route path="/calendar" element={<ProtectedRoute><CompanyCalendar /></ProtectedRoute>} />
              <Route path="/notification-preferences" element={<ProtectedRoute><NotificationPreferences /></ProtectedRoute>} />
              <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
              <Route path="/modules" element={<ProtectedRoute><ModuleLauncher /></ProtectedRoute>} />
              <Route path="/ats/dashboard" element={<ProtectedRoute><Gate pageCode="ATS_DASHBOARD"><NativeATSDashboardReplica /></Gate></ProtectedRoute>} />
              <Route path="/ats/candidate-registration" element={<NativeATSCandidateRegistration />} />
              <Route path="/ats/registration-enhanced" element={<ProtectedRoute><NativeATSRegistrationEnhanced /></ProtectedRoute>} />
              <Route path="/ats/recruiter/my-candidates" element={<ProtectedRoute><Gate pageCode="ATS_RECRUITER_QUEUE"><NativeATSRecruiterWorkspace /></Gate></ProtectedRoute>} />
              <Route path="/ats/recruiter/hiring-entry" element={<ProtectedRoute><Gate pageCode="ATS_RECRUITER_QUEUE"><NativeATSHiringEntry /></Gate></ProtectedRoute>} />
              <Route path="/ats/recruiter/calling-entry" element={<ProtectedRoute><Gate pageCode="ATS_RECRUITER_QUEUE"><NativeATSHiringEntry /></Gate></ProtectedRoute>} />
              <Route path="/ats/recruiter/hiring-dashboard" element={<ProtectedRoute><Gate pageCode="ATS_DASHBOARD"><NativeATSHiringDashboard /></Gate></ProtectedRoute>} />
              <Route path="/ats/recruiter/calling-dashboard" element={<ProtectedRoute><Gate pageCode="ATS_DASHBOARD"><NativeATSHiringDashboard /></Gate></ProtectedRoute>} />
              <Route path="/ats/onboarding-bridge" element={<ProtectedRoute><Gate pageCode="ATS_ONBOARDING_BRIDGE"><NativeATSOnboardingBridge /></Gate></ProtectedRoute>} />
              <Route path="/ats/waiting-queue" element={<ProtectedRoute><Gate pageCode="ATS_WAITING_QUEUE"><NativeATSWaitingQueue /></Gate></ProtectedRoute>} />
              <Route path="/ats/candidate-master" element={<ProtectedRoute><Gate pageCode="ATS_CANDIDATE_MASTER"><NativeATSCandidateMaster /></Gate></ProtectedRoute>} />
              <Route path="/ats/recruiter/workspace" element={<ProtectedRoute><Gate pageCode="ATS_RECRUITER_WORKSPACE"><NativeATSRecruiterWorkspace /></Gate></ProtectedRoute>} />
              <Route path="/ats/dashboard-v2" element={<ProtectedRoute><Gate pageCode="ATS_DASHBOARD"><NativeATSDashboardV2 /></Gate></ProtectedRoute>} />
              <Route path="/ats/sourcing-analysis" element={<ProtectedRoute><Gate pageCode="ATS_DASHBOARD"><NativeATSSourcingAnalysis /></Gate></ProtectedRoute>} />
              <Route path="/ats/extensions" element={<ProtectedRoute><Gate pageCode="ATS_EXTENSIONS"><NativeATSExtensions /></Gate></ProtectedRoute>} />
              <Route path="/ats/form-config" element={<ProtectedRoute roles={['admin', 'hr', 'super_admin']}><NativeATSFormConfig /></ProtectedRoute>} />
              <Route path="/ats/command-center" element={<ProtectedRoute><Gate pageCode="ATS_DASHBOARD"><NativeATSFullParityCommandCenter /></Gate></ProtectedRoute>} />
              <Route path="/ats/onboarding-requests" element={<ProtectedRoute><Gate pageCode="ATS_ONBOARDING_BRIDGE"><NativeHROnboardingRequests /></Gate></ProtectedRoute>} />
              <Route path="/hr-onboarding-requests" element={<ProtectedRoute><Gate pageCode="ATS_ONBOARDING_BRIDGE"><NativeHROnboardingRequests /></Gate></ProtectedRoute>} />
              {/* CANONICAL: /ats/offer-approvals is the primary branch-head approval page, wired to the offer submission flow in NativeHROnboardingRequests */}
              <Route path="/ats/offer-approvals" element={<ProtectedRoute><Gate pageCode="ATS_OFFER_APPROVALS"><NativeBranchHeadApproval /></Gate></ProtectedRoute>} />
              {/* LEGACY: /ats/branch-head-approval uses a separate backend module (ats_branch_head_approval table). Keep alive while any pending approvals may exist there. */}
              <Route path="/ats/branch-head-approval" element={<ProtectedRoute><Gate pageCode="ATS_BRANCH_HEAD_APPROVAL"><BranchHeadApproval /></Gate></ProtectedRoute>} />
              <Route path="/ats/payroll-hr" element={<ProtectedRoute roles={['admin', 'hr', 'payroll_hr']}><Gate pageCode="ATS_PAYROLL_HR"><NativePayrollHRValidation /></Gate></ProtectedRoute>} />
              <Route path="/ats/payroll-hr-validation" element={<ProtectedRoute><Gate pageCode="ATS_PAYROLL_HR"><NativePayrollHRValidation /></Gate></ProtectedRoute>} />
              <Route path="/ats/joining-control-room" element={<ProtectedRoute roles={['admin', 'hr', 'payroll_hr', 'super_admin']}><Gate pageCode="ATS_JOINING_CONTROL_ROOM"><NativeJoiningControlRoom /></Gate></ProtectedRoute>} />
              {/* CANONICAL: /onboard-full is the active 10-step onboarding form. All new send-token links use this route. */}
              <Route path="/onboard-full" element={<CandidateOnboardingFullPage />} />
              <Route path="/candidate-onboarding-full" element={<CandidateOnboardingFullPage />} />
              {/* DEPRECATED: /onboard-full-legacy (CandidateOnboardingV2). Kept for existing tokens. Do not generate new links to this route. */}
              <Route path="/onboard-full-legacy" element={<CandidateOnboardingV2 />} />
              <Route path="/onboard-v1" element={<CandidateOnboardingFullPage />} />
              <Route path="/ats/bgv" element={<ProtectedRoute><Gate pageCode="ATS_BGV"><NativeBGVVerificationCenter /></Gate></ProtectedRoute>} />
              <Route path="/ats/bgv-enhanced" element={<ProtectedRoute roles={['admin', 'hr']}><NativeBGVEnhanced /></ProtectedRoute>} />
              <Route path="/ats/bgv-report" element={<ProtectedRoute><Gate pageCode="ATS_BGV_REPORT"><NativeBGVReport /></Gate></ProtectedRoute>} />
              <Route path="/bgv-report-view/:candidateId" element={<ProtectedRoute roles={['admin','hr']}><NativeBGVReportView /></ProtectedRoute>} />
              <Route path="/ats/bgv-api-monitor" element={<ProtectedRoute roles={['admin','hr','super_admin']}><NativeBGVAPIMonitor /></ProtectedRoute>} />
              {/* Employee Reactivation */}
              <Route path="/employees/reactivation" element={<ProtectedRoute roles={['hr','admin','super_admin','branch_head','payroll_head']}><NativeEmployeeReactivation /></ProtectedRoute>} />
              {/* Employee self-view BGV status */}
              <Route path="/employees/bgv-status" element={<ProtectedRoute><NativeEmployeeBGVStatus /></ProtectedRoute>} />
              {/* HR/Payroll lookup by employee ID */}
              <Route path="/employees/bgv-status/:employeeId" element={<ProtectedRoute roles={['admin','hr','payroll','super_admin']}><NativeEmployeeBGVStatus /></ProtectedRoute>} />
              <Route path="/ats/recruiter-portal" element={<ProtectedRoute><Gate pageCode="ATS_RECRUITER_PORTAL"><NativeRecruiterPortal /></Gate></ProtectedRoute>} />
              <Route path="/ats/walkin-queue" element={<ProtectedRoute><Gate pageCode="ATS_WALKIN_QUEUE"><NativeWalkinQueue /></Gate></ProtectedRoute>} />
              <Route path="/candidate-portal/login" element={<CandidatePortalLogin />} />
              <Route path="/candidate-portal/dashboard" element={<CandidatePortalDashboard />} />
              <Route path="/super-admin/module-access" element={<ProtectedRoute roles={['admin']}><SuperAdminModuleAccess /></ProtectedRoute>} />
              <Route path="/super-admin/dashboard" element={<ProtectedRoute roles={['admin']}><SuperAdminDashboardV2 /></ProtectedRoute>} />
              <Route path="/ats/command-centre" element={<ProtectedRoute roles={['admin', 'manager', 'hr', 'recruiter', 'recruitment_hr']}><ATSCommandCentre /></ProtectedRoute>} />
              <Route path="/provisioning/wfm-alignment" element={<ProtectedRoute roles={['wfm', 'admin', 'super_admin']}><Gate pageCode="PROVISIONING_WFM_ALIGNMENT"><NativeITProvisioningTracker /></Gate></ProtectedRoute>} />
              <Route path="/provisioning/it" element={<ProtectedRoute roles={['it', 'admin', 'super_admin']}><Gate pageCode="PROVISIONING_IT"><NativeITProvisioningTracker /></Gate></ProtectedRoute>} />
              <Route path="/provisioning/admin" element={<ProtectedRoute roles={['branch_admin', 'hr', 'admin', 'super_admin']}><Gate pageCode="PROVISIONING_ADMIN"><NativeITProvisioningTracker /></Gate></ProtectedRoute>} />
              <Route path="/provisioning/appointment-letter" element={<ProtectedRoute roles={['hr', 'admin', 'super_admin']}><Gate pageCode="PROVISIONING_APPOINTMENT_LETTER"><NativeITProvisioningTracker /></Gate></ProtectedRoute>} />

              {/* LMS */}
              <Route path="/lms" element={<Navigate to="/lms/my-learning" replace />} />
              <Route path="/lms/my-learning" element={<ProtectedRoute><Gate pageCode="LMS_MY_LEARNING"><NativeLMSMyLearning /></Gate></ProtectedRoute>} />
              <Route path="/lms/coordinator" element={<ProtectedRoute><Gate pageCode="LMS_COORDINATOR"><NativeLMSCoordinator /></Gate></ProtectedRoute>} />
              <Route path="/lms/admin" element={<ProtectedRoute><Gate pageCode="LMS_ADMIN"><LMSIntegrationAdmin /></Gate></ProtectedRoute>} />
              <Route path="/lms/management-dashboard" element={<Navigate to="/lms/admin" replace />} />
              <Route path="/lms/integration" element={<ProtectedRoute><Gate pageCode="LMS_INTEGRATION"><NativeLMSIntegration /></Gate></ProtectedRoute>} />
              <Route path="/lms/progress-dashboard" element={<ProtectedRoute><Gate pageCode="LMS_PROGRESS_DASHBOARD"><LMSProgressDashboard /></Gate></ProtectedRoute>} />
              <Route path="/lms/module-launch" element={<ProtectedRoute><Gate pageCode="LMS_MODULE_LAUNCH"><LMSModuleLaunch /></Gate></ProtectedRoute>} />

              {/* WFM */}
              <Route path="/wfm/roster" element={<ProtectedRoute><Gate pageCode="WFM_ROSTER"><NativeWFMRoster /></Gate></ProtectedRoute>} />
              <Route path="/wfm-roster" element={<Navigate to="/wfm/roster" replace />} />
              <Route path="/wfm/live-tracker" element={<ProtectedRoute><Gate pageCode="WFM_LIVE_TRACKER"><NativeBiometricCommandCenter /></Gate></ProtectedRoute>} />
              <Route path="/wfm/adherence-command-center" element={<ProtectedRoute><Gate pageCode="WFM_LIVE_TRACKER"><NativeBiometricCommandCenter /></Gate></ProtectedRoute>} />
              <Route path="/wfm/agent-attendance-view" element={<ProtectedRoute><Gate pageCode="WFM_LIVE_TRACKER"><NativeBiometricCommandCenter /></Gate></ProtectedRoute>} />
              <Route path="/wfm/attendance-exceptions" element={<ProtectedRoute><Gate pageCode="WFM_LIVE_TRACKER"><NativeAttendanceExceptionEngine /></Gate></ProtectedRoute>} />
              <Route path="/wfm/cosec-monitoring" element={<ProtectedRoute><Gate pageCode="WFM_LIVE_TRACKER"><NativeCosecSyncMonitoring /></Gate></ProtectedRoute>} />
              <Route path="/wfm/extensions" element={<ProtectedRoute><Gate pageCode="WFM_EXTENSIONS"><NativeWFMExtensions /></Gate></ProtectedRoute>} />
              <Route path="/wfm-manager-approvals" element={<ProtectedRoute><Gate pageCode="WFM_ROSTER"><NativeWFMManagerApproval /></Gate></ProtectedRoute>} />
              <Route path="/roster-preference" element={<ProtectedRoute><Gate pageCode="WFM_ROSTER"><NativeRosterPreference /></Gate></ProtectedRoute>} />
              <Route path="/wfm/weekoff-day-rules" element={<ProtectedRoute roles={['super_admin','admin','wfm']}><NativeWeekOffDayRuleConfig /></ProtectedRoute>} />
              <Route path="/wfm/planning-rules" element={<ProtectedRoute roles={['super_admin','admin','wfm']}><NativeWFMPlanningRules /></ProtectedRoute>} />
              <Route path="/wfm/slot-requirements" element={<ProtectedRoute roles={['super_admin','admin','wfm']}><NativeSlotRequirementBuilder /></ProtectedRoute>} />
              <Route path="/attendance/disputes" element={<ProtectedRoute><NativeAttendanceDisputes /></ProtectedRoute>} />
              <Route path="/business-command-center" element={<ProtectedRoute roles={['super_admin','admin','branch_head','operations_manager']}><NativeBusinessCommandCenter /></ProtectedRoute>} />
              <Route path="/business-actions" element={<ProtectedRoute roles={['super_admin','admin','branch_head','operations_manager']}><NativeBusinessActionQueue /></ProtectedRoute>} />
              <Route path="/quality/dashboard" element={<ProtectedRoute><Gate pageCode="QUALITY_DASHBOARD"><NativeQualityDashboard /></Gate></ProtectedRoute>} />
              <Route path="/quality/executive" element={<ProtectedRoute roles={['super_admin','admin','ceo']}><ExecutiveQualityDashboard /></ProtectedRoute>} />
              <Route path="/quality/team" element={<ProtectedRoute roles={['super_admin','admin','manager','process_manager','branch_head','team_leader']}><ManagerQualityDashboard /></ProtectedRoute>} />
              <Route path="/quality/my-dashboard" element={<ProtectedRoute><AgentQualityDashboard /></ProtectedRoute>} />
              <Route path="/quality/audit" element={<ProtectedRoute><Gate pageCode="QUALITY_DASHBOARD"><NativeQualityDashboard /></Gate></ProtectedRoute>} />
              <Route path="/agent-performance" element={<ProtectedRoute><NativeAgentPerformanceDashboard /></ProtectedRoute>} />
              <Route path="/call-master" element={<ProtectedRoute roles={['super_admin','admin','ceo','manager','process_manager','operations_manager','qa','quality_analyst']}><NativeCallMasterDashboard /></ProtectedRoute>} />
              <Route path="/call-master/inbound" element={<ProtectedRoute roles={['super_admin','admin','ceo','manager','process_manager','operations_manager','qa','quality_analyst']}><NativeInboundDashboard /></ProtectedRoute>} />
              <Route path="/call-master/inbound/:projectKey" element={<ProtectedRoute roles={['super_admin','admin','ceo','manager','process_manager','operations_manager','qa','quality_analyst']}><NativeInboundDashboard /></ProtectedRoute>} />
              <Route path="/sales/brand-analytics" element={<ProtectedRoute roles={['super_admin','admin','ceo','manager','process_manager','operations_manager']}><NativeSalesDashboard /></ProtectedRoute>} />
              <Route path="/operations/dashboard" element={<ProtectedRoute><Gate pageCode="OPERATIONS_DASHBOARD"><NativeOperationsDashboard /></Gate></ProtectedRoute>} />
              <Route path="/performance/command-center" element={<ProtectedRoute><Gate pageCode="WORKFORCE_COMMAND_CENTER"><UnifiedPerformanceCommandCenter /></Gate></ProtectedRoute>} />
              <Route path="/settings/access-control" element={<ProtectedRoute><Gate pageCode="ACCESS_CONTROL"><UnifiedAccessControl /></Gate></ProtectedRoute>} />
              <Route path="/security-center" element={<ProtectedRoute roles={['admin', 'ceo', 'coo', 'hr']}><NativeSecurityCenter /></ProtectedRoute>} />
              <Route path="/super-admin/page-access" element={<ProtectedRoute roles={['admin']}><SuperAdminAccessControl /></ProtectedRoute>} />
              <Route path="/it-provisioning" element={<ProtectedRoute><Gate pageCode="IT_PROVISIONING_TRACKER"><NativeITProvisioningTracker /></Gate></ProtectedRoute>} />
              <Route path="/settings/call-centre-config" element={<ProtectedRoute roles={['admin']}><NativeCallCentreConfig /></ProtectedRoute>} />
              <Route path="/performance-feedback/my-reports" element={<ProtectedRoute><NativePerformanceFeedbackMyReports /></ProtectedRoute>} />
              <Route path="/performance-feedback/reports/:id" element={<ProtectedRoute><NativePerformanceFeedbackReportDetail /></ProtectedRoute>} />
              <Route path="/performance-feedback/development-plan" element={<ProtectedRoute><NativePerformanceFeedbackDevelopmentPlan /></ProtectedRoute>} />
              <Route path="/performance-feedback/assignments" element={<ProtectedRoute><NativePerformanceFeedbackAssignments /></ProtectedRoute>} />
              <Route path="/performance-feedback/form/:id" element={<ProtectedRoute><NativePerformanceFeedbackForm /></ProtectedRoute>} />
              <Route path="/performance-feedback/team-reports" element={<ProtectedRoute><NativePerformanceFeedbackTeamReports /></ProtectedRoute>} />
              <Route path="/engagement" element={<ProtectedRoute><NativeEngagement /></ProtectedRoute>} />
              <Route path="/engagement/badges" element={<ProtectedRoute><NativeBadges /></ProtectedRoute>} />
              <Route path="/engagement/kudos" element={<ProtectedRoute><NativeKudos /></ProtectedRoute>} />
              <Route path="/engagement/surveys" element={<ProtectedRoute><NativeSurveys /></ProtectedRoute>} />
              <Route path="/engagement/leaderboard" element={<ProtectedRoute><NativeLeaderboard /></ProtectedRoute>} />
              <Route path="/people-experience/command-center" element={<ProtectedRoute roles={['admin', 'hr', 'ceo', 'coo', 'manager', 'process_manager', 'team_leader', 'tl', 'branch_head', 'employee']}><NativePeopleExperienceCommandCenter /></ProtectedRoute>} />
              <Route path="/engagement/command-center" element={<Navigate to="/people-experience/command-center" replace />} />
              <Route path="/employee-stat-card" element={<ProtectedRoute><NativeEmployeeStatCard /></ProtectedRoute>} />
              <Route path="/employee-stat-card/:id" element={<ProtectedRoute><NativeEmployeeStatCard /></ProtectedRoute>} />
              <Route path="/portal/login" element={<PortalLogin />} />
              <Route path="/portal" element={<PortalRoute><PortalOverview /></PortalRoute>} />
              <Route path="/portal/processes/:id" element={<PortalRoute><PortalProcessDashboard /></PortalRoute>} />
              <Route path="/offer-letter" element={<ProtectedRoute><Gate pageCode="ATS_OFFER"><NativeOfferLetterGeneration /></Gate></ProtectedRoute>} />
              <Route path="/master-reports" element={<Navigate to="/reports" replace />} />
              <Route path="/document-verification" element={<ProtectedRoute><Gate pageCode="EMPLOYEE_MANAGEMENT"><NativeDocumentVerification /></Gate></ProtectedRoute>} />
              <Route path="/assets-manager" element={<ProtectedRoute><Gate pageCode="ASSETS_MANAGER"><NativeAssetsManager /></Gate></ProtectedRoute>} />
              <Route path="/helpdesk" element={<ProtectedRoute><Gate pageCode="HELPDESK"><NativeHelpdesk /></Gate></ProtectedRoute>} />
              <Route path="/support/command-center" element={<ProtectedRoute><Gate pageCode="SUPPORT_COMMAND_CENTER"><NativeSupportCommandCenter /></Gate></ProtectedRoute>} />
              <Route path="/support/grievance-command-center" element={<ProtectedRoute><Gate pageCode="GRIEVANCE_COMMAND_CENTER"><NativeGrievanceCommandCenter /></Gate></ProtectedRoute>} />
              <Route path="/letters" element={<ProtectedRoute><Gate pageCode="LETTERS"><NativeLetters /></Gate></ProtectedRoute>} />
              <Route path="/letters/:id/preview" element={<ProtectedRoute><NativeLetterPreview /></ProtectedRoute>} />
              <Route path="/maternity-leave" element={<ProtectedRoute roles={['admin', 'hr']}><NativeMaternityLeave /></ProtectedRoute>} />
              <Route path="/employee-lifecycle" element={<ProtectedRoute><Gate pageCode="EMPLOYEE_LIFECYCLE"><NativeLifecycle /></Gate></ProtectedRoute>} />
              <Route path="/employee-lifecycle-v2" element={<ProtectedRoute><Gate pageCode="EMPLOYEE_LIFECYCLE"><NativeEmployeeLifecycle /></Gate></ProtectedRoute>} />
              <Route path="/org-masters" element={<ProtectedRoute><Gate pageCode="ORG_MASTERS"><NativeOrgMasters /></Gate></ProtectedRoute>} />
              <Route path="/org-masters/locations-policies" element={<ProtectedRoute><Gate pageCode="ORG_MASTERS"><NativeLocationPolicyMasters /></Gate></ProtectedRoute>} />
              <Route path="/workflow-admin" element={<ProtectedRoute><Gate pageCode="WORKFLOW_ADMIN"><NativeWorkflowAdmin /></Gate></ProtectedRoute>} />
              <Route path="/management/dashboard" element={<ProtectedRoute><Gate pageCode="MANAGEMENT_DASHBOARD"><NativeManagementDashboard /></Gate></ProtectedRoute>} />
              <Route path="/management/ceo-command-center" element={<Navigate to="/dashboard" replace />} />
              <Route path="/benefits" element={<ProtectedRoute><Gate pageCode="BENEFITS"><NativeBenefitsClaims /></Gate></ProtectedRoute>} />
              <Route path="/career-planning" element={<ProtectedRoute><Gate pageCode="CAREER_PLANNING"><NativeCareerPlanning /></Gate></ProtectedRoute>} />
              <Route path="/pip-management" element={<Navigate to="/dashboard" replace />} />
              <Route path="/erp" element={<ProtectedRoute><Gate pageCode="ERP"><NativeERP /></Gate></ProtectedRoute>} />
              <Route path="/finance/vendor-payment-tracking" element={<ProtectedRoute><NativeVendorPaymentTracking /></ProtectedRoute>} />
              <Route path="/finance/grn" element={<ProtectedRoute><NativeGRNManagement /></ProtectedRoute>} />
              <Route path="/goals" element={<Navigate to="/dashboard" replace />} />
              <Route path="/work-inbox" element={<ProtectedRoute><Gate pageCode="WORK_INBOX"><NativeWorkInbox /></Gate></ProtectedRoute>} />
              <Route path="/settings/ai-providers" element={<ProtectedRoute roles={['super_admin']}><AIProviderSettings /></ProtectedRoute>} />
              <Route path="/peopleos/copilot" element={<ProtectedRoute><PeopleOSCopilot /></ProtectedRoute>} />
              <Route path="/mobility" element={<ProtectedRoute><Gate pageCode="MOBILITY"><NativeMobilityManagement /></Gate></ProtectedRoute>} />
              <Route path="/salary-increment" element={<ProtectedRoute><Gate pageCode="SALARY_INCREMENT"><NativeSalaryIncrement /></Gate></ProtectedRoute>} />
              <Route path="/jobs" element={<Navigate to="/dashboard" replace />} />
              <Route path="/advanced-reports" element={<Navigate to="/reports" replace />} />
              <Route path="/compliance/statutory" element={<ProtectedRoute><Gate pageCode="STATUTORY_COMPLIANCE"><NativeStatutoryCompliance /></Gate></ProtectedRoute>} />
              <Route path="/compliance/labour" element={<ProtectedRoute><Gate pageCode="LABOUR_COMPLIANCE"><NativeLabourCompliance /></Gate></ProtectedRoute>} />
              <Route path="/compliance/dpdp" element={<ProtectedRoute><Gate pageCode="DPDP_COMPLIANCE"><NativeDPDPCompliance /></Gate></ProtectedRoute>} />
              <Route path="/compliance/audit-report" element={<ProtectedRoute roles={["admin","hr","super_admin"]}><NativeComplianceAuditReport /></ProtectedRoute>} />
              <Route path="/integration-hub" element={<ProtectedRoute><Gate pageCode="INTEGRATION_HUB"><NativeIntegrationHub /></Gate></ProtectedRoute>} />
              <Route path="/client-master" element={<ProtectedRoute><Gate pageCode="CLIENT_MASTER"><EnhancedClientMaster /></Gate></ProtectedRoute>} />
              <Route path="/customization" element={<ProtectedRoute><Gate pageCode="CUSTOMIZATION_MANAGER"><NativeCustomizationManager /></Gate></ProtectedRoute>} />
              <Route path="/customization/new" element={<ProtectedRoute><Gate pageCode="CUSTOMIZATION_MANAGER"><NativeCustomizationRuleEditor /></Gate></ProtectedRoute>} />
              <Route path="/customization/:id/edit" element={<ProtectedRoute><Gate pageCode="CUSTOMIZATION_MANAGER"><NativeCustomizationRuleEditor /></Gate></ProtectedRoute>} />
              <Route path="/payroll/payslips" element={<ProtectedRoute><Gate pageCode="PAYROLL_PAYSLIPS"><NativePayslipCenter /></Gate></ProtectedRoute>} />
              <Route path="/payroll/readiness" element={<ProtectedRoute><Gate pageCode="PAYROLL"><NativePayrollReadiness /></Gate></ProtectedRoute>} />
              <Route path="/payroll/epf-compliance" element={<ProtectedRoute roles={['admin', 'super_admin', 'payroll_hr', 'payroll', 'hr', 'manager']}><PayrollEpfCompliancePage /></ProtectedRoute>} />
              <Route path="/payroll/pf-creation-queue" element={<ProtectedRoute roles={['admin', 'super_admin', 'payroll_hr', 'payroll']}><PfCreationQueuePage /></ProtectedRoute>} />
              <Route path="/payroll/pf-batches" element={<ProtectedRoute roles={['admin', 'super_admin', 'payroll_hr', 'payroll']}><PfBatchesPage /></ProtectedRoute>} />
              <Route path="/payroll/tax-declaration" element={<ProtectedRoute><Gate pageCode="TAX_DECLARATION"><NativeTaxDeclaration /></Gate></ProtectedRoute>} />
              <Route path="/payroll/full-final" element={<ProtectedRoute><Gate pageCode="FULL_FINAL"><NativeFullFinal /></Gate></ProtectedRoute>} />
              <Route path="/payroll/disbursal" element={<ProtectedRoute roles={['super_admin', 'payroll', 'finance']}><DisbursalManagement /></ProtectedRoute>} />
              <Route path="/payroll/statutory-config" element={<ProtectedRoute><Gate pageCode="STATUTORY_CONFIG"><NativeStatutoryConfig /></Gate></ProtectedRoute>} />
              <Route path="/payroll/masters" element={<ProtectedRoute><Gate pageCode="PAYROLL_MASTERS"><NativePayrollMasters /></Gate></ProtectedRoute>} />
              <Route path="/payroll/ho-queues" element={<ProtectedRoute><NativePayrollHOQueues /></ProtectedRoute>} />
              <Route path="/payroll/cheque-validation" element={<ProtectedRoute roles={['payroll','payroll_head','super_admin','finance']}><NativeChequeNameValidation /></ProtectedRoute>} />
              <Route path="/payroll/package-admin" element={<ProtectedRoute roles={['admin','super_admin','payroll']}><NativeSalaryPackageAdmin /></ProtectedRoute>} />
              <Route path="/payroll/salary-packages" element={<ProtectedRoute><Gate pageCode="SALARY_PACKAGES"><NativeSalaryPackages /></Gate></ProtectedRoute>} />
              <Route path="/payroll/incentives" element={<ProtectedRoute><Gate pageCode="PAYROLL_INCENTIVES"><NativeIncentives /></Gate></ProtectedRoute>} />
              <Route path="/payroll/overtime" element={<ProtectedRoute roles={['admin', 'super_admin', 'wfm', 'payroll', 'payroll_head']}><PayrollOvertimeManagement /></ProtectedRoute>} />
              <Route path="/payroll/config-flags" element={<ProtectedRoute roles={['super_admin','admin','payroll_head','payroll_branch']}><PayrollConfigFlags /></ProtectedRoute>} />
              <Route path="/payroll/recalculation-queue" element={<ProtectedRoute roles={['super_admin','admin','payroll_head','payroll_branch']}><RecalculationQueue /></ProtectedRoute>} />
              <Route path="/payroll/running-breakdown" element={<ProtectedRoute roles={['super_admin','admin','payroll_head','payroll_branch','wfm','employee']}><RunningPayrollBreakdown /></ProtectedRoute>} />
              <Route path="/payroll/holiday-master" element={<ProtectedRoute roles={['super_admin','admin','payroll_head','payroll_branch']}><HolidayMaster /></ProtectedRoute>} />
              <Route path="/payroll/holiday-work-requests" element={<ProtectedRoute roles={['super_admin','admin','wfm','payroll_head','payroll_branch']}><HolidayWorkRequest /></ProtectedRoute>} />
              <Route path="/payroll/holiday-work-approvals" element={<ProtectedRoute roles={['super_admin','admin','payroll_head','payroll_branch','wfm']}><HolidayWorkApprovals /></ProtectedRoute>} />
              <Route path="/payroll/validation" element={<ProtectedRoute roles={['super_admin','payroll_head']}><PayrollValidationScreen /></ProtectedRoute>} />
              <Route path="/payroll/noc" element={<ProtectedRoute roles={['super_admin','payroll_head','payroll_branch','payroll','admin']}><NocManagement /></ProtectedRoute>} />
              <Route path="/payroll/branch-readiness" element={<ProtectedRoute roles={['super_admin','payroll_head','branch_head','payroll_branch']}><BranchPayrollReadiness /></ProtectedRoute>} />
              <Route path="/payroll/calendar" element={<ProtectedRoute roles={['super_admin','payroll_head','payroll_branch']}><PayrollCalendar /></ProtectedRoute>} />
              <Route path="/payroll/cost-summary" element={<ProtectedRoute roles={['super_admin','payroll_head','finance']}><PayrollCostSummary /></ProtectedRoute>} />
              <Route path="/payroll/statutory-filing" element={<ProtectedRoute roles={['super_admin','payroll_head','finance','admin']}><StatutoryFilingTracker /></ProtectedRoute>} />
              <Route path="/payroll/audit-trail" element={<ProtectedRoute roles={['super_admin','payroll_head','finance','admin']}><PayrollAuditTrail /></ProtectedRoute>} />
              <Route path="/payroll/variance" element={<ProtectedRoute roles={['super_admin','payroll_head','finance','admin']}><PayrollVarianceReport /></ProtectedRoute>} />
              <Route path="/payroll/bulk-outputs" element={<ProtectedRoute roles={['super_admin','payroll_head','admin']}><BulkOutputs /></ProtectedRoute>} />
              <Route path="/payroll/loans" element={<ProtectedRoute roles={['super_admin','payroll_head','finance','admin','hr','employee']}><LoanManagement /></ProtectedRoute>} />
              <Route path="/payroll/sign-off" element={<ProtectedRoute roles={['super_admin','payroll_head','finance','ceo','admin']}><PayrollSignOff /></ProtectedRoute>} />
              <Route path="/payroll/salary-certificates" element={<ProtectedRoute roles={['super_admin','payroll_head','finance','admin','hr','employee']}><SalaryCertificate /></ProtectedRoute>} />
              <Route path="/payroll/reimbursements" element={<ProtectedRoute roles={['super_admin','payroll_head','finance','admin','hr','employee']}><ReimbursementManagement /></ProtectedRoute>} />
              <Route path="/wfm/weekoff-fairness" element={<ProtectedRoute roles={['super_admin','admin','wfm']}><WeekoffFairness /></ProtectedRoute>} />

              {/* Communication */}
              <Route path="/communication/templates" element={<ProtectedRoute roles={['admin', 'hr']}><NativeTemplateManager /></ProtectedRoute>} />
              <Route path="/settings/email-templates/bulk-import" element={<ProtectedRoute roles={['admin', 'super_admin']}><Suspense fallback={<PageLoader />}><NativeEmailTemplateBulkImport /></Suspense></ProtectedRoute>} />
              <Route path="/settings/document-templates" element={<ProtectedRoute roles={['admin', 'super_admin', 'hr']}><JoiningDocumentTemplateAdmin /></ProtectedRoute>} />
              <Route path="/communication/dispatch" element={<ProtectedRoute roles={['admin', 'hr']}><NativeDispatchCenter /></ProtectedRoute>} />
              <Route path="/communication/history" element={<ProtectedRoute roles={['admin', 'hr']}><NativeDispatchHistory /></ProtectedRoute>} />
              <Route path="/communication/preferences" element={<ProtectedRoute><NativeNotificationPreferences /></ProtectedRoute>} />
              <Route path="/settings/communication-config" element={<ProtectedRoute roles={['admin']}><Suspense fallback={<PageLoader />}><NativeCommunicationConfig /></Suspense></ProtectedRoute>} />
              <Route path="/migration-console" element={<ProtectedRoute roles={['admin']}><NativeMigrationConsole /></ProtectedRoute>} />
              <Route path="/audit-log" element={<ProtectedRoute roles={['admin', 'super_admin', 'hr', 'payroll_head', 'wfm']}><NativeAuditLog /></ProtectedRoute>} />
              <Route path="/exit-management" element={<ProtectedRoute><Gate pageCode="EXIT_COMMAND_CENTER"><NativeExitManagement /></Gate></ProtectedRoute>} />
              <Route path="/exit/command-center" element={<ProtectedRoute><Gate pageCode="EXIT_COMMAND_CENTER"><NativeExitCommandCenter /></Gate></ProtectedRoute>} />
              <Route path="/kpi-config" element={<ProtectedRoute><Gate pageCode="KPI_CONFIG"><NativeKPIConfiguration /></Gate></ProtectedRoute>} />
              <Route path="/operations-kpi" element={<ProtectedRoute><Gate pageCode="OPERATIONS_KPI"><NativeOperationsKPI /></Gate></ProtectedRoute>} />
              <Route path="/kpi-master" element={<ProtectedRoute><Gate pageCode="KPI_MASTER"><KpiMasterConfig /></Gate></ProtectedRoute>} />
              <Route path="/my-kpi" element={<ProtectedRoute><Gate pageCode="MY_KPI"><MyKpiDashboard /></Gate></ProtectedRoute>} />
              <Route path="/portal-data-manager" element={<ProtectedRoute><Gate pageCode="PORTAL_DATA_MANAGER"><NativePortalDataManager /></Gate></ProtectedRoute>} />
              <Route path="/process-config" element={<ProtectedRoute><Gate pageCode="PROCESS_CONFIG"><NativeProcessConfig /></Gate></ProtectedRoute>} />
              <Route path="/leave-types" element={<ProtectedRoute><Gate pageCode="LEAVE_TYPES"><NativeLeaveTypeConfig /></Gate></ProtectedRoute>} />
              <Route path="/my-roster" element={<ProtectedRoute><NativeMyRoster /></ProtectedRoute>} />
              <Route path="/roster-master-builder" element={<ProtectedRoute><Gate pageCode="ROSTER_MASTER"><NativeRosterMasterBuilder /></Gate></ProtectedRoute>} />
              <Route path="/week-off-preferences" element={<ProtectedRoute><NativeWeekOffPreferences /></ProtectedRoute>} />
              <Route path="/roster-capacity-config" element={<ProtectedRoute><Gate pageCode="ROSTER_MASTER"><NativeRosterCapacityConfig /></Gate></ProtectedRoute>} />
              <Route path="/wfm/auto-roster" element={<ProtectedRoute><Gate pageCode="WFM_AUTO_ROSTER"><NativeWFMAutoRoster /></Gate></ProtectedRoute>} />
              <Route path="/workforce-planning" element={<ProtectedRoute><Gate pageCode="WFM_AUTO_ROSTER"><NativeWorkforcePlanning /></Gate></ProtectedRoute>} />
              <Route path="/control-tower" element={<Navigate to="/dashboard" replace />} />
              <Route path="/rta-board" element={<ProtectedRoute><Gate pageCode="RTA_BOARD"><NativeRTABoard /></Gate></ProtectedRoute>} />
              <Route path="/ats/walkin-queue" element={<ProtectedRoute><Gate pageCode="ATS_WALKIN_QUEUE"><NativeWalkinQueue /></Gate></ProtectedRoute>} />
              <Route path="/attendance-rules-master" element={<ProtectedRoute roles={['admin', 'hr']}><NativeAttendanceRulesMaster /></ProtectedRoute>} />
              <Route path="/wfm/mismatch-queue" element={<ProtectedRoute><NativeAttendanceMismatchQueue /></ProtectedRoute>} />
              <Route path="/attendance/billing-config" element={<ProtectedRoute><NativeAttendanceBillingConfig /></ProtectedRoute>} />
              <Route path="/hr/attendance-lookup" element={<ProtectedRoute roles={['super_admin', 'admin', 'hr', 'payroll_head', 'payroll_admin', 'wfm']}><AdminAttendanceView /></ProtectedRoute>} />
              <Route path="/changelog" element={<ProtectedRoute><Changelog /></ProtectedRoute>} />

              {/* Expenses */}
              <Route path="/expenses" element={<ProtectedRoute><MyExpenses /></ProtectedRoute>} />
              <Route path="/expenses/new" element={<ProtectedRoute><NewExpenseClaim /></ProtectedRoute>} />
              <Route path="/expenses/new/:claimId" element={<ProtectedRoute><NewExpenseClaim /></ProtectedRoute>} />
              <Route path="/expenses/approvals" element={<ProtectedRoute><ExpenseApprovals /></ProtectedRoute>} />
              <Route path="/expenses/finance" element={<ProtectedRoute><FinanceQueue /></ProtectedRoute>} />
              <Route path="/expenses/reports" element={<ProtectedRoute><ExpenseReports /></ProtectedRoute>} />
              <Route path="/expenses/:claimId" element={<ProtectedRoute><NewExpenseClaim /></ProtectedRoute>} />

              {/* Role dashboards */}
              <Route path="/ceo/dashboard" element={<ProtectedRoute><Gate pageCode="CEO_DASHBOARD"><CeoDashboard /></Gate></ProtectedRoute>} />
              <Route path="/payroll-hr/dashboard" element={<ProtectedRoute><Gate pageCode="PAYROLL_HR_DASHBOARD"><PayrollHrDashboard /></Gate></ProtectedRoute>} />
              <Route path="/wfm/dashboard" element={<ProtectedRoute><Gate pageCode="WFM_DASHBOARD"><WfmDashboard /></Gate></ProtectedRoute>} />
              <Route path="/hr/dashboard" element={<ProtectedRoute><Gate pageCode="HR_DASHBOARD"><HrDashboard /></Gate></ProtectedRoute>} />
              <Route path="/manager/dashboard" element={<ProtectedRoute><Gate pageCode="MANAGEMENT_DASHBOARD"><ManagerDashboard /></Gate></ProtectedRoute>} />
              <Route path="/my-team" element={<ProtectedRoute roles={["manager","process_manager","tl","team_leader","assistant_manager","branch_head","admin","hr"]}><MyTeamPage /></ProtectedRoute>} />
              <Route path="/my-dashboard" element={<ProtectedRoute><Gate pageCode="EMPLOYEE_SELF_DASHBOARD"><EmployeeSelfDashboard /></Gate></ProtectedRoute>} />

              {/* DPDP Withdrawal */}
              <Route path="/privacy/dpdp-withdrawal" element={<ProtectedRoute><Gate pageCode="DPDP_WITHDRAWAL"><NativeDPDPWithdrawal /></Gate></ProtectedRoute>} />
              <Route path="/compliance/dpdp-withdrawal-admin" element={<ProtectedRoute><Gate pageCode="DPDP_WITHDRAWAL_ADMIN"><NativeDPDPWithdrawalAdmin /></Gate></ProtectedRoute>} />

              {/* Governance / TAT */}
              <Route path="/governance/tat-matrix" element={<ProtectedRoute><Gate pageCode="TAT_MATRIX"><NativePlaceholderPage title="TAT Matrix" module="Governance" /></Gate></ProtectedRoute>} />
              <Route path="/governance/tat-dashboard" element={<ProtectedRoute><Gate pageCode="TAT_DASHBOARD"><NativePlaceholderPage title="TAT Dashboard" module="Governance" /></Gate></ProtectedRoute>} />

              {/* ATS name consistency */}
              <Route path="/ats/name-consistency" element={<ProtectedRoute><Gate pageCode="NAME_CONSISTENCY_MATRIX"><NativePlaceholderPage title="Name Consistency Matrix" module="ATS" /></Gate></ProtectedRoute>} />

              {/* Appointment e-sign */}
              <Route path="/letters/appointment-esign" element={<ProtectedRoute><Gate pageCode="APPOINTMENT_ESIGN"><NativeAppointmentEsign /></Gate></ProtectedRoute>} />
              <Route path="/employee/joining-documents/esign/:token" element={<EmployeeDocumentEsignReviewPage />} />
              <Route path="/employee/epf-compliance/review/:token" element={<EmployeeEpfComplianceReviewPage />} />

              {/* Exit / Resignation */}
              <Route path="/exit/resignation" element={<ProtectedRoute><Gate pageCode="RESIGNATION_MY_REQUEST"><NativeMyResignation /></Gate></ProtectedRoute>} />
              <Route path="/exit/resignation-command-center" element={<ProtectedRoute><Gate pageCode="RESIGNATION_COMMAND_CENTER"><NativePlaceholderPage title="Resignation Command Center" module="Exit Management" /></Gate></ProtectedRoute>} />

              {/* Public kiosk display — no auth required */}
              <Route path="/break-management/devices" element={<ProtectedRoute roles={['super_admin', 'admin', 'wfm']}><BreakDeskDevices /></ProtectedRoute>} />
              <Route path="/wfm/break-desk-devices" element={<ProtectedRoute roles={['super_admin', 'admin', 'wfm']}><BreakDeskDevices /></ProtectedRoute>} />
              <Route path="/break-desk" element={<BreakDesk />} />
              <Route path="/display/waiting-room" element={<WaitingRoomDisplay />} />

              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
          </ErrorBoundary>
          <CookieConsent />
          <OfflineFallback />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
