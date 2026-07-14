import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import type { PnlAdjustmentRow } from "./usePnlConfiguration";
import type { ProcessPnlRecord } from "./useProcessPnl";

export interface PnlPeriodCloseData {
  period: {
    id: string;
    period_code: string;
    status: string;
    start_date: string;
    end_date: string;
    locked_at?: string | null;
  };
  summary: {
    organisationRevenue: number;
    totalDirectCost: number;
    totalIndirectCost: number;
    operatingProfit: number;
    operatingMarginPct: number | null;
    mostProfitableProcess: { processId: string; processName: string; value: number } | null;
    lossMakingProcesses: number;
    revenueAtRisk: number;
    receivableRisk: number;
    monthEndProjectedProfit: number;
    billableHeadcount: number;
    activeHeadcount: number;
  };
  alertCounts: {
    critical: number;
    warning: number;
    info: number;
  };
  topAlerts: Array<{
    type: "critical" | "warning" | "info";
    title: string;
    detail: string;
    processId?: string;
    processName?: string;
    impact?: number;
  }>;
  processCounts: {
    total: number;
    profitable: number;
    atRisk: number;
    lossMaking: number;
    pendingReconciliation: number;
  };
  lossMakingProcesses: ProcessPnlRecord[];
  signoffs: Array<{
    role: "finance_preparer" | "finance_head" | "accounts_head" | "ceo";
    status: string;
    signed_by: string | null;
    signed_at: string | null;
    note: string | null;
  }>;
  availableActions: {
    signoffRole: "finance_preparer" | "finance_head" | "accounts_head" | "ceo" | null;
    canSignoff: boolean;
    canLock: boolean;
  };
  allocationDrivers: Array<{
    branchName: string;
    revenue: number;
    indirectCost: number;
    activeHc: number;
    sharePct: number;
  }>;
  adjustments: PnlAdjustmentRow[];
  lastCalculatedAt: string;
}

function periodQuery(period?: string) {
  const params = new URLSearchParams();
  if (period) params.set("period", period);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function usePnlReconciliation(period?: string) {
  const queryClient = useQueryClient();

  const periodCloseQuery = useQuery({
    queryKey: ["pnl-period-close", period],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: PnlPeriodCloseData }>(`/api/finance/pnl/period-close${periodQuery(period)}`);
      return response.data;
    },
    staleTime: 60_000,
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["pnl-period-close"] }),
      queryClient.invalidateQueries({ queryKey: ["pnl-adjustments"] }),
      queryClient.invalidateQueries({ queryKey: ["pnl-periods"] }),
      queryClient.invalidateQueries({ queryKey: ["process-pnl-summary"] }),
      queryClient.invalidateQueries({ queryKey: ["process-pnl-processes"] }),
    ]);
  };

  const recalculate = useMutation({
    mutationFn: async () => {
      const response = await hrmsApi.post<{ success: boolean; data: Record<string, unknown> }>("/api/finance/pnl/recalculate", {
        period,
      });
      return response.data;
    },
    onSuccess: invalidate,
  });

  const signoff = useMutation({
    mutationFn: async (payload: { periodId: string; note?: string }) => {
      const response = await hrmsApi.post<{ success: boolean; data: { success: boolean } }>(
        `/api/finance/pnl/period/${payload.periodId}/signoff`,
        {
          note: payload.note ?? null,
        }
      );
      return response.data;
    },
    onSuccess: invalidate,
  });

  const lockPeriod = useMutation({
    mutationFn: async (periodId: string) => {
      const response = await hrmsApi.post<{ success: boolean; data: { success: boolean } }>(`/api/finance/pnl/period/${periodId}/lock`);
      return response.data;
    },
    onSuccess: invalidate,
  });

  return {
    periodCloseQuery,
    recalculate,
    signoff,
    lockPeriod,
  };
}
