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
const EmployeeJoiningKitEsignPage     = lazy(() => import("@/pages/EmployeeJoiningKitEsignPage"));
const PublicAppointmentLetterVerify   = lazy(() => import("@/pages/PublicAppointmentLetterVerify").then(m => ({ default: m.PublicAppointmentLetterVerify })));
const EmployeeEpfComplianceReviewPage = lazy(() => import("@/pages/EmployeeEpfComplianceReviewPage"));
const VisitorSelfRegister = lazy(() => import("@/pages/VisitorSelfRegister"));
const VisitorStatusPage   = lazy(() => import("@/pages/VisitorStatusPage"));
const VisitorGatePage     = lazy(() => import("@/pages/VisitorGatePage"));
const UXSkillDemo         = lazy(() => import("@/pages/UXSkillDemo"));
const UXSkillDemoCompare  = lazy(() => import("@/pages/UXSkillDemoCompare"));
const ProfileCompare      = lazy(() => import("@/pages/ProfileCompare"));
const ProfileV3Demo       = lazy(() => import("@/pages/ProfileV3Demo"));
const Step10Demo          = lazy(() => import("@/components/onboarding-full/Step10Demo"));
const OnboardingFullDemo  = lazy(() => import("@/components/onboarding-full/OnboardingFullDemo"));
const CandidateOnboardingFullPageV2 = lazy(() => import("@/pages/CandidateOnboardingFullPageV2"));
const PublicKpiCapture        = lazy(() => import("@/pages/PublicKpiCapture"));
const PublicKpiCaptureResults = lazy(() => import("@/pages/PublicKpiCaptureResults"));

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

      {/* Demo */}
      <Route path="/ux-skill-demo"    element={<UXSkillDemo />} />
      <Route path="/ux-skill-compare" element={<UXSkillDemoCompare />} />
      <Route path="/profile-compare" element={<ProfileCompare />} />
      <Route path="/profile-v3-demo" element={<ProfileV3Demo />} />
      <Route path="/onboarding-step10-demo" element={<Step10Demo />} />
      <Route path="/onboarding-demo" element={<OnboardingFullDemo />} />

      {/* Auth */}
      <Route path="/auth"           element={<Auth />} />
      <Route path="/login"          element={<Auth />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/change-password" element={<ProtectedRoute><ChangePassword /></ProtectedRoute>} />
      <Route path="/two-factor"     element={<ProtectedRoute><TwoFactor /></ProtectedRoute>} />

      {/* Public verification (QR codes) */}
      <Route path="/verify/emp/:employeeCode"                element={<PublicEmployeeVerify />} />
      <Route path="/verify/payslip/:employeeCode/:monthYear" element={<PublicPayslipVerify />} />
      {/* The QR printed on every appointment letter points here. */}
      <Route path="/verify/appointment/:token"              element={<PublicAppointmentLetterVerify />} />

      {/* Candidate registration — CANONICAL: /interview-registration */}
      <Route path="/interview-registration" element={<NativeATSCandidateRegistration />} />
      <Route path="/candidate-registration" element={<Navigate to="/interview-registration" replace />} />
      <Route path="/walkin-registration"    element={<Navigate to="/interview-registration" replace />} />

      {/* Candidate onboarding — CANONICAL: /onboard-full */}
      <Route path="/onboard"      element={<CandidateOnboardingPage />} />
      <Route path="/onboard-full" element={<CandidateOnboardingFullPage />} />
      {/* V2 TEST — Redesigned UI, same backend */}
      {/*
        * Consolidated 2026-08-27. Two full candidate-onboarding flows existed side by side.
        * Every link the backend actually sends a candidate — ats-reminders.cron,
        * ats.onboarding.routes, ats.onboarding.service (x2), ats.service, and the DigiLocker
        * redirect_uri — points at /onboard-full. Nothing anywhere sends /onboard-full-v2.
        *
        * FOR THE MODULE OWNER: the unreachable V2 is the NEWER file (26-Aug vs 23-Aug) and
        * enforces education, live selfie and marital status at submit. That validation is
        * worth porting into CandidateOnboardingFullPage. Redirecting rather than switching
        * the canonical URL, because swapping the form a live candidate receives is a
        * behaviour change that needs its own approval, not a de-duplication commit.
        */}
      <Route path="/onboard-full-v2" element={<Navigate to="/onboard-full" replace />} />
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
      {/* One link, all joining documents. joiningKitDispatch.service.ts emails this exact path. */}
      <Route path="/employee/joining-kit/esign/:token"       element={<EmployeeJoiningKitEsignPage />} />
      <Route path="/employee/epf-compliance/review/:token"   element={<EmployeeEpfComplianceReviewPage />} />

      {/* KPI capture — intentionally open so process owners can fill it from a link with no
          HRMS account. The form writes only to the kpi_capture_submission staging table.
          Results carry client names and targets, so they sit behind an unguessable token
          rather than a plain path, and the page sets robots noindex. */}
      <Route path="/kpi-capture"                element={<PublicKpiCapture />} />
      <Route path="/kpi-capture/results/:token" element={<PublicKpiCaptureResults />} />

      {/* Visitor management — public unauthenticated surfaces */}
      <Route path="/visitor-register"        element={<VisitorSelfRegister />} />
      <Route path="/visitor-status/:token"   element={<VisitorStatusPage />} />
      <Route path="/visitor-status"          element={<VisitorStatusPage />} />
      <Route path="/visitor-gate"            element={<VisitorGatePage />} />
  </>
);
