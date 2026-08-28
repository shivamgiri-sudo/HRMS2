import { useMemo } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Briefcase, GraduationCap, ShieldCheck, Users, BarChart3, Clock, Settings } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { PAGE_CODE_BY_ROUTE } from "@/lib/pageRoutePageCodes";

/**
 * page_code -> route, inverted from the frontend's own route map.
 *
 * The router is the authority on what exists; page_catalog.page_path is a database
 * copy that has drifted from it more than once. WORKFORCE_COMMAND_CENTER is the
 * worked example: sql/216 overwrote the correct '/performance/command-center' with
 * '/workforce/command-center', which has never been mounted, and this launcher sent
 * all eight roles holding that grant straight to the 404 page. Preferring the
 * router's path makes a future catalog drift inert rather than user-visible.
 */
const ROUTE_BY_PAGE_CODE: Record<string, string> = Object.entries(PAGE_CODE_BY_ROUTE).reduce(
  (acc, [route, code]) => {
    // First wins — several codes share a route (e.g. the ATS command centre), and
    // the earliest entry is the canonical one.
    if (!acc[code]) acc[code] = route;
    return acc;
  },
  {} as Record<string, string>,
);

/** Every path the router actually serves, so a catalog path can be sanity-checked. */
const KNOWN_ROUTES = new Set(Object.keys(PAGE_CODE_BY_ROUTE));

/**
 * Reverse-resolution-only overrides for page codes whose real destination is one tab of
 * a merged console rather than a standalone route, so they can never gain a
 * PAGE_CODE_BY_ROUTE entry (the forward map) without reintroducing a bug.
 *
 * WFM_ATTENDANCE_EXCEPTIONS is the case in point. Task 6 of the WFM attendance-page merge
 * folded the old /wfm/attendance-exceptions page into a tab of /wfm/attendance-integrity
 * and turned the old path into a query-string-preserving redirect (see
 * AttendanceIntegrityRedirect.tsx) — so pageRoutePageCodes.ts deliberately removed its
 * PAGE_CODE_BY_ROUTE entry (see that file's comment on "/wfm/attendance-integrity") and,
 * just as deliberately, never added one for the merged route either: the console covers
 * four page codes (one per tab), and ProtectedRoute's getRoutePageCode() forward lookup is
 * a hard pre-render deny — mapping "/wfm/attendance-integrity" to any single code would
 * 403 a viewer whose grant covers a different tab before the console's own per-tab
 * canViewPage() gating ever runs.
 *
 * That correctly keeps ProtectedRoute out of it, but it also means ROUTE_BY_PAGE_CODE
 * below (built from that same forward map) has nothing to resolve WFM_ATTENDANCE_EXCEPTIONS
 * to any more. page_catalog's page_path for it still reads the pre-merge
 * '/wfm/attendance-exceptions' (backend/sql/1083_wfm_attendance_exceptions_page_code.sql —
 * intentionally not migrated, see resolveLaunchRoute's KNOWN_ROUTES check below: that path
 * is no longer a KNOWN_ROUTES key either, since it left PAGE_CODE_BY_ROUTE), so without an
 * explicit override, eight roles holding this grant (backend/src/shared/rbacPageMatrix.ts)
 * would silently fall through resolveLaunchRoute() to "/dashboard" instead of the console.
 *
 * This map is consulted only here, in resolveLaunchRoute() — never by getRoutePageCode() —
 * so it cannot make ProtectedRoute re-gate the merged console behind one code.
 */
const ROUTE_OVERRIDE_BY_PAGE_CODE: Record<string, string> = {
  WFM_ATTENDANCE_EXCEPTIONS: "/wfm/attendance-integrity?tab=exceptions",
};

/**
 * Resolve where a launcher tile should point.
 *
 * The reverse-only override wins first (see ROUTE_OVERRIDE_BY_PAGE_CODE above), then the
 * router mapping. A database path is used only if it names a route that exists —
 * page_catalog.page_path drifts (sql/216 is the recorded example) and an unchecked
 * fallback turns that drift into a 404 the user meets by clicking a tile they were
 * legitimately granted.
 */
export function resolveLaunchRoute(page: { page_code: string; route_path?: string | null; page_path?: string | null }): string {
  const override = ROUTE_OVERRIDE_BY_PAGE_CODE[page.page_code];
  if (override) return override;

  const routerPath = ROUTE_BY_PAGE_CODE[page.page_code];
  if (routerPath) return routerPath;

  const dbPath = page.route_path ?? page.page_path ?? null;
  // Catalog paths sometimes carry a query string (?tab=…); the route is the part before it.
  if (dbPath && KNOWN_ROUTES.has(dbPath.split("?")[0])) return dbPath;

  return "/dashboard";
}

const iconMap: Record<string, JSX.Element> = {
  // Core modules
  HRMS: <Users className="h-5 w-5" />,
  ATS: <Briefcase className="h-5 w-5" />,
  LMS: <GraduationCap className="h-5 w-5" />,
  WFM: <Clock className="h-5 w-5" />,
  QUALITY: <ShieldCheck className="h-5 w-5" />,
  OPERATIONS: <BarChart3 className="h-5 w-5" />,
  PERFORMANCE: <BarChart3 className="h-5 w-5" />,
  SETTINGS: <Settings className="h-5 w-5" />,
  // Additional modules (normalized from page_catalog)
  HR: <Users className="h-5 w-5" />,
  Payroll: <BarChart3 className="h-5 w-5" />,
  Finance: <BarChart3 className="h-5 w-5" />,
  Admin: <Settings className="h-5 w-5" />,
  Compliance: <ShieldCheck className="h-5 w-5" />,
  Support: <ShieldCheck className="h-5 w-5" />,
  Expenses: <BarChart3 className="h-5 w-5" />,
  Engagement: <Users className="h-5 w-5" />,
  Dashboards: <BarChart3 className="h-5 w-5" />,
  KPI: <BarChart3 className="h-5 w-5" />,
  Management: <Briefcase className="h-5 w-5" />,
  Integrations: <Settings className="h-5 w-5" />,
  Portal: <Users className="h-5 w-5" />,
  Provisioning: <Settings className="h-5 w-5" />,
  Attendance: <Clock className="h-5 w-5" />,
  Quality: <ShieldCheck className="h-5 w-5" />,
  Operations: <BarChart3 className="h-5 w-5" />,
  Overview: <BarChart3 className="h-5 w-5" />,
};

type PageRow = {
  page_code: string;
  module_code?: string | null;
  module?: string | null;
  page_name: string;
  page_description: string | null;
  description?: string | null;
  page_path?: string | null;
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
        const res = await hrmsApi.get<{ success?: boolean; data?: PageRow[] } | PageRow[]>("/api/access/pages/my-catalog");
        const catalog = Array.isArray(res) ? res : Array.isArray(res.data) ? res.data : [];
        return catalog
          .filter((page) => access.visiblePageCodes.includes(page.page_code))
          .map((page) => ({
            ...page,
            module_code: page.module_code ?? page.module ?? page.page_code.split("_")[0] ?? "HRMS",
            page_description: page.page_description ?? page.description ?? "Open workspace",
            // Router first, database second — and the database only when it names a
            // route that actually exists. Nine granted codes (LEAVE_MANAGEMENT,
            // WFM_ROSTER_MANAGER_QUEUE, COACHING, PAYROLL_ATTENDANCE_OVERRIDES,
            // ONBOARDING_REQUESTS/REVIEW/SECTION_STATUS, SALARY_PREP,
            // SALARY_BAND_MASTER) have no router entry AND a page_path matching no
            // mounted route, so the old chain handed the user a tile that 404s. Falling
            // back to the dashboard is not a fix for those codes — they still need
            // either a route mapping or retiring in page_catalog — but a tile that lands
            // somewhere real beats one that dead-ends.
            route_path: resolveLaunchRoute(page),
          }));
      } catch {
        return access.visiblePageCodes.map(fallbackPageFromCode);
      }
    },
    enabled: !access.isLoading,
  });

  const grouped = useMemo(() => {
    return pages.reduce<Record<string, PageRow[]>>((acc, page) => {
      const moduleCode = page.module_code ?? page.module ?? "HRMS";
      acc[moduleCode] = acc[moduleCode] || [];
      acc[moduleCode].push(page);
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
