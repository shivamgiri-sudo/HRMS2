import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export type BudgetPlanningStatus = "planned" | "not_planned" | "not_applicable";

export interface BudgetCoverageItem {
  expense_head_id: string;
  head_code: string;
  head_name: string;
  head_display_order: number;
  expense_sub_head_id: string;
  sub_head_code: string;
  sub_head_name: string;
  default_unit: string;
  default_tax_treatment: string;
  default_gst_rate: number;
  default_gst_type: string;
  default_recoverable_tax_pct: number;
  default_allocation_driver: string | null;
  pnl_treatment: string;
  planning_status: BudgetPlanningStatus | null;
  reason: string | null;
  budget_line_count: number;
  gross_budget_amount: number;
  pnl_budget_amount: number;
}

export interface BudgetCoverageResponse {
  items: BudgetCoverageItem[];
  summary: {
    total: number;
    reviewed: number;
    planned: number;
    notPlanned: number;
    notApplicable: number;
    incomplete: number;
    completionPct: number;
    readyToSubmit: boolean;
  };
}

export interface BudgetCoverageEntry {
  expenseHeadId: string;
  expenseSubHeadId: string;
  planningStatus: BudgetPlanningStatus;
  reason?: string | null;
}

export function useBudgetCoverage(budgetId: string | null) {
  const queryClient = useQueryClient();
  const coverageQuery = useQuery({
    queryKey: ["budget-coverage", budgetId],
    enabled: Boolean(budgetId),
    queryFn: async () => {
      const response = await hrmsApi.get<{
        success: boolean;
        data: BudgetCoverageResponse;
      }>(`/api/finance/pnl/budgets/${budgetId}/coverage`);
      return response.data;
    },
  });

  const saveCoverage = useMutation({
    mutationFn: async (entries: BudgetCoverageEntry[]) => {
      if (!budgetId) throw new Error("Save the budget draft before reviewing Head/Sub-head coverage");
      const response = await hrmsApi.put<{
        success: boolean;
        data: BudgetCoverageResponse;
      }>(`/api/finance/pnl/budgets/${budgetId}/coverage`, { entries });
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["budget-coverage", budgetId], data);
      void queryClient.invalidateQueries({ queryKey: ["branch-budgets"] });
    },
  });

  return { coverageQuery, saveCoverage };
}
