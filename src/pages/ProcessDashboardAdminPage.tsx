import { Link, useSearchParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { DashboardSetup } from "@/components/process-dashboard/DashboardSetup";

/** /performance/process-dashboard-admin — register a process's APR table + column mapping so its dashboard appears automatically. */
export default function ProcessDashboardAdminPage() {
  const [sp] = useSearchParams();
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
        <Link to="/performance/process-data-sources" className="inline-flex min-h-[36px] items-center gap-1 text-xs font-semibold text-blue-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />Process Data Sources
        </Link>
        <div><h1 className="text-xl font-bold text-slate-900">Dashboard Setup</h1>
          <p className="text-sm text-slate-700">Pick a process, its category and its APR table, map the columns, preview, then enable. No code change needed.</p></div>
        <DashboardSetup initialProcessId={sp.get("process") ?? ""} />
      </div>
    </DashboardLayout>
  );
}
