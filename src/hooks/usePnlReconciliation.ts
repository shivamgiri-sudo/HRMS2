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
  /**
   * Why the period cannot be locked yet.
   *
   * canonicalCloseView computes canLock as `base.canLock && qualityBlockers.length === 0` and
   * returns the blockers alongside it — but this type never declared them, so the page could
   * only hide the Lock button and say nothing. A control that disappears with no reason is
   * indistinguishable from a broken page, and lockPeriod's own error message (which does list
   * them) was unreachable because the button that would trigger it was gone.
   */
  qualityGates?: {
    strictClose: boolean;
    lobEnabledProcesses: number;
    revenueModelCoveragePct: number;
    blockerCount: number;
    blockers: Array<{ code: string; message: string; processId?: string }>;
    passed: boolean;
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

  /**
   * Recalculate, sign off and lock all move the numbers the whole P&L surface reads, so every
   * cached view of them has to go — not just this page's own.
   *
   * bpo-process-pnl, pnl-statement and budget-consolidation were missing. All three carry
   * staleTime: 60_000, so after a Recalculate the Process P&L KPI strip and the consolidation
   * rollup kept serving pre-recalculation figures for a full minute, with nothing on screen to
   * say they were stale — the worst kind of wrong number, because it looks settled.
   */
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["pnl-period-close"] }),
      queryClient.invalidateQueries({ queryKey: ["pnl-adjustments"] }),
      queryClient.invalidateQueries({ queryKey: ["pnl-periods"] }),
      queryClient.invalidateQueries({ queryKey: ["process-pnl-summary"] }),
      queryClient.invalidateQueries({ queryKey: ["process-pnl-processes"] }),
      queryClient.invalidateQueries({ queryKey: ["bpo-process-pnl"] }),
      queryClient.invalidateQueries({ queryKey: ["pnl-statement"] }),
      queryClient.invalidateQueries({ queryKey: ["budget-consolidation"] }),
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
