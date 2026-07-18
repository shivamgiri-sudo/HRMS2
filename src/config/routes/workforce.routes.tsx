import { Route, Navigate } from "react-router-dom";
import { lazy } from "./lazy";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import WorkforcePageGate from "@/components/security/WorkforcePageGate";

const Gate = ({ pageCode, children }: { pageCode: string; children: React.ReactNode }) =>
  <WorkforcePageGate pageCode={pageCode}>{children}</WorkforcePageGate>;

const Attendance                   = lazy(() => import("@/pages/Attendance"));
const AttendanceRegularization     = lazy(() => import("@/pages/AttendanceRegularization"));
const AdminAttendanceView          = lazy(() => import("@/pages/AdminAttendanceView"));
const NativeAttendanceDisputes     = lazy(() => import("@/pages/NativeAttendanceDisputes"));
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
const BreakReports                 = lazy(() => import("@/pages/BreakReports"));
const WeekoffFairness              = lazy(() => import("@/pages/wfm/WeekoffFairness"));

export function WorkforceRoutes() {
  return (
    <>
      {/* Attendance */}
      <Route path="/attendance" element={<ProtectedRoute><Attendance /></ProtectedRoute>} />
      {/* CANONICAL regularization route: /attendance-regularization */}
      <Route path="/attendance-regularization" element={<ProtectedRoute><Gate pageCode="ATTENDANCE_REGULARIZATION"><AttendanceRegularization /></Gate></ProtectedRoute>} />
      {/* Duplicate eliminated — redirect to canonical */}
      <Route path="/attendance/regularizations" element={<Navigate to="/attendance-regularization" replace />} />
      <Route path="/attendance/disputes"        element={<ProtectedRoute><NativeAttendanceDisputes /></ProtectedRoute>} />
      <Route path="/attendance/billing-config"  element={<ProtectedRoute><NativeAttendanceBillingConfig /></ProtectedRoute>} />
      <Route path="/wfm/mismatch-queue"         element={<ProtectedRoute><NativeAttendanceMismatchQueue /></ProtectedRoute>} />
      <Route path="/wfm/attendance-exceptions"  element={<ProtectedRoute><Gate pageCode="WFM_LIVE_TRACKER"><NativeAttendanceExceptionEngine /></Gate></ProtectedRoute>} />
      <Route path="/attendance-rules-master"    element={<ProtectedRoute roles={['admin','hr']}><NativeAttendanceRulesMaster /></ProtectedRoute>} />
      <Route path="/hr/attendance-lookup"       element={
        <ProtectedRoute roles={['super_admin','admin','hr','payroll_head','payroll_admin','wfm']}>
          <AdminAttendanceView />
        </ProtectedRoute>
      } />

      {/* Leave */}
      <Route path="/leaves"       element={<ProtectedRoute><Leaves /></ProtectedRoute>} />
      <Route path="/leave-approvals" element={<Navigate to="/leaves" replace />} />
      <Route path="/leave-types"  element={<ProtectedRoute><Gate pageCode="LEAVE_TYPES"><NativeLeaveTypeConfig /></Gate></ProtectedRoute>} />
      <Route path="/maternity-leave" element={<ProtectedRoute roles={['admin','hr']}><NativeMaternityLeave /></ProtectedRoute>} />

      {/* WFM / Roster */}
      <Route path="/wfm/roster"        element={<ProtectedRoute><Gate pageCode="WFM_ROSTER"><NativeWFMRoster /></Gate></ProtectedRoute>} />
      <Route path="/wfm-roster"        element={<Navigate to="/wfm/roster" replace />} />
      <Route path="/wfm/extensions"    element={<ProtectedRoute><Gate pageCode="WFM_EXTENSIONS"><NativeWFMExtensions /></Gate></ProtectedRoute>} />
      <Route path="/wfm-manager-approvals" element={<ProtectedRoute><Gate pageCode="WFM_ROSTER"><NativeWFMManagerApproval /></Gate></ProtectedRoute>} />
      <Route path="/wfm/planning-rules"  element={<ProtectedRoute roles={['super_admin','admin','wfm']}><NativeWFMPlanningRules /></ProtectedRoute>} />
      <Route path="/wfm/slot-requirements" element={<ProtectedRoute roles={['super_admin','admin','wfm']}><NativeSlotRequirementBuilder /></ProtectedRoute>} />
      <Route path="/wfm/auto-roster"   element={<ProtectedRoute><Gate pageCode="WFM_AUTO_ROSTER"><NativeWFMAutoRoster /></Gate></ProtectedRoute>} />
      <Route path="/wfm/weekoff-day-rules" element={<ProtectedRoute roles={['super_admin','admin','wfm']}><NativeWeekOffDayRuleConfig /></ProtectedRoute>} />
      <Route path="/wfm/weekoff-fairness"  element={<ProtectedRoute roles={['super_admin','admin','wfm']}><WeekoffFairness /></ProtectedRoute>} />
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
        <ProtectedRoute roles={['super_admin','admin','branch_head','operations_manager']}>
          <NativeBusinessCommandCenter />
        </ProtectedRoute>
      } />
      <Route path="/business-actions" element={
        <ProtectedRoute roles={['super_admin','admin','branch_head','operations_manager']}>
          <NativeBusinessActionQueue />
        </ProtectedRoute>
      } />

      {/* Break management — CANONICAL device route: /wfm/break-desk-devices */}
      <Route path="/wfm/break-desk-devices" element={<ProtectedRoute roles={['super_admin','admin','wfm']}><BreakDeskDevices /></ProtectedRoute>} />
      {/* Duplicate eliminated — redirect to canonical */}
      <Route path="/break-management/devices" element={<Navigate to="/wfm/break-desk-devices" replace />} />
      <Route path="/break-reports" element={<ProtectedRoute roles={['super_admin','admin','hr','wfm','manager','process_manager']}><BreakReports /></ProtectedRoute>} />
    </>
  );
}
