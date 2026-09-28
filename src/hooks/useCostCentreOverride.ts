import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

/**
 * Per-employee cost centre override for P&L attribution (migration 1785).
 * Mirrors backend/src/modules/process-pnl/pnl-cost-centre-override.service.ts; keep the two in
 * step (the frontend typecheck runs strict:false and cannot catch a misnamed key).
 */

export interface CostCentreOverrideRow {
  id: string;
  employeeId: string;
  employeeCode: string | null;
  employeeName: string | null;
  actualCostCentreId: string | null;
  actualCostCentreCode: string | null;
  actualCostCentreName: string | null;
  targetCostCentreId: string;
  targetCostCentreCode: string | null;
  targetCostCentreName: string | null;
  targetBranchId: string | null;
  targetBranchName: string | null;
  reason: string | null;
  activeStatus: boolean;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OverrideCostCentreOption {
  id: string;
  code: string;
  name: string | null;
  branchId: string | null;
  branchName: string | null;
  processName: string | null;
}

export interface OverrideEmployeeOption {
  id: string;
  employeeCode: string;
  name: string | null;
  branchName: string | null;
  costCentreCode: string | null;
  alreadyMappedTo: string | null;
}

/** Every open cost centre (optionally one branch's) — unpaginated, unlike the general cost-centre list. */
export function useOverrideCostCentreOptions(branchId: string) {
  return useQuery({
    queryKey: ["pnl-cost-centre-override-cost-centres", branchId],
    queryFn: async () => {
      const qs = branchId ? `?branchId=${encodeURIComponent(branchId)}` : "";
      const response = await hrmsApi.get<{ success: boolean; data: OverrideCostCentreOption[] }>(
        `/api/finance/pnl/cost-centre-overrides/cost-centres${qs}`,
      );
      return response.data;
    },
    staleTime: 5 * 60_000,
  });
}

export function useOverrideEmployeeSearch(query: string, branchId: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ["pnl-cost-centre-override-employees", q, branchId],
    queryFn: async () => {
      const params = new URLSearchParams({ q });
      if (branchId) params.set("branchId", branchId);
      const response = await hrmsApi.get<{ success: boolean; data: OverrideEmployeeOption[] }>(
        `/api/finance/pnl/cost-centre-overrides/employees?${params.toString()}`,
      );
      return response.data;
    },
    enabled: q.length >= 2,
    staleTime: 30_000,
  });
}

export interface BulkSetOverrideResult {
  applied: { employeeId: string; employeeCode: string; employeeName: string | null }[];
  notFound: string[];
}

export function useCostCentreOverrides() {
  return useQuery({
    queryKey: ["pnl-cost-centre-overrides"],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: CostCentreOverrideRow[] }>(
        "/api/finance/pnl/cost-centre-overrides",
      );
      return response.data;
    },
  });
}

export function useCostCentreOverrideMutations() {
  const queryClient = useQueryClient();
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["pnl-cost-centre-overrides"] }),
      queryClient.invalidateQueries({ queryKey: ["pnl-live-reconciliation"] }),
      queryClient.invalidateQueries({ queryKey: ["ceo-overview"] }),
    ]);

  const bulkSet = useMutation({
    mutationFn: async (payload: { employeeCodes: string[]; targetCostCentreId: string; reason?: string | null }) =>
      (await hrmsApi.post<{ success: boolean; data: BulkSetOverrideResult }>(
        "/api/finance/pnl/cost-centre-overrides/bulk",
        payload,
      )).data,
    onSuccess: invalidate,
  });

  const deactivate = useMutation({
    mutationFn: async (employeeId: string) =>
      await hrmsApi.post<{ success: boolean }>(
        `/api/finance/pnl/cost-centre-overrides/${encodeURIComponent(employeeId)}/deactivate`,
        {},
      ),
    onSuccess: invalidate,
  });

  return { bulkSet, deactivate };
}
