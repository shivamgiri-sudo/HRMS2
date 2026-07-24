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

const Settings                      = lazy(() => import("@/pages/Settings"));
const Profile                       = lazy(() => import("@/pages/Profile"));
const NativeAssetsManager           = lazy(() => import("@/pages/NativeAssetsManager"));
const NativeHelpdesk                = lazy(() => import("@/pages/NativeHelpdesk"));
const NativeSupportCommandCenter    = lazy(() => import("@/pages/NativeSupportCommandCenter"));
const NativeGrievanceCommandCenter  = lazy(() => import("@/pages/NativeGrievanceCommandCenter"));
const NativeLetters                 = lazy(() => import("@/pages/NativeLetters"));
const NativeLetterPreview           = lazy(() => import("@/pages/NativeLetterPreview"));
const NativeAppointmentEsign          = lazy(() => import("@/pages/NativeAppointmentEsign"));
const NativeDocumentVerification    = lazy(() => import("@/pages/NativeDocumentVerification"));
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
const NativeBadges                  = lazy(() => import("@/pages/NativeBadges"));
const NativeKudos                   = lazy(() => import("@/pages/NativeKudos"));
const NativeSurveys                 = lazy(() => import("@/pages/NativeSurveys"));
const NativeLeaderboard             = lazy(() => import("@/pages/NativeLeaderboard"));
const NativeReportsCenter           = lazy(() => import("@/pages/NativeReportsCenterV2"));
const LiveLocationMap               = lazy(() => import("@/pages/LiveLocationMap"));
const BulkUploadHub                 = lazy(() => import("@/pages/BulkUploadHub"));
const Departments                   = lazy(() => import("@/pages/Departments"));
const CompanyCalendar               = lazy(() => import("@/pages/CompanyCalendar"));
const NotificationPreferences       = lazy(() => import("@/pages/NotificationPreferences"));
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
const NativeCallCentreConfig         = lazy(() => import("@/pages/NativeCallCentreConfig"));

export const platformRouteElements = (
  <>
      {/* Core platform */}
      <Route path="/settings"        element={<ProtectedRoute><Settings /></ProtectedRoute>} />
      <Route path="/profile"         element={<ProtectedRoute><Gate pageCode="MY_PROFILE"><Profile /></Gate></ProtectedRoute>} />
      <Route path="/departments"     element={<ProtectedRoute><Departments /></ProtectedRoute>} />
      <Route path="/calendar"        element={<ProtectedRoute><CompanyCalendar /></ProtectedRoute>} />
      <Route path="/notifications"   element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
      <Route path="/notification-preferences" element={<ProtectedRoute><NotificationPreferences /></ProtectedRoute>} />
      <Route path="/modules"         element={<ProtectedRoute><ModuleLauncher /></ProtectedRoute>} />
      <Route path="/changelog"       element={<ProtectedRoute><Changelog /></ProtectedRoute>} />
      <Route path="/bulk-upload"     element={<ProtectedRoute roles={['admin','hr','super_admin','wfm','payroll','payroll_hr']}><BulkUploadHub /></ProtectedRoute>} />
      <Route path="/assets"          element={<ProtectedRoute><Assets /></ProtectedRoute>} />
      <Route path="/onboarding"      element={<ProtectedRoute roles={['admin','hr']}><Onboarding /></ProtectedRoute>} />
      <Route path="/onboarding-requests" element={<Navigate to="/onboarding?tab=requests" replace />} />

      {/* Assets / documents */}
      <Route path="/assets-manager"       element={<ProtectedRoute><Gate pageCode="ASSETS_MANAGER"><NativeAssetsManager /></Gate></ProtectedRoute>} />
      <Route path="/document-verification" element={<ProtectedRoute><Gate pageCode="EMPLOYEE_MANAGEMENT"><NativeDocumentVerification /></Gate></ProtectedRoute>} />

      {/* Letters */}
      <Route path="/letters"                   element={<ProtectedRoute><Gate pageCode="LETTERS"><NativeLetters /></Gate></ProtectedRoute>} />
      <Route path="/letters/:id/preview"       element={<ProtectedRoute><NativeLetterPreview /></ProtectedRoute>} />
      <Route path="/letters/appointment-esign" element={<ProtectedRoute><Gate pageCode="APPOINTMENT_ESIGN"><NativeAppointmentEsign /></Gate></ProtectedRoute>} />
      {/* /employee/joining-documents/esign/:token and /employee/epf-compliance/review/:token are in public.routes */}

      {/* Helpdesk / Support */}
      <Route path="/helpdesk"                        element={<ProtectedRoute><Gate pageCode="HELPDESK"><NativeHelpdesk /></Gate></ProtectedRoute>} />
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
      <Route path="/migration-console"            element={<ProtectedRoute roles={['admin']}><NativeMigrationConsole /></ProtectedRoute>} />
      <Route path="/audit-log"                    element={<ProtectedRoute roles={['admin','super_admin','hr','payroll_head','wfm']}><NativeAuditLog /></ProtectedRoute>} />

      {/* Security / access */}
      <Route path="/security-center"             element={<ProtectedRoute roles={['admin','ceo','coo','hr']}><NativeSecurityCenter /></ProtectedRoute>} />
      <Route path="/settings/access-control"     element={<ProtectedRoute><Gate pageCode="ACCESS_CONTROL"><UnifiedAccessControl /></Gate></ProtectedRoute>} />
      <Route path="/super-admin/page-access"     element={<ProtectedRoute roles={['admin']}><SuperAdminAccessControl /></ProtectedRoute>} />
      <Route path="/super-admin/module-access"   element={<ProtectedRoute roles={['admin']}><SuperAdminModuleAccess /></ProtectedRoute>} />
      <Route path="/super-admin/policy-engine"   element={<ProtectedRoute roles={['super_admin']}><NativePolicyEngine /></ProtectedRoute>} />
      <Route path="/super-admin/company-feed-creators" element={<ProtectedRoute roles={['super_admin']}><NativeCompanyFeedCreatorAccess /></ProtectedRoute>} />
      <Route path="/super-admin/live-location"   element={<ProtectedRoute roles={['super_admin']}><LiveLocationMap /></ProtectedRoute>} />

      {/* AI / Copilot */}
      <Route path="/settings/ai-providers"       element={<ProtectedRoute roles={['super_admin']}><AIProviderSettings /></ProtectedRoute>} />
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
      <Route path="/control-tower"               element={<ProtectedRoute roles={['admin','super_admin','hr','manager']}><NativeControlTower /></ProtectedRoute>} />

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

      {/* Reports */}
      <Route path="/reports"                     element={<ProtectedRoute roles={['super_admin','admin','hr','hr_head','finance','payroll','wfm','manager','process_manager','branch_head','ceo','quality','operations']}><Gate pageCode="REPORTS_CENTER"><NativeReportsCenter /></Gate></ProtectedRoute>} />

      {/* Communication */}
      <Route path="/communication/templates"     element={<ProtectedRoute roles={['admin','hr']}><NativeTemplateManager /></ProtectedRoute>} />
      <Route path="/settings/email-templates/bulk-import" element={<ProtectedRoute roles={['admin','super_admin']}><Suspense fallback={<PageLoader />}><NativeEmailTemplateBulkImport /></Suspense></ProtectedRoute>} />
      <Route path="/communication/dispatch"      element={<ProtectedRoute roles={['admin','hr']}><NativeDispatchCenter /></ProtectedRoute>} />
      <Route path="/communication/history"       element={<ProtectedRoute roles={['admin','hr']}><NativeDispatchHistory /></ProtectedRoute>} />
      <Route path="/communication/preferences"   element={<ProtectedRoute><NativeNotificationPreferences /></ProtectedRoute>} />
      <Route path="/settings/communication-config" element={<ProtectedRoute roles={['admin']}><Suspense fallback={<PageLoader />}><NativeCommunicationConfig /></Suspense></ProtectedRoute>} />
      <Route path="/settings/call-centre-config" element={<ProtectedRoute roles={['admin']}><NativeCallCentreConfig /></ProtectedRoute>} />
  </>
);
