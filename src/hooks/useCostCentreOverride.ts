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
  reason: string | null;
  activeStatus: boolean;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
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
