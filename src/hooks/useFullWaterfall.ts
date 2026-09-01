import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

/**
 * The "Full P&L Waterfall" — a supplementary, more detailed total built from the same canonical
 * per-process fields ProcessPnlDetailPage's own "Profitability waterfall" card shows, summed
 * across a branch's (or the whole company's) active processes.
 *
 * NOT the same figure as CEO Overview's headline Operating Profit (a separate, simpler calculation
 * reconciled against the business's real reported P&L Excel file) — see PnlFullWaterfallCard.tsx
 * for how that distinction is worded to the user.
 */
export interface FullWaterfallTotals {
  period: string;
  branchId: string | null;
  processCount: number;
  recognizedRevenue: number;
  contribution: number;
  contributionMarginPct: number | null;
  ebitda: number;
  ebitdaMarginPct: number | null;
  depreciation: number;
  amortization: number;
  ebit: number;
  operatingProfitPct: number | null;
  financeCost: number;
  pbt: number;
  tax: number;
  pat: number;
  hasDepreciationData: boolean;
  hasAmortizationData: boolean;
  hasFinanceCostData: boolean;
  hasTaxData: boolean;
}

export function useFullWaterfall(period: string, branchId?: string | null, enabled = true) {
  return useQuery({
    queryKey: ["pnl-full-waterfall", period, branchId ?? ""],
    enabled: enabled && Boolean(period),
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const params = new URLSearchParams({ period });
      if (branchId) params.set("branchId", branchId);
      const response = await hrmsApi.get<{ success: boolean; data: FullWaterfallTotals }>(
        `/api/finance/pnl/full-waterfall?${params.toString()}`,
      );
      return response.data;
    },
  });
}
