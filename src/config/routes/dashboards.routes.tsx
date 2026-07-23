import { Route } from "react-router-dom";
import { lazy } from "./lazy";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import WorkforcePageGate from "@/components/security/WorkforcePageGate";
import {
  DASHBOARD_ACCESS_REGISTRY,
  type DashboardCode,
} from "../../../backend/src/shared/dashboardAccessRegistry";

const Gate = ({ pageCode, children }: { pageCode: string; children: React.ReactNode }) =>
  <WorkforcePageGate pageCode={pageCode}>{children}</WorkforcePageGate>;

const DashboardRouteGate = ({
  code,
  children,
}: {
  code: DashboardCode;
  children: React.ReactNode;
}) => {
  const definition = DASHBOARD_ACCESS_REGISTRY[code];
  return (
    <ProtectedRoute dashboardCode={code}>
      <Gate pageCode={definition.pageCode}>{children}</Gate>
    </ProtectedRoute>
  );
};

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
      <Route path="/ceo/dashboard"      element={<DashboardRouteGate code="CEO_DASHBOARD"><CeoDashboard /></DashboardRouteGate>} />
      <Route path="/payroll-hr/dashboard" element={<DashboardRouteGate code="PAYROLL_HR_DASHBOARD"><PayrollHrDashboard /></DashboardRouteGate>} />
      <Route path="/wfm/dashboard"      element={<DashboardRouteGate code="WFM_DASHBOARD"><WfmDashboard /></DashboardRouteGate>} />
      <Route path="/hr/dashboard"       element={<DashboardRouteGate code="HR_DASHBOARD"><HrDashboard /></DashboardRouteGate>} />
      <Route path="/manager/dashboard"  element={<DashboardRouteGate code="MANAGEMENT_DASHBOARD"><ManagerDashboard /></DashboardRouteGate>} />
      <Route path="/my-dashboard"       element={<DashboardRouteGate code="EMPLOYEE_SELF_DASHBOARD"><EmployeeSelfDashboard /></DashboardRouteGate>} />

      {/* New role-specific dashboards (from reference layouts) */}
      <Route path="/quality-dashboard"      element={<DashboardRouteGate code="QUALITY_DASHBOARD"><QualityDashboardRole /></DashboardRouteGate>} />
      <Route path="/operations-dashboard"   element={<DashboardRouteGate code="OPERATIONS_DASHBOARD"><OperationsDashboardRole /></DashboardRouteGate>} />
      <Route path="/recruiter-dashboard"    element={<DashboardRouteGate code="RECRUITER_DASHBOARD"><RecruiterDashboard /></DashboardRouteGate>} />
      <Route path="/wfm-attendance"         element={<DashboardRouteGate code="WFM_ATTENDANCE_DASHBOARD"><WfmAttendanceDashboard /></DashboardRouteGate>} />
      <Route path="/it/dashboard"           element={<DashboardRouteGate code="IT_MANAGER_DASHBOARD"><ItManagerDashboard /></DashboardRouteGate>} />
  </>
);
