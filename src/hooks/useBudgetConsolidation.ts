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
  branchCount: number;
  branches: CompanyConsolidationBranchAmount[];
}

export interface BudgetConsolidationResponse {
  branchSummaries: BranchBudgetSummary[];
  headBreakdown: CompanyConsolidationGroup[];
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
