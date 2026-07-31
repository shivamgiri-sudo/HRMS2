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

  /**
   * Basic TDS slab projection on an annual taxable income.
   *
   * Withholds a projection entirely when statutory_config carries no tds_slab_*
   * rows, rather than falling back to constants. That is the charter rule — TDS
   * must be blocked or pending unless approved slab configuration exists, with no
   * hardcoded fallback slabs — and the reason is staleness, not arithmetic: rates
   * baked into code keep deducting last year's numbers after a Finance Act
   * changes them, and nothing tells anyone. Under-deduction is the employer's
   * liability, so this fails visibly instead.
   *
   * This function was previously removed, leaving its type (TdsProjection), its
   * helper (checkTdsConfigExists) and the calculateTds import orphaned in this
   * file and its tests failing as "is not a function". Restored to the contract
   * those survivors and tests/payroll.security.test.ts already specify.
   *
   * `tds` is the ANNUAL figure, matching the annual income taken as input.
   * Nothing consumes this yet — it is a projection helper, not a payroll path.
   */
  async computeBasicTds(annualTaxableIncome: number): Promise<TdsProjection> {
    if (!(await checkTdsConfigExists())) {
      return {
        tds: 0,
        status: "pending_configuration",
        note:
          "TDS slab configuration absent from statutory_config — projection withheld. " +
          "Seed and approve tds_slab_* keys; no hardcoded defaults are applied.",
      };
    }

    const [cfgRows] = await db.execute<RowDataPacket[]>(
      "SELECT config_key, config_value FROM statutory_config"
    );
    const statutoryConfig: Record<string, number> = {};
    for (const row of cfgRows as Array<{ config_key: string; config_value: string }>) {
      const value = Number(row.config_value);
      if (Number.isFinite(value)) statutoryConfig[String(row.config_key).toLowerCase()] = value;
    }

    const result = calculateTds(annualTaxableIncome, statutoryConfig);

    // checkTdsConfigExists() only proves at least one tds_slab_% row exists; it
    // does not prove every key calculateTds needs is present. Honour the
    // calculator's own verdict rather than assuming, or a partially seeded
    // config would report a confident zero.
    if (result.status === "pending_configuration") {
      return {
        tds: 0,
        status: "pending_configuration",
        note:
          `TDS configuration is incomplete — missing ${result.missing_config_keys.join(", ")}. ` +
          `Projection withheld; no hardcoded defaults are applied.`,
      };
    }

    return {
      tds: result.tds_annual,
      status: "configured",
      note: `Projected from statutory_config slabs at an effective rate of ${result.effective_rate}%.`,
    };
  },

};
