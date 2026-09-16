import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

/**
 * Depreciation, finance cost and tax provision — company-wide entries for Live P&L's "True Bottom
 * Line (PAT)" figure. Reuses the same table and write path the older "Cost master" tab already has
 * (process_pnl_cost_component via /api/finance/pnl/bpo/cost-components) — this is a narrower,
 * purpose-built screen over the same data, not a separate feature. Company-wide rows only
 * (processId/branchId both null); a row scoped to a process or branch belongs to that other
 * (canonical/BPO) engine's per-process model and is filtered out here.
 * Mirrors backend/src/modules/process-pnl/pnl-reconciliation.service.ts's readBelowTheLine().
 */

export type BelowTheLineCostType = "depreciation" | "finance_cost" | "tax";

export interface BelowTheLineEntry {
  id: string;
  periodCode: string;
  costType: BelowTheLineCostType;
  description: string;
  amountInr: number;
  sourceReference: string | null;
  status: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CostComponentRow extends Record<string, unknown> {
  id: string;
  process_id: string | null;
  branch_id: string | null;
  period_code: string;
  cost_type: string;
  description: string;
  amount_inr: number | string;
  source_reference: string | null;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const BELOW_THE_LINE_TYPES: BelowTheLineCostType[] = ["depreciation", "finance_cost", "tax"];

function isCompanyWideBelowTheLine(row: CostComponentRow): boolean {
  return !row.process_id && !row.branch_id && BELOW_THE_LINE_TYPES.includes(row.cost_type as BelowTheLineCostType);
}

function mapRow(row: CostComponentRow): BelowTheLineEntry {
  return {
    id: row.id,
    periodCode: row.period_code,
    costType: row.cost_type as BelowTheLineCostType,
    description: row.description,
    amountInr: Number(row.amount_inr ?? 0),
    sourceReference: row.source_reference,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function useBelowTheLineCosts(period: string) {
  return useQuery({
    queryKey: ["pnl-below-the-line", period],
    enabled: /^\d{4}-\d{2}$/.test(period),
    queryFn: async () => {
      const response = await hrmsApi.get<{ success: boolean; data: CostComponentRow[] }>(
        `/api/finance/pnl/bpo/cost-components?period=${period}`,
      );
      return response.data.filter(isCompanyWideBelowTheLine).map(mapRow);
    },
  });
}

export interface BelowTheLineSavePayload {
  id?: string;
  periodCode: string;
  costType: BelowTheLineCostType;
  description: string;
  amountInr: number;
  sourceReference?: string | null;
}

export function useBelowTheLineCostMutations() {
  const queryClient = useQueryClient();
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["pnl-below-the-line"] }),
      queryClient.invalidateQueries({ queryKey: ["pnl-live-reconciliation"] }),
      queryClient.invalidateQueries({ queryKey: ["bpo-pnl-cost-components"] }),
    ]);

  const save = useMutation({
    mutationFn: async (payload: BelowTheLineSavePayload) =>
      (await hrmsApi.post<{ success: boolean; data: { id: string } }>(
        "/api/finance/pnl/bpo/cost-components",
        {
          ...payload,
          processId: null,
          branchId: null,
          status: "approved",
        },
      )).data,
    onSuccess: invalidate,
  });

  return { save };
}
