import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { tableExists } from "../../shared/dbHelpers.js";

/**
 * "Zero because nobody has ever entered this cost" and "zero because it genuinely is zero this
 * month" look identical on every waterfall card today — depreciation, amortization, finance cost
 * and tax all read ₹0 for every process, every period, because `process_pnl_cost_component` (the
 * only table either figure is ever entered into — see getCostComponents in bpo-pnl.service.ts and
 * buildAllocationMaps in bpo-pnl-allocation-overlay.service.ts) holds zero rows in production,
 * confirmed live 2026-09-01. Those are two different facts and must not render the same way.
 *
 * This module answers one narrow question — "has ANYONE ever entered a row of this cost type for
 * this period/scope, approved or not just proposed" — so callers can show "Not yet configured"
 * instead of a confident-looking ₹0. It changes no calculated figure: every waterfall amount is
 * still summed exactly as before, in bpo-pnl-allocation-overlay.service.ts and
 * bpo-pnl-full-waterfall.service.ts; this only tells the presentation layer which zeros to trust.
 *
 * `vw_process_pnl_grn_allocation` (the OTHER source that feeds depreciation/amortization/
 * finance_cost/tax into the same waterfall fields, via buckets in buildAllocationMaps) was
 * checked live for the same date: across every period in the view, `pnl_bucket` only ever takes
 * the values `bmc_non_people` and `dsc_non_people` — never depreciation/amortization/finance_cost/
 * tax. So `process_pnl_cost_component` is not just the ONLY intended entry point for these four
 * cost types today, it is also the only one that has EVER carried them. If GRN allocation rows
 * ever start carrying those buckets, this function's coverage should be revisited alongside it.
 */

export type ConfiguredCostScope = {
  /** Present when checking a single process (the per-process detail card). */
  processId?: string | null;
  /** Present when checking a branch (the branch/company-wide waterfall). Omit both for company-wide. */
  branchId?: string | null;
};

interface CostTypeRow extends RowDataPacket {
  cost_type: string;
}

/**
 * Which `process_pnl_cost_component.cost_type` values have at least one APPROVED row for this
 * period, within the given scope:
 *   - `processId` given: a row directly against that process, OR a branch-level pool row against
 *     that process's own branch (a pool that has not been allocated to this specific process is
 *     still evidence someone configured the cost type for the branch this process belongs to).
 *   - `branchId` given (no processId): a row directly against the branch, OR against any process
 *     that belongs to it.
 *   - neither given: any approved row at all, for company-wide scope.
 *
 * Returns an empty set (not an error) when the table doesn't exist yet — same "missing table means
 * no data, not a query failure" convention as the rest of this module (see safeRows's own doc
 * comment in bpo-pnl.service.ts).
 */
export async function configuredCostTypes(
  period: string,
  scope: ConfiguredCostScope = {}
): Promise<Set<string>> {
  if (!(await tableExists("process_pnl_cost_component"))) return new Set();

  const needsProcessJoin = Boolean(scope.processId || scope.branchId);
  const where: string[] = ["c.period_code = ?", "c.status = 'approved'"];
  const params: unknown[] = [period];

  const scopeOr: string[] = [];
  if (scope.processId) {
    scopeOr.push("c.process_id = ?");
    params.push(scope.processId);
  }
  if (scope.branchId) {
    scopeOr.push("c.branch_id = ?");
    params.push(scope.branchId);
    scopeOr.push("pm.branch_id = ?");
    params.push(scope.branchId);
  }
  if (scopeOr.length > 0) where.push(`(${scopeOr.join(" OR ")})`);

  const [rows] = await db.execute<CostTypeRow[]>(
    `SELECT DISTINCT c.cost_type
       FROM process_pnl_cost_component c
       ${needsProcessJoin ? "LEFT JOIN process_master pm ON pm.id = c.process_id" : ""}
      WHERE ${where.join(" AND ")}`,
    params
  );
  return new Set(rows.map((r) => String(r.cost_type)));
}

/** The four cost types this feature distinguishes "not configured" for, keyed to the BpoPnlRow/
 *  waterfall field names a consumer already reads (`depreciation`, `amortization`, `financeCost`,
 *  `tax`) rather than the raw `cost_type` column values. */
export interface CostComponentDataFlags {
  hasDepreciationData: boolean;
  hasAmortizationData: boolean;
  hasFinanceCostData: boolean;
  hasTaxData: boolean;
}

export async function costComponentDataFlags(
  period: string,
  scope: ConfiguredCostScope = {}
): Promise<CostComponentDataFlags> {
  const types = await configuredCostTypes(period, scope);
  return {
    hasDepreciationData: types.has("depreciation"),
    hasAmortizationData: types.has("amortization"),
    hasFinanceCostData: types.has("finance_cost"),
    hasTaxData: types.has("tax"),
  };
}
