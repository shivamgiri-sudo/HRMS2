export interface PnlQueryFilters {
  period: string;
  branchId?: string;
  processId?: string;
  clientId?: string;
  search?: string;
}

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

export interface PnlSummaryResponse {
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

export interface ProcessPnlDetailBundle {
  record: ProcessPnlRecord;
  overview: Record<string, unknown>;
  revenue: Record<string, unknown>;
  workforce: Record<string, unknown>;
  peopleCost: Record<string, unknown>;
  directCost: Record<string, unknown>;
  indirectAllocation: Record<string, unknown>;
  trend: Record<string, unknown>;
  reconciliation: Record<string, unknown>;
  ledger: Record<string, unknown>;
}
