import { Route, Navigate } from "react-router-dom";
import { lazy } from "./lazy";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { BreakDeskErrorBoundary } from "@/components/BreakDeskErrorBoundary";
import Auth from "@/pages/AuthClean";
import ResetPassword from "@/pages/ResetPassword";
import ChangePassword from "@/pages/ChangePassword";
import TwoFactor from "@/pages/TwoFactor";

const Features       = lazy(() => import("@/pages/Features"));
const HowItWorks     = lazy(() => import("@/pages/HowItWorks"));
const Pricing        = lazy(() => import("@/pages/Pricing"));
const PrivacyPolicy  = lazy(() => import("@/pages/PrivacyPolicy"));
const TermsOfService = lazy(() => import("@/pages/TermsOfService"));
const Security       = lazy(() => import("@/pages/Security"));

const PublicEmployeeVerify = lazy(() => import("@/pages/PublicEmployeeVerify").then(m => ({ default: m.PublicEmployeeVerify })));
const PublicPayslipVerify  = lazy(() => import("@/pages/PublicEmployeeVerify").then(m => ({ default: m.PublicPayslipVerify })));

const CandidateOnboardingPage     = lazy(() => import("@/pages/CandidateOnboardingPage"));
const CandidateOnboardingFullPage = lazy(() => import("@/pages/CandidateOnboardingFullPage"));
const CandidateOnboardingV2       = lazy(() => import("@/pages/CandidateOnboardingV2"));
const NativeATSCandidateRegistration = lazy(() => import("@/pages/NativeATSCandidateRegistration"));

const BreakDesk            = lazy(() => import("@/pages/BreakDesk"));
const WaitingRoomDisplay   = lazy(() => import("@/pages/WaitingRoomDisplay"));
const OpsBoard             = lazy(() => import("@/pages/OpsBoard"));
const CandidatePortalLogin = lazy(() => import("@/pages/CandidatePortalLogin"));
const CandidatePortalDashboard = lazy(() => import("@/pages/CandidatePortalDashboard"));
const PortalLogin          = lazy(() => import("@/pages/portal/PortalLogin"));

const EmployeeDocumentEsignReviewPage = lazy(() => import("@/pages/EmployeeDocumentEsignReviewPage"));
const EmployeeEpfComplianceReviewPage = lazy(() => import("@/pages/EmployeeEpfComplianceReviewPage"));

export const publicRouteElements = (
  <>
      {/* Root */}
      <Route path="/" element={<Navigate to="/auth" replace />} />

      {/* Marketing */}
      <Route path="/features"         element={<Features />} />
      <Route path="/how-it-works"     element={<HowItWorks />} />
      <Route path="/pricing"          element={<Pricing />} />
      <Route path="/privacy-policy"   element={<PrivacyPolicy />} />
      <Route path="/terms-of-service" element={<TermsOfService />} />
      <Route path="/security"         element={<Security />} />

      {/* Auth */}
      <Route path="/auth"           element={<Auth />} />
      <Route path="/login"          element={<Auth />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/change-password" element={<ProtectedRoute><ChangePassword /></ProtectedRoute>} />
      <Route path="/two-factor"     element={<ProtectedRoute><TwoFactor /></ProtectedRoute>} />

      {/* Public verification (QR codes) */}
      <Route path="/verify/emp/:employeeCode"                element={<PublicEmployeeVerify />} />
      <Route path="/verify/payslip/:employeeCode/:monthYear" element={<PublicPayslipVerify />} />

      {/* Candidate registration — CANONICAL: /interview-registration */}
      <Route path="/interview-registration" element={<NativeATSCandidateRegistration />} />
      <Route path="/candidate-registration" element={<Navigate to="/interview-registration" replace />} />
      <Route path="/walkin-registration"    element={<Navigate to="/interview-registration" replace />} />

      {/* Candidate onboarding — CANONICAL: /onboard-full */}
      <Route path="/onboard"      element={<CandidateOnboardingPage />} />
      <Route path="/onboard-full" element={<CandidateOnboardingFullPage />} />
      {/* LEGACY: kept alive for existing email token links until token table is audited for zero active sessions */}
      <Route path="/onboard-full-legacy" element={<CandidateOnboardingV2 />} />
      {/* Duplicates eliminated → redirects to canonical */}
      <Route path="/candidate-onboarding-full" element={<Navigate to="/onboard-full" replace />} />
      <Route path="/onboard-v1"                element={<Navigate to="/onboard-full" replace />} />

      {/* Candidate and client portals (unauthenticated surfaces) */}
      <Route path="/candidate-portal/login"     element={<CandidatePortalLogin />} />
      <Route path="/candidate-portal/dashboard" element={<CandidatePortalDashboard />} />
      <Route path="/portal/login"               element={<PortalLogin />} />

      {/* Kiosk displays — intentionally public (wall-mounted screens) */}
      <Route path="/break-desk"           element={<BreakDeskErrorBoundary><BreakDesk /></BreakDeskErrorBoundary>} />
      <Route path="/display/waiting-room" element={<WaitingRoomDisplay />} />
      <Route path="/display/ops-board"    element={<OpsBoard />} />

      {/* Token-gated document review flows (token in URL, no session required) */}
      <Route path="/employee/joining-documents/esign/:token" element={<EmployeeDocumentEsignReviewPage />} />
      <Route path="/employee/epf-compliance/review/:token"   element={<EmployeeEpfComplianceReviewPage />} />
  </>
);
