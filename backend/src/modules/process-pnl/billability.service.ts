import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";

/**
 * Who the client pays for, and how much they pay per seat.
 *
 * THE ONE PLACE THIS IS DECIDED
 * -----------------------------
 * Both people-cost engines must agree on who is billable, so both import from here.
 * The repo already carries the failure this avoids: isSupportRole exists as a
 * byte-identical regex in pnl-running-salary.service.ts and bpo-pnl.service.ts, with a
 * comment saying it is "kept deliberately identical" — which is a copy waiting to drift.
 * A contract test asserts this logic appears in exactly one file.
 *
 * WHY THE DEFAULT IS THE EXISTING BUCKET
 * --------------------------------------
 * The P&L already classifies everyone as agent_salary (front-line, paid for by the
 * client), dsc_people (that process's own support) or bmc_people (shared overhead), from
 * seeded rules plus a department/designation fallback. The business rule stated for this
 * feature — "on a few processes the client pays for only the Executive role, and we pay
 * the team leaders, managers and quality auditors ourselves" — is exactly
 * `pnl_bucket == 'agent_salary'`.
 *
 * So that is the default, and it needs no data entry: simulated over live data it makes
 * 825 employees billable and 157 not, and the 157 are precisely TEAM LEADER (51),
 * QUALITY AUDITOR (17), ASSISTANT MANAGER (11), TRAINER (6) and the management grades.
 * Rows in process_role_billability exist only to record the EXCEPTIONS — the processes
 * where the client does also pay for a TL or an auditor.
 *
 * UNRESOLVED IS NOT BILLABLE
 * --------------------------
 * 146 of 1,125 active employees have no process or no designation, so no rule can reach
 * them. They resolve to 'unresolved', which is not billable and is counted. Never let
 * "we don't know" fall through to "yes, bill it".
 */

export type BillabilitySource =
  | "employee_rule"
  | "process_designation"
  | "process"
  | "designation"
  | "default_bucket"
  | "unresolved";

export type SeatRateSource =
  | "employee_override"
  | "cc_designation"
  | "cc_flat"
  | "monthly_driver"
  | "not_seat_billed"
  | "missing";

export interface BillabilityResolution {
  isBillable: boolean;
  source: BillabilitySource;
  ruleId: string | null;
}

export interface SeatRateResolution {
  seatRateMonthly: number;
  source: SeatRateSource;
  ruleId: string | null;
  prorationMethod: "payable_days" | "full_month";
}

interface EmployeeContext {
  employeeId: string;
  processId: string | null;
  designationId: string | null;
  costCentreId: string | null;
  /** The P&L bucket already resolved for this person, used as the default. */
  pnlBucket: string | null;
}

/** A date the effective-dating predicates can be compared against. */
function asDate(value: Date | string): string {
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

/**
 * Billability for one employee as at a date.
 *
 * Specificity is derived here rather than read from a stored priority column. An
 * editable priority integer is precisely what left pnl_cost_classification_rule with
 * five duplicate rules at identical priority 50 and no way to break the tie.
 */
export async function resolveBillability(
  employee: EmployeeContext,
  onDate: Date | string,
): Promise<BillabilityResolution> {
  const date = asDate(onDate);

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, is_billable, employee_id, process_id, designation_id
       FROM process_role_billability
      WHERE status = 'approved'
        AND effective_from <= ?
        AND (effective_to IS NULL OR effective_to >= ?)
        AND (employee_id = ? OR employee_id IS NULL)
        AND (process_id = ? OR process_id IS NULL)
        AND (designation_id = ? OR designation_id IS NULL)
      ORDER BY
        CASE
          WHEN employee_id IS NOT NULL                             THEN 1
          WHEN process_id IS NOT NULL AND designation_id IS NOT NULL THEN 2
          WHEN process_id IS NOT NULL                              THEN 3
          WHEN designation_id IS NOT NULL                          THEN 4
          ELSE 5
        END,
        effective_from DESC
      LIMIT 1`,
    [date, date, employee.employeeId, employee.processId, employee.designationId],
  );

  const rule = rows[0];
  if (rule) {
    const source: BillabilitySource = rule.employee_id
      ? "employee_rule"
      : rule.process_id && rule.designation_id
        ? "process_designation"
        : rule.process_id
          ? "process"
          : "designation";
    return { isBillable: Number(rule.is_billable) === 1, source, ruleId: String(rule.id) };
  }

  // No rule reaches this person. Fall back to the classification the P&L already made —
  // but only if we actually know enough to place them.
  if (!employee.processId || !employee.designationId) {
    return { isBillable: false, source: "unresolved", ruleId: null };
  }
  return {
    isBillable: employee.pnlBucket === "agent_salary",
    source: "default_bucket",
    ruleId: null,
  };
}

/**
 * Seat rate for one employee as at a date, most specific source first.
 *
 * A non-billable employee has no seat rate by definition — callers must not ask, and if
 * they do they get 0 with source 'missing' rather than a number that would invent revenue.
 *
 * 'not_seat_billed' is a real answer, not a failure. Reconciliation against actually
 * invoiced revenue showed the seats x rate model holds where a cost centre is seat-billed
 * (+2% for Onfido against June invoicing) and is simply wrong where it is not (-17% and
 * +174% for two outcome-billed cost centres, whose invoices are several variable
 * components). 171 of 579 active cost centres are seat-billed; the other 408 must report
 * "not seat-billed" rather than a confident wrong number.
 */
export async function resolveSeatRate(
  employee: EmployeeContext,
  onDate: Date | string,
  periodCode: string,
): Promise<SeatRateResolution> {
  const date = asDate(onDate);

  // 1. Employee override.
  const [override] = await db.execute<RowDataPacket[]>(
    `SELECT id, seat_rate_monthly, proration_method
       FROM employee_seat_rate_override
      WHERE employee_id = ? AND status = 'approved'
        AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
      ORDER BY effective_from DESC LIMIT 1`,
    [employee.employeeId, date, date],
  );
  if (override[0]) {
    return {
      seatRateMonthly: Number(override[0].seat_rate_monthly),
      source: "employee_override",
      ruleId: String(override[0].id),
      prorationMethod: override[0].proration_method as "payable_days" | "full_month",
    };
  }

  if (!employee.costCentreId) {
    return { seatRateMonthly: 0, source: "missing", ruleId: null, prorationMethod: "payable_days" };
  }

  // 2 and 3. Cost-centre rate, designation-specific before flat. Ordering by
  // designation_id IS NULL puts the more specific row first in a single query.
  const [ccRates] = await db.execute<RowDataPacket[]>(
    `SELECT id, seat_rate_monthly, designation_id, billing_model, proration_method
       FROM cost_centre_seat_rate
      WHERE cost_centre_id = ? AND status = 'approved'
        AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
        AND (designation_id = ? OR designation_id IS NULL)
      ORDER BY (designation_id IS NULL), effective_from DESC
      LIMIT 1`,
    [employee.costCentreId, date, date, employee.designationId],
  );
  const ccRate = ccRates[0];
  if (ccRate) {
    if (ccRate.billing_model === "not_seat_billed") {
      return {
        seatRateMonthly: 0,
        source: "not_seat_billed",
        ruleId: String(ccRate.id),
        prorationMethod: "payable_days",
      };
    }
    return {
      seatRateMonthly: Number(ccRate.seat_rate_monthly),
      source: ccRate.designation_id ? "cc_designation" : "cc_flat",
      ruleId: String(ccRate.id),
      prorationMethod: ccRate.proration_method as "payable_days" | "full_month",
    };
  }

  // 4. The existing budgeting driver — what the P&L already uses for its revenue line.
  // Deliberately accepted regardless of its draft/approved status, because all 44 live
  // rows are 'draft': requiring approval here would resolve every employee to 'missing'
  // on day one and make a working feature look broken. The provenance travels with the
  // answer instead.
  const [driver] = await db.execute<RowDataPacket[]>(
    `SELECT id, revenue_rate_per_head
       FROM finance_cost_centre_monthly_driver
      WHERE cost_centre_id = ? AND period_code = ? AND revenue_rate_per_head > 0
      LIMIT 1`,
    [employee.costCentreId, periodCode],
  );
  if (driver[0]) {
    return {
      seatRateMonthly: Number(driver[0].revenue_rate_per_head),
      source: "monthly_driver",
      ruleId: String(driver[0].id),
      prorationMethod: "payable_days",
    };
  }

  return { seatRateMonthly: 0, source: "missing", ruleId: null, prorationMethod: "payable_days" };
}

// ─── Allocation splits ────────────────────────────────────────────────────────

export interface AllocationRow {
  id: string;
  employeeId: string;
  costCentreId: string;
  costCentreName?: string | null;
  allocationPct: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: string;
}

/**
 * The approved split for one employee as at a date.
 *
 * Returns the rows and whether they balance. It deliberately does NOT renormalise an
 * unbalanced set — the same discipline allocatePoolAmount already applies. Silently
 * rebalancing approved allocation data would hide a mistake someone made on purpose;
 * the caller surfaces the residual as unallocated cost instead.
 */
export async function getEmployeeAllocation(
  employeeId: string,
  onDate: Date | string,
): Promise<{ rows: AllocationRow[]; percentTotal: number; balanced: boolean }> {
  const date = asDate(onDate);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT a.id, a.employee_id, a.cost_centre_id, a.allocation_pct,
            a.effective_from, a.effective_to, a.status,
            cc.cost_centre_name
       FROM employee_cost_centre_allocation a
       LEFT JOIN cost_centre_master cc ON cc.id = a.cost_centre_id
      WHERE a.employee_id = ? AND a.status = 'approved'
        AND a.effective_from <= ? AND (a.effective_to IS NULL OR a.effective_to >= ?)
      ORDER BY a.allocation_pct DESC`,
    [employeeId, date, date],
  );

  const mapped: AllocationRow[] = rows.map((r) => ({
    id: String(r.id),
    employeeId: String(r.employee_id),
    costCentreId: String(r.cost_centre_id),
    costCentreName: r.cost_centre_name ? String(r.cost_centre_name) : null,
    allocationPct: Number(r.allocation_pct),
    effectiveFrom: String(r.effective_from),
    effectiveTo: r.effective_to ? String(r.effective_to) : null,
    status: String(r.status),
  }));

  const percentTotal = mapped.reduce((sum, r) => sum + r.allocationPct, 0);
  // Same tolerance allocatePoolAmount uses for its manual_percentage mode.
  const balanced = mapped.length === 0 || Math.abs(percentTotal - 100) <= 0.01;
  return { rows: mapped, percentTotal, balanced };
}

/**
 * Replace an employee's split for one effective date, in a single transaction.
 *
 * The "must total 100%" rule cannot be a CHECK constraint — MySQL CHECK cannot aggregate
 * over sibling rows — so it is enforced here, with the existing rows locked FOR UPDATE so
 * two concurrent edits cannot each pass while their union does not.
 */
export async function replaceEmployeeAllocation(
  employeeId: string,
  effectiveFrom: string,
  allocations: Array<{ costCentreId: string; allocationPct: number }>,
  actorId: string,
  changeReason: string,
): Promise<{ ok: true; rows: number }> {
  if (allocations.length > 0) {
    const total = allocations.reduce((sum, a) => sum + Number(a.allocationPct || 0), 0);
    if (Math.abs(total - 100) > 0.01) {
      throw Object.assign(
        new Error(`Allocation must total 100% — received ${total.toFixed(2)}%`),
        { statusCode: 400, code: "ALLOCATION_NOT_BALANCED" },
      );
    }
    if (allocations.some((a) => Number(a.allocationPct) <= 0)) {
      throw Object.assign(new Error("Each allocation percentage must be greater than zero"), {
        statusCode: 400,
        code: "ALLOCATION_NON_POSITIVE",
      });
    }
    const seen = new Set<string>();
    for (const a of allocations) {
      if (seen.has(a.costCentreId)) {
        throw Object.assign(
          new Error("The same cost centre appears more than once in this split"),
          { statusCode: 400, code: "ALLOCATION_DUPLICATE_COST_CENTRE" },
        );
      }
      seen.add(a.costCentreId);
    }
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `SELECT id FROM employee_cost_centre_allocation
        WHERE employee_id = ? AND effective_from = ? FOR UPDATE`,
      [employeeId, effectiveFrom],
    );
    await conn.execute(
      `DELETE FROM employee_cost_centre_allocation
        WHERE employee_id = ? AND effective_from = ? AND status <> 'approved'`,
      [employeeId, effectiveFrom],
    );
    // An already-approved set for the same date is inactivated rather than deleted, so a
    // period that was computed against it can still be explained afterwards.
    await conn.execute(
      `UPDATE employee_cost_centre_allocation
          SET status = 'inactive', updated_at = NOW()
        WHERE employee_id = ? AND effective_from = ? AND status = 'approved'`,
      [employeeId, effectiveFrom],
    );

    for (const a of allocations) {
      await conn.execute<ResultSetHeader>(
        `INSERT INTO employee_cost_centre_allocation
           (id, employee_id, cost_centre_id, allocation_pct, allocation_basis,
            effective_from, status, change_reason, created_by, approved_by, approved_at)
         VALUES (?, ?, ?, ?, 'manual', ?, 'approved', ?, ?, ?, NOW())`,
        [randomUUID(), employeeId, a.costCentreId, a.allocationPct, effectiveFrom,
         changeReason, actorId, actorId],
      );
    }

    await conn.commit();
    return { ok: true, rows: allocations.length };
  } catch (error) {
    await conn.rollback();
    logger.error({ err: error, employeeId, effectiveFrom }, "[billability] allocation replace failed");
    throw error;
  } finally {
    conn.release();
  }
}

export const billabilityService = {
  resolveBillability,
  resolveSeatRate,
  getEmployeeAllocation,
  replaceEmployeeAllocation,
};
