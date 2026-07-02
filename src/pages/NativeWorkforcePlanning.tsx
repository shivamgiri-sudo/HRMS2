import PeopleOSDataPage from "./PeopleOSDataPage";

export default function NativeWorkforcePlanning() {
  return (
    <PeopleOSDataPage
      eyebrow="Workforce"
      title="Workforce Planning"
      endpoint="/api/workforce-planning/summary"
      primaryKeys={["coverage_rows", "active_headcount", "open_drafts"]}
    />
  );
}
