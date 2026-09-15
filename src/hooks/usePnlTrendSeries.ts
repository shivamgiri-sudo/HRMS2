import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

/**
 * P&L trend by day / week / month for the company, a branch or a cost centre.
 * Mirrors backend/src/modules/process-pnl/pnl-trend-series.service.ts — keep the two in step
 * (strict:false frontend typecheck cannot catch a misnamed key).
 */

export type TrendGrain = "day" | "week" | "month";
export type TrendScopeType = "company" | "branch" | "cost_centre";

export interface TrendPoint {
  key: string;
  label: string;
  start: string;
  end: string;
  revenue: number;
  revenueActual: number;
  revenueEstimated: number;
  salary: number | null;
  idc: number;
  cost: number | null;
  op: number | null;
  opPct: number | null;
  salaryMissing: boolean;
  /** No indirect cost recorded for the month anywhere — OP% is NA. */
  idcMissing?: boolean;
  isPartial: boolean;
}

export interface TrendSeries {
  grain: TrendGrain;
  scope: { type: TrendScopeType; id: string | null; label: string };
  asOfDate: string;
  points: TrendPoint[];
  totals: { revenue: number; revenueEstimated: number; salary: number | null; idc: number; op: number | null; opPct: number | null };
  notes: string[];
  options: {
    branches: Array<{ id: string; name: string }>;
    costCentres: Array<{ id: string; code: string; name: string; processName?: string | null; branchId: string | null; branchName: string }>;
  };
}

export function usePnlTrendSeries(params: { grain: TrendGrain; scope: TrendScopeType; scopeId?: string; anchor: string; count?: number }) {
  const ready = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.anchor) && (params.scope === "company" || Boolean(params.scopeId));
  return useQuery({
    queryKey: ["pnl-trend-series", params.grain, params.scope, params.scopeId ?? null, params.anchor, params.count ?? null],
    enabled: ready,
    staleTime: 5 * 60_000,
    // Refetch keeps the frame: the previous chart stays up (dimmed) while the next slice loads.
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const search = new URLSearchParams({ grain: params.grain, scope: params.scope, anchor: params.anchor });
      if (params.scopeId) search.set("scopeId", params.scopeId);
      if (params.count) search.set("count", String(params.count));
      const response = await hrmsApi.get<{ success: boolean; data: TrendSeries }>(`/api/finance/pnl/trend-series?${search.toString()}`, 90_000);
      return response.data;
    },
  });
}
