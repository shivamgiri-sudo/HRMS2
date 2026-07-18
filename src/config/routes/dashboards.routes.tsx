import { Route } from "react-router-dom";
import { lazy } from "./lazy";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import WorkforcePageGate from "@/components/security/WorkforcePageGate";

const Gate = ({ pageCode, children }: { pageCode: string; children: React.ReactNode }) =>
  <WorkforcePageGate pageCode={pageCode}>{children}</WorkforcePageGate>;

const Index                 = lazy(() => import("@/pages/Index"));
const CeoDashboard          = lazy(() => import("@/pages/dashboards/CeoDashboard"));
const PayrollHrDashboard    = lazy(() => import("@/pages/dashboards/PayrollHrDashboard"));
const WfmDashboard          = lazy(() => import("@/pages/dashboards/WfmDashboard"));
const HrDashboard           = lazy(() => import("@/pages/dashboards/HrDashboard"));
const EmployeeSelfDashboard = lazy(() => import("@/pages/dashboards/EmployeeSelfDashboard"));
const ManagerDashboard      = lazy(() => import("@/pages/dashboards/ManagerDashboard"));

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
  </>
);
