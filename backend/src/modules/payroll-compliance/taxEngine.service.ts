import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export type TaxRegime = "old" | "new";

export interface TaxDeclarationLike {
  regime?: TaxRegime | string | null;
  declared_hra?: number | null;
  declared_80c?: number | null;
  declared_80d?: number | null;
}

export interface TaxEngineInput {
  financialYear: string;
  annualGross: number;
  declaration?: TaxDeclarationLike | null;
  alreadyDeducted?: number;
  monthsRemaining?: number;
  employeeAge?: number | null;
}

export interface TaxEngineResult {
  financial_year: string;
  regime: TaxRegime;
  annual_gross: number;
  standard_deduction: number;
  deductions_allowed: number;
  taxable_income: number;
  tax_before_rebate: number;
  rebate: number;
  cess: number;
  tax_annual: number;
  already_deducted: number;
  tds_monthly: number;
  effective_rate: number;
  notes: string[];
}

interface FyConfigRow extends RowDataPacket {
  standard_deduction: number;
  rebate_limit: number;
  rebate_max_amount: number;
  cess_pct: number;
}

interface SlabRow extends RowDataPacket {
  slab_from: number;
  slab_to: number | null;
  rate_pct: number;
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

function normalizeRegime(input?: string | null): TaxRegime {
  return input === "old" ? "old" : "new";
}

export const taxEngineService = {
  async getConfig(financialYear: string, regime: TaxRegime): Promise<FyConfigRow> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM payroll_tax_fy_config
        WHERE financial_year = ? AND regime = ? AND active_status = 1
        LIMIT 1`,
      [financialYear, regime]
    );

    if (rows[0]) return rows[0] as FyConfigRow;

    // No hardcoded fallback. The removed literals were not wrong — they matched the
    // Finance Act 2025 — but constants go stale invisibly: once a Finance Act moves a
    // band, code carrying them keeps deducting last year's rate and nothing reports it.
    // Under-deduction is the employer's liability under s.201(1A), with interest, and
    // it surfaces via the tax department rather than via payroll.
    //
    // Throwing routes the caller (payrollCalculate.service.ts) into calculateTds, which
    // reads the approved statutory_config and refuses with pending_configuration when
    // that is absent too — a different route to the same approved rates, not a laxer one.
    throw new Error(
      `No approved tax configuration for financial year ${financialYear}, ${regime} regime. ` +
      `Seed payroll_tax_fy_config before running payroll for this year.`
    );
  },

  async getSlabs(financialYear: string, regime: TaxRegime): Promise<SlabRow[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT slab_from, slab_to, rate_pct
         FROM payroll_tax_slab_master
        WHERE financial_year = ? AND regime = ? AND active_status = 1
        ORDER BY slab_from ASC`,
      [financialYear, regime]
    );

    if (rows.length) {
      // Two active rows for the same band is not a slab table, it is an ambiguity.
      //
      // calculateSlabTax below sums EVERY row it is handed, so a duplicated band is charged
      // twice and the result is a clean, plausible, silently doubled tax figure. Verified live
      // 2026-08-16: every FY2026-27 band is present twice in payroll_tax_slab_master, and the
      // table has no unique key on (financial_year, regime, slab_from) to prevent it.
      //
      // Deduplicating here would mean picking a winner, and the duplicates are not guaranteed
      // to agree on rate_pct or slab_to — choosing silently would swap a visible doubling for
      // an invisible wrong rate. This throws for the same reason the missing-slab branch below
      // throws: an unapproved or unresolvable slab set must stop payroll, not guess at it.
      const seen = new Map<string, number>();
      for (const row of rows as SlabRow[]) {
        const key = String(row.slab_from);
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
      const duplicated = [...seen.entries()].filter(([, n]) => n > 1).map(([from]) => from);
      if (duplicated.length) {
        throw Object.assign(
          new Error(
            `Ambiguous tax slabs for financial year ${financialYear}, ${regime} regime: ` +
            `slab_from ${duplicated.join(", ")} each have more than one active row in ` +
            `payroll_tax_slab_master. Every duplicated band would be taxed more than once. ` +
            `Deactivate the extra rows before running payroll for this year.`
          ),
          { statusCode: 409, code: "TAX_SLABS_AMBIGUOUS" }
        );
      }
      return rows as SlabRow[];
    }

    // No hardcoded slab table, for the same reason as getConfig above. The old-regime
    // literals removed here were the pre-2023 bands (250k/500k/1000k) and had already
    // drifted from the ones seeded in payroll_tax_slab_master, so this path could
    // silently tax an old-regime employee on bands nobody had approved.
    throw new Error(
      `No approved tax slabs for financial year ${financialYear}, ${regime} regime. ` +
      `Seed payroll_tax_slab_master before running payroll for this year.`
    );
  },

  calculateSlabTax(taxableIncome: number, slabs: SlabRow[]): number {
    let tax = 0;
    for (const slab of slabs) {
      const from = Number(slab.slab_from);
      const to = slab.slab_to === null ? taxableIncome : Math.min(taxableIncome, Number(slab.slab_to));
      if (taxableIncome <= from) continue;
      const amount = Math.max(0, to - from);
      tax += amount * (Number(slab.rate_pct) / 100);
    }
    return r2(tax);
  },

  allowedOldRegimeDeductions(decl?: TaxDeclarationLike | null, employeeAge?: number | null): number {
    if (!decl) return 0;
    const hra = Math.max(0, Number(decl.declared_hra ?? 0));
    const sec80c = Math.min(Math.max(0, Number(decl.declared_80c ?? 0)), 150000);
    const sec80dCap = (employeeAge != null && employeeAge >= 60) ? 50000 : 25000; // s.80D: ₹50K for senior citizens
    const sec80d = Math.min(Math.max(0, Number(decl.declared_80d ?? 0)), sec80dCap);
    return r2(hra + sec80c + sec80d);
  },

  async calculateMonthlyTds(input: TaxEngineInput): Promise<TaxEngineResult> {
    const regime = normalizeRegime(input.declaration?.regime as string | undefined);
    const config = await this.getConfig(input.financialYear, regime);
    const slabs = await this.getSlabs(input.financialYear, regime);

    const annualGross = Math.max(0, Number(input.annualGross || 0));
    const standardDeduction = Math.max(0, Number(config.standard_deduction || 0));
    const deductionsAllowed = regime === "old" ? this.allowedOldRegimeDeductions(input.declaration, input.employeeAge) : 0;

    const taxableIncome = r2(Math.max(0, annualGross - standardDeduction - deductionsAllowed));
    const taxBeforeRebate = this.calculateSlabTax(taxableIncome, slabs);

    let rebate = 0;
    if (taxableIncome <= Number(config.rebate_limit || 0)) {
      rebate = Math.min(taxBeforeRebate, Number(config.rebate_max_amount || taxBeforeRebate));
    }

    const taxAfterRebate = Math.max(0, taxBeforeRebate - rebate);
    const cess = r2(taxAfterRebate * (Number(config.cess_pct || 0) / 100));
    const taxAnnual = r2(taxAfterRebate + cess);
    const alreadyDeducted = Math.max(0, Number(input.alreadyDeducted ?? 0));
    const monthsRemaining = Math.max(1, Math.min(12, Number(input.monthsRemaining ?? 12)));
    const tdsMonthly = r2(Math.max(0, taxAnnual - alreadyDeducted) / monthsRemaining);
    const effectiveRate = annualGross > 0 ? r2((taxAnnual / annualGross) * 100) : 0;

    return {
      financial_year: input.financialYear,
      regime,
      annual_gross: annualGross,
      standard_deduction: standardDeduction,
      deductions_allowed: deductionsAllowed,
      taxable_income: taxableIncome,
      tax_before_rebate: taxBeforeRebate,
      rebate: r2(rebate),
      cess,
      tax_annual: taxAnnual,
      already_deducted: alreadyDeducted,
      tds_monthly: tdsMonthly,
      effective_rate: effectiveRate,
      notes: [
        `Regime=${regime}`,
        `FY=${input.financialYear}`,
        `Standard deduction=${standardDeduction}`,
        regime === "new" ? "Old-regime deductions ignored under new regime" : `Old-regime deductions allowed=${deductionsAllowed}`,
      ],
    };
  },
};
