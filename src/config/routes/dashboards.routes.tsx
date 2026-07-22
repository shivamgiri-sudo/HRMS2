import { Route } from "react-router-dom";
import { lazy } from "./lazy";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import WorkforcePageGate from "@/components/security/WorkforcePageGate";

const Gate = ({ pageCode, children }: { pageCode: string; children: React.ReactNode }) =>
  <WorkforcePageGate pageCode={pageCode}>{children}</WorkforcePageGate>;

const Index                    = lazy(() => import("@/pages/Index"));
const CeoDashboard             = lazy(() => import("@/pages/dashboards/CeoDashboard"));
const PayrollHrDashboard       = lazy(() => import("@/pages/dashboards/PayrollHrDashboard"));
const WfmDashboard             = lazy(() => import("@/pages/dashboards/WfmDashboard"));
const HrDashboard              = lazy(() => import("@/pages/dashboards/HrDashboard"));
const EmployeeSelfDashboard    = lazy(() => import("@/pages/dashboards/EmployeeSelfDashboard"));
const ManagerDashboard         = lazy(() => import("@/pages/dashboards/ManagerDashboard"));
const QualityDashboardRole     = lazy(() => import("@/pages/dashboards/QualityDashboardRole"));
const OperationsDashboardRole  = lazy(() => import("@/pages/dashboards/OperationsDashboardRole"));
const RecruiterDashboard       = lazy(() => import("@/pages/dashboards/RecruiterDashboard"));
const WfmAttendanceDashboard   = lazy(() => import("@/pages/dashboards/WfmAttendanceDashboard"));
const ItManagerDashboard       = lazy(() => import("@/pages/dashboards/ItManagerDashboard"));

export const dashboardRouteElements = (
  <>
      {/* Main dashboard */}
      <Route path="/dashboard"          element={<ProtectedRoute><Index /></ProtectedRoute>} />

      {/* Role dashboards */}
      <Route path="/ceo/dashboard"      element={<ProtectedRoute><Gate pageCode="CEO_DASHBOARD"><CeoDashboard /></Gate></ProtectedRoute>} />
      <Route path="/payroll-hr/dashboard" element={<ProtectedRoute><Gate pageCode="PAYROLL_HR_DASHBOARD"><PayrollHrDashboard /></Gate></ProtectedRoute>} />
      <Route path="/wfm/dashboard"      element={<ProtectedRoute><Gate pageCode="WFM_DASHBOARD"><WfmDashboard /></Gate></ProtectedRoute>} />
      <Route path="/hr/dashboard"       element={<ProtectedRoute><Gate pageCode="HR_DASHBOARD"><HrDashboard /></Gate></ProtectedRoute>} />
      <Route path="/manager/dashboard"  element={<ProtectedRoute><Gate pageCode="MANAGEMENT_DASHBOARD"><ManagerDashboard /></Gate></ProtectedRoute>} />
      <Route path="/my-dashboard"       element={<ProtectedRoute><Gate pageCode="EMPLOYEE_SELF_DASHBOARD"><EmployeeSelfDashboard /></Gate></ProtectedRoute>} />

      {/* New role-specific dashboards (from reference layouts) */}
      <Route path="/quality-dashboard"      element={<ProtectedRoute roles={["qa","quality_analyst","super_admin","admin","ceo","manager","process_manager","branch_head","operations_manager"]}><QualityDashboardRole /></ProtectedRoute>} />
      <Route path="/operations-dashboard"   element={<ProtectedRoute roles={["operations_manager","admin","super_admin","ceo","manager","process_manager","branch_head"]}><OperationsDashboardRole /></ProtectedRoute>} />
      <Route path="/recruiter-dashboard"    element={<ProtectedRoute roles={["recruiter","hr","admin","super_admin","manager"]}><RecruiterDashboard /></ProtectedRoute>} />
      <Route path="/wfm-attendance"         element={<ProtectedRoute roles={["wfm","admin","super_admin","hr","manager","operations_manager"]}><WfmAttendanceDashboard /></ProtectedRoute>} />
      <Route path="/it/dashboard"           element={<ProtectedRoute roles={["it","branch_it","it_admin","admin","super_admin"]}><ItManagerDashboard /></ProtectedRoute>} />
  </>
);
