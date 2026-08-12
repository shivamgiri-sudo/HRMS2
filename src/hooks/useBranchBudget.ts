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
export type BranchSharingMethod = "total_manpower" | "agent_headcount" | "revenue_share" | "equal_split" | "manual" | "meter_wise" | "grade_weighted_headcount" | "seat_count" | "floor_area" | "device_count" | "hiring_volume";
/** Must stay in step with SUPPORTED_SHARING_METHODS in branch-budget-allocation.service.ts.
 *  The last four were added because finance_expense_sub_head_master already seeds them as
 *  default_allocation_driver on 26 of the 38 sub-heads; leaving them out of this list meant a
 *  sub-head's own default could not be picked in the UI even once the engine accepted it. */
export const BRANCH_SHARING_METHODS: { value: BranchSharingMethod; label: string }[] = [
  { value: "total_manpower", label: "Manpower (planned headcount)" },
  { value: "agent_headcount", label: "Agent headcount" },
  { value: "revenue_share", label: "Revenue share" },
  { value: "equal_split", label: "Equal split" },
  { value: "manual", label: "Manual %" },
  { value: "meter_wise", label: "Meter-wise (utility consumption)" },
  { value: "grade_weighted_headcount", label: "Grade-weighted headcount (blended CTC)" },
  { value: "seat_count", label: "Seats" },
  { value: "floor_area", label: "Floor area" },
  { value: "device_count", label: "Devices" },
  { value: "hiring_volume", label: "Hiring volume" },
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
  expenditureType?: "opex" | "capex";
  /** Defaults to "cost_centre" (today's behaviour). Set to "branch" to split this line across
   *  the branch's active cost centres by allocationDriver instead of attributing to one. */
  planningLevel?: BudgetPlanningLevel;
  /** Only used when planningLevel = "branch" and allocationDriver = "manual". */
  manualAllocations?: ManualAllocationInput[];
  /** Only used when planningLevel = "branch". The cost centres this line applies to; omit or leave
   *  empty to spread across every active cost centre. */
  includedCostCentreIds?: string[] | null;
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
  /** The user who raised it. Returned by the list query's `SELECT h.*` all along, but undeclared —
   *  needed to show a creator their own draft's delete action. */
  created_by?: string | null;
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

export interface BudgetException {
  lineId: string;
  itemName: string;
  type: "missing_driver_data" | "manual_split_imbalance";
  message: string;
}

/** A reviewer's correction note against one head/sub-head, sent back with a revision request. */
export interface BudgetLineCorrectionInput {
  lineId?: string | null;
  head: string;
  subHead?: string | null;
  itemName?: string | null;
  note: string;
}

export interface BudgetLineCorrectionRecord {
  id: string;
  budget_id: string;
  line_id: string | null;
  head: string;
  sub_head: string | null;
  item_name: string | null;
  correction_note: string;
  raised_by_role: string;
  raised_by: string;
  raised_by_name: string | null;
  raised_at: string;
  revision_no: number;
  resolved_at: string | null;
}

export interface BranchBudgetDetail extends BranchBudgetSummary {
  lines: BranchBudgetLineRecord[];
  approvals: BranchBudgetApprovalRecord[];
  /** Per head/sub-head correction notes raised by reviewers. Open notes (resolved_at null) are the
   *  current round's instructions to the branch admin; resolved ones are kept as history. */
  corrections: BudgetLineCorrectionRecord[];
  /** Cost-centre-first consolidation (spec 6.2/7.2): cost-centre-planned lines sharing a
   *  head/sub-head/item, rolled up into a branch total. See buildCostCentreConsolidation()
   *  (branch-budget.service.ts) — computed server-side, read-only. */
  costCentreConsolidation: CostCentreConsolidationGroup[];
  /** Branch Budget foundation (PR 13): branch-common lines whose sharing method now has missing
   *  driver data, or manual splits that no longer total 100% — read-only, non-blocking. */
  exceptions: BudgetException[];
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
    // The saved allocation rows ARE the cost-centre scope: a cost centre left out of the line has
    // no row (as opposed to a row with a zero amount), so the selection round-trips without
    // needing a table of its own.
    includedCostCentreIds: line.allocations?.length
      ? line.allocations.map((a) => a.cost_centre_id)
      : null,
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
      lineCorrections,
    }: {
      id: string;
      decision: "approve" | "reject" | "revision";
      remarks?: string;
      /** Per head/sub-head notes telling the branch admin exactly what to fix. The backend
       *  requires at least one of these when the decision is "revision". */
      lineCorrections?: BudgetLineCorrectionInput[];
    }) => {
      const response = await hrmsApi.post<{
        success: boolean;
        data: BranchBudgetDetail;
      }>(`/api/finance/pnl/budgets/${id}/review`, { decision, remarks, lineCorrections });
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["branch-budget-detail", data.id], data);
      return queryClient.invalidateQueries({ queryKey: ["branch-budgets"] });
    },
  });

  /** A reviewer correcting the lines in place at their own stage. Does not move the budget — the
   *  reviewer still has to approve afterwards. */
  const reviewerReviseBudget = useMutation({
    mutationFn: async ({
      id,
      lines,
      reason,
    }: {
      id: string;
      lines: BranchBudgetLineInput[];
      reason: string;
    }) => {
      const response = await hrmsApi.post<{
        success: boolean;
        data: BranchBudgetDetail;
      }>(`/api/finance/pnl/budgets/${id}/reviewer-revise`, { lines, reason });
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["branch-budget-detail", data.id], data);
      return queryClient.invalidateQueries({ queryKey: ["branch-budgets"] });
    },
  });

  /** Super-admin removal. The server deletes outright only when no GRN has consumed against the
   *  budget, and closes it instead when spend history exists, reporting which it did. */
  const deleteBudget = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const response = await hrmsApi.delete<{
        success: boolean;
        data: { outcome: "deleted" | "superseded"; budgetNumber: string; message: string };
      }>(`/api/finance/pnl/budgets/${id}`, { data: { reason } });
      return response.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["branch-budgets"] }),
  });

  return { budgetsQuery, saveBudget, submitBudget, reviewBudget, reviewerReviseBudget, deleteBudget };
}

export interface PriorMirrorLine {
  head: string;
  subHead: string;
  amount: number;
}

/**
 * The previous month's budget from the db_bill mirror, for months that were never created in the
 * workspace. July 2026 is the case in hand: it exists only as a mirrored snapshot, so the
 * Prev/Variance columns read zero and Copy-forward stays disabled against a month that does have
 * a budget.
 *
 * Only enabled when there is no workspace budget for that month — the workspace copy is always
 * the better source when it exists, because it is what was actually approved here.
 */
export function usePriorBudgetMirror(period?: string | null, branchId?: string | null, enabled = true) {
  return useQuery({
    queryKey: ["branch-budget-prior-mirror", period, branchId],
    enabled: Boolean(enabled && period && branchId),
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: PriorMirrorLine[] }>(
        `/api/finance/pnl/budgets/prior-mirror${queryString({ period: period ?? undefined, branchId: branchId ?? undefined })}`
      );
      return response.data;
    },
  });
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
  /** The process this cost centre serves, from cost_centre_master's text columns rather than a
   *  process_id join — process_id is NULL on live rows whose process name IS recorded. */
  processName?: string | null;
  processMapped?: boolean;
}

export interface MonthlyDriverRecord {
  costCentreId: string;
  costCentreName: string;
  plannedHeadcount: number;
  revenueRatePerHead: number;
  calculatedPlannedRevenue: number;
  /** Drivers for the seat_count / floor_area / device_count / hiring_volume sharing methods
   *  (migration 434). Optional so an older API response still satisfies the type. */
  seatCount?: number;
  floorAreaSqft?: number;
  deviceCount?: number;
  hiringVolume?: number;
  remarks: string | null;
  status: "draft" | "approved";
}

export interface MonthlyDriverInput {
  costCentreId: string;
  plannedHeadcount: number;
  revenueRatePerHead: number;
  seatCount?: number;
  floorAreaSqft?: number;
  deviceCount?: number;
  hiringVolume?: number;
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

export interface MeterOption {
  id: string;
  meterCode: string;
  meterName: string;
  branchId: string;
  costCentreId: string;
  location: string | null;
  readingUnit: string;
  fixedRate: number;
}

export interface CreateMeterInput {
  costCentreId: string;
  meterCode: string;
  meterName: string;
  location?: string | null;
  readingUnit: string;
  fixedRate: number;
  effectiveFrom: string;
}

export interface MeterReadingRecord {
  id: string;
  meterId: string;
  periodCode: string;
  openingReading: number;
  closingReading: number;
  consumption: number;
  rate: number;
  amount: number;
  readingType: "actual" | "estimated";
  estimationMethod: string | null;
  estimationReason: string | null;
  reconciliationStatus: "pending" | "reconciled";
}

export interface SaveMeterReadingInput {
  meterId: string;
  periodCode: string;
  openingReading: number;
  closingReading: number;
  readingType: "actual" | "estimated";
  estimationMethod?: string | null;
  estimationReason?: string | null;
}

/** Branch Budget foundation (PR 7): meter master/reading management, feeding the meter_wise
 *  sharing method exposed above. */
export function useBranchBudgetMeters(branchId?: string | null) {
  const queryClient = useQueryClient();

  const metersQuery = useQuery({
    queryKey: ["branch-budget-meters", branchId],
    enabled: Boolean(branchId),
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: MeterOption[] }>(
        `/api/finance/pnl/branch-budget/meters?branchId=${branchId}`
      );
      return response.data;
    },
  });

  const createMeter = useMutation({
    mutationFn: async (input: CreateMeterInput) => {
      const response = await hrmsApi.post<{ success: boolean; data: MeterOption }>(
        "/api/finance/pnl/branch-budget/meters",
        { branchId, ...input }
      );
      return response.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["branch-budget-meters", branchId] }),
  });

  const saveReading = useMutation({
    mutationFn: async (input: SaveMeterReadingInput) => {
      const response = await hrmsApi.put<{ success: boolean; data: { reading: MeterReadingRecord; reconciliation: boolean } }>(
        `/api/finance/pnl/branch-budget/meters/${input.meterId}/reading`,
        input
      );
      return response.data;
    },
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: ["branch-budget-meter-readings", variables.meterId, variables.periodCode] }),
  });

  return { metersQuery, createMeter, saveReading };
}

export function useMeterReadings(meterId?: string | null, periodCode?: string | null) {
  return useQuery({
    queryKey: ["branch-budget-meter-readings", meterId, periodCode],
    enabled: Boolean(meterId) && Boolean(periodCode),
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: MeterReadingRecord[] }>(
        `/api/finance/pnl/branch-budget/meters/${meterId}/reading?period=${periodCode}`
      );
      return response.data;
    },
  });
}

export interface GradeDriverRecord {
  gradeId: string;
  gradeName: string;
  band: string | null;
  minCtc: number;
  maxCtc: number;
  plannedHeadcount: number;
  monthlyCost: number;
  remarks: string | null;
  status: "draft" | "approved";
}

export interface SaveGradeDriverInput {
  gradeId: string;
  plannedHeadcount: number;
  remarks?: string | null;
}

/** Branch Budget foundation (PR 12): grade-wise headcount planning per cost centre/period,
 *  feeding the "grade_weighted_headcount" sharing method exposed above. Reuses grade_band_master
 *  (already fetched via the existing, unrestricted GET /api/org/grade-bands endpoint). */
export function useBranchBudgetGradeDrivers(
  branchId?: string | null,
  costCentreId?: string | null,
  periodCode?: string | null
) {
  const queryClient = useQueryClient();

  const gradeDriversQuery = useQuery({
    queryKey: ["branch-budget-grade-drivers", costCentreId, periodCode],
    enabled: Boolean(costCentreId) && Boolean(periodCode),
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: GradeDriverRecord[] }>(
        `/api/finance/pnl/branch-budget/grade-drivers?costCentreId=${costCentreId}&period=${periodCode}`
      );
      return response.data;
    },
  });

  const saveGradeDrivers = useMutation({
    mutationFn: async (drivers: SaveGradeDriverInput[]) => {
      const response = await hrmsApi.put<{ success: boolean; data: GradeDriverRecord[] }>(
        "/api/finance/pnl/branch-budget/grade-drivers",
        { branchId, costCentreId, periodCode, drivers }
      );
      return response.data;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["branch-budget-grade-drivers", costCentreId, periodCode] }),
  });

  return { gradeDriversQuery, saveGradeDrivers };
}

export interface SharingMethodReadiness {
  method: "total_manpower" | "revenue_share" | "meter_wise" | "grade_weighted_headcount";
  label: string;
  ready: boolean;
  missingCostCentres: { id: string; name: string }[];
}

/** Branch Budget foundation (PR 13): proactive readiness checks for the weighted sharing
 *  methods, surfaced before a user picks one — mirrors the exact missing-data checks
 *  computeLineAllocations() runs at save time, just shown ahead of time instead of only as a
 *  save-time failure. */
export function useBudgetReadiness(branchId?: string | null, periodCode?: string | null) {
  return useQuery({
    queryKey: ["branch-budget-readiness", branchId, periodCode],
    enabled: Boolean(branchId) && Boolean(periodCode),
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: SharingMethodReadiness[] }>(
        `/api/finance/pnl/branch-budget/readiness?branchId=${branchId}&period=${periodCode}`
      );
      return response.data;
    },
  });
}
