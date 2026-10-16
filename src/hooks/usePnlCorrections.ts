import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { toast } from "sonner";

export type PnlLineItem = "revenue" | "salary" | "grn" | "ebitda";

export interface PnlCorrection {
  id: string;
  period_code: string;
  company_name: string;
  line_item: PnlLineItem;
  amount: number;
  reason: string | null;
  created_by: string | null;
  creator_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface PnlPeriodStatus {
  period: string;
  salaryBasis: "ACTUAL" | "ACCRUAL";
  salaryRunStatus: "finalized" | "draft" | "none";
  revenueMode: {
    forecastCostCentres: number;
    invoicedCostCentres: number;
    estimatedCostCentres: number;
  };
  grnSource: "hrms_only" | "hrms_plus_legacy";
  mode: "FINAL" | "LIVE_MTD";
  corrections: Record<PnlLineItem, number>;
}

export interface CreateCorrectionInput {
  period_code: string;
  company_name: string;
  line_item: PnlLineItem;
  amount: number;
  reason?: string;
}

const QUERY_KEY = (period?: string) =>
  ["pnl-corrections", period].filter(Boolean);

export function usePnlCorrections(period?: string, company?: string) {
  const params = new URLSearchParams();
  if (period) params.set("period", period);
  if (company) params.set("company", company);

  return useQuery<PnlCorrection[]>({
    queryKey: QUERY_KEY(period),
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: PnlCorrection[] }>(
        `/finance/pnl/corrections?${params.toString()}`
      );
      return res.data.data ?? [];
    },
    staleTime: 30_000,
  });
}

export function usePnlPeriodStatus(period: string) {
  return useQuery<PnlPeriodStatus>({
    queryKey: ["pnl-period-status", period],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: PnlPeriodStatus }>(
        `/finance/pnl/period-status?period=${period}`
      );
      return res.data.data;
    },
    staleTime: 60_000,
    enabled: /^\d{4}-\d{2}$/.test(period),
  });
}

export function useCreatePnlCorrection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateCorrectionInput) => {
      const res = await hrmsApi.post<{ success: boolean; data: PnlCorrection }>(
        `/finance/pnl/corrections`,
        input
      );
      return res.data.data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: QUERY_KEY(vars.period_code) });
      qc.invalidateQueries({ queryKey: ["pnl-period-status", vars.period_code] });
      toast.success("P&L correction saved");
    },
    onError: () => toast.error("Failed to save correction"),
  });
}

export function useUpdatePnlCorrection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, amount, reason }: { id: string; amount: number; reason?: string }) => {
      const res = await hrmsApi.put<{ success: boolean; data: PnlCorrection }>(
        `/finance/pnl/corrections/${id}`,
        { amount, reason }
      );
      return res.data.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pnl-corrections"] });
      qc.invalidateQueries({ queryKey: ["pnl-period-status"] });
      toast.success("Correction updated");
    },
    onError: () => toast.error("Failed to update correction"),
  });
}

export function useDeletePnlCorrection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await hrmsApi.delete(`/finance/pnl/corrections/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pnl-corrections"] });
      qc.invalidateQueries({ queryKey: ["pnl-period-status"] });
      toast.success("Correction deleted");
    },
    onError: () => toast.error("Failed to delete correction"),
  });
}
