import { useMemo } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Briefcase, GraduationCap, ShieldCheck, Users, BarChart3, Clock, Settings } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useWorkforceAccess } from "@/hooks/useUserRole";

const iconMap: Record<string, JSX.Element> = {
  HRMS: <Users className="h-5 w-5" />,
  ATS: <Briefcase className="h-5 w-5" />,
  LMS: <GraduationCap className="h-5 w-5" />,
  WFM: <Clock className="h-5 w-5" />,
  QUALITY: <ShieldCheck className="h-5 w-5" />,
  OPERATIONS: <BarChart3 className="h-5 w-5" />,
  PERFORMANCE: <BarChart3 className="h-5 w-5" />,
  SETTINGS: <Settings className="h-5 w-5" />,
};

type PageRow = {
  page_code: string;
  module_code: string;
  page_name: string;
  page_description: string | null;
  route_path: string | null;
  display_order: number;
  is_base_hrms_page?: boolean;
  module_master?: { module_name: string; module_group: string | null } | null;
};

function fallbackPageFromCode(pageCode: string): PageRow {
  return {
    page_code: pageCode,
    module_code: pageCode.split("_")[0] || "HRMS",
    page_name: pageCode
      .toLowerCase()
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" "),
    page_description: "Open workspace",
    route_path: "/dashboard",
    display_order: 999,
  };
}

export default function ModuleLauncher() {
  const access = useWorkforceAccess();

  const { data: pages = [], isLoading } = useQuery({
    queryKey: ["workforce-module-launcher", access.visiblePageCodes],
    queryFn: async () => {
      if (!access.visiblePageCodes.length) return [] as PageRow[];
      try {
        const res = await hrmsApi.get<{ success?: boolean; data?: PageRow[] }>("/api/access/pages/my-catalog");
        const catalog = Array.isArray(res.data) ? res.data : [];
        return catalog.filter((page) => access.visiblePageCodes.includes(page.page_code));
      } catch {
        return access.visiblePageCodes.map(fallbackPageFromCode);
      }
    },
    enabled: !access.isLoading,
  });

  const grouped = useMemo(() => {
    return pages.reduce<Record<string, PageRow[]>>((acc, page) => {
      acc[page.module_code] = acc[page.module_code] || [];
      acc[page.module_code].push(page);
      return acc;
    }, {});
  }, [pages]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="rounded-3xl border bg-gradient-to-br from-slate-950 to-slate-800 p-6 text-white shadow-sm">
          <p className="text-sm font-medium text-slate-300">Native Workforce OS</p>
          <h1 className="mt-2 text-3xl font-bold">My Modules</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">
            Every user gets HRMS self-service first. Role-based modules like ATS, LMS, WFM, Quality, Operations and Performance are added on top.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-200">
            {access.roleKeys.map((role) => (
              <span key={role} className="rounded-full bg-white/10 px-3 py-1">{role}</span>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="rounded-2xl border bg-white p-6 text-sm text-slate-500">Loading modules...</div>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="rounded-2xl border bg-white p-6 text-sm text-slate-500">No module access configured yet.</div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {Object.entries(grouped).map(([moduleCode, modulePages]) => (
              <div key={moduleCode} className="rounded-2xl border bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-3">
                  <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">{iconMap[moduleCode] ?? <ArrowRight className="h-5 w-5" />}</div>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">{modulePages[0]?.module_master?.module_name ?? moduleCode}</h2>
                    <p className="text-xs uppercase tracking-wide text-slate-500">{moduleCode}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {modulePages.map((page) => (
                    <Link
                      key={page.page_code}
                      to={page.route_path || "/dashboard"}
                      className="flex items-center justify-between rounded-xl border border-slate-100 p-3 transition hover:border-slate-300 hover:bg-slate-50"
                    >
                      <div>
                        <p className="font-medium text-slate-900">{page.page_name}</p>
                        <p className="text-sm text-slate-500">{page.page_description || "Open workspace"}</p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-slate-400" />
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
