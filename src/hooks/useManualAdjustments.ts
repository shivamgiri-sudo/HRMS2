import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export type AdjustmentType = "projected_revenue" | "penalty" | "reward";
export type AdjustmentStatus = "pending" | "approved" | "rejected";

export interface ManualAdjustment {
  id: string;
  process_id: string;
  process_name?: string;
  branch_id: string | null;
  branch_name?: string;
  period_code: string;
  adjustment_type: AdjustmentType;
  amount: number;
  reason: string;
  status: AdjustmentStatus;
  created_by: string;
  created_by_name?: string;
  created_at: string;
  approved_by: string | null;
  approved_by_name?: string;
  approved_at: string | null;
  rejection_reason: string | null;
}

export interface ManualAdjustmentFilters {
  processId?: string;
  branchId?: string;
  period?: string;
  status?: AdjustmentStatus;
}

function queryString(filters: ManualAdjustmentFilters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** List manual adjustments — the pending-approval queue when filtered to status: "pending". */
export function useManualAdjustments(filters: ManualAdjustmentFilters) {
  return useQuery({
    queryKey: ["pnl-manual-adjustments", filters],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: ManualAdjustment[] }>(
        `/api/finance/pnl/manual-adjustments${queryString(filters)}`
      );
      return response.data;
    },
    staleTime: 15_000,
  });
}

export interface CreateAdjustmentInput {
  processId: string;
  periodCode: string;
  adjustmentType: AdjustmentType;
  amount: number;
  reason: string;
}

export function useCreateManualAdjustment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateAdjustmentInput) => {
      const response = await hrmsApi.post<{ success: boolean; data: ManualAdjustment }>(
        "/api/finance/pnl/manual-adjustments",
        input
      );
      return response.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pnl-manual-adjustments"] });
    },
  });
}

export function useReviewManualAdjustment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; decision: "approve" | "reject"; reason?: string }) => {
      const response = await hrmsApi.put<{ success: boolean; data: ManualAdjustment }>(
        `/api/finance/pnl/manual-adjustments/${vars.id}/${vars.decision}`,
        vars.decision === "reject" ? { reason: vars.reason } : undefined
      );
      return response.data;
    },
    onSuccess: () => {
      // Approving/rejecting changes whether the entry counts toward the Adjusted Total shown on
      // the P&L Statement and Process Detail surfaces — both must refetch, not just the queue.
      void queryClient.invalidateQueries({ queryKey: ["pnl-manual-adjustments"] });
      void queryClient.invalidateQueries({ queryKey: ["pnl-statement"] });
      void queryClient.invalidateQueries({ queryKey: ["process-pnl-detail"] });
      void queryClient.invalidateQueries({ queryKey: ["process-pnl-section"] });
    },
  });
}
