import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import type { BpoPnlFilters, BpoPnlRow } from "./useBpoProcessPnl";

export interface BpoProcessPnlDetail {
  period: string;
  row: BpoPnlRow;
  revenueRules: Array<Record<string, any>>;
  deliveryActuals: Array<Record<string, any>>;
  revenueComponents: Array<Record<string, any>>;
  payrollClassification: {
    agentSalary: number;
    agentHeadcount: number;
    averageAgentSalary: number | null;
    dscPeople: number;
    supportHeadcount: number;
    bmcPeopleAllocated: number;
  };
  costStack: {
    dscNonPeople: number;
    bmcNonPeople: number;
    grnVendorActual: number;
    depreciation: number;
    amortization: number;
    financeCost: number;
    tax: number;
  };
  budget: {
    approvedBudget: number;
    reservedBudget: number;
    consumedBudget: number;
  };
  generatedAt: string;
  /**
   * Manual Adjustments (Projected Revenue / Penalty / Reward): APPROVED entries only, folded into
   * a figure shown ALONGSIDE row.recognizedRevenue — never in place of it. Null when the table has
   * no rows for this process/period at all.
   */
  manualAdjustment: {
    approvedProjectedRevenue: number;
    approvedRewards: number;
    approvedPenalties: number;
    adjustedTotal: number;
    systemRevenue: number;
    pendingCount: number;
  } | null;
  /**
   * "Not yet configured" vs "genuinely zero" for depreciation/amortization/finance cost/tax —
   * process_pnl_cost_component holds zero rows in production today, so every one of these reads
   * false and the waterfall card shows "Not yet configured" rather than a confident-looking ₹0.
   * Presentation-only: does not affect row.depreciation/amortization/financeCost/tax themselves.
   */
  costComponentFlags: {
    hasDepreciationData: boolean;
    hasAmortizationData: boolean;
    hasFinanceCostData: boolean;
    hasTaxData: boolean;
  };
}

function queryString(filters: BpoPnlFilters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function useBpoProcessPnlDetail(processId: string, filters: BpoPnlFilters) {
  return useQuery({
    queryKey: ["bpo-process-pnl-detail", processId, filters],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: BpoProcessPnlDetail }>(
        `/api/finance/pnl/bpo/processes/${processId}${queryString(filters)}`
      );
      return response.data;
    },
    enabled: Boolean(processId),
    staleTime: 60_000,
  });
}
