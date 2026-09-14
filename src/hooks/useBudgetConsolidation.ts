import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import type { BranchBudgetSummary } from "@/hooks/useBranchBudget";

/** Branch Budget foundation (PR 11): company-wide, all-branches budget consolidation for
 *  CEO/COO/finance-leadership roles. */
export interface CompanyConsolidationBranchAmount {
  branchId: string;
  branchName: string | null;
  budgetStatus: string;
  quantity: number;
  grossAmount: number;
  pnlCostAmount: number;
  reservedAmount: number;
  consumedAmount: number;
  paidAmount: number;
  bookedToPnlAmount: number;
}

export interface CompanyConsolidationGroup {
  head: string;
  subHead: string | null;
  itemName: string;
  unit: string;
  unitConsistent: boolean;
  companyUnit: number;
  companyGrossAmount: number;
  companyPnlCostAmount: number;
  companyReservedAmount: number;
  companyConsumedAmount: number;
  companyPaidAmount: number;
  companyBookedToPnlAmount: number;
  branchCount: number;
  branches: CompanyConsolidationBranchAmount[];
}

export interface BranchReadiness {
  budgetId: string;
  branchName: string | null;
  /** null when the coverage read failed — the API distinguishes "0% planned" from "we could
   *  not tell", so the table must not render the second as the first. */
  completionPct: number | null;
  readyToSubmit: boolean;
  coverageAvailable?: boolean;
}

export interface BudgetConsolidationResponse {
  branchSummaries: BranchBudgetSummary[];
  headBreakdown: CompanyConsolidationGroup[];
  /** Branch Budget foundation (PR 13): per-branch Head/Sub-head Coverage completion, reusing
   *  budgetCoverageService.getCoverage() once per branch's budget — no new coverage logic. */
  readiness: BranchReadiness[];
  /** True once this period's P&L has been signed off and locked (canonical-pnl.service.ts's
   *  lock()). This rollup still reads live budget data either way — the flag only tells the
   *  viewer whether the figures below can still move, since there is no frozen snapshot of
   *  budget consolidation to fall back to yet. */
  isPeriodLocked: boolean;
}

export function useBudgetConsolidation(period: string) {
  return useQuery({
    queryKey: ["budget-consolidation", period],
    enabled: Boolean(period),
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: BudgetConsolidationResponse }>(
        `/api/finance/pnl/budgets/consolidation?period=${period}`
      );
      return response.data;
    },
  });
}
