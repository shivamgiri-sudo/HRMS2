/**
 * /reginald-email-dashboard — the Reginald Email Dashboard as its own page: the
 * same view as the Molecular Email Dashboard, fed by the Reginald Men ticketing
 * database (db_email) and the EMAIL dialler campaign. The Reginald dashboard's
 * "Reginald Email" tab embeds the same component. The API
 * (/api/process-live/reginald-email) keeps its scope rule: viewers of the Reginald
 * Email / Reginald dashboards and admins/CEO.
 */
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { MolecularEmailDashboard } from "@/components/process-live/molecular/MolecularEmailDashboard";

export default function ReginaldEmailDashboardPage() {
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-screen-2xl p-4">
        <MolecularEmailDashboard source="reginald" />
      </div>
    </DashboardLayout>
  );
}
