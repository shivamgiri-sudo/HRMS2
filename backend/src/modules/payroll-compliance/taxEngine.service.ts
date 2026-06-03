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

    if (regime === "new") {
      return { standard_deduction: 75000, rebate_limit: 1200000, rebate_max_amount: 60000, cess_pct: 4 } as FyConfigRow;
    }
    return { standard_deduction: 50000, rebate_limit: 500000, rebate_max_amount: 12500, cess_pct: 4 } as FyConfigRow;
  },

  async getSlabs(financialYear: string, regime: TaxRegime): Promise<SlabRow[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT slab_from, slab_to, rate_pct
         FROM payroll_tax_slab_master
        WHERE financial_year = ? AND regime = ? AND active_status = 1
        ORDER BY slab_from ASC`,
      [financialYear, regime]
    );

    if (rows.length) return rows as SlabRow[];

    if (regime === "new") {
      return [
        { slab_from: 0, slab_to: 400000, rate_pct: 0 },
        { slab_from: 400000, slab_to: 800000, rate_pct: 5 },
        { slab_from: 800000, slab_to: 1200000, rate_pct: 10 },
        { slab_from: 1200000, slab_to: 1600000, rate_pct: 15 },
        { slab_from: 1600000, slab_to: 2000000, rate_pct: 20 },
        { slab_from: 2000000, slab_to: 2400000, rate_pct: 25 },
        { slab_from: 2400000, slab_to: null, rate_pct: 30 },
      ] as SlabRow[];
    }

    return [
      { slab_from: 0, slab_to: 250000, rate_pct: 0 },
      { slab_from: 250000, slab_to: 500000, rate_pct: 5 },
      { slab_from: 500000, slab_to: 1000000, rate_pct: 20 },
      { slab_from: 1000000, slab_to: null, rate_pct: 30 },
    ] as SlabRow[];
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

  allowedOldRegimeDeductions(decl?: TaxDeclarationLike | null): number {
    if (!decl) return 0;
    const hra = Math.max(0, Number(decl.declared_hra ?? 0));
    const sec80c = Math.min(Math.max(0, Number(decl.declared_80c ?? 0)), 150000);
    const sec80d = Math.min(Math.max(0, Number(decl.declared_80d ?? 0)), 25000);
    return r2(hra + sec80c + sec80d);
  },

  async calculateMonthlyTds(input: TaxEngineInput): Promise<TaxEngineResult> {
    const regime = normalizeRegime(input.declaration?.regime as string | undefined);
    const config = await this.getConfig(input.financialYear, regime);
    const slabs = await this.getSlabs(input.financialYear, regime);

    const annualGross = Math.max(0, Number(input.annualGross || 0));
    const standardDeduction = Math.max(0, Number(config.standard_deduction || 0));
    const deductionsAllowed = regime === "old" ? this.allowedOldRegimeDeductions(input.declaration) : 0;

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
