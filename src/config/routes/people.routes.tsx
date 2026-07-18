import { Route, Navigate } from "react-router-dom";
import { lazy } from "./lazy";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import WorkforcePageGate from "@/components/security/WorkforcePageGate";

const Gate = ({ pageCode, children }: { pageCode: string; children: React.ReactNode }) =>
  <WorkforcePageGate pageCode={pageCode}>{children}</WorkforcePageGate>;

const Employees                  = lazy(() => import("@/pages/Employees"));
const NativeEmployee360          = lazy(() => import("@/pages/NativeEmployee360"));
const NativeEmployeeStatCard     = lazy(() => import("@/pages/NativeEmployeeStatCard"));
const NativeOrgChart             = lazy(() => import("@/pages/NativeOrgChart"));
const OrgChartSettings           = lazy(() => import("@/pages/OrgChartSettings"));
const EmployeeJoiningDocumentsPage  = lazy(() => import("@/pages/EmployeeJoiningDocumentsPage"));
const JoiningDocumentsTrackerPage   = lazy(() => import("@/pages/JoiningDocumentsTrackerPage"));
const JoiningDocumentTemplateAdmin  = lazy(() => import("@/pages/JoiningDocumentTemplateAdmin"));
const EmployeeEpfCompliancePage     = lazy(() => import("@/pages/EmployeeEpfCompliancePage"));
const NativeEmployeeReactivation    = lazy(() => import("@/pages/NativeEmployeeReactivation"));
const NativeEmployeeBGVStatus       = lazy(() => import("@/pages/NativeEmployeeBGVStatus"));
const NativeLifecycle               = lazy(() => import("@/pages/NativeLifecycle"));
const NativeEmployeeLifecycle       = lazy(() => import("@/pages/NativeEmployeeLifecycle"));
const NativePeopleExperienceCommandCenter = lazy(() => import("@/pages/NativePeopleExperienceCommandCenter"));
const NativeMyResignation           = lazy(() => import("@/pages/NativeMyResignation"));
const NativeExitCommandCenter       = lazy(() => import("@/pages/NativeExitCommandCenter"));
const NativeExitManagement          = lazy(() => import("@/pages/NativeExitManagement"));
const MyTeamPage                    = lazy(() => import("@/pages/MyTeamPage"));
const EmployeeJourney               = lazy(() => import("@/pages/EmployeeJourney"));

export const peopleRouteElements = (
  <>
      {/* Employee directory */}
      <Route path="/employees" element={<ProtectedRoute><Gate pageCode="EMPLOYEE_MANAGEMENT"><Employees /></Gate></ProtectedRoute>} />
      <Route path="/employees/:id/360" element={<ProtectedRoute><Gate pageCode="EMPLOYEE_MANAGEMENT"><NativeEmployee360 /></Gate></ProtectedRoute>} />
      <Route path="/employees/:id" element={<ProtectedRoute><Gate pageCode="EMPLOYEE_MANAGEMENT"><NativeEmployeeStatCard /></Gate></ProtectedRoute>} />
      <Route path="/employee-stat-card" element={<Navigate to="/employees" replace />} />
      <Route path="/employee-stat-card/:id" element={<ProtectedRoute><NativeEmployeeStatCard /></ProtectedRoute>} />

      {/* Org chart */}
      <Route path="/org-chart" element={<ProtectedRoute><Gate pageCode="ORG_CHART"><NativeOrgChart /></Gate></ProtectedRoute>} />
      <Route path="/org-chart/settings" element={<ProtectedRoute><OrgChartSettings /></ProtectedRoute>} />

      {/* Joining documents */}
      <Route path="/employees/:employeeId/joining-documents" element={
        <ProtectedRoute roles={['admin','super_admin','hr','manager','payroll_hr','payroll','employee']}>
          <EmployeeJoiningDocumentsPage />
        </ProtectedRoute>
      } />
      <Route path="/ats/joining-documents-tracker" element={
        <ProtectedRoute roles={['admin','super_admin','hr','payroll_hr','branch_head']}>
          <Gate pageCode="ATS_JOINING_DOCUMENTS_TRACKER"><JoiningDocumentsTrackerPage /></Gate>
        </ProtectedRoute>
      } />
      <Route path="/settings/document-templates" element={
        <ProtectedRoute roles={['admin','super_admin','hr']}>
          <JoiningDocumentTemplateAdmin />
        </ProtectedRoute>
      } />

      {/* EPF compliance */}
      <Route path="/employees/:employeeId/epf-compliance" element={
        <ProtectedRoute roles={['admin','super_admin','hr','manager','payroll_hr','payroll','employee']}>
          <EmployeeEpfCompliancePage />
        </ProtectedRoute>
      } />

      {/* Reactivation */}
      <Route path="/employees/reactivation" element={
        <ProtectedRoute roles={['hr','admin','super_admin','branch_head','payroll_head']}>
          <NativeEmployeeReactivation />
        </ProtectedRoute>
      } />

      {/* BGV status */}
      <Route path="/employees/bgv-status" element={<ProtectedRoute><NativeEmployeeBGVStatus /></ProtectedRoute>} />
      <Route path="/employees/bgv-status/:employeeId" element={
        <ProtectedRoute roles={['admin','hr','payroll','super_admin']}>
          <NativeEmployeeBGVStatus />
        </ProtectedRoute>
      } />

      {/* Employee lifecycle — CANONICAL: /employee-lifecycle */}
      <Route path="/employee-lifecycle" element={<ProtectedRoute><Gate pageCode="EMPLOYEE_LIFECYCLE"><NativeLifecycle /></Gate></ProtectedRoute>} />
      {/* LEGACY: /employee-lifecycle-v2 — separate component; kept pending convergence review */}
      <Route path="/employee-lifecycle-v2" element={<ProtectedRoute><Gate pageCode="EMPLOYEE_LIFECYCLE"><NativeEmployeeLifecycle /></Gate></ProtectedRoute>} />

      {/* Exit */}
      <Route path="/exit/command-center" element={<ProtectedRoute><Gate pageCode="EXIT_COMMAND_CENTER"><NativeExitCommandCenter /></Gate></ProtectedRoute>} />
      {/* LEGACY: /exit-management uses different component — kept pending convergence review */}
      <Route path="/exit-management" element={<ProtectedRoute><Gate pageCode="EXIT_COMMAND_CENTER"><NativeExitManagement /></Gate></ProtectedRoute>} />
      <Route path="/exit/resignation" element={<ProtectedRoute><Gate pageCode="RESIGNATION_MY_REQUEST"><NativeMyResignation /></Gate></ProtectedRoute>} />
      <Route path="/exit/resignation-command-center" element={
        <ProtectedRoute roles={['admin','hr','manager','finance','payroll','super_admin']}>
          <Gate pageCode="RESIGNATION_COMMAND_CENTER"><NativeExitCommandCenter /></Gate>
        </ProtectedRoute>
      } />

      {/* People experience */}
      <Route path="/people-experience/command-center" element={
        <ProtectedRoute roles={['admin','hr','ceo','coo','manager','process_manager','team_leader','tl','branch_head','employee']}>
          <NativePeopleExperienceCommandCenter />
        </ProtectedRoute>
      } />
      <Route path="/engagement/command-center" element={<Navigate to="/people-experience/command-center" replace />} />

      {/* Team */}
      <Route path="/my-team" element={
        <ProtectedRoute roles={['manager','process_manager','tl','team_leader','assistant_manager','branch_head','admin','hr']}>
          <MyTeamPage />
        </ProtectedRoute>
      } />
      <Route path="/employee-journey" element={<ProtectedRoute><EmployeeJourney /></ProtectedRoute>} />
  </>
);
