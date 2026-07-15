import { useSearchParams } from "react-router-dom";
import ReferenceRoleDashboard from "./ReferenceRoleDashboard";

export default function WfmDashboard() {
  const [searchParams] = useSearchParams();
  const variant = searchParams.get("view") === "attendance" ? "wfm_attendance" : "wfm";
  return <ReferenceRoleDashboard variant={variant} />;
}
