import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { grnAllocationExGstSql } from "./pnl-ex-gst.js";
import { legacyGrnSql } from "../../shared/ownCompanyCostCentre.js";

/**
 * HRMS budgets show HRMS GRNs only (owner rule, 2026-10-14).
 *
 * finance_budget_line.reserved_amount / consumed_amount still carry db_bill-migrated GRN spend on
 * Apr-Aug 2026 budgets: the 2026-08-22 remediation (created_by ...budgetfix001, 1,388 rows) and
 * the db_bill migration (...dbbill000001, 66 rows) linked approved legacy GRNs to HRMS budget
 * lines so the months would reconcile. The stored counters are left alone — the headroom gate and
 * history read them — and every BUDGET VIEW subtracts the legacy share instead, using the same
 * "legacy" test as the rest of the app (legacyGrnSql: bill_source_id set, or a migration-sentinel
 * creator).
 */

/** SQL predicate: this grn_cost_allocation row (alias) belongs to a legacy GRN. */
export function legacyAllocationSql(allocAlias: string): string {
  return `EXISTS (SELECT 1 FROM grn_request lgr WHERE lgr.id = ${allocAlias}.grn_request_id AND ${legacyGrnSql("lgr")})`;
}

/** SQL predicate: this grn_cost_allocation row (alias) belongs to a GRN raised in HRMS. */
export function hrmsAllocationSql(allocAlias: string): string {
  return `NOT ${legacyAllocationSql(allocAlias)}`;
}

export interface LegacyCounter { reserved: number; consumed: number }

/** Legacy share of reserved/consumed per budget line, ex-GST (the basis the counters are kept on). */
export async function legacyCountersByLine(
  budgetIds: string[],
): Promise<Map<string, LegacyCounter>> {
  const out = new Map<string, LegacyCounter>();
  if (budgetIds.length === 0) return out;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT a.budget_line_id AS line_id,
            SUM(CASE WHEN a.lifecycle_status = 'reserved' THEN ${grnAllocationExGstSql("a")} ELSE 0 END) AS reserved,
            SUM(CASE WHEN a.lifecycle_status = 'consumed' THEN ${grnAllocationExGstSql("a")} ELSE 0 END) AS consumed
       FROM grn_cost_allocation a
       JOIN finance_budget_line l ON l.id = a.budget_line_id
      WHERE l.budget_id IN (${budgetIds.map(() => "?").join(", ")})
        AND a.lifecycle_status IN ('reserved', 'consumed')
        AND ${legacyAllocationSql("a")}
      GROUP BY a.budget_line_id`,
    budgetIds,
  );
  for (const r of rows) {
    out.set(String(r.line_id), { reserved: Number(r.reserved ?? 0), consumed: Number(r.consumed ?? 0) });
  }
  return out;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** A budget line with the legacy share taken out of reserved/consumed and put back into headroom. */
export function withoutLegacy<T extends Record<string, any>>(line: T, legacy: LegacyCounter | undefined): T {
  if (!legacy || (legacy.reserved === 0 && legacy.consumed === 0)) return line;
  const reserved = Math.max(0, Number(line.reserved_amount ?? 0) - legacy.reserved);
  const consumed = Math.max(0, Number(line.consumed_amount ?? 0) - legacy.consumed);
  const out: Record<string, any> = { ...line, reserved_amount: r2(reserved), consumed_amount: r2(consumed) };
  if (line.available_gross_amount != null) {
    out.available_gross_amount = r2(Number(line.available_gross_amount) + legacy.reserved + legacy.consumed);
  }
  return out as T;
}
