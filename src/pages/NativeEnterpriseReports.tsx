import PeopleOSDataPage from "./PeopleOSDataPage";

export default function NativeEnterpriseReports() {
  return (
    <PeopleOSDataPage
      eyebrow="Reports"
      title="Enterprise Reports"
      endpoint="/api/reports/enterprise"
      primaryKeys={[
        "active_headcount",
        "attendance_risk",
        "support_sla_risk",
        "grievance_risk",
        "payroll_blocked",
      ]}
    />
  );
}
