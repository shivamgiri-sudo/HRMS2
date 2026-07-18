import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export interface BpoPnlRow {
  processId: string;
  processName: string;
  clientId: string | null;
  clientName: string | null;
  branchId: string | null;
  branchName: string | null;
  costCentreId: string | null;
  costCentreCode: string | null;
  billingModels: string[];
  primaryBillingModel: string | null;
  revenueDataStatus: "configured" | "configured_no_delivery" | "accounting_fallback";
  mandatedSeats: number | null;
  contractedSeats: number | null;
  requiredProductiveHc: number;
  requiredRosterHc: number;
  activeHc: number;
  agentHeadcount: number;
  supportHeadcount: number;
  billableHc: number | null;
  seatFillPct: number | null;
  billableSeatUtilizationPct: number | null;
  plannedDeliveryUnits: number;
  deliveredUnits: number;
  acceptedUnits: number;
  rejectedUnits: number;
  billableUnits: number;
  productiveHours: number;
  loginHours: number;
  talkMinutes: number;
  qualityScore: number | null;
  slaScore: number | null;
  deliveryAttainmentPct: number | null;
  acceptancePct: number | null;
  grossPotentialRevenue: number;
  baseEarnedRevenue: number;
  minimumCommitmentTopUp: number;
  incentiveRevenue: number;
  rewardRevenue: number;
  trainingRevenue: number;
  otherRevenueIncrease: number;
  penalty: number;
  slaDeduction: number;
  creditNote: number;
  otherRevenueDecrease: number;
  earnedRevenue: number;
  recognizedRevenue: number;
  invoicedRevenue: number;
  collectedRevenue: number;
  outstandingReceivable: number;
  unbilledRevenue: number;
  deferredRevenue: number;
  revenueLeakage: number;
  revenueAtRisk: number;
  revenueBudget: number | null;
  revenueVariance: number | null;
  agentSalary: number;
  averageAgentSalary: number | null;
  agentSalaryPctRevenue: number | null;
  dscPeople: number;
  dscNonPeople: number;
  dsc: number;
  dscPctRevenue: number | null;
  bmcPeople: number;
  bmcNonPeople: number;
  bmc: number;
  bmcPctRevenue: number | null;
  grnVendorActual: number;
  totalPeopleCost: number;
  peopleCostPctRevenue: number | null;
  contribution: number;
  contributionMarginPct: number | null;
  ebitda: number;
  ebitdaMarginPct: number | null;
  depreciation: number;
  amortization: number;
  ebit: number;
  operatingProfit: number;
  operatingProfitPct: number | null;
  financeCost: number;
  pbt: number;
  tax: number;
  pat: number;
  totalOperatingCost: number;
  totalCostPctRevenue: number | null;
  revenuePerAgent: number | null;
  revenuePerActiveEmployee: number | null;
  revenuePerContractedSeat: number | null;
  loadedCostPerBillableSeat: number | null;
  approvedBudget: number;
  reservedBudget: number;
  consumedBudget: number;
  availableBudget: number;
  budgetUtilizationPct: number | null;
  ebitdaBudget: number | null;
  ebitdaVariance: number | null;
  processStatus: "profitable" | "at-risk" | "loss-making";
  freshness: string | null;
}

export interface BpoPnlSummary {
  period: string;
  filters: Record<string, string | undefined>;
  kpis: {
    grossPotentialRevenue: number;
    earnedRevenue: number;
    recognizedRevenue: number;
    invoicedRevenue: number;
    collectedRevenue: number;
    outstandingReceivable: number;
    unbilledRevenue: number;
    revenueAtRisk: number;
    agentSalary: number;
    agentSalaryPctRevenue: number | null;
    dsc: number;
    dscPctRevenue: number | null;
    bmc: number;
    bmcPctRevenue: number | null;
    grnVendorActual: number;
    totalPeopleCost: number;
    peopleCostPctRevenue: number | null;
    contribution: number;
    ebitda: number;
    ebitdaMarginPct: number | null;
    operatingProfit: number;
    operatingProfitPct: number | null;
    pbt: number;
    pat: number;
    approvedBudget: number;
    consumedBudget: number;
    reservedBudget: number;
    availableBudget: number;
    activeHeadcount: number;
    agentHeadcount: number;
    configuredProcesses: number;
    totalProcesses: number;
    revenueModelCoveragePct: number | null;
    lossMakingProcesses: number;
  };
  revenueMix: {
    baseRevenue: number;
    minimumCommitment: number;
    incentivesAndRewards: number;
    trainingAndOtherRevenue: number;
    penaltiesAndSla: number;
    creditNotesAndOtherDeductions: number;
  };
  costMix: {
    agentSalary: number;
    dscPeople: number;
    dscNonPeople: number;
    bmcPeople: number;
    bmcNonPeople: number;
    depreciation: number;
    amortization: number;
    financeCost: number;
    tax: number;
  };
  alerts: Array<{
    type: "critical" | "warning" | "info";
    code: string;
    title: string;
    detail: string;
    processId?: string;
    processName?: string;
    impact?: number;
  }>;
  rows: BpoPnlRow[];
  generatedAt: string;
}

export interface BpoPnlFilters {
  period?: string;
  branchId?: string;
  processId?: string;
  clientId?: string;
  search?: string;
}

function queryString(filters: BpoPnlFilters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function useBpoProcessPnl(filters: BpoPnlFilters) {
  return useQuery({
    queryKey: ["bpo-process-pnl", filters],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: BpoPnlSummary }>(
        `/api/finance/pnl/bpo/summary${queryString(filters)}`
      );
      return response.data;
    },
    staleTime: 60_000,
  });
}

export async function downloadBpoPnlExport(filters: BpoPnlFilters) {
  const blob = await hrmsApi.getBlob(`/api/finance/pnl/bpo/export${queryString(filters)}`);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `bpo-process-pnl-${filters.period ?? "current"}.csv`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
