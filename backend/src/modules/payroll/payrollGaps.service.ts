import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Payroll gap-fix service — addresses calculation gaps identified in Phase 0 audit:
 *  1. Working days calculation: holiday-calendar-aware (with 26-day fallback)
 *  2. LWP deduction formula — basis-config-aware
 *  3. Basic TDS slab projection — config-gated, no hardcoded defaults
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
   * FIX E — Compute a basic projected TDS.
   * Returns pending_configuration (tds: 0) when no tds_slab_* keys exist in statutory_config.
   * Returns configured with computed TDS when keys are present.
   * NO hardcoded slab defaults — admin must configure before projection runs.
   */
  async computeBasicTds(annualTaxable: number): Promise<TdsProjection> {
    if (annualTaxable <= 0) {
      return {
        tds: 0,
        status: "configured",
        note: "Annual taxable income is zero or negative — no TDS applicable.",
      };
    }

    const hasConfig = await checkTdsConfigExists();
    if (!hasConfig) {
      return {
        tds: 0,
        status: "pending_configuration",
        note: "TDS projection requires approved tax slab configuration. No hardcoded defaults applied.",
      };
    }

    // Load slab limits and rates from statutory_config
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT config_key, config_value FROM statutory_config WHERE config_key LIKE 'tds_slab_%'"
    );
    const slabMap: Record<string, number> = {};
    for (const r of rows as { config_key: string; config_value: number }[]) {
      slabMap[r.config_key] = Number(r.config_value);
    }

    const s1 = slabMap["tds_slab_1_limit"];
    const s2 = slabMap["tds_slab_2_limit"];
    const s3 = slabMap["tds_slab_3_limit"];
    const s4 = slabMap["tds_slab_4_limit"];
    const s5 = slabMap["tds_slab_5_limit"];

    // All five limit keys are required for a valid computation
    if (!s1 || !s2 || !s3 || !s4 || !s5) {
      return {
        tds: 0,
        status: "pending_configuration",
        note: "TDS projection requires approved tax slab configuration. No hardcoded defaults applied.",
      };
    }

    if (annualTaxable <= s1) {
      return {
        tds: 0,
        status: "configured",
        note: "Provisional projection from statutory_config. Not a filed value.",
      };
    }

    // All six rate keys are required — no hardcoded fallback rates
    const r1 = slabMap["tds_slab_1_rate"];
    const r2 = slabMap["tds_slab_2_rate"];
    const r3 = slabMap["tds_slab_3_rate"];
    const r4 = slabMap["tds_slab_4_rate"];
    const r5 = slabMap["tds_slab_5_rate"];
    const r6 = slabMap["tds_slab_6_rate"];

    if (r1 === undefined || r2 === undefined || r3 === undefined ||
        r4 === undefined || r5 === undefined || r6 === undefined) {
      return {
        tds: 0,
        status: "pending_configuration",
        note: "TDS projection requires approved tax slab configuration. No hardcoded defaults applied.",
      };
    }

    const slabs = [
      { from: 0,  to: s1,       rate: r1 },
      { from: s1, to: s2,       rate: r2 },
      { from: s2, to: s3,       rate: r3 },
      { from: s3, to: s4,       rate: r4 },
      { from: s4, to: s5,       rate: r5 },
      { from: s5, to: Infinity, rate: r6 },
    ];

    let tax = 0;
    for (const slab of slabs) {
      if (annualTaxable <= slab.from) break;
      const taxable = Math.min(annualTaxable, slab.to) - slab.from;
      tax += taxable * slab.rate;
    }

    return {
      tds: Math.round(tax * 100) / 100,
      status: "configured",
      note: "Provisional projection from statutory_config. Not a filed value.",
    };
  },
};
