import { EmployeeSheet } from "./DrillDrawer";

/** Risk-board row drawer: the same employee view as the drill drawer, at the same 60% width. */
export default function RiskDrawer({ employeeId, onClose }: { employeeId: string | null; onClose: () => void }) {
  return <EmployeeSheet employeeId={employeeId} onClose={onClose} />;
}
