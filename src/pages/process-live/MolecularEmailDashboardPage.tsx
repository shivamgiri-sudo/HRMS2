/**
 * /molecular-email-dashboard — the Molecular Email Dashboard as its own page
 * (MOL-01, REG-07). Molecular has no process_master row, so it is not opened from
 * the Process Operations process picker; the Reginald dashboard's old
 * "Molecular Email" tab now links here. The API (/api/process-live/molecular-email)
 * keeps its scope rule: viewers of the Reginald dashboard and admins/CEO.
 */
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { MolecularEmailDashboard } from "@/components/process-live/molecular/MolecularEmailDashboard";

export default function MolecularEmailDashboardPage() {
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-screen-2xl p-4">
        <MolecularEmailDashboard />
      </div>
    </DashboardLayout>
  );
}
