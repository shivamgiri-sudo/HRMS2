import { Route, Navigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { lazy } from "./lazy";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import WorkforcePageGate from "@/components/security/WorkforcePageGate";

const Gate = ({ pageCode, children }: { pageCode: string; children: React.ReactNode }) =>
  <WorkforcePageGate pageCode={pageCode}>{children}</WorkforcePageGate>;

const Attendance                   = lazy(() => import("@/pages/Attendance"));
const BiometricPunchLogs           = lazy(() => import("@/pages/BiometricPunchLogs"));
const AttendanceRegularization     = lazy(() => import("@/pages/AttendanceRegularization"));
const AdminAttendanceView          = lazy(() => import("@/pages/AdminAttendanceView"));
const TeamAttendanceMonth          = lazy(() => import("@/pages/wfm/TeamAttendanceMonth"));
const NativeAttendanceDisputes     = lazy(() => import("@/pages/NativeAttendanceDisputes"));
const NativeDiscardCenter          = lazy(() => import("@/pages/NativeDiscardCenter"));
const NativeAttendanceMismatchQueue = lazy(() => import("@/pages/NativeAttendanceMismatchQueue"));
const NativeAttendanceExceptionEngine = lazy(() => import("@/pages/NativeAttendanceExceptionEngine"));
const NativeAttendanceRulesMaster  = lazy(() => import("@/pages/NativeAttendanceRulesMaster"));
const NativeAttendanceBillingConfig = lazy(() => import("@/pages/NativeAttendanceBillingConfig"));
const Leaves                       = lazy(() => import("@/pages/Leaves"));
const NativeLeaveTypeConfig        = lazy(() => import("@/pages/NativeLeaveTypeConfig"));
const NativeMaternityLeave         = lazy(() => import("@/pages/NativeMaternityLeave"));
const NativeWFMRoster              = lazy(() => import("@/pages/NativeWFMRoster"));
const NativeWFMExtensions          = lazy(() => import("@/pages/NativeWFMExtensions"));
const NativeWFMManagerApproval     = lazy(() => import("@/pages/NativeWFMManagerApproval"));
const NativeWFMAutoRoster          = lazy(() => import("@/pages/NativeWFMAutoRoster"));
const NativeWFMPlanningRules       = lazy(() => import("@/pages/NativeWFMPlanningRules"));
const NativeSlotRequirementBuilder = lazy(() => import("@/pages/NativeSlotRequirementBuilder"));
const NativeWeekOffDayRuleConfig   = lazy(() => import("@/pages/NativeWeekOffDayRuleConfig"));
const NativeWFMRestPolicyConfig    = lazy(() => import("@/pages/NativeWFMRestPolicyConfig"));
const NativeWeekOffDefaultConfig   = lazy(() => import("@/pages/NativeWeekOffDefaultConfig"));
const NativeWeekOffPreferences     = lazy(() => import("@/pages/NativeWeekOffPreferences"));
const NativeRosterPreference       = lazy(() => import("@/pages/NativeRosterPreference"));
const NativeMyRoster               = lazy(() => import("@/pages/NativeMyRoster"));
const NativeRosterManagerQueue     = lazy(() => import("@/pages/NativeRosterManagerQueue"));
const NativeRosterMasterBuilder    = lazy(() => import("@/pages/NativeRosterMasterBuilder"));
const NativeRosterCapacityConfig   = lazy(() => import("@/pages/NativeRosterCapacityConfig"));
const NativeBiometricCommandCenter = lazy(() => import("@/pages/NativeBiometricCommandCenter"));
const NativeCosecSyncMonitoring    = lazy(() => import("@/pages/NativeCosecSyncMonitoring"));
const NativeWorkforcePlanning      = lazy(() => import("@/pages/NativeWorkforcePlanning"));
const NativeRTABoard               = lazy(() => import("@/pages/NativeRTABoard"));
const NativeBusinessCommandCenter  = lazy(() => import("@/pages/NativeBusinessCommandCenter"));
const NativeBusinessActionQueue    = lazy(() => import("@/pages/NativeBusinessActionQueue"));
const BreakDeskDevices             = lazy(() => import("@/pages/BreakDeskDevices"));
// BreakReports moved into ReportsHub — route redirects to hub
const WeekoffFairness              = lazy(() => import("@/pages/wfm/WeekoffFairness"));
const NativeBranchWFMSpocConfig    = lazy(() => import("@/pages/NativeBranchWFMSpocConfig"));
const RosterWorkspace              = lazy(() => import("@/pages/wfm/RosterWorkspace"));
const RosterPipelinePage           = lazy(() => import("@/pages/wfm/RosterPipelinePage"));

export const workforceRouteElements = (
  <>
      {/* Attendance */}
      <Route path="/attendance" element={<ProtectedRoute><Attendance /></ProtectedRoute>} />
      <Route path="/attendance/biometric-logs" element={<ProtectedRoute><BiometricPunchLogs /></ProtectedRoute>} />
      <Route path="/attendance/biometric-logs/:employeeId" element={<ProtectedRoute><BiometricPunchLogs /></ProtectedRoute>} />
      {/* CANONICAL regularization route: /attendance-regularization */}
      <Route path="/attendance-regularization" element={<ProtectedRoute><Gate pageCode="ATTENDANCE_REGULARIZATION"><AttendanceRegularization /></Gate></ProtectedRoute>} />
      {/* Duplicate eliminated — redirect to canonical */}
      <Route path="/attendance/regularizations" element={<Navigate to="/attendance-regularization" replace />} />
      <Route path="/attendance/disputes"        element={<ProtectedRoute><Gate pageCode="ATTENDANCE_DISPUTES"><NativeAttendanceDisputes /></Gate></ProtectedRoute>} />
      {/* Audit surface for reversed approvals. Discards themselves are performed
          inline on the Leaves / Regularization / Disputes pages. */}
      <Route path="/admin/discard-center"       element={<ProtectedRoute roles={['super_admin','wfm']}><Gate pageCode="DISCARD_CENTER"><NativeDiscardCenter /></Gate></ProtectedRoute>} />
      <Route path="/attendance/billing-config"  element={<ProtectedRoute><Gate pageCode="ATTENDANCE_BILLING_CONFIG"><DashboardLayout><NativeAttendanceBillingConfig /></DashboardLayout></Gate></ProtectedRoute>} />
      <Route path="/wfm/mismatch-queue"         element={<ProtectedRoute><Gate pageCode="WFM_LIVE_TRACKER"><DashboardLayout><NativeAttendanceMismatchQueue /></DashboardLayout></Gate></ProtectedRoute>} />
      {/* Requires migration 1083 to have been applied — prod runs SKIP_MIGRATIONS=true, so
          deploying this ahead of the seed leaves the page dark for every role. */}
      <Route path="/wfm/attendance-exceptions"  element={<ProtectedRoute><Gate pageCode="WFM_ATTENDANCE_EXCEPTIONS"><NativeAttendanceExceptionEngine /></Gate></ProtectedRoute>} />
      <Route path="/attendance-rules-master"    element={<ProtectedRoute roles={['super_admin','admin','hr']}><Gate pageCode="ATTENDANCE_RULES_MASTER"><NativeAttendanceRulesMaster /></Gate></ProtectedRoute>} />
      <Route path="/hr/attendance-lookup"       element={
        <ProtectedRoute roles={['super_admin','admin','hr','payroll_head','payroll_admin','wfm']}>
          <Gate pageCode="ATTENDANCE_LOOKUP"><AdminAttendanceView /></Gate>
        </ProtectedRoute>
      } />
      {/* Manager closure screen: whole team, whole month, one page. The backend
          scopes rows to direct reports on its own — these roles gate who may ask,
          not whose data comes back. pageCode must stay identical here, in
          pageRoutePageCodes.ts and in navConfig.tsx or nav and access disagree. */}
      <Route path="/wfm/team-attendance"        element={
        <ProtectedRoute roles={['super_admin','admin','hr','wfm','manager','assistant_manager','tl','team_leader','process_manager','branch_head']}>
          {/* TEAM_ATTENDANCE, not TEAM_ATTENDANCE_MONTH: the latter exists in no migration, so
              the page gate denied everyone. TEAM_ATTENDANCE is the code the grants were
              actually issued against (102_role_page_access_seed, 309, and tq_head in the RBAC
              matrix). See 1101_team_attendance_page_path_fix.sql. */}
          <Gate pageCode="TEAM_ATTENDANCE"><DashboardLayout><TeamAttendanceMonth /></DashboardLayout></Gate>
        </ProtectedRoute>
      } />

      {/* Leave */}
      <Route path="/leaves"       element={<ProtectedRoute><Leaves /></ProtectedRoute>} />
      <Route path="/leave-approvals" element={<Navigate to="/leaves" replace />} />
      <Route path="/leave/requests"  element={<Navigate to="/leaves" replace />} />
      <Route path="/leave-types"  element={<ProtectedRoute><Gate pageCode="LEAVE_TYPES"><NativeLeaveTypeConfig /></Gate></ProtectedRoute>} />
      <Route path="/maternity-leave" element={<ProtectedRoute roles={['super_admin','admin','hr']}><Gate pageCode="MATERNITY_LEAVE"><NativeMaternityLeave /></Gate></ProtectedRoute>} />

      {/* WFM / Roster */}
      <Route path="/wfm/roster"        element={<ProtectedRoute><Gate pageCode="WFM_ROSTER"><NativeWFMRoster /></Gate></ProtectedRoute>} />
      <Route path="/wfm-roster"        element={<Navigate to="/wfm/roster" replace />} />
      <Route path="/wfm/roster-workspace" element={<ProtectedRoute><Gate pageCode="WFM_ROSTER"><RosterWorkspace /></Gate></ProtectedRoute>} />
      <Route path="/wfm/roster-pipeline"   element={<ProtectedRoute><Gate pageCode="WFM_ROSTER"><RosterPipelinePage /></Gate></ProtectedRoute>} />
      <Route path="/wfm/extensions"    element={<ProtectedRoute><Gate pageCode="WFM_EXTENSIONS"><NativeWFMExtensions /></Gate></ProtectedRoute>} />
      <Route path="/wfm-manager-approvals" element={<ProtectedRoute><Gate pageCode="WFM_ROSTER"><NativeWFMManagerApproval /></Gate></ProtectedRoute>} />
      <Route path="/wfm/planning-rules"  element={<ProtectedRoute roles={['super_admin','admin','wfm']}><Gate pageCode="WFM_PLANNING_RULES"><NativeWFMPlanningRules /></Gate></ProtectedRoute>} />
      <Route path="/wfm/slot-requirements" element={<ProtectedRoute roles={['super_admin','admin','wfm']}><Gate pageCode="WFM_SLOT_REQUIREMENTS"><NativeSlotRequirementBuilder /></Gate></ProtectedRoute>} />
      <Route path="/wfm/auto-roster"   element={<ProtectedRoute><Gate pageCode="WFM_AUTO_ROSTER"><NativeWFMAutoRoster /></Gate></ProtectedRoute>} />
      <Route path="/wfm/weekoff-day-rules" element={<ProtectedRoute roles={['super_admin','admin','wfm']}><Gate pageCode="WFM_WEEKOFF_DAY_RULES"><NativeWeekOffDayRuleConfig /></Gate></ProtectedRoute>} />
      {/* No Gate pageCode here (unlike siblings above): canViewPage() fails closed for any
          pageCode absent from the page-access catalog, and adding one is a production data
          seed outside what a code change should do unreviewed. roles={...} is the live
          enforcement for these two routes; the real security boundary is the backend RBAC.
          Deliberately DIFFERENT role lists on the two routes below, not copy-pasted — a
          same-day self-audit found nav had promised both pages to hr/manager while both
          routes actually gated to admin/wfm only, so any hr/manager user clicking the nav
          link landed on "Access Denied". Fixed by matching each route's roles to what its
          OWN backend genuinely allows to read (they differ):
            - /api/wfm/rest-policy GET is requireRole(admin,super_admin,wfm,hr) — no manager.
            - /api/roster-gov/week-off-policy-default GET has no role check beyond requireAuth
              (roster.governance.routes.ts — a different session's already-shipped CRUD for
              the same week_off_policy_default table, reused here rather than duplicated) —
              open to hr and manager too. Both pages' writes stay admin/wfm-only regardless;
              a hr/manager viewer just can't submit the form, same as any other read-only role
              here. A pageCode can be added later by whoever administers the access catalog. */}
      <Route path="/wfm/rest-policy"       element={<ProtectedRoute roles={['super_admin','admin','wfm','hr']}><NativeWFMRestPolicyConfig /></ProtectedRoute>} />
      <Route path="/wfm/week-off-default"  element={<ProtectedRoute roles={['super_admin','admin','wfm','hr','manager']}><NativeWeekOffDefaultConfig /></ProtectedRoute>} />
      <Route path="/wfm/weekoff-fairness"  element={<ProtectedRoute roles={['super_admin','admin','wfm']}><Gate pageCode="WFM_WEEKOFF_FAIRNESS"><WeekoffFairness /></Gate></ProtectedRoute>} />
      <Route path="/workforce-planning" element={<ProtectedRoute><Gate pageCode="WFM_AUTO_ROSTER"><NativeWorkforcePlanning /></Gate></ProtectedRoute>} />

      {/* Roster self-service */}
      <Route path="/my-roster"              element={<ProtectedRoute><NativeMyRoster /></ProtectedRoute>} />
      <Route path="/roster-preference"      element={<ProtectedRoute><Gate pageCode="WFM_ROSTER"><NativeRosterPreference /></Gate></ProtectedRoute>} />
      <Route path="/week-off-preferences"   element={<ProtectedRoute><NativeWeekOffPreferences /></ProtectedRoute>} />
      <Route path="/roster-master-builder"  element={<ProtectedRoute><Gate pageCode="ROSTER_MASTER"><NativeRosterMasterBuilder /></Gate></ProtectedRoute>} />
      <Route path="/roster-capacity-config" element={<ProtectedRoute><Gate pageCode="ROSTER_MASTER"><NativeRosterCapacityConfig /></Gate></ProtectedRoute>} />

      {/* Live tracker / biometric */}
      <Route path="/wfm/live-tracker"              element={<ProtectedRoute><Gate pageCode="WFM_LIVE_TRACKER"><NativeBiometricCommandCenter /></Gate></ProtectedRoute>} />
      <Route path="/wfm/adherence-command-center"  element={<Navigate to="/wfm/live-tracker" replace />} />
      <Route path="/wfm/agent-attendance-view"     element={<Navigate to="/wfm/live-tracker" replace />} />
      <Route path="/wfm/cosec-monitoring"          element={<ProtectedRoute><Gate pageCode="WFM_LIVE_TRACKER"><NativeCosecSyncMonitoring /></Gate></ProtectedRoute>} />

      {/* RTA */}
      <Route path="/rta-board" element={<ProtectedRoute><Gate pageCode="RTA_BOARD"><NativeRTABoard /></Gate></ProtectedRoute>} />

      {/* Business command */}
      <Route path="/business-command-center" element={
        <ProtectedRoute roles={['super_admin','admin','branch_head','operations_manager','ceo','coo','hr','manager','process_manager']}>
          <Gate pageCode="BUSINESS_COMMAND_CENTER"><NativeBusinessCommandCenter /></Gate>
        </ProtectedRoute>
      } />
      <Route path="/business-actions" element={
        <ProtectedRoute roles={['super_admin','admin','branch_head','operations_manager','ceo','coo','hr','manager','process_manager','team_leader','tl']}>
          <Gate pageCode="BUSINESS_ACTION_QUEUE"><NativeBusinessActionQueue /></Gate>
        </ProtectedRoute>
      } />

      {/* WFM SPOC Config — admin only */}
      <Route path="/wfm/branch-spoc-config" element={<ProtectedRoute roles={['super_admin','admin']}><Gate pageCode="WFM_BRANCH_SPOC_CONFIG"><NativeBranchWFMSpocConfig /></Gate></ProtectedRoute>} />

      {/* Break management — CANONICAL device route: /wfm/break-desk-devices */}
      <Route path="/wfm/break-desk-devices" element={<ProtectedRoute roles={['super_admin','admin','wfm']}><Gate pageCode="WFM_BREAK_DESK_DEVICES"><BreakDeskDevices /></Gate></ProtectedRoute>} />
      {/* Duplicate eliminated — redirect to canonical */}
      <Route path="/break-management/devices" element={<Navigate to="/wfm/break-desk-devices" replace />} />
      <Route path="/break-reports" element={<Navigate to="/reports?view=library&report=break-daily-summary" replace />} />
      <Route path="/break-session-log" element={<Navigate to="/reports?view=library&report=break-session-log" replace />} />
  </>
);
