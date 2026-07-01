import PeopleOSDataPage from "./PeopleOSDataPage";

export default function NativePayrollReadiness() {
  return (
    <PeopleOSDataPage
      eyebrow="Payroll"
      title="Payroll Readiness"
      endpoint="/api/payroll/readiness/summary"
      primaryKeys={["total", "ready", "blocked", "confidence_score"]}
    />
  );
}
