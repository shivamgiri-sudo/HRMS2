import { Navigate, useSearchParams } from "react-router-dom";
import ReferenceRoleDashboard from "./ReferenceRoleDashboard";

export default function WfmDashboard() {
  const [searchParams] = useSearchParams();

  // `?view=attendance` used to swap the rendered variant (and therefore the dashboard
  // code the summary API is called with) while the route stayed gated on
  // WFM_DASHBOARD. That left the gate and the request disagreeing about which
  // entitlement applies — and hr / operations_manager, who are entitled to the
  // attendance dashboard but not the WFM one, were blocked by the wrong gate.
  // Redirect to the route that is actually gated on WFM_ATTENDANCE_DASHBOARD.
  if (searchParams.get("view") === "attendance") {
    return <Navigate to="/wfm-attendance" replace />;
  }

  return <ReferenceRoleDashboard variant="wfm" />;
}
