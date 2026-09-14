import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import type { ProcessPnlFilters, ProcessPnlRecord } from "./useProcessPnl";

export interface ProcessPnlDetailBundle {
  record: ProcessPnlRecord;
  overview: Record<string, any>;
  revenue: {
    period: string;
    summary: {
      recognizedRevenue: number;
      invoicedRevenue: number;
      collectedRevenue: number;
      outstandingReceivable: number;
      revenueAtRisk: number;
      forecastRevenue: number;
    };
    contract: Record<string, any> | null;
    invoices: Array<Record<string, any>>;
  };
  workforce: {
    period: string;
    metrics: Record<string, number | null>;
    employees: Array<Record<string, any>>;
  };
  peopleCost: {
    period: string;
    source: string;
    summary: {
      directPeopleCost: number;
      salaryMtd: number;
    };
    employees: Array<Record<string, any>>;
  };
  directCost: {
    period: string;
    summary: {
      directPeopleCost: number;
      directExpenseCost: number;
      directVendorCost: number;
      directNonPeopleCost: number;
      directCost: number;
    };
    expenses: Array<Record<string, any>>;
  };
  indirectAllocation: {
    period: string;
    summary: {
      branchPoolAmount: number;
      processAllocationAmount: number;
      processAllocationPct: number;
    };
    pools: Array<Record<string, any>>;
  };
  trend: {
    period: string;
    trend: Array<{
      month: string;
      revenue: number;
      directCost: number;
      indirectCost: number;
      operatingProfit: number;
    }>;
  };
  reconciliation: {
    period: string;
    status: string;
    freshness: string | null;
    issues: Array<{ severity: string; code: string; message: string }>;
  };
  ledger: {
    period: string;
    summary: {
      revenue: number;
      directCost: number;
      indirectCost: number;
      operatingProfit: number;
    };
    entries: Array<Record<string, any>>;
  };
}

export interface ProcessPnlOverviewData extends ProcessPnlRecord {
  period: string;
  topPositiveContributors: Array<{ label: string; value: number }>;
  topNegativeContributors: Array<{ label: string; value: number }>;
}

export type ProcessPnlRevenueData = ProcessPnlDetailBundle["revenue"];
export type ProcessPnlWorkforceData = ProcessPnlDetailBundle["workforce"];
export type ProcessPnlPeopleCostData = ProcessPnlDetailBundle["peopleCost"];
export type ProcessPnlDirectCostData = ProcessPnlDetailBundle["directCost"];
export type ProcessPnlIndirectAllocationData = ProcessPnlDetailBundle["indirectAllocation"];
export type ProcessPnlTrendData = ProcessPnlDetailBundle["trend"];
export type ProcessPnlReconciliationData = ProcessPnlDetailBundle["reconciliation"];
export type ProcessPnlLedgerData = ProcessPnlDetailBundle["ledger"];

type ProcessPnlSectionMap = {
  overview: ProcessPnlOverviewData;
  revenue: ProcessPnlRevenueData;
  workforce: ProcessPnlWorkforceData;
  "people-cost": ProcessPnlPeopleCostData;
  "direct-cost": ProcessPnlDirectCostData;
  "indirect-allocation": ProcessPnlIndirectAllocationData;
  trend: ProcessPnlTrendData;
  reconciliation: ProcessPnlReconciliationData;
  ledger: ProcessPnlLedgerData;
};

export type ProcessPnlSectionKey = keyof ProcessPnlSectionMap;

function toQueryString(filters: ProcessPnlFilters): string {
  const params = new URLSearchParams();
  if (filters.period) params.set("period", filters.period);
  if (filters.branchId) params.set("branchId", filters.branchId);
  if (filters.clientId) params.set("clientId", filters.clientId);
  if (filters.search) params.set("search", filters.search);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function useProcessPnlDetail(processId: string, filters: ProcessPnlFilters) {
  const query = toQueryString(filters);

  return useQuery({
    queryKey: ["process-pnl-detail", processId, filters],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: ProcessPnlDetailBundle }>(
        `/api/finance/pnl/processes/${processId}/detail${query}`
      );
      return response.data;
    },
    enabled: Boolean(processId),
    staleTime: 60_000,
  });
}

export function useProcessPnlSection<K extends ProcessPnlSectionKey>(
  processId: string,
  filters: ProcessPnlFilters,
  section: K,
  enabled = true
) {
  const query = toQueryString(filters);

  return useQuery({
    queryKey: ["process-pnl-section", section, processId, filters],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: ProcessPnlSectionMap[K] }>(
        `/api/finance/pnl/processes/${processId}/${section}${query}`
      );
      return response.data;
    },
    enabled: enabled && Boolean(processId),
    staleTime: 60_000,
  });
}
