import PeopleOSDataPage from "./PeopleOSDataPage";

export default function NativeAttendanceExceptionEngine() {
  return (
    <PeopleOSDataPage
      eyebrow="Attendance"
      title="Attendance Exception Engine"
      endpoint="/api/attendance/exception-engine/summary"
      primaryKeys={["total", "unresolved", "critical", "high"]}
    />
  );
}
