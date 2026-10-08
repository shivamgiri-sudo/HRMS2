import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { errorText, useDashboard } from "@/components/dashboard-studio/api";
import DashboardList from "@/components/dashboard-studio/DashboardList";
import DatasetManager from "@/components/dashboard-studio/DatasetManager";
import StudioEditor from "@/components/dashboard-studio/StudioEditor";

/**
 * Dashboard Studio: /dashboard-builder lists dashboards, /dashboard-builder/:id opens one (the URL is shareable).
 * Replaces the first Dashboard Builder; its API and tables are left in place.
 */
export default function DashboardStudioPage() {
  const { id } = useParams<{ id?: string }>();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { hasAnyRole } = useWorkforceAccess();
  const isAdmin = hasAnyRole("super_admin", "admin");
  const [datasetsOpen, setDatasetsOpen] = useState(false);
  const { data, isLoading, isError, error } = useDashboard(id);
  const open = (dashId: string, edit?: boolean) => navigate(`/dashboard-builder/${dashId}${edit ? "?edit=1" : ""}`);

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-[1600px] p-3 sm:p-4">
        {!id && <DashboardList onOpen={open} isAdmin={isAdmin} onManageDatasets={() => setDatasetsOpen(true)} />}
        {id && isLoading && <div className="flex items-center gap-2 py-16 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" />Loading dashboard…</div>}
        {id && isError && (
          <div role="alert" className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center">
            <p className="text-sm font-semibold text-slate-900">This dashboard could not be opened.</p>
            <p className="mt-1 text-sm text-slate-600">{errorText(error)}. It may have been deleted, or not shared with you.</p>
            <button type="button" onClick={() => navigate("/dashboard-builder")} className="mt-4 h-10 cursor-pointer rounded-lg bg-blue-800 px-4 text-sm font-semibold text-white hover:bg-blue-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">Back to dashboards</button>
          </div>
        )}
        {id && data && <StudioEditor key={data.dashboard.id} detail={data} startEditing={search.get("edit") === "1"} onBack={() => navigate("/dashboard-builder")} onOpen={open} />}
        {isAdmin && <DatasetManager open={datasetsOpen} onClose={() => setDatasetsOpen(false)} />}
      </div>
    </DashboardLayout>
  );
}
