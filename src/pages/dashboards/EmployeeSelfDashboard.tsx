import ReferenceRoleDashboard from "./ReferenceRoleDashboard";
import { CompanyFeedLoginPopup } from "@/components/CompanyFeedLoginPopup";

export default function EmployeeSelfDashboard() {
  return (
    <>
      <CompanyFeedLoginPopup />
      <ReferenceRoleDashboard variant="employee" />
    </>
  );
}
