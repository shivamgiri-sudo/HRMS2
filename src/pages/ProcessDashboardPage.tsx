import { Link, useParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ProcessDashboard } from "@/components/process-dashboard/ProcessDashboard";

/** /performance/process-dashboard/:processId — config-driven dashboard for any registered process. */
export default function ProcessDashboardPage() {
  const { processId = "" } = useParams<{ processId: string }>();
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6">
        <Link to="/performance/process-performance-v2" className="inline-flex min-h-[36px] items-center gap-1 text-xs font-semibold text-blue-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />All processes
        </Link>
        {processId ? <ProcessDashboard key={processId} processId={processId} /> : <p className="text-sm text-slate-700">No process selected.</p>}
      </div>
    </DashboardLayout>
  );
}
