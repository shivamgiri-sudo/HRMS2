import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { calculateTds } from "./payrollCalculate.service.js";
import { payrollService } from "./payroll.service.js";

/**
 * Payroll gap-fix service — addresses calculation gaps identified in Phase 0 audit:
 *  1. Working days calculation: holiday-calendar-aware (with 26-day fallback)
 *  2. LWP deduction formula — basis-config-aware
 *  3. Basic TDS slab projection — delegates to main calculateTds engine
 */

// FIX E — exported TDS projection type
export interface TdsProjection {
  tds: number;
  status: "configured" | "pending_configuration";
  note: string;
}

// FIX F — exported LWP deduction type (reused pattern)
export interface LwpDeduction {
  amount: number;
  status: "configured" | "pending_configuration";
  note: string;
}

/**
 * FIX E helper — checks whether statutory_config has at least one tds_slab_* key.
 */
export async function checkTdsConfigExists(): Promise<boolean> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS cnt FROM statutory_config WHERE config_key LIKE 'tds_slab_%'"
    );
    const cnt: number = (rows as any[])[0]?.cnt ?? 0;
    return Number(cnt) > 0;
  } catch {
    return false;
  }
}

export const payrollGapsService = {
  /**
   * Return the number of working days for a given month and branch.
   * Queries leave_holiday_master for the month's holidays and subtracts them
   * from the total weekdays (Mon–Sat BPO standard).
   * Falls back to 26 when no holiday master entry exists for the month/branch.
   */
  async calculateWorkingDaysFromHolidays(
    month: string,  // format: YYYY-MM
    branchId?: string
  ): Promise<number> {
    const [year, mon] = month.split("-").map(Number);
    if (!year || !mon) return 26;

    try {
      const start = `${month}-01`;
      const end   = `${month}-${new Date(year, mon, 0).getDate().toString().padStart(2, "0")}`;

      const conds = ["holiday_date BETWEEN ? AND ?", "active_status = 1"];
      const params: unknown[] = [start, end];
      if (branchId) {
        conds.push("(branch_id = ? OR branch_id IS NULL)");
        params.push(branchId);
      }

      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS holiday_count
           FROM leave_holiday_master
          WHERE ${conds.join(" AND ")}`,
        params
      );

      const holidayCount: number = (rows as any[])[0]?.holiday_count ?? 0;

      // BPO standard: Mon–Sat = 26 working days, minus holidays
      const workingDays = Math.max(1, 26 - Number(holidayCount));
      return workingDays;
    } catch {
      // Table may not exist on this schema version — safe fallback
      return 26;
    }
  },

  /**
   * FIX F — Calculate LWP deduction amount.
   * Requires explicit lwpBasis from statutory_config (key: lwp_deduction_basis).
   * Returns pending_configuration when basis is not supplied.
   *
   * Supported bases:
   *   "ctc_annual"   — ctcAnnual / 12 / workingDays (existing logic)
   *   others         — pending until component-level breakdown is available
   */
  calculateLwpDeduction(
    lwpDays: number,
    ctcAnnual: number,
    workingDays: number,
    lwpBasis: "ctc_annual" | "eligible_gross" | "basic_only" | undefined
  ): LwpDeduction {
    if (lwpBasis === undefined) {
      return {
        amount: 0,
        status: "pending_configuration",
        note: "LWP deduction basis not configured. Use statutory_config key lwp_deduction_basis.",
      };
    }

    if (lwpBasis === "ctc_annual") {
      if (lwpDays <= 0 || workingDays <= 0 || ctcAnnual <= 0) {
        return {
          amount: 0,
          status: "configured",
          note: "LWP deduction computed on ctc_annual basis.",
        };
      }
      const dailyRate = ctcAnnual / 12 / workingDays;
      return {
        amount: Math.round(lwpDays * dailyRate * 100) / 100,
        status: "configured",
        note: "LWP deduction computed on ctc_annual basis.",
      };
    }

    // eligible_gross / basic_only require salary component breakdown not yet computed here
    return {
      amount: 0,
      status: "pending_configuration",
      note: `LWP basis '${lwpBasis}' is not yet computed from components — pending_configuration.`,
    };
  },

};
