import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import type { BranchHeadHealthPayload } from "../../backend/src/modules/branch-head-health/types";
import type { DrillRow } from "../../backend/src/modules/branch-head-health/processes";

const BASE = "/api/branch-head-health";

export async function fetchBranchHeadHealth(branchIds: string[], date?: string): Promise<BranchHeadHealthPayload> {
  const qs = new URLSearchParams();
  if (branchIds.length > 0) qs.set("branchIds", branchIds.join(","));
  if (date) qs.set("date", date);
  const q = qs.toString();
  const res = await hrmsApi.get<{ success?: boolean; data?: BranchHeadHealthPayload }>(`${BASE}/overview${q ? `?${q}` : ""}`);
  if (!res?.data) throw new Error("Branch health is unavailable right now");
  return res.data;
}

export async function fetchProcessDrilldown(branchId: string, processId: string, metric: string): Promise<DrillRow[]> {
  const qs = new URLSearchParams({ branchId, metric });
  const res = await hrmsApi.get<{ success?: boolean; data?: DrillRow[] }>(
    `${BASE}/process/${encodeURIComponent(processId)}/drilldown?${qs.toString()}`,
  );
  return res?.data ?? [];
}

export function useBranchHeadHealth(branchIds: string[], date?: string) {
  const query = useQuery({
    queryKey: ["branch-head-health", branchIds.join(","), date ?? ""],
    queryFn: () => fetchBranchHeadHealth(branchIds, date),
    staleTime: 60_000,
    retry: 1,
    placeholderData: keepPreviousData,
  });
  return { data: query.data, isLoading: query.isLoading, isFetching: query.isFetching, error: query.error as Error | null, refetch: query.refetch };
}

export function useProcessDrilldown(branchId: string, processId: string, metric: string, enabled: boolean) {
  return useQuery({
    queryKey: ["branch-head-health-drill", branchId, processId, metric],
    queryFn: () => fetchProcessDrilldown(branchId, processId, metric),
    enabled: enabled && Boolean(branchId),
    staleTime: 60_000,
    retry: 1,
  });
}
