import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export interface PnlTrendMonth {
  period: string;
  revenue: number;
  cost: number;
  margin: number;
  headcount: number;
  source?: "mas_hrms" | "db_bill";
}

export interface PnlTrendProcess {
  processId: string;
  processName: string;
  months: PnlTrendMonth[];
}

export interface PnlTrendYoyYear {
  year: number;
  points: { month: number; cumulativeMargin: number }[];
  complete: boolean;
  source: "mas_hrms" | "db_bill" | "mixed";
}

export interface PnlTrendData {
  realMonths: string[];
  dataStatus: {
    revenueSource: string;
    costSource: string;
    note: string;
  };
  processes: PnlTrendProcess[];
  /** mas_hrms-only company series (5 live months). */
  company: PnlTrendMonth[];
  /** Legacy db_bill company series (2018-01 onward, where both revenue and cost are real). */
  companyHistory: PnlTrendMonth[];
  historyDataStatus: {
    available: boolean;
    revenueRealRange: [string, string] | null;
    costRealRange: [string, string] | null;
    overlapRange: [string, string] | null;
    caveat: string;
  };
  yoy: PnlTrendYoyYear[];
  /**
   * Historical (pre-live) REVENUE ONLY per process, matched from db_bill's tbl_invoice.cost_process
   * directly against process_master.process_name. No cost/margin — see backend doc comment.
   */
  processHistoryRevenue: { processId: string; processName: string; months: { period: string; revenue: number }[] }[];
}

export interface PnlTrendFilters {
  branchId?: string;
  processId?: string;
}

/**
 * Revenue/cost/margin + headcount trend across the months that carry real invoicing data
 * (see pnl-trend.service.ts). `realMonths` tells the caller exactly which months are real — the
 * chart must label its span from this array, never assume "last 12 months".
 */
export function usePnlTrend(filters: PnlTrendFilters = {}) {
  const params = new URLSearchParams();
  if (filters.branchId) params.set("branchId", filters.branchId);
  if (filters.processId) params.set("processId", filters.processId);
  const qs = params.toString();

  return useQuery({
    queryKey: ["pnl-trend", filters.branchId ?? "", filters.processId ?? ""],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: PnlTrendData }>(
        `/api/finance/pnl/trend${qs ? `?${qs}` : ""}`
      );
      return response.data;
    },
    staleTime: 60_000,
  });
}
