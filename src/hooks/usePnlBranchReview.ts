import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

const BASE = "/api/finance/pnl-branch-review";

export type BranchReviewStatus = "pending" | "queried" | "acknowledged" | "changed_after_acknowledgement";
export type BranchQuerySection = "revenue" | "people_cost" | "non_people_cost" | "other";

export interface BranchReviewQuery {
  id: string; section: BranchQuerySection; costCentreId: string | null; message: string; status: "open" | "resolved";
  raisedBy: string; raisedAt: string; resolvedBy: string | null; resolvedAt: string | null; resolutionNote: string | null;
}
export interface BranchReviewRow {
  branchId: string; branchName: string; status: BranchReviewStatus;
  revenue: number; cost: number; operatingProfit: number; marginPct: number | null; issues: string[];
  acknowledgedAt: string | null; acknowledgedBy: string | null; comment: string | null;
  snapshot: { revenue: number; cost: number; operatingProfit: number } | null;
  openQueries: number; queries: BranchReviewQuery[];
}
export interface BranchReview {
  period: string; mode: string; blockers: string[]; generatedAt: string;
  totals: { branches: number; pending: number; queried: number; acknowledged: number; changed: number };
  branches: BranchReviewRow[];
}

export function usePnlBranchReview(period: string, enabled = true) {
  return useQuery({
    queryKey: ["pnl-branch-review", period],
    enabled: enabled && /^\d{4}-\d{2}$/.test(period),
    queryFn: async () => (await hrmsApi.get<{ success: boolean; data: BranchReview }>(`${BASE}?period=${period}`)).data,
  });
}

function useReviewMutation<T>(fn: (input: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => void qc.invalidateQueries({ queryKey: ["pnl-branch-review"] }) });
}

export const useAcknowledgeBranch = () =>
  useReviewMutation((i: { branchId: string; period: string; comment?: string }) => hrmsApi.post(`${BASE}/acknowledge`, i));
export const useRaiseBranchQuery = () =>
  useReviewMutation((i: { branchId: string; period: string; section: BranchQuerySection; message: string; costCentreId?: string }) =>
    hrmsApi.post(`${BASE}/queries`, i));
export const useResolveBranchQuery = () =>
  useReviewMutation((i: { id: string; note: string }) => hrmsApi.post(`${BASE}/queries/${i.id}/resolve`, { note: i.note }));
