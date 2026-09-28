import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export type PnlReconciliationMode = "FINAL" | "LIVE_MTD" | "BLOCKED";
export type PnlSourceStatus = "ACTUAL" | "ACCRUAL" | "MISSING" | "PARTIAL" | "ESTIMATED";
/** Where a cost centre's recognised revenue came from. ESTIMATED = seat rate x seats. */
export type PnlRevenueBasis = "INVOICE" | "ACCRUAL" | "ESTIMATED" | "NONE";

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
  /** The process this cost centre serves (mapped process, else billing name); null when unknown. */
  costCentreProcess?: string | null;
  companyName: string | null;
  active: boolean;
  revenueInvoice: number;
  revenueProvision: number;
  revenueAccrual: number;
  creditNote: number;
  revenueEstimated: number;
  recognisedRevenue: number;
  revenueBasis: PnlRevenueBasis;
  estimateSource: "configured" | "invoice" | null;
  estimateSourcePeriod: string | null;
  perDayRevenue: number;
  grnActual: number;
  /** Approved GRN spend (reserved, not yet consumed) for the open month — a committed estimate,
   *  same treatment as revenueEstimated. Zero for a closed month or once the bill is consumed. */
  grnEstimated?: number;
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
  grnEstimated?: number;
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
    /** Payroll of staff with no cost centre — included in payrollCost/OP, in no row. */
    unallocatedPayroll?: number;
    unallocatedStaff?: number;
    revenue: number;
    revenueInvoice: number;
    revenueAccrual: number;
    creditNote: number;
    revenueEstimated: number;
    estimatedCostCentres: number;
    perDayRevenue: number;
    grnActual: number;
    grnEstimated?: number;
    allocatedBudget: number;
    branchBudget: number;
    payrollCost: number;
    staffPaid: number;
    operatingProfit: number;
    marginPct: number | null;
    /** Company-wide only, manually entered under P&L Configuration > Below-the-line costs. */
    depreciation?: number;
    financeCost?: number;
    taxProvision?: number;
    belowTheLineTotal?: number;
    /** operatingProfit - belowTheLineTotal — deeper than marginPct above (which is a contribution
     *  margin); this also subtracts depreciation, finance cost and tax. */
    truePat?: number;
    truePatPct?: number | null;
  };
  branches: PnlBranchRollup[];
  rows: PnlReconciliationRow[];
  freshness: PnlSourceFreshness[];
  exceptions: Array<{ code: string; label: string; amount: number; count: number }>;
  blockers: string[];
  /** No GRN maps anywhere in the company for the month, and no committed estimate covers it. */
  idcMissing?: boolean;
  estimate?: {
    applied: boolean;
    daysInMonth: number;
    daysElapsed: number;
    configurationAvailable: boolean;
  };
}

export function usePnlLiveReconciliation(
  period: string,
  filters: { branchIds?: string[]; clientId?: string; search?: string } = {},
) {
  const branchIds = filters.branchIds ?? [];
  const branchKey = [...branchIds].sort().join(",");
  // The page's Client / Search filters (audit item 19): narrowed server-side to the cost centres
  // the matching processes' staff are posted to. Empty strings keep the old query key shape.
  const clientId = filters.clientId ?? "";
  const search = filters.search ?? "";
  return useQuery({
    queryKey: ["pnl-live-reconciliation", period, branchKey, clientId, search],
    enabled: Boolean(period),
    placeholderData: (previous) => previous,
    staleTime: 60_000,
    queryFn: async () => {
      const params = new URLSearchParams({ period });
      if (branchIds.length) params.set("branchIds", branchIds.join(","));
      if (clientId) params.set("clientId", clientId);
      if (search) params.set("search", search);
      const response = await hrmsApi.get<{ success: boolean; data: PnlLiveReconciliation }>(
        `/api/finance/pnl/reconciliation?${params.toString()}`,
      );
      return response.data;
    },
  });
}
