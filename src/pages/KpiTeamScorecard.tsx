import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { TeamKpiView } from "@/components/performance/TeamKpiView";

/**
 * Team KPI Scorecard — manager-facing page at /kpi/my-team.
 *
 * Thin wrapper: all display logic (member table, filters, per-employee drill-down
 * slide-over) lives in TeamKpiView, which loads its own data from
 * GET /api/kpi-master/team-summary and GET /api/kpi-master/live/:empId.
 */
export default function KpiTeamScorecard() {
  return (
    <DashboardLayout>
      <div className="px-4 py-6 max-w-7xl mx-auto space-y-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Team KPI Scorecard</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Live KPI achievement vs target for your direct reports.
          </p>
        </div>
        <TeamKpiView />
      </div>
    </DashboardLayout>
  );
}
