import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { tableExists } from "../../shared/dbHelpers.js";
import { PROCESS_BY_COST_CENTRE, type ActualsByKey } from "./pnl-actuals.service.js";

/**
 * One revenue rule for every P&L surface (owner rule 2026-10-06): a cost centre with an approved
 * Branch Head forecast earns its CLOSED amount once closed, its forecast amount while OPEN, and
 * nothing else. Live P&L applies it per row (pnl-reconciliation.service.ts); the Statement and the
 * process matrix aggregate per branch / process, so they take each forecast cost centre's old
 * revenue OUT of their own sources (withoutCostCentres) and put the forecast IN (this reader).
 *
 * Attribution matches the invoice reader: branch = cost_centre_master.branch_id, process = the
 * cost centre's staff's modal process (PROCESS_BY_COST_CENTRE), else cost_centre_master.process_id.
 */
export interface ForecastRevenueActuals extends ActualsByKey {
  /** Cost centres whose revenue comes from a forecast, and in which state. */
  state: Map<string, "OPEN" | "CLOSED">;
}

const empty = (): ForecastRevenueActuals => ({
  byBranch: new Map(), byProcess: new Map(), byCostCentre: new Map(), ccKeys: new Map(), state: new Map(),
});

export async function getForecastRevenueActuals(period: string): Promise<ForecastRevenueActuals> {
  const out = empty();
  if (!/^\d{4}-\d{2}$/.test(period) || !(await tableExists("revenue_forecast"))) return out;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT f.cost_centre_id, f.status, ccm.branch_id,
            COALESCE(pc.process_id, ccm.process_id) AS process_id,
            CASE WHEN f.status = 'closed' THEN f.closed_amount ELSE f.forecast_amount END AS amount
       FROM revenue_forecast f
       JOIN cost_centre_master ccm ON ccm.id = f.cost_centre_id
       LEFT JOIN ${PROCESS_BY_COST_CENTRE} pc ON pc.cost_centre_id = ccm.id
      WHERE f.period_code = ? AND f.status IN ('approved','closed')`,
    [period],
  );
  for (const r of rows) {
    const cc = String(r.cost_centre_id);
    const amount = Number(r.amount ?? 0) || 0;
    const branchId = r.branch_id ? String(r.branch_id) : null;
    const processId = r.process_id ? String(r.process_id) : null;
    out.state.set(cc, String(r.status) === "closed" ? "CLOSED" : "OPEN");
    out.byCostCentre.set(cc, amount);
    out.ccKeys!.set(cc, { branchId, processId });
    if (branchId) out.byBranch.set(branchId, (out.byBranch.get(branchId) ?? 0) + amount);
    if (processId) out.byProcess.set(processId, (out.byProcess.get(processId) ?? 0) + amount);
  }
  return out;
}

/**
 * A copy of `source` with the given cost centres' amounts taken out of the branch and process each
 * was attributed to. Needs the source's own per-cost-centre attribution (ccKeys); a source without
 * it is returned unchanged.
 */
export function withoutCostCentres(source: ActualsByKey, costCentreIds: Iterable<string>): ActualsByKey {
  const out: ActualsByKey = {
    byBranch: new Map(source.byBranch), byProcess: new Map(source.byProcess),
    byCostCentre: new Map(source.byCostCentre), ccKeys: source.ccKeys ? new Map(source.ccKeys) : undefined,
  };
  for (const cc of costCentreIds) {
    const amount = out.byCostCentre.get(cc);
    const keys = out.ccKeys?.get(cc);
    if (amount === undefined || !keys) continue;
    if (keys.branchId) out.byBranch.set(keys.branchId, (out.byBranch.get(keys.branchId) ?? 0) - amount);
    if (keys.processId) out.byProcess.set(keys.processId, (out.byProcess.get(keys.processId) ?? 0) - amount);
    out.byCostCentre.delete(cc);
  }
  return out;
}
