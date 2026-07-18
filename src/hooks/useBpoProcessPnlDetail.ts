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
