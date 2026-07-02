import PeopleOSDataPage from "./PeopleOSDataPage";

export default function NativeCEOCommandCenter() {
  return (
    <PeopleOSDataPage
      eyebrow="Management"
      title="CEO Command Center"
      endpoint="/api/management/ceo-command-center"
      primaryKeys={[
        "active_headcount",
        "billable_headcount",
        "attendance_risk",
        "support_sla_risk",
        "grievance_risk",
        "payroll_blocked",
        "hiring_pipeline",
      ]}
    />
  );
}
