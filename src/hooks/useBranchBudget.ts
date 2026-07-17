import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export type BudgetTaxTreatment =
  | "inclusive"
  | "exclusive"
  | "exempt"
  | "reverse_charge"
  | "non_gst";
export type BudgetGstType = "cgst_sgst" | "igst" | "none";
export type TaxTreatment = BudgetTaxTreatment;

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
  taxTreatment: BudgetTaxTreatment;
  gstRate: number;
  gstType?: BudgetGstType;
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
  revision_no: number;
  base_budget_amount: number;
  tax_budget_amount: number;
  gross_budget_amount: number;
  pnl_budget_amount: number;
  reserved_quantity: number;
  consumed_quantity: number;
  reserved_amount: number;
  consumed_amount: number;
  line_count: number;
}

export interface BranchBudgetLineRecord {
  id: string;
  budget_id: string;
  cost_centre_id: string | null;
  cost_centre_name: string | null;
  process_id: string | null;
  process_name: string | null;
  head: string;
  sub_head: string | null;
  item_name: string;
  item_description: string | null;
  quantity: number;
  unit: string;
  unit_rate: number;
  tax_treatment: BudgetTaxTreatment;
  gst_rate: number;
  gst_type: BudgetGstType;
  recoverable_tax_pct: number;
  base_amount: number;
  tax_amount: number;
  gross_amount: number;
  pnl_cost_amount: number;
  preferred_vendor_id: string | null;
  preferred_vendor_name: string | null;
  allocation_driver: string | null;
  justification: string;
  reserved_quantity: number;
  consumed_quantity: number;
  reserved_amount: number;
  consumed_amount: number;
  available_quantity: number;
  available_gross_amount: number;
}

export interface BranchBudgetApprovalRecord {
  id: string;
  action: string;
  from_status: string | null;
  to_status: string;
  actor_user_id: string;
  actor_role: string;
  remarks: string | null;
  created_at: string;
}

export interface BranchBudgetDetail extends BranchBudgetSummary {
  lines: BranchBudgetLineRecord[];
  approvals: BranchBudgetApprovalRecord[];
}

function queryString(filters: {
  period?: string;
  branchId?: string;
  status?: string;
}) {
  const params = new URLSearchParams();
  if (filters.period) params.set("period", filters.period);
  if (filters.branchId) params.set("branchId", filters.branchId);
  if (filters.status) params.set("status", filters.status);
  const value = params.toString();
  return value ? `?${value}` : "";
}

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function calculateBudgetLine(line: BranchBudgetLineInput) {
  const quoted = roundMoney(
    Number(line.quantity || 0) * Number(line.unitRate || 0)
  );
  const rate = Number(line.gstRate || 0);
  let base = quoted;
  let tax = 0;
  let gross = quoted;

  if (line.taxTreatment === "inclusive" && rate > 0) {
    base = roundMoney(quoted / (1 + rate / 100));
    tax = roundMoney(quoted - base);
  } else if (
    ["exclusive", "reverse_charge"].includes(line.taxTreatment)
    && rate > 0
  ) {
    tax = roundMoney(quoted * rate / 100);
    gross = roundMoney(quoted + tax);
  }
  if (["exempt", "non_gst"].includes(line.taxTreatment)) {
    tax = 0;
    gross = base;
  }

  const recoverableTax = roundMoney(
    tax
      * Math.max(0, Math.min(100, Number(line.recoverableTaxPct ?? 100)))
      / 100
  );
  return {
    base,
    tax,
    gross,
    pnlCost: roundMoney(base + tax - recoverableTax),
  };
}

export function budgetLineRecordToInput(
  line: BranchBudgetLineRecord
): BranchBudgetLineInput {
  return {
    id: line.id,
    costCentreId: line.cost_centre_id,
    processId: line.process_id,
    head: line.head,
    subHead: line.sub_head,
    itemName: line.item_name,
    itemDescription: line.item_description,
    quantity: Number(line.quantity),
    unit: line.unit,
    unitRate: Number(line.unit_rate),
    taxTreatment: line.tax_treatment,
    gstRate: Number(line.gst_rate),
    gstType: line.gst_type,
    recoverableTaxPct: Number(line.recoverable_tax_pct),
    preferredVendorId: line.preferred_vendor_id,
    allocationDriver: line.allocation_driver,
    justification: line.justification,
  };
}

export function useBranchBudgets(filters: {
  period?: string;
  branchId?: string;
  status?: string;
}) {
  const queryClient = useQueryClient();
  const budgetsQuery = useQuery({
    queryKey: ["branch-budgets", filters],
    queryFn: async () => {
      const response = await hrmsApi.get<{
        success: boolean;
        data: BranchBudgetSummary[];
      }>(`/api/finance/pnl/budgets${queryString(filters)}`);
      return response.data;
    },
  });

  const saveBudget = useMutation({
    mutationFn: async (payload: SaveBranchBudgetInput) => {
      const response = await hrmsApi.post<{
        success: boolean;
        data: BranchBudgetDetail;
      }>("/api/finance/pnl/budgets", payload);
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["branch-budget-detail", data.id], data);
      return queryClient.invalidateQueries({ queryKey: ["branch-budgets"] });
    },
  });

  const submitBudget = useMutation({
    mutationFn: async (id: string) => {
      const response = await hrmsApi.post<{
        success: boolean;
        data: BranchBudgetDetail;
      }>(`/api/finance/pnl/budgets/${id}/submit`, {});
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["branch-budget-detail", data.id], data);
      return queryClient.invalidateQueries({ queryKey: ["branch-budgets"] });
    },
  });

  const reviewBudget = useMutation({
    mutationFn: async ({
      id,
      decision,
      remarks,
    }: {
      id: string;
      decision: "approve" | "reject" | "revision";
      remarks?: string;
    }) => {
      const response = await hrmsApi.post<{
        success: boolean;
        data: BranchBudgetDetail;
      }>(`/api/finance/pnl/budgets/${id}/review`, { decision, remarks });
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["branch-budget-detail", data.id], data);
      return queryClient.invalidateQueries({ queryKey: ["branch-budgets"] });
    },
  });

  return { budgetsQuery, saveBudget, submitBudget, reviewBudget };
}

export function useBranchBudgetDetail(id?: string | null) {
  return useQuery({
    queryKey: ["branch-budget-detail", id],
    enabled: Boolean(id),
    queryFn: async () => {
      const response = await hrmsApi.get<{
        success: boolean;
        data: BranchBudgetDetail;
      }>(`/api/finance/pnl/budgets/${id}`);
      return response.data;
    },
  });
}
