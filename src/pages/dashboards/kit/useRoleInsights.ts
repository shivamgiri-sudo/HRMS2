import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import type { RoleInsights } from "../../../../backend/src/modules/dashboards/role-insights/types";

export type { RoleInsights, InsightAction, InsightKpi, InsightSeries, InsightTable, InsightSignal } from "../../../../backend/src/modules/dashboards/role-insights/types";

/**
 * Role insights load AFTER (and independent of) the summary so the hero + tiles paint first.
 * Never throws into the page: an error degrades to `error` and the layout keeps its summary data.
 */
export function useRoleInsights(dashboardCode: string, params: { branchId?: string; processId?: string } = {}, enabled = true) {
  const qs = new URLSearchParams();
  if (params.branchId) qs.set("branchId", params.branchId);
  if (params.processId) qs.set("processId", params.processId);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return useQuery({
    queryKey: ["role-insights", dashboardCode, params.branchId ?? "", params.processId ?? ""],
    queryFn: async () => {
      const res = await hrmsApi.get<{ data?: RoleInsights } | RoleInsights>(`/api/dashboards/${dashboardCode}/insights${suffix}`);
      return ((res as { data?: RoleInsights }).data ?? res) as RoleInsights;
    },
    enabled,
    staleTime: 30_000,
    retry: 2,
    // Sections the server is still computing arrive on later polls; stop as soon as none are pending.
    refetchInterval: (query) => ((query.state.data?.pending?.length ?? 0) > 0 ? 1_500 : false),
  });
}
