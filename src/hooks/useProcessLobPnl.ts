import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import type { PnlReferenceData } from "./usePnlConfiguration";

export interface ProcessLobRow {
  id: string;
  process_id: string;
  lob_code: string;
  lob_name: string;
  description: string | null;
  cost_centre_id: string | null;
  cost_centre_code?: string | null;
  cost_centre_name?: string | null;
  allocation_scope: "direct_lob" | "shared_process";
  effective_from: string;
  effective_to: string | null;
  active_status: number;
  approval_status: "draft" | "approved" | "inactive";
  process_name?: string;
  client_name?: string | null;
  branch_name?: string | null;
}

export interface ProcessLobPlanRow {
  id: string;
  process_lob_id: string;
  period_code: string;
  lob_code: string;
  lob_name: string;
  process_id: string;
  process_name: string;
  contracted_seats: number | null;
  billable_seats: number | null;
  occupied_seats: number | null;
  required_productive_hc: number | null;
  required_roster_hc: number | null;
  revenue_budget: number | null;
  agent_cost_budget: number | null;
  direct_vendor_cost_budget: number | null;
  shared_cost_budget: number | null;
  ebitda_budget: number | null;
  shared_cost_driver: string;
  manual_allocation_pct: number | null;
  status: "draft" | "approved" | "locked";
}

export interface ProcessLobRevenueRuleRow {
  id: string;
  process_id: string;
  process_lob_id: string;
  lob_code: string;
  lob_name: string;
  rule_name: string;
  billing_model: string;
  metric_key: string;
  rate_amount: number;
  currency_code: string;
  fx_to_inr: number;
  monthly_minimum_commitment: number;
  included_units: number;
  overage_rate: number;
  mandated_seats: number | null;
  effective_from: string;
  effective_to: string | null;
  status: string;
}

export interface ProcessLobDeliveryRow {
  id: string;
  process_id: string;
  process_lob_id: string;
  lob_code: string;
  lob_name: string;
  period_code: string;
  activity_date: string | null;
  metric_key: string;
  planned_units: number;
  delivered_units: number;
  accepted_units: number;
  rejected_units: number;
  billable_units: number;
  /** The API already returns these (the delivery SELECT is `d.*`); they were simply not declared
   *  here, so editDelivery could not carry them and every edit re-sent them as undefined —
   *  which the upsert writes as `?? 0`. process-lob.service.ts sums productive_hours into the
   *  LOB P&L, so a per-productive-hour LOB then recognised zero revenue for the month. */
  productive_hours: number;
  login_hours: number;
  talk_minutes: number;
  quality_score: number | null;
  sla_score: number | null;
  data_source: string;
  source_reference: string;
  status: string;
}

export interface LobDiagnostics {
  period: string;
  processId: string;
  activeLobCount: number;
  plannedLobCount: number;
  revenueRuleCoveragePct: number | null;
  deliveryCoveragePct: number | null;
  planCoveragePct: number | null;
  sharedCostDriver: string;
  manualAllocationPct: number;
  readyForClose: boolean;
  blockers: Array<{ code: string; message: string; lobId?: string }>;
}

export interface LobPnlRow {
  rowType: "lob" | "unallocated";
  processId: string;
  processLobId: string | null;
  lobCode: string;
  lobName: string;
  branchName: string | null;
  clientName: string | null;
  contractedSeats: number;
  billableSeats: number;
  occupiedSeats: number;
  seatFillPct: number | null;
  agentHeadcount: number;
  supportHeadcount: number;
  deliveredUnits: number;
  billableUnits: number;
  deliveryAttainmentPct: number | null;
  earnedRevenue: number;
  recognizedRevenue: number;
  agentSalary: number;
  dscPeople: number;
  dscNonPeople: number;
  bmcPeople: number;
  bmcNonPeople: number;
  directVendorCost: number;
  sharedCost: number;
  contribution: number;
  ebitda: number;
  ebitdaMarginPct: number | null;
  pbt: number;
  pat: number;
  revenueBudget: number;
  ebitdaBudget: number;
  ebitdaVariance: number | null;
  planStatus: string;
  dataStatus: Record<string, string>;
  freshness: string | null;
}

export interface ProcessLobPnlSummary {
  period: string;
  calculationEngine: string;
  process: Record<string, any>;
  totals: Record<string, number>;
  reconciliation: {
    revenueVariance: number;
    agentSalaryVariance: number;
    dscVariance: number;
    bmcVariance: number;
    ebitdaVariance: number;
    isReconciled: boolean;
  };
  diagnostics: LobDiagnostics;
  rows: LobPnlRow[];
  generatedAt: string;
}

export interface SaveLobPayload {
  id?: string;
  processId: string;
  lobCode: string;
  lobName: string;
  description?: string | null;
  costCentreId?: string | null;
  allocationScope?: "direct_lob" | "shared_process";
  effectiveFrom: string;
  effectiveTo?: string | null;
  activeStatus?: boolean;
  approvalStatus?: "draft" | "approved" | "inactive";
}

export interface SaveLobPlanPayload {
  id?: string;
  processLobId: string;
  periodCode: string;
  contractedSeats?: number | null;
  billableSeats?: number | null;
  occupiedSeats?: number | null;
  requiredProductiveHc?: number | null;
  requiredRosterHc?: number | null;
  revenueBudget?: number | null;
  agentCostBudget?: number | null;
  directVendorCostBudget?: number | null;
  sharedCostBudget?: number | null;
  ebitdaBudget?: number | null;
  sharedCostDriver?: string;
  manualAllocationPct?: number | null;
  status?: "draft" | "approved" | "locked";
}

export interface SaveLobRevenueRulePayload {
  id?: string;
  processId: string;
  processLobId: string;
  ruleName: string;
  billingModel: string;
  metricKey: string;
  rateAmount: number;
  currencyCode?: string;
  fxToInr?: number;
  monthlyMinimumCommitment?: number;
  includedUnits?: number;
  overageRate?: number;
  mandatedSeats?: number | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  status?: "draft" | "approved" | "inactive";
  approvalReference?: string | null;
}

export interface SaveLobDeliveryPayload {
  id?: string;
  processId: string;
  processLobId: string;
  periodCode: string;
  activityDate?: string | null;
  metricKey: string;
  plannedUnits?: number;
  deliveredUnits?: number;
  acceptedUnits?: number;
  rejectedUnits?: number;
  billableUnits?: number;
  productiveHours?: number;
  loginHours?: number;
  talkMinutes?: number;
  qualityScore?: number | null;
  slaScore?: number | null;
  dataSource?: string;
  sourceReference?: string;
  status?: "draft" | "validated" | "locked";
}

function suffix(processId?: string, period?: string) {
  const params = new URLSearchParams();
  if (processId) params.set("processId", processId);
  if (period) params.set("period", period);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function useProcessLobPnl(processId?: string, period?: string) {
  const queryClient = useQueryClient();
  const querySuffix = suffix(processId, period);

  const referenceQuery = useQuery({
    queryKey: ["pnl-reference-data"],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: PnlReferenceData }>(
        "/api/finance/pnl/config/reference-data"
      );
      return response.data;
    },
    staleTime: 300_000,
  });

  const lobsQuery = useQuery({
    queryKey: ["process-lobs", processId],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: ProcessLobRow[] }>(
        `/api/finance/pnl/lobs${suffix(processId)}`
      );
      return response.data;
    },
    enabled: Boolean(processId),
  });

  const plansQuery = useQuery({
    queryKey: ["process-lob-plans", processId, period],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: ProcessLobPlanRow[] }>(
        `/api/finance/pnl/lobs/plans${querySuffix}`
      );
      return response.data;
    },
    enabled: Boolean(processId && period),
  });

  const commercialQuery = useQuery({
    queryKey: ["process-lob-commercial", processId, period],
    queryFn: async () => {
      const response = await hrmsApi.get<{
        success: boolean;
        data: {
          period: string;
          processId: string;
          lobs: ProcessLobRow[];
          revenueRules: ProcessLobRevenueRuleRow[];
          deliveryActuals: ProcessLobDeliveryRow[];
        };
      }>(`/api/finance/pnl/lobs/commercial${querySuffix}`);
      return response.data;
    },
    enabled: Boolean(processId && period),
  });

  const diagnosticsQuery = useQuery({
    queryKey: ["process-lob-diagnostics", processId, period],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: LobDiagnostics }>(
        `/api/finance/pnl/lobs/diagnostics${querySuffix}`
      );
      return response.data;
    },
    enabled: Boolean(processId && period),
  });

  const summaryQuery = useQuery({
    queryKey: ["process-lob-summary", processId, period],
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: ProcessLobPnlSummary }>(
        `/api/finance/pnl/lobs/summary${querySuffix}`
      );
      return response.data;
    },
    enabled: Boolean(processId && period),
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["process-lobs"] }),
      queryClient.invalidateQueries({ queryKey: ["process-lob-plans"] }),
      queryClient.invalidateQueries({ queryKey: ["process-lob-commercial"] }),
      queryClient.invalidateQueries({ queryKey: ["process-lob-diagnostics"] }),
      queryClient.invalidateQueries({ queryKey: ["process-lob-summary"] }),
      queryClient.invalidateQueries({ queryKey: ["bpo-process-pnl"] }),
      queryClient.invalidateQueries({ queryKey: ["process-pnl-summary"] }),
      queryClient.invalidateQueries({ queryKey: ["pnl-period-close"] }),
    ]);
  };

  const saveLob = useMutation({
    mutationFn: async (payload: SaveLobPayload) => {
      const response = await hrmsApi.post<{ success: boolean; data: { id: string } }>(
        "/api/finance/pnl/lobs",
        payload
      );
      return response.data;
    },
    onSuccess: invalidate,
  });

  const savePlan = useMutation({
    mutationFn: async (payload: SaveLobPlanPayload) => {
      const response = await hrmsApi.post<{ success: boolean; data: { id: string } }>(
        "/api/finance/pnl/lobs/plans",
        payload
      );
      return response.data;
    },
    onSuccess: invalidate,
  });

  const saveRevenueRule = useMutation({
    mutationFn: async (payload: SaveLobRevenueRulePayload) => {
      const response = await hrmsApi.post<{ success: boolean; data: { id: string } }>(
        "/api/finance/pnl/lobs/revenue-rules",
        payload
      );
      return response.data;
    },
    onSuccess: invalidate,
  });

  const saveDelivery = useMutation({
    mutationFn: async (payload: SaveLobDeliveryPayload) => {
      const response = await hrmsApi.post<{ success: boolean; data: { id: string } }>(
        "/api/finance/pnl/lobs/delivery-actuals",
        payload
      );
      return response.data;
    },
    onSuccess: invalidate,
  });

  return {
    referenceQuery,
    lobsQuery,
    plansQuery,
    commercialQuery,
    diagnosticsQuery,
    summaryQuery,
    saveLob,
    savePlan,
    saveRevenueRule,
    saveDelivery,
  };
}
