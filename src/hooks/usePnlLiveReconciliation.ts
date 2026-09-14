import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export type PnlReconciliationMode = "FINAL" | "LIVE_MTD" | "BLOCKED";
export type PnlSourceStatus = "ACTUAL" | "ACCRUAL" | "MISSING" | "PARTIAL";

export interface PnlSourceFreshness {
  source: string;
  table: string;
  rows: number;
  latestSyncedAt: string | null;
  status: PnlSourceStatus;
}

export interface PnlReconciliationRow {
  branchId: string | null;
  branchName: string;
  costCentreId: string;
  costCentreCode: string;
  costCentreName: string;
  companyName: string | null;
  active: boolean;
  revenueInvoice: number;
  revenueProvision: number;
  revenueAccrual: number;
  creditNote: number;
  recognisedRevenue: number;
  grnActual: number;
  allocatedBudget: number;
  branchBudget: number;
  payrollCost: number;
  staffPaid: number;
  operatingProfit: number;
  marginPct: number | null;
  sourceStatus: PnlSourceStatus;
  issues: string[];
}

export interface PnlBranchRollup {
  branchId: string | null;
  branchName: string;
  costCentres: number;
  revenue: number;
  grnActual: number;
  allocatedBudget: number;
  branchBudget: number;
  payrollCost: number;
  staffPaid: number;
  operatingProfit: number;
  marginPct: number | null;
  issues: string[];
}

export interface PnlLiveReconciliation {
  period: string;
  company: string;
  mode: PnlReconciliationMode;
  generatedAt: string;
  totals: {
    activeCostCentres: number;
    revenue: number;
    revenueInvoice: number;
    revenueAccrual: number;
    creditNote: number;
    grnActual: number;
    allocatedBudget: number;
    branchBudget: number;
    payrollCost: number;
    staffPaid: number;
    operatingProfit: number;
    marginPct: number | null;
  };
  branches: PnlBranchRollup[];
  rows: PnlReconciliationRow[];
  freshness: PnlSourceFreshness[];
  exceptions: Array<{ code: string; label: string; amount: number; count: number }>;
  blockers: string[];
}

export function usePnlLiveReconciliation(period: string, filters: { branchIds?: string[] } = {}) {
  const branchIds = filters.branchIds ?? [];
  const branchKey = [...branchIds].sort().join(",");
  return useQuery({
    queryKey: ["pnl-live-reconciliation", period, branchKey],
    enabled: Boolean(period),
    placeholderData: (previous) => previous,
    staleTime: 60_000,
    queryFn: async () => {
      const params = new URLSearchParams({ period });
      if (branchIds.length) params.set("branchIds", branchIds.join(","));
      const response = await hrmsApi.get<{ success: boolean; data: PnlLiveReconciliation }>(
        `/api/finance/pnl/reconciliation?${params.toString()}`,
      );
      return response.data;
    },
  });
}
