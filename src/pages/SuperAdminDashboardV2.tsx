import RoleDashboardV3 from "./dashboards/RoleDashboardV3";
import "./dashboards/role-dashboard-reference.css";

export default function SuperAdminDashboardV2() {
  return <div className="role-dashboard-reference"><RoleDashboardV3 variant="super_admin" /></div>;
}
