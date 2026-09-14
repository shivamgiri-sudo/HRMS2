import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

/**
 * Day-by-day revenue, cost and operating margin.
 *
 * Two of the four series are real daily measurements and two are a monthly figure spread across
 * days. `series[].basis` says which is which, and the chart must render them differently.
 */

export type SeriesBasis = "actual" | "estimated";

export interface DailyTrendPoint {
  date: string;
  revenue: number;
  grnCost: number;
  peopleCost: number;
  totalCost: number;
  headcount: number;
  cumulativeRevenue: number;
  cumulativeCost: number;
  cumulativeOpPct: number | null;
}

export interface DailyTrendSeriesMeta {
  key: "revenue" | "grnCost" | "peopleCost" | "headcount";
  label: string;
  basis: SeriesBasis;
  method: string;
}

export interface DailyTrend {
  period: string;
  branchId: string | null;
  daysInMonth: number;
  daysObserved: number;
  points: DailyTrendPoint[];
  series: DailyTrendSeriesMeta[];
  monthlyRevenueBasis: number;
  monthlyPeopleCostBasis: number;
  grnCostDatedByBillDate: true;
}

export function usePnlDailyTrend(period: string, branchId?: string) {
  return useQuery({
    queryKey: ["pnl-daily-trend", period, branchId ?? null],
    enabled: Boolean(period),
    queryFn: async () => {
      const search = new URLSearchParams({ period });
      if (branchId) search.set("branchId", branchId);
      const response = await hrmsApi.get<{ success: boolean; data: DailyTrend }>(
        `/api/finance/pnl/daily-trend?${search.toString()}`
      );
      return response.data;
    },
    staleTime: 60_000,
  });
}
