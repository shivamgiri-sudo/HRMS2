/**
 * AON & Attrition Analytics — standalone page.
 *
 * The analytics itself lives in AonAnalyticsView, which is also the `aon` tab inside the
 * Reports hub. This page exists because a tab three clicks inside /reports is invisible to
 * anyone not already hunting through the report library, and tenure/attrition trends are
 * something HR and Ops look for by name in the sidebar.
 *
 * The VIEW is imported, not copied. Two renderings of the same analysis would drift the
 * moment one of them was fixed, and this codebase has a documented history of exactly that
 * (a report's SQL and its rendered columns living in four rival layers). One component,
 * two entry points.
 *
 * Access: the route is mapped to REPORTS_CENTER in PAGE_CODE_BY_ROUTE, deliberately reusing
 * the Reports hub's own page code rather than minting a new one. It shows the same data
 * through the same API, so anyone who can open /reports can open this, and no new grant has
 * to be added to rbacPageMatrix — where an entry missing from the matrix gets deactivated by
 * the RBAC applier on its next run.
 */
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import AonAnalyticsView from "@/components/reports/views/AonAnalyticsView";

export default function AonAnalyticsPage() {
  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6">
        <AonAnalyticsView />
      </div>
    </DashboardLayout>
  );
}
