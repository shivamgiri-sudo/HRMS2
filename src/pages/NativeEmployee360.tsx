import { useParams } from "react-router-dom";
import PeopleOSDataPage from "./PeopleOSDataPage";

export default function NativeEmployee360() {
  const { id } = useParams();
  return (
    <PeopleOSDataPage
      eyebrow="Employees"
      title="Employee 360"
      endpoint={`/api/employees/${id ?? ""}/360`}
      primaryKeys={["payroll", "sensitive_personal"]}
    />
  );
}
