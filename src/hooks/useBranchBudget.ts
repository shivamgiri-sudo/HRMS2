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
export type BudgetAttributionScope = "branch_common" | "cost_centre" | "process";
export type BudgetPlanningLevel = "branch" | "cost_centre";

/** Sharing methods supported for a branch-level (planningLevel = "branch") line — reuses the
 *  allocationDriver field, now actually acted on server-side instead of only stored. */
export type BranchSharingMethod = "total_manpower" | "agent_headcount" | "revenue_share" | "equal_split" | "manual";
export const BRANCH_SHARING_METHODS: { value: BranchSharingMethod; label: string }[] = [
  { value: "total_manpower", label: "Manpower (planned headcount)" },
  { value: "agent_headcount", label: "Agent headcount" },
  { value: "revenue_share", label: "Revenue share" },
  { value: "equal_split", label: "Equal split" },
  { value: "manual", label: "Manual %" },
];

export interface ManualAllocationInput {
  costCentreId: string;
  percentage: number;
}

export interface BranchBudgetLineInput {
  id?: string;
  attributionScope?: BudgetAttributionScope;
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
  /** Defaults to "cost_centre" (today's behaviour). Set to "branch" to split this line across
   *  the branch's active cost centres by allocationDriver instead of attributing to one. */
  planningLevel?: BudgetPlanningLevel;
  /** Only used when planningLevel = "branch" and allocationDriver = "manual". */
  manualAllocations?: ManualAllocationInput[];
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

export interface BranchBudgetAllocationRecord {
  id: string;
  budget_line_id: string;
  cost_centre_id: string;
  cost_centre_name: string | null;
  cost_centre_code: string | null;
  driver_value: number;
  allocation_percentage: number;
  planned_unit: number;
  base_amount: number;
  tax_amount: number;
  gross_amount: number;
  pnl_cost_amount: number;
  rounding_adjustment: number;
  entry_source: "calculated" | "manual";
}

export interface BranchBudgetLineRecord {
  id: string;
  budget_id: string;
  cost_centre_id: string | null;
  cost_centre_name: string | null;
  planning_level: BudgetPlanningLevel;
  allocations?: BranchBudgetAllocationRecord[];
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

export interface CostCentreConsolidationLine {
  costCentreId: string;
  costCentreName: string | null;
  quantity: number;
  grossAmount: number;
  pnlCostAmount: number;
}

export interface CostCentreConsolidationGroup {
  head: string;
  subHead: string | null;
  itemName: string;
  unit: string;
  unitConsistent: boolean;
  branchUnit: number;
  branchBaseAmount: number;
  branchTaxAmount: number;
  branchGrossAmount: number;
  branchPnlCostAmount: number;
  costCentreCount: number;
  lines: CostCentreConsolidationLine[];
}

export interface BranchBudgetDetail extends BranchBudgetSummary {
  lines: BranchBudgetLineRecord[];
  approvals: BranchBudgetApprovalRecord[];
  /** Cost-centre-first consolidation (spec 6.2/7.2): cost-centre-planned lines sharing a
   *  head/sub-head/item, rolled up into a branch total. See buildCostCentreConsolidation()
   *  (branch-budget.service.ts) — computed server-side, read-only. */
  costCentreConsolidation: CostCentreConsolidationGroup[];
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
    attributionScope: line.planning_level === "branch"
      ? "branch_common"
      : line.cost_centre_id
        ? "cost_centre"
        : line.process_id
          ? "process"
          : "branch_common",
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
    planningLevel: line.planning_level === "branch" ? "branch" : "cost_centre",
    manualAllocations: line.allocations?.map((a) => ({
      costCentreId: a.cost_centre_id,
      percentage: a.allocation_percentage,
    })),
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

export interface CostCentreOption {
  id: string;
  costCentreCode: string;
  costCentreName: string;
}

export interface MonthlyDriverRecord {
  costCentreId: string;
  costCentreName: string;
  plannedHeadcount: number;
  revenueRatePerHead: number;
  calculatedPlannedRevenue: number;
  remarks: string | null;
  status: "draft" | "approved";
}

export interface MonthlyDriverInput {
  costCentreId: string;
  plannedHeadcount: number;
  revenueRatePerHead: number;
  remarks?: string | null;
}

/** Branch Budget foundation (PR 2): active cost centres + monthly driver setup (planned
 *  headcount, revenue rate per head) needed before manpower/revenue sharing methods can split a
 *  branch-level line across cost centres. */
export function useBranchBudgetAllocations(branchId?: string | null, periodCode?: string | null) {
  const queryClient = useQueryClient();

  const costCentresQuery = useQuery({
    queryKey: ["branch-budget-cost-centres", branchId],
    enabled: Boolean(branchId),
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: CostCentreOption[] }>(
        `/api/finance/pnl/branch-budget/cost-centres?branchId=${branchId}`
      );
      return response.data;
    },
  });

  const monthlyDriversQuery = useQuery({
    queryKey: ["branch-budget-monthly-drivers", branchId, periodCode],
    enabled: Boolean(branchId) && Boolean(periodCode),
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: MonthlyDriverRecord[] }>(
        `/api/finance/pnl/branch-budget/monthly-drivers?branchId=${branchId}&period=${periodCode}`
      );
      return response.data;
    },
  });

  const saveMonthlyDrivers = useMutation({
    mutationFn: async (drivers: MonthlyDriverInput[]) => {
      const response = await hrmsApi.put<{ success: boolean; data: MonthlyDriverRecord[] }>(
        "/api/finance/pnl/branch-budget/monthly-drivers",
        { branchId, periodCode, drivers }
      );
      return response.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["branch-budget-monthly-drivers", branchId, periodCode] }),
  });

  return { costCentresQuery, monthlyDriversQuery, saveMonthlyDrivers };
}
