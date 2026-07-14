import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export interface ProcessPnlRecord {
  processId: string;
  processName: string;
  clientId: string | null;
  clientName: string | null;
  branchId: string | null;
  branchName: string | null;
  billingModel: string | null;
  contractedSeats: number | null;
  billableHc: number;
  requiredProductiveHc: number;
  requiredRosterHc: number;
  activeHc: number;
  deployedHc: number;
  bufferTargetPct: number | null;
  actualBufferPct: number | null;
  revenueMtd: number;
  revenueForecast: number;
  invoicedRevenueMtd: number;
  collectedRevenueMtd: number;
  outstandingReceivable: number;
  salaryMtd: number;
  directPeopleCost: number;
  directNonPeopleCost: number;
  directCost: number;
  indirectCost: number;
  totalCost: number;
  contributionMargin: number;
  operatingProfit: number;
  operatingMarginPct: number | null;
  budgetVariance: number | null;
  revenueAtRisk: number;
  monthEndProjectedProfit: number;
  reconciliationStatus: "matched" | "pending" | "exception";
  financialStatus: "actual" | "forecast" | "mixed";
  processStatus: "profitable" | "at-risk" | "loss-making";
  freshness: string | null;
}

export interface ProcessPnlSummary {
  period: string;
  filters: {
    branchId?: string;
    processId?: string;
    clientId?: string;
    search?: string;
  };
  kpis: {
    organisationRevenue: number;
    totalDirectCost: number;
    totalIndirectCost: number;
    operatingProfit: number;
    operatingMarginPct: number | null;
    mostProfitableProcess: { processId: string; processName: string; value: number } | null;
    lossMakingProcesses: number;
    revenueAtRisk: number;
    monthEndProjectedProfit: number;
    billableHeadcount: number;
    activeHeadcount: number;
  };
  alerts: Array<{
    type: "critical" | "warning" | "info";
    title: string;
    detail: string;
    processId?: string;
    processName?: string;
    impact?: number;
  }>;
  trend: Array<{
    month: string;
    revenue: number;
    directCost: number;
    indirectCost: number;
    operatingProfit: number;
  }>;
  generatedAt: string;
}

export interface ProcessPnlFilters {
  period?: string;
  branchId?: string;
  processId?: string;
  clientId?: string;
  search?: string;
}

function toQueryString(filters: ProcessPnlFilters): string {
  const params = new URLSearchParams();
  if (filters.period) params.set("period", filters.period);
  if (filters.branchId) params.set("branchId", filters.branchId);
  if (filters.processId) params.set("processId", filters.processId);
  if (filters.clientId) params.set("clientId", filters.clientId);
  if (filters.search) params.set("search", filters.search);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function useProcessPnl(filters: ProcessPnlFilters) {
  const query = toQueryString(filters);

  const summaryQuery = useQuery({
    queryKey: ["process-pnl-summary", filters],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: ProcessPnlSummary }>(`/api/finance/pnl/summary${query}`);
      return response.data;
    },
    staleTime: 60_000,
  });

  const processesQuery = useQuery({
    queryKey: ["process-pnl-processes", filters],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: ProcessPnlRecord[] }>(`/api/finance/pnl/processes${query}`);
      return response.data;
    },
    staleTime: 60_000,
  });

  return {
    summaryQuery,
    processesQuery,
  };
}

export function processPnlExportUrl(filters: ProcessPnlFilters) {
  return `/api/finance/pnl/export${toQueryString(filters)}`;
}
