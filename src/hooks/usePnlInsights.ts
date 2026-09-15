import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

/**
 * P&L Insights — margin heatmap, profit contribution, unit economics and revenue mix.
 * Mirrors backend/src/modules/process-pnl/pnl-insights.service.ts — keep the two in step
 * (strict:false frontend typecheck cannot catch a misnamed key).
 */

export interface InsightCell {
  period: string;
  revenue: number;
  cost: number;
  op: number;
  opPct: number | null;
  estimated: boolean;
  noPayroll: boolean;
}

export interface InsightHeatRow {
  costCentreId: string;
  code: string;
  name: string;
  processName: string | null;
  branchName: string;
  cells: InsightCell[];
  windowRevenue: number;
  windowOp: number;
  windowOpPct: number | null;
}

export interface InsightContribution {
  costCentreId: string;
  code: string;
  name: string;
  processName: string | null;
  branchName: string;
  revenue: number;
  payroll: number;
  idc: number;
  op: number;
  opPct: number | null;
  estimated: boolean;
  revenueEstimated: number;
  kind: "trading" | "no_revenue" | "no_payroll";
}

export interface InsightUnit {
  costCentreId: string;
  code: string;
  name: string;
  processName: string | null;
  branchName: string;
  staff: number;
  revenue: number;
  revenuePerHead: number;
  costPerHead: number;
  opPct: number | null;
}

export interface InsightMix {
  branchId: string | null;
  branchName: string;
  invoiced: number;
  accrual: number;
  estimated: number;
  creditNote: number;
  revenue: number;
}

export interface PnlInsights {
  period: string;
  months: { period: string; label: string; salaryMissing: boolean; idcMissing?: boolean }[];
  salaryMissing: boolean;
  heatmap: InsightHeatRow[];
  contribution: InsightContribution[];
  unitEconomics: InsightUnit[];
  revenueMix: { branches: InsightMix[]; totals: Omit<InsightMix, "branchId" | "branchName"> };
  notes: string[];
}

export function usePnlInsights(period: string, months: number, branchId?: string) {
  return useQuery({
    queryKey: ["pnl-insights", period, months, branchId ?? null],
    enabled: /^\d{4}-\d{2}$/.test(period),
    staleTime: 5 * 60_000,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const search = new URLSearchParams({ period, months: String(months) });
      if (branchId) search.set("branchId", branchId);
      const response = await hrmsApi.get<{ success: boolean; data: PnlInsights }>(`/api/finance/pnl/insights?${search.toString()}`, 90_000);
      return response.data;
    },
  });
}
