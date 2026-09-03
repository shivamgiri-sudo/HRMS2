import { Suspense } from "react";
import { Route, Navigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { lazy } from "./lazy";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import WorkforcePageGate from "@/components/security/WorkforcePageGate";

const Gate = ({ pageCode, children }: { pageCode: string; children: React.ReactNode }) =>
  <WorkforcePageGate pageCode={pageCode}>{children}</WorkforcePageGate>;
const PageLoader = () => (
  <div className="flex h-screen items-center justify-center bg-slate-50">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800" />
  </div>
);

const NativeConfigurationCenter     = lazy(() => import("@/pages/NativeConfigurationCenter"));
const Settings                      = lazy(() => import("@/pages/Settings"));
const Profile                       = lazy(() => import("@/pages/Profile"));
const NativeAssetsManager           = lazy(() => import("@/pages/NativeAssetsManager"));
const NativeExitPass                = lazy(() => import("@/pages/NativeExitPass"));
const NativeExitPassPrint           = lazy(() => import("@/pages/NativeExitPassPrint"));
const NativeExitPassVerify          = lazy(() => import("@/pages/NativeExitPassVerify"));
const NativeHelpdesk                = lazy(() => import("@/pages/NativeHelpdesk"));
const NativeUatFeedback             = lazy(() => import("@/pages/NativeUatFeedback"));
const NativeUatTriageConsole        = lazy(() => import("@/pages/NativeUatTriageConsole"));
const NativeUatReleaseBoard         = lazy(() => import("@/pages/NativeUatReleaseBoard"));
const NativeUatChecklistAdmin       = lazy(() => import("@/pages/NativeUatChecklistAdmin"));
const NativeSupportCommandCenter    = lazy(() => import("@/pages/NativeSupportCommandCenter"));
const NativeGrievanceCommandCenter  = lazy(() => import("@/pages/NativeGrievanceCommandCenter"));
const NativeLetters                 = lazy(() => import("@/pages/NativeLetters"));
const NativeLetterPreview           = lazy(() => import("@/pages/NativeLetterPreview"));
const NativeCompanySigningCertificate = lazy(() => import("@/pages/NativeCompanySigningCertificate"));
const NativeProvisioningRecipients   = lazy(() => import("@/pages/NativeProvisioningRecipients"));
const NativeFraudAlertReview         = lazy(() => import("@/pages/NativeFraudAlertReview"));
const NativeBranchPayrollHrSignatory = lazy(() => import("@/pages/NativeBranchPayrollHrSignatory"));
const NativeDocumentVerification    = lazy(() => import("@/pages/NativeDocumentVerification"));
const NativeStatutoryApprovals      = lazy(() => import("@/pages/NativeStatutoryApprovals"));
const NativeOrgMasters              = lazy(() => import("@/pages/NativeOrgMasters"));
const NativeLocationPolicyMasters   = lazy(() => import("@/pages/NativeLocationPolicyMasters"));
const NativeWorkflowAdmin           = lazy(() => import("@/pages/NativeWorkflowAdmin"));
const NativeBenefitsClaims          = lazy(() => import("@/pages/NativeBenefitsClaims"));
const NativeIntegrationHub          = lazy(() => import("@/pages/NativeIntegrationHub"));
const EnhancedClientMaster          = lazy(() => import("@/pages/EnhancedClientMaster"));
const NativeCustomizationManager    = lazy(() => import("@/pages/customization/NativeCustomizationManager"));
const NativeCustomizationRuleEditor = lazy(() => import("@/pages/customization/NativeCustomizationRuleEditor"));
const NativeMigrationConsole        = lazy(() => import("@/pages/NativeMigrationConsole"));
const NativeAuditLog                = lazy(() => import("@/pages/NativeAuditLog"));
const NativeSecurityCenter          = lazy(() => import("@/pages/NativeSecurityCenter"));
const UnifiedAccessControl          = lazy(() => import("@/pages/UnifiedAccessControl"));
const SuperAdminAccessControl       = lazy(() => import("@/pages/SuperAdminAccessControl"));
const SuperAdminModuleAccess        = lazy(() => import("@/pages/SuperAdminModuleAccess"));
const NativePolicyEngine            = lazy(() => import("@/pages/NativePolicyEngine"));
const AIProviderSettings            = lazy(() => import("@/pages/AIProviderSettings"));
const MiraComplaintsPage            = lazy(() => import("@/pages/ai/MiraComplaintsPage"));
const PeopleOSCopilot               = lazy(() => import("@/pages/PeopleOSCopilot"));
const NativeProcessConfig           = lazy(() => import("@/pages/NativeProcessConfig"));
const NativePortalDataManager       = lazy(() => import("@/pages/NativePortalDataManager"));
const NativeMobilityManagement      = lazy(() => import("@/pages/NativeMobilityManagement"));
const NativeWorkInbox               = lazy(() => import("@/pages/NativeWorkInbox"));
const NativeControlTower            = lazy(() => import("@/pages/NativeControlTower"));
const NativeManagementDashboard     = lazy(() => import("@/pages/NativeManagementDashboard"));
const NativeJobsPage                = lazy(() => import("@/pages/NativeJobsPage"));
const NativeEngagement              = lazy(() => import("@/pages/NativeEngagement"));
const NativeCompanyFeed             = lazy(() => import("@/pages/NativeCompanyFeed"));
const NativeCompanyPostCreate       = lazy(() => import("@/pages/NativeCompanyPostCreate"));
const NativeCompanyPostApproval     = lazy(() => import("@/pages/NativeCompanyPostApproval"));
const NativeCompanyPostManage       = lazy(() => import("@/pages/NativeCompanyPostManage"));
const NativeCompanyFeedCreatorAccess = lazy(() => import("@/pages/NativeCompanyFeedCreatorAccess"));
const NativeSocialFeed               = lazy(() => import("@/pages/NativeSocialFeed"));
const NativeSocialFeedAdmin          = lazy(() => import("@/pages/NativeSocialFeedAdmin"));
const MeetingsBroadcasts             = lazy(() => import("@/pages/MeetingsBroadcasts"));
const NativeBadges                  = lazy(() => import("@/pages/NativeBadges"));
const NativeKudos                   = lazy(() => import("@/pages/NativeKudos"));
const NativeSurveys                 = lazy(() => import("@/pages/NativeSurveys"));
const NativeLeaderboard             = lazy(() => import("@/pages/NativeLeaderboard"));
const ReportsHub                    = lazy(() => import("@/pages/ReportsHub"));
const LiveLocationMap               = lazy(() => import("@/pages/LiveLocationMap"));
const BulkUploadHub                 = lazy(() => import("@/pages/BulkUploadHub"));
const BulkUploadApprovals           = lazy(() => import("@/pages/BulkUploadApprovals"));
const Departments                   = lazy(() => import("@/pages/Departments"));
const CompanyCalendar               = lazy(() => import("@/pages/CompanyCalendar"));
const Notifications                 = lazy(() => import("@/pages/Notifications"));
const Changelog                     = lazy(() => import("@/pages/Changelog"));
const ModuleLauncher                = lazy(() => import("@/pages/ModuleLauncher"));
const Assets                        = lazy(() => import("@/pages/Assets"));
const Onboarding                    = lazy(() => import("@/pages/Onboarding"));

// Communication
const NativeTemplateManager          = lazy(() => import("@/pages/NativeTemplateManager"));
const NativeEmailTemplateBulkImport  = lazy(() => import("@/pages/NativeEmailTemplateBulkImport"));
const NativeDispatchCenter           = lazy(() => import("@/pages/NativeDispatchCenter"));
const NativeDispatchHistory          = lazy(() => import("@/pages/NativeDispatchHistory"));
const NativeNotificationPreferences  = lazy(() => import("@/pages/NativeNotificationPreferences"));
const NativeCommunicationConfig      = lazy(() => import("@/pages/NativeCommunicationConfig"));
const NativeEmailCommandCentre = lazy(() => import("@/pages/NativeEmailCommandCentre"));
const NativeCallCentreConfig         = lazy(() => import("@/pages/NativeCallCentreConfig"));

const REPORT_ROLES = [
  'super_admin','admin','hr','hr_head','finance','finance_head','accounts_head',
  'payroll','payroll_head','payroll_branch','payroll_hr','wfm','manager','process_manager','branch_head',
  'ceo','coo','quality','qa','quality_analyst','operations','operations_manager','recruiter','recruitment_head',
  'recruitment_hr','trainer','training','it','it_manager','security','security_head',
  'compliance','privacy_officer','facility_manager','visitor_security','visitor_reception',
  'branch_hr','hr_branch','team_leader','tl'
];

const REPORT_VALIDATION_ROLES = [
  'super_admin','admin','ceo','coo','internal_auditor','compliance_head','it_manager','hr_head','finance_head'
];

export const platformRouteElements = (
  <>
      {/* Core platform */}
      <Route path="/settings"        element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      <Route path="/profile"         element={<ProtectedRoute><Gate pageCode="MY_PROFILE"><Profile /></Gate></ProtectedRoute>} />
      {/*
        * Consolidated 2026-08-27. Four components rendered "my profile" — Profile,
        * ProfileEnhanced, ProfileEnhancedV2, ProfileV3 — all on the MY_PROFILE page code,
        * all reading /api/employees/me and /api/employees/me/journey, and none of the three
        * variants linked from the sidebar or anywhere else in src/. Design iterations that
        * were never cleaned up; /profile is the one the sidebar points at.
        *
        * Redirected, not deleted: identical page code on both sides, so no access changes,
        * and the URLs survive in bookmarks. ProfileV3 additionally called
        * /api/leave/requests — that is a leave list, already on its own page, not a reason
        * to keep a fourth profile.
        */}
      <Route path="/profile-enhanced" element={<Navigate to="/profile" replace />} />
      <Route path="/profile-v2" element={<Navigate to="/profile" replace />} />
      <Route path="/profile-v3" element={<Navigate to="/profile" replace />} />
      <Route path="/departments"     element={<ProtectedRoute><Departments /></ProtectedRoute>} />
      <Route path="/calendar"        element={<ProtectedRoute><CompanyCalendar /></ProtectedRoute>} />
      <Route path="/notifications"   element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
      {/*
        * Consolidated 2026-08-27. NotificationPreferences.tsx made ZERO network calls of any
        * kind — no useQuery, no hrmsApi, no fetch — so whatever a user toggled here was never
        * saved anywhere. NativeNotificationPreferences at /communication/preferences is the
        * working one (POSTs /api/communication/preferences). Two sidebar entries pointed at
        * these two, one of which quietly discarded every change.
        */}
      <Route path="/notification-preferences" element={<Navigate to="/communication/preferences" replace />} />
      <Route path="/modules"         element={<ProtectedRoute><ModuleLauncher /></ProtectedRoute>} />
      <Route path="/changelog"       element={<ProtectedRoute><Changelog /></ProtectedRoute>} />
      <Route path="/bulk-upload"     element={<ProtectedRoute roles={['admin','hr','super_admin','wfm','payroll','payroll_hr']}><Gate pageCode="BULK_UPLOAD"><BulkUploadHub /></Gate></ProtectedRoute>} />
      {/* Gated on BULK_UPLOAD_APPROVALS, not BULK_UPLOAD.
        * branch_head holds NO BULK_UPLOAD grant (live, 2026-09-03) — so the only role
        * allowed to approve a gated batch was being turned away by the gate on the very
        * page built for them. BULK_UPLOAD_APPROVALS is the code migration 1522 created for
        * this queue and already grants branch_head, branch_admin, payroll_head and
        * super_admin; migration 1657 adds wfm and payroll_hr read-only so a creator can
        * watch their own batch. This route is also listed in PAGE_CODE_BY_ROUTE, which
        * makes the `roles` prop below inert — the page code is the single gate. The list is
        * kept as documentation of who the code is expected to admit. */}
      <Route path="/bulk-upload/approvals" element={<ProtectedRoute roles={['super_admin','branch_head','branch_admin','payroll_head','wfm','payroll_hr']}><Gate pageCode="BULK_UPLOAD_APPROVALS"><BulkUploadApprovals /></Gate></ProtectedRoute>} />
      <Route path="/assets"          element={<ProtectedRoute><Assets /></ProtectedRoute>} />
      <Route path="/onboarding"      element={<ProtectedRoute roles={['admin','hr']}><Onboarding /></ProtectedRoute>} />
      <Route path="/onboarding-requests" element={<Navigate to="/onboarding?tab=requests" replace />} />

      {/* Assets / documents */}
      <Route path="/assets-manager"       element={<ProtectedRoute><Gate pageCode="ASSETS_MANAGER"><NativeAssetsManager /></Gate></ProtectedRoute>} />
      <Route path="/it-admin/exit-pass"   element={<ProtectedRoute><Gate pageCode="ASSET_EXIT_PASS"><NativeExitPass /></Gate></ProtectedRoute>} />
      <Route path="/it-admin/exit-pass/:id/print" element={<ProtectedRoute><Gate pageCode="ASSET_EXIT_PASS"><NativeExitPassPrint /></Gate></ProtectedRoute>} />
      <Route path="/security/exit-pass-verify" element={<ProtectedRoute><Gate pageCode="ASSET_EXIT_PASS_VERIFY"><NativeExitPassVerify /></Gate></ProtectedRoute>} />
      <Route path="/document-verification" element={<ProtectedRoute><Gate pageCode="EMPLOYEE_MANAGEMENT"><NativeDocumentVerification /></Gate></ProtectedRoute>} />
      <Route path="/statutory-change-approvals" element={<ProtectedRoute roles={['super_admin','admin','hr']}><NativeStatutoryApprovals /></ProtectedRoute>} />

      {/* Letters */}
      <Route path="/letters"                   element={<ProtectedRoute><Gate pageCode="LETTERS"><NativeLetters /></Gate></ProtectedRoute>} />
      <Route path="/letters/:id/preview"       element={<ProtectedRoute><Gate pageCode="LETTERS"><NativeLetterPreview /></Gate></ProtectedRoute>} />
      {/* Company signing certificate. The backend router is super_admin-only; this
          route is intentionally not page-gated so a Super Admin can always reach it. */}
      <Route path="/settings/signing-certificate" element={<ProtectedRoute><NativeCompanySigningCertificate /></ProtectedRoute>} />
      {/* Provisioning notification recipients. Same pattern as above: the backend
          router is super_admin-only, and the route is intentionally not page-gated
          so a Super Admin can always reach it — a Gate on a pageCode missing from
          page_catalog locks out every role including super_admin. */}
      <Route path="/settings/provisioning-recipients" element={<ProtectedRoute><NativeProvisioningRecipients /></ProtectedRoute>} />
      {/* Fraud alert review. Deliberately not page-gated, for the same reason as
          the two routes above: a Gate on a pageCode that is missing from
          page_catalog locks out every role. The backend enforces the real
          boundary (super_admin, admin, hr, payroll_hr), and this screen is what
          lets an open alert be cleared — without it, the employee-creation gate
          would strand a candidate with no route out. */}
      <Route path="/settings/fraud-alerts" element={<ProtectedRoute><NativeFraudAlertReview /></ProtectedRoute>} />
      {/* Per-branch Payroll HR signatory. Not page-gated for the same reason as
          its neighbours: a Gate on a pageCode missing from page_catalog locks out
          every role. The backend enforces super_admin. */}
      <Route path="/settings/branch-payroll-hr" element={<ProtectedRoute><NativeBranchPayrollHrSignatory /></ProtectedRoute>} />
      {/* /employee/joining-documents/esign/:token and /employee/epf-compliance/review/:token are in public.routes */}

      {/* Helpdesk / Support */}
      <Route path="/helpdesk"                        element={<ProtectedRoute><Gate pageCode="HELPDESK_KB"><NativeHelpdesk /></Gate></ProtectedRoute>} />
      <Route path="/uat/feedback"                    element={<ProtectedRoute><Gate pageCode="UAT_FEEDBACK"><NativeUatFeedback /></Gate></ProtectedRoute>} />
      <Route path="/uat/triage"                      element={<ProtectedRoute><Gate pageCode="UAT_TRIAGE_CONSOLE"><NativeUatTriageConsole /></Gate></ProtectedRoute>} />
      <Route path="/uat/releases"                    element={<ProtectedRoute><Gate pageCode="UAT_RELEASE_BOARD"><NativeUatReleaseBoard /></Gate></ProtectedRoute>} />
      <Route path="/uat/checklist"                   element={<ProtectedRoute><Gate pageCode="UAT_CHECKLIST_ADMIN"><NativeUatChecklistAdmin /></Gate></ProtectedRoute>} />
      <Route path="/support/command-center"          element={<ProtectedRoute><Gate pageCode="SUPPORT_COMMAND_CENTER"><NativeSupportCommandCenter /></Gate></ProtectedRoute>} />
      <Route path="/support/grievance-command-center" element={<ProtectedRoute><Gate pageCode="GRIEVANCE_COMMAND_CENTER"><NativeGrievanceCommandCenter /></Gate></ProtectedRoute>} />

      {/* Org / workflow masters */}
      <Route path="/org-masters"                  element={<ProtectedRoute><Gate pageCode="ORG_MASTERS"><NativeOrgMasters /></Gate></ProtectedRoute>} />
      <Route path="/org-masters/locations-policies" element={<ProtectedRoute><Gate pageCode="ORG_MASTERS"><NativeLocationPolicyMasters /></Gate></ProtectedRoute>} />
      <Route path="/workflow-admin"               element={<ProtectedRoute><Gate pageCode="WORKFLOW_ADMIN"><NativeWorkflowAdmin /></Gate></ProtectedRoute>} />
      <Route path="/process-config"               element={<ProtectedRoute><Gate pageCode="PROCESS_CONFIG"><NativeProcessConfig /></Gate></ProtectedRoute>} />
      <Route path="/client-master"                element={<ProtectedRoute><Gate pageCode="CLIENT_MASTER"><EnhancedClientMaster /></Gate></ProtectedRoute>} />

      {/* Integration / migration / audit */}
      <Route path="/integration-hub"              element={<ProtectedRoute><Gate pageCode="INTEGRATION_HUB"><NativeIntegrationHub /></Gate></ProtectedRoute>} />
      <Route path="/migration-console"            element={<ProtectedRoute roles={['admin']}><Gate pageCode="MIGRATION_CONSOLE"><NativeMigrationConsole /></Gate></ProtectedRoute>} />
      <Route path="/audit-log"                    element={<ProtectedRoute roles={['admin','super_admin','hr','payroll_head','wfm']}><Gate pageCode="AUDIT_LOG"><NativeAuditLog /></Gate></ProtectedRoute>} />

      {/* Configuration Control Center */}
      <Route path="/admin/configuration" element={<ProtectedRoute roles={['super_admin','admin']}><Gate pageCode="CONFIGURATION_CENTER"><NativeConfigurationCenter /></Gate></ProtectedRoute>} />

      {/* Security / access */}
      <Route path="/security-center"             element={<ProtectedRoute roles={['admin','ceo','coo','hr']}><Gate pageCode="SECURITY_CENTER"><NativeSecurityCenter /></Gate></ProtectedRoute>} />
      <Route path="/settings/access-control"     element={<ProtectedRoute><Gate pageCode="ACCESS_CONTROL"><UnifiedAccessControl /></Gate></ProtectedRoute>} />
      <Route path="/super-admin/page-access"     element={<ProtectedRoute roles={['admin']}><Gate pageCode="ACCESS_CONTROL"><SuperAdminAccessControl /></Gate></ProtectedRoute>} />
      <Route path="/super-admin/module-access"   element={<ProtectedRoute roles={['admin']}><Gate pageCode="MODULE_ACCESS"><SuperAdminModuleAccess /></Gate></ProtectedRoute>} />
      <Route path="/super-admin/policy-engine"   element={<ProtectedRoute roles={['super_admin']}><Gate pageCode="SUPER_ADMIN_POLICY_ENGINE"><NativePolicyEngine /></Gate></ProtectedRoute>} />
      <Route path="/super-admin/company-feed-creators" element={<ProtectedRoute roles={['super_admin']}><NativeCompanyFeedCreatorAccess /></ProtectedRoute>} />
      <Route path="/super-admin/live-location"   element={<ProtectedRoute roles={['super_admin','branch_head','hr_admin','operations_manager','process_manager']}><LiveLocationMap /></ProtectedRoute>} />

      {/* AI / Copilot */}
      <Route path="/settings/ai-providers"       element={<ProtectedRoute roles={['super_admin']}><AIProviderSettings /></ProtectedRoute>} />
      <Route path="/admin/mira-complaints"       element={<ProtectedRoute roles={['super_admin']}><MiraComplaintsPage /></ProtectedRoute>} />
      <Route path="/peopleos/copilot"            element={<ProtectedRoute><DashboardLayout><PeopleOSCopilot /></DashboardLayout></ProtectedRoute>} />

      {/* Customization */}
      <Route path="/customization"               element={<ProtectedRoute><Gate pageCode="CUSTOMIZATION_MANAGER"><DashboardLayout><NativeCustomizationManager /></DashboardLayout></Gate></ProtectedRoute>} />
      <Route path="/customization/new"           element={<ProtectedRoute><Gate pageCode="CUSTOMIZATION_MANAGER"><DashboardLayout><NativeCustomizationRuleEditor /></DashboardLayout></Gate></ProtectedRoute>} />
      <Route path="/customization/:id/edit"      element={<ProtectedRoute><Gate pageCode="CUSTOMIZATION_MANAGER"><DashboardLayout><NativeCustomizationRuleEditor /></DashboardLayout></Gate></ProtectedRoute>} />

      {/* Portal data */}
      <Route path="/portal-data-manager"         element={<ProtectedRoute><Gate pageCode="PORTAL_DATA_MANAGER"><NativePortalDataManager /></Gate></ProtectedRoute>} />

      {/* Benefits / Mobility / Work Inbox */}
      <Route path="/benefits"                    element={<ProtectedRoute><Gate pageCode="BENEFITS"><NativeBenefitsClaims /></Gate></ProtectedRoute>} />
      <Route path="/mobility"                    element={<ProtectedRoute><Gate pageCode="MOBILITY"><NativeMobilityManagement /></Gate></ProtectedRoute>} />
      <Route path="/work-inbox"                  element={<ProtectedRoute><Gate pageCode="WORK_INBOX"><NativeWorkInbox /></Gate></ProtectedRoute>} />
      <Route path="/jobs"                        element={<ProtectedRoute><Gate pageCode="JOBS"><NativeJobsPage /></Gate></ProtectedRoute>} />

      {/* Control tower */}
      <Route path="/control-tower"               element={<ProtectedRoute roles={['admin','super_admin','hr','manager']}><Gate pageCode="CONTROL_TOWER"><NativeControlTower /></Gate></ProtectedRoute>} />

      {/* Management dashboard */}
      <Route path="/management/dashboard"        element={<ProtectedRoute><Gate pageCode="MANAGEMENT_DASHBOARD"><NativeManagementDashboard /></Gate></ProtectedRoute>} />
      <Route path="/management/ceo-command-center" element={<Navigate to="/ceo/dashboard" replace />} />

      {/* Engagement */}
      <Route path="/engagement"                  element={<ProtectedRoute><NativeEngagement /></ProtectedRoute>} />
      <Route path="/engagement/company-feed"     element={<ProtectedRoute><NativeCompanyFeed /></ProtectedRoute>} />
      <Route path="/engagement/company-feed/create" element={<ProtectedRoute><NativeCompanyPostCreate /></ProtectedRoute>} />
      <Route path="/engagement/company-feed/approvals" element={<ProtectedRoute roles={['hr_head','admin','super_admin']}><NativeCompanyPostApproval /></ProtectedRoute>} />
      <Route path="/engagement/company-feed/manage" element={<ProtectedRoute roles={['hr_head','admin','super_admin']}><NativeCompanyPostManage /></ProtectedRoute>} />
      <Route path="/engagement/badges"           element={<ProtectedRoute><NativeBadges /></ProtectedRoute>} />
      <Route path="/engagement/kudos"            element={<ProtectedRoute><NativeKudos /></ProtectedRoute>} />
      <Route path="/engagement/surveys"          element={<ProtectedRoute><NativeSurveys /></ProtectedRoute>} />
      <Route path="/engagement/leaderboard"      element={<ProtectedRoute><NativeLeaderboard /></ProtectedRoute>} />

      {/* Social media feed — external platform posts (free API / embeds) */}
      <Route path="/social-feed"       element={<ProtectedRoute><Gate pageCode="SOCIAL_FEED"><NativeSocialFeed /></Gate></ProtectedRoute>} />
      <Route path="/social-feed/admin" element={<ProtectedRoute roles={['super_admin','hr_admin','admin']}><NativeSocialFeedAdmin /></ProtectedRoute>} />

      {/* MCNmeet — Video meetings & broadcasts */}
      <Route path="/meetings" element={<ProtectedRoute><Gate pageCode="MCNMEET"><MeetingsBroadcasts /></Gate></ProtectedRoute>} />

      {/* Reports Hub — auth-only; per-view role gates enforced inside ReportsHub */}
      <Route path="/reports" element={<ProtectedRoute><ReportsHub /></ProtectedRoute>} />

      {/* Legacy report routes — permanent redirects to hub with correct ?view= param */}
      <Route path="/reports/library"           element={<Navigate to="/reports?view=library"      replace />} />
      <Route path="/reports/control-room"      element={<Navigate to="/reports?view=control-room" replace />} />
      <Route path="/reports/source-validation" element={<Navigate to="/reports?view=validation"   replace />} />
      <Route path="/my-report-requests"        element={<Navigate to="/reports?view=requests"     replace />} />
      <Route path="/admin/report-audit"        element={<Navigate to="/reports?view=audit"        replace />} />
      {/* Module-specific report routes → hub library with pre-selected report */}
      <Route path="/break-reports"             element={<Navigate to="/reports?view=library&report=break-daily-summary"  replace />} />
      <Route path="/break-session-log"         element={<Navigate to="/reports?view=library&report=break-session-log"   replace />} />
      <Route path="/payroll/variance"          element={<Navigate to="/reports?view=library&report=payroll-variance"     replace />} />
      <Route path="/payroll/cost-summary"      element={<Navigate to="/reports?view=library&report=payroll-cost-summary" replace />} />

      {/* Legacy /reports-legacy/* paths now redirect to the hub */}
      <Route path="/reports-legacy/*" element={<Navigate to="/reports" replace />} />

      {/* Communication */}
      <Route path="/communication/templates"     element={<ProtectedRoute roles={['super_admin','admin','hr']}><Gate pageCode="COMM_TEMPLATES"><NativeTemplateManager /></Gate></ProtectedRoute>} />
      <Route path="/settings/email-templates/bulk-import" element={<ProtectedRoute roles={['admin','super_admin']}><Suspense fallback={<PageLoader />}><NativeEmailTemplateBulkImport /></Suspense></ProtectedRoute>} />
      <Route path="/communication/dispatch"      element={<ProtectedRoute roles={['super_admin','admin','hr']}><Gate pageCode="COMM_DISPATCH"><NativeDispatchCenter /></Gate></ProtectedRoute>} />
      <Route path="/communication/history"       element={<ProtectedRoute roles={['super_admin','admin','hr']}><Gate pageCode="COMM_HISTORY"><NativeDispatchHistory /></Gate></ProtectedRoute>} />
      <Route path="/communication/preferences"   element={<ProtectedRoute><NativeNotificationPreferences /></ProtectedRoute>} />
      <Route path="/settings/communication-config" element={<ProtectedRoute roles={['super_admin','admin']}><Suspense fallback={<PageLoader />}><Gate pageCode="COMM_CONFIG"><NativeCommunicationConfig /></Gate></Suspense></ProtectedRoute>} />
    <Route path="/communication/email-centre" element={<ProtectedRoute><Gate pageCode="EMAIL_COMMAND_CENTRE"><NativeEmailCommandCentre /></Gate></ProtectedRoute>} />
      <Route path="/settings/call-centre-config" element={<ProtectedRoute roles={['super_admin','admin']}><Gate pageCode="CALL_CENTRE_CONFIG"><NativeCallCentreConfig /></Gate></ProtectedRoute>} />
  </>
);
