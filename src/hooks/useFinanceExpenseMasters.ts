import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import type {
  BudgetGstType,
  BudgetTaxTreatment,
} from "@/hooks/useBranchBudget";

export interface FinanceExpenseSubHead {
  id: string;
  subHeadCode: string;
  subHeadName: string;
  defaultUnit: string;
  defaultTaxTreatment: BudgetTaxTreatment;
  defaultGstRate: number;
  defaultGstType: BudgetGstType;
  defaultRecoverableTaxPct: number;
  defaultAllocationDriver: string | null;
  pnlTreatment: "operating_expense" | "direct_cost" | "non_operating" | "excluded";
  displayOrder: number;
  activeStatus: boolean;
}

export interface FinanceExpenseHead {
  id: string;
  headCode: string;
  headName: string;
  description: string | null;
  displayOrder: number;
  activeStatus: boolean;
  subHeads: FinanceExpenseSubHead[];
}

export interface SaveExpenseHeadPayload {
  id?: string;
  headCode?: string;
  headName: string;
  description?: string | null;
  displayOrder?: number;
  activeStatus?: boolean;
}

export interface SaveExpenseSubHeadPayload {
  id?: string;
  headId: string;
  subHeadCode?: string;
  subHeadName: string;
  defaultUnit: string;
  defaultTaxTreatment: BudgetTaxTreatment;
  defaultGstRate: number;
  defaultGstType: BudgetGstType;
  defaultRecoverableTaxPct: number;
  defaultAllocationDriver?: string | null;
  pnlTreatment?: "operating_expense" | "direct_cost" | "non_operating" | "excluded";
  displayOrder?: number;
  activeStatus?: boolean;
}

export function useFinanceExpenseMasters(includeInactive = false) {
  const queryClient = useQueryClient();
  const mastersQuery = useQuery({
    queryKey: ["finance-expense-masters", includeInactive],
    queryFn: async () => {
      const response = await hrmsApi.get<{
        success: boolean;
        data: FinanceExpenseHead[];
      }>(
        `/api/finance/expense-masters${
          includeInactive ? "?includeInactive=true" : ""
        }`
      );
      return response.data;
    },
    staleTime: 5 * 60_000,
  });

  const saveHead = useMutation({
    mutationFn: (payload: SaveExpenseHeadPayload) =>
      hrmsApi.post("/api/finance/expense-heads", payload),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["finance-expense-masters"] }),
  });

  const saveSubHead = useMutation({
    mutationFn: (payload: SaveExpenseSubHeadPayload) =>
      hrmsApi.post("/api/finance/expense-sub-heads", payload),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["finance-expense-masters"] }),
  });

  return { mastersQuery, saveHead, saveSubHead };
}
