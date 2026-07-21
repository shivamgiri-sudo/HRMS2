import { Route, Navigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { lazy } from "./lazy";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import WorkforcePageGate from "@/components/security/WorkforcePageGate";

const Gate = ({ pageCode, children }: { pageCode: string; children: React.ReactNode }) =>
  <WorkforcePageGate pageCode={pageCode}>{children}</WorkforcePageGate>;

const NativeATSDashboardReplica        = lazy(() => import("@/pages/NativeATSDashboardReplica"));
const NativeATSDashboardV2             = lazy(() => import("@/pages/NativeATSDashboardV2"));
const NativeATSFullParityCommandCenter = lazy(() => import("@/pages/NativeATSFullParityCommandCenter"));
const ATSCommandCentre                 = lazy(() => import("@/pages/ATSCommandCentre"));
const NativeATSRegistrationEnhanced   = lazy(() => import("@/pages/NativeATSRegistrationEnhanced"));
const NativeATSOnboardingBridge        = lazy(() => import("@/pages/NativeATSOnboardingBridge"));
const NativeATSWaitingQueue            = lazy(() => import("@/pages/NativeATSWaitingQueue"));
const NativeATSCandidateMaster         = lazy(() => import("@/pages/NativeATSCandidateMaster"));
const NativeATSRecruiterWorkspace      = lazy(() => import("@/pages/NativeATSRecruiterWorkspace"));
const NativeATSHiringEntry             = lazy(() => import("@/pages/NativeATSHiringEntry"));
const NativeATSHiringDashboard         = lazy(() => import("@/pages/NativeATSHiringDashboard"));
const NativeATSSourcingAnalysis        = lazy(() => import("@/pages/NativeATSSourcingAnalysis"));
const NativeATSExtensions              = lazy(() => import("@/pages/NativeATSExtensions"));
const NativeATSFormConfig              = lazy(() => import("@/pages/NativeATSFormConfig"));
const NativeRecruiterPortal            = lazy(() => import("@/pages/NativeRecruiterPortal"));
const NativeATSNameConsistency         = lazy(() => import("@/pages/NativeATSNameConsistency"));
const NativeWalkinQueue                = lazy(() => import("@/pages/NativeWalkinQueueEnhanced"));
const NativeHROnboardingRequests       = lazy(() => import("@/pages/NativeHROnboardingRequests"));
const NativeBranchHeadApproval         = lazy(() => import("@/pages/NativeBranchHeadApproval"));
const BranchHeadApproval               = lazy(() => import("@/pages/BranchHeadApproval"));
const NativeBGVVerificationCenter      = lazy(() => import("@/pages/NativeBGVVerificationCenter"));
const NativeBGVEnhanced                = lazy(() => import("@/pages/NativeBGVEnhanced"));
const NativeBGVReport                  = lazy(() => import("@/pages/NativeBGVReport"));
const NativeBGVReportView              = lazy(() => import("@/pages/NativeBGVReportView"));
const NativeBGVAPIMonitor              = lazy(() => import("@/pages/NativeBGVAPIMonitor"));
const NativeReconciliationDashboard    = lazy(() => import("@/pages/NativeReconciliationDashboard"));
const NativePayrollHRValidation        = lazy(() => import("@/pages/NativePayrollHRValidation"));
const NativeJoiningControlRoom         = lazy(() => import("@/pages/NativeJoiningControlRoom"));
const NativeOfferLetterGeneration      = lazy(() => import("@/pages/NativeOfferLetterGeneration"));
const ATSBulkImportPage                = lazy(() => import("@/pages/ATSBulkImportPage"));
const NativeATSCandidateRegistration   = lazy(() => import("@/pages/NativeATSCandidateRegistration"));

export const recruitmentRouteElements = (
  <>
      {/* ATS Dashboards — CANONICAL: /ats/command-center */}
      <Route path="/ats/command-center" element={<ProtectedRoute><Gate pageCode="ATS_DASHBOARD"><NativeATSFullParityCommandCenter /></Gate></ProtectedRoute>} />
      {/* Legacy dashboard views — kept for role-specific bookmarks */}
      <Route path="/ats/dashboard"      element={<ProtectedRoute><Gate pageCode="ATS_DASHBOARD"><NativeATSDashboardReplica /></Gate></ProtectedRoute>} />
      <Route path="/ats/dashboard-v2"   element={<ProtectedRoute><Gate pageCode="ATS_DASHBOARD"><NativeATSDashboardV2 /></Gate></ProtectedRoute>} />
      {/* Old spelling — redirect to canonical */}
      <Route path="/ats/command-centre" element={
        <ProtectedRoute roles={['admin','manager','hr','recruiter','recruitment_hr']}>
          <Navigate to="/ats/command-center" replace />
        </ProtectedRoute>
      } />

      {/* Candidate registration duplicate — redirect to canonical public route */}
      <Route path="/ats/candidate-registration" element={<Navigate to="/interview-registration" replace />} />

      {/* Recruiter workspace */}
      <Route path="/ats/recruiter/workspace"        element={<ProtectedRoute><Gate pageCode="ATS_RECRUITER_WORKSPACE"><NativeATSRecruiterWorkspace /></Gate></ProtectedRoute>} />
      <Route path="/ats/recruiter/my-candidates"    element={<ProtectedRoute><Gate pageCode="ATS_RECRUITER_QUEUE"><NativeATSRecruiterWorkspace /></Gate></ProtectedRoute>} />
      {/* CANONICAL hiring entry: /ats/recruiter/hiring-entry */}
      <Route path="/ats/recruiter/hiring-entry"     element={<ProtectedRoute><Gate pageCode="ATS_RECRUITER_QUEUE"><NativeATSHiringEntry /></Gate></ProtectedRoute>} />
      {/* "Calling entry" was a duplicate — redirect to canonical */}
      <Route path="/ats/recruiter/calling-entry"    element={<Navigate to="/ats/recruiter/hiring-entry" replace />} />
      {/* CANONICAL hiring dashboard: /ats/recruiter/hiring-dashboard */}
      <Route path="/ats/recruiter/hiring-dashboard" element={<ProtectedRoute><Gate pageCode="ATS_DASHBOARD"><NativeATSHiringDashboard /></Gate></ProtectedRoute>} />
      {/* "Calling dashboard" was a duplicate — redirect to canonical */}
      <Route path="/ats/recruiter/calling-dashboard" element={<Navigate to="/ats/recruiter/hiring-dashboard" replace />} />

      {/* Sourcing */}
      <Route path="/ats/sourcing-analysis" element={<ProtectedRoute><Gate pageCode="ATS_DASHBOARD"><NativeATSSourcingAnalysis /></Gate></ProtectedRoute>} />

      {/* Onboarding bridge */}
      <Route path="/ats/onboarding-bridge"    element={<ProtectedRoute><Gate pageCode="ATS_ONBOARDING_BRIDGE"><NativeATSOnboardingBridge /></Gate></ProtectedRoute>} />
      {/* CANONICAL onboarding requests: /ats/onboarding-requests */}
      <Route path="/ats/onboarding-requests"  element={<ProtectedRoute><Gate pageCode="ATS_ONBOARDING_BRIDGE"><NativeHROnboardingRequests /></Gate></ProtectedRoute>} />
      {/* Duplicate eliminated — redirect to canonical */}
      <Route path="/hr-onboarding-requests"   element={<Navigate to="/ats/onboarding-requests" replace />} />

      {/* Walkin queue — CANONICAL: /ats/walkin-queue (single declaration) */}
      <Route path="/ats/walkin-queue"         element={<ProtectedRoute><Gate pageCode="ATS_WALKIN_QUEUE"><NativeWalkinQueue /></Gate></ProtectedRoute>} />
      <Route path="/ats/waiting-queue"        element={<ProtectedRoute><Gate pageCode="ATS_WAITING_QUEUE"><NativeATSWaitingQueue /></Gate></ProtectedRoute>} />

      {/* Candidate master */}
      <Route path="/ats/candidate-master" element={<ProtectedRoute><Gate pageCode="ATS_CANDIDATE_MASTER"><NativeATSCandidateMaster /></Gate></ProtectedRoute>} />

      {/* Branch head approval — CANONICAL: /ats/offer-approvals */}
      <Route path="/ats/offer-approvals" element={<ProtectedRoute><Gate pageCode="ATS_OFFER_APPROVALS"><NativeBranchHeadApproval /></Gate></ProtectedRoute>} />
      {/* LEGACY: /ats/branch-head-approval uses ats_branch_head_approval table; kept alive while pending records exist */}
      <Route path="/ats/branch-head-approval" element={<ProtectedRoute><Gate pageCode="ATS_BRANCH_HEAD_APPROVAL"><BranchHeadApproval /></Gate></ProtectedRoute>} />

      {/* Payroll HR validation — DEPRECATED: salary assignment now handled in onboarding-requests Employment Offer form */}
      <Route path="/ats/payroll-hr-validation" element={<Navigate to="/ats/onboarding-requests" replace />} />
      <Route path="/ats/payroll-hr" element={<Navigate to="/ats/onboarding-requests" replace />} />

      {/* Joining control room */}
      <Route path="/ats/joining-control-room" element={
        <ProtectedRoute roles={['admin','hr','payroll_hr','super_admin']}>
          <Gate pageCode="ATS_JOINING_CONTROL_ROOM"><NativeJoiningControlRoom /></Gate>
        </ProtectedRoute>
      } />

      {/* BGV */}
      <Route path="/ats/bgv"          element={<ProtectedRoute><Gate pageCode="ATS_BGV"><NativeBGVVerificationCenter /></Gate></ProtectedRoute>} />
      <Route path="/ats/bgv-enhanced" element={<ProtectedRoute roles={['admin','hr']}><DashboardLayout><NativeBGVEnhanced /></DashboardLayout></ProtectedRoute>} />
      <Route path="/ats/bgv-report"   element={<ProtectedRoute><Gate pageCode="ATS_BGV_REPORT"><NativeBGVReport /></Gate></ProtectedRoute>} />
      <Route path="/bgv-report-view/:candidateId" element={<ProtectedRoute roles={['admin','hr']}><NativeBGVReportView /></ProtectedRoute>} />
      <Route path="/ats/bgv-api-monitor" element={<ProtectedRoute roles={['admin','hr','super_admin']}><NativeBGVAPIMonitor /></ProtectedRoute>} />
      <Route path="/ats/reconciliation" element={<ProtectedRoute roles={['admin','super_admin','hr']}><DashboardLayout><NativeReconciliationDashboard /></DashboardLayout></ProtectedRoute>} />

      {/* Misc ATS */}
      <Route path="/ats/registration-enhanced" element={<ProtectedRoute><NativeATSRegistrationEnhanced /></ProtectedRoute>} />
      <Route path="/ats/extensions"   element={<ProtectedRoute><Gate pageCode="ATS_EXTENSIONS"><NativeATSExtensions /></Gate></ProtectedRoute>} />
      <Route path="/ats/form-config"  element={<ProtectedRoute roles={['admin','hr','super_admin']}><NativeATSFormConfig /></ProtectedRoute>} />
      <Route path="/ats/recruiter-portal" element={<ProtectedRoute><Gate pageCode="ATS_RECRUITER_PORTAL"><NativeRecruiterPortal /></Gate></ProtectedRoute>} />
      <Route path="/ats/name-consistency" element={
        <ProtectedRoute roles={['admin','hr','super_admin','recruiter']}>
          <Gate pageCode="NAME_CONSISTENCY_MATRIX"><DashboardLayout><NativeATSNameConsistency /></DashboardLayout></Gate>
        </ProtectedRoute>
      } />
      <Route path="/ats/bulk-import" element={<ProtectedRoute roles={['admin','super_admin']}><Gate pageCode="ATS_BULK_IMPORT"><ATSBulkImportPage /></Gate></ProtectedRoute>} />

      {/* Offer letter */}
      <Route path="/offer-letter" element={<ProtectedRoute><Gate pageCode="ATS_OFFER"><NativeOfferLetterGeneration /></Gate></ProtectedRoute>} />
  </>
);
