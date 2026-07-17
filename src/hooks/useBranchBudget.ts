import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export type TaxTreatment = "inclusive" | "exclusive" | "exempt" | "reverse_charge" | "non_gst";

export interface BranchBudgetLineInput {
  id?: string;
  costCentreId?: string | null;
  processId?: string | null;
  head: string;
  subHead?: string | null;
  itemName: string;
  itemDescription?: string | null;
  quantity: number;
  unit: string;
  unitRate: number;
  taxTreatment: TaxTreatment;
  gstRate: number;
  gstType?: "cgst_sgst" | "igst" | "none";
  recoverableTaxPct?: number;
  preferredVendorId?: string | null;
  allocationDriver?: string | null;
  justification: string;
}

export interface SaveBranchBudgetInput {
  id?: string;
  branchId: string;
  periodCode: string;
  financialYear: string;
  lines: BranchBudgetLineInput[];
}

export interface BranchBudgetSummary {
  id: string;
  budget_number: string;
  branch_id: string;
  branch_name: string;
  period_code: string;
  financial_year: string;
  status: string;
  base_budget_amount: number;
  tax_budget_amount: number;
  gross_budget_amount: number;
  pnl_budget_amount?: number;
  reserved_amount: number;
  consumed_amount: number;
  line_count: number;
}

function queryString(filters: { period?: string; branchId?: string; status?: string }) {
  const params = new URLSearchParams();
  if (filters.period) params.set("period", filters.period);
  if (filters.branchId) params.set("branchId", filters.branchId);
  if (filters.status) params.set("status", filters.status);
  const value = params.toString();
  return value ? `?${value}` : "";
}

export function calculateBudgetLine(line: BranchBudgetLineInput) {
  const quoted = Number(line.quantity || 0) * Number(line.unitRate || 0);
  const rate = Number(line.gstRate || 0);
  let base = quoted;
  let tax = 0;
  let gross = quoted;
  if (line.taxTreatment === "inclusive" && rate > 0) {
    base = quoted / (1 + rate / 100);
    tax = quoted - base;
  } else if (["exclusive", "reverse_charge"].includes(line.taxTreatment) && rate > 0) {
    tax = quoted * rate / 100;
    gross = quoted + tax;
  }
  if (["exempt", "non_gst"].includes(line.taxTreatment)) tax = 0;
  const recoverableTax = tax * Math.max(0, Math.min(100, Number(line.recoverableTaxPct ?? 100))) / 100;
  return { base, tax, gross, pnlCost: base + tax - recoverableTax };
}

export function useBranchBudgets(filters: { period?: string; branchId?: string; status?: string }) {
  const qc = useQueryClient();
  const budgetsQuery = useQuery({
    queryKey: ["branch-budgets", filters],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: BranchBudgetSummary[] }>(`/api/finance/pnl/budgets${queryString(filters)}`);
      return response.data;
    },
  });
  const saveBudget = useMutation({
    mutationFn: async (payload: SaveBranchBudgetInput) => {
      const response = await hrmsApi.post<{ success: boolean; data: unknown }>("/api/finance/pnl/budgets", payload);
      return response.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["branch-budgets"] }),
  });
  const submitBudget = useMutation({
    mutationFn: async (id: string) => hrmsApi.post(`/api/finance/pnl/budgets/${id}/submit`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["branch-budgets"] }),
  });
  const reviewBudget = useMutation({
    mutationFn: async ({ id, decision, remarks }: { id: string; decision: "approve" | "reject" | "revision"; remarks?: string }) =>
      hrmsApi.post(`/api/finance/pnl/budgets/${id}/review`, { decision, remarks }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["branch-budgets"] }),
  });
  const budgetDetail = (id: string) => hrmsApi.get<{ success: boolean; data: unknown }>(`/api/finance/pnl/budgets/${id}`);
  return { budgetsQuery, saveBudget, submitBudget, reviewBudget, budgetDetail };
}
