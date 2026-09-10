// backend/src/modules/ats/salary.calculator.ts
import { getPtFromSlab } from '../payroll/payrollCalculate.service.js';

export interface SalaryComponents {
  offered_ctc: number;
  gross: number;
  basic: number;
  hra: number;
  conveyance: number;
  da: number;
  special_allowance: number;
  other_allowance: number;
  bonus: number;
  pf_employee: number;
  pf_employer: number;
  esic_employee: number;
  esic_employer: number;
  professional_tax: number;
  gratuity: number;
  admin_charges: number;
  net_in_hand: number;
}

/**
 * All inputs are annual. All returned values are monthly (annual ÷ 12).
 * basic_pct: % of gross (e.g. 40 for 40%)
 * hra_pct:   % of basic (e.g. 40 for 40%)
 */
export async function calculateSalary(
  annualCtc: number,
  basicPct: number,
  hraPct: number,
  _isMetro: boolean,
  esicEmployerPct = 3.25,
  pfEligible = true,
  esiEligible = true,
  stateCode?: string | null,
): Promise<SalaryComponents> {
  // Single-pass: derive gross from CTC by subtracting employer-side costs.
  // We don't know gross yet, so approximate employer PF/ESIC iteratively.
  // Use CTC * 0.88 as starting estimate for gross to determine ESIC eligibility only.
  const estimatedMonthlyGross = (annualCtc * 0.88) / 12;
  const esicApplies = esiEligible && estimatedMonthlyGross <= 21000;

  // Employer-side annual costs (deducted from CTC to get gross)
  // These are computed on gross which we don't know yet — use an iterative solve.
  // In practice one pass is accurate enough for HRM purposes.
  //
  // Gratuity is NOT included here: it's a statutory accrual/provision the
  // employer sets aside, never money the CTC offer is structured around --
  // see PkgCalcOptions in src/lib/salaryCalculator.ts ("Gratuity is a
  // statutory accrual shown as a P&L provision — NOT part of monthly CTC").
  const estimatedGross = annualCtc * 0.88;
  const estimatedBasic = estimatedGross * (basicPct / 100);
  const pfEmployerAnnual = pfEligible ? estimatedBasic * 0.12 : 0;
  const esicEmployerAnnual = esicApplies ? estimatedGross * (esicEmployerPct / 100) : 0;
  // Admin charges are the PF administration charge — only applicable when PF
  // is actually being deducted. Rate is 1% (0.50% admin + 0.50% EDLI); the
  // EDLI administration charge component was abolished in 2018, so the old
  // 1.36% here double-counted it -- see src/lib/salaryCalculator.ts ADMIN_RATE,
  // matched to the live salary_package_master catalog and owner-ruled 2026-08-27.
  const adminChargesAnnual = pfEligible ? estimatedBasic * 0.01 : 0;

  const gross = annualCtc - pfEmployerAnnual - esicEmployerAnnual - adminChargesAnnual;
  const monthlyGross = gross / 12;

  // Recompute all derived values on the actual gross
  const basic = gross * (basicPct / 100);
  const hra = basic * (hraPct / 100);
  const conveyance = 19200; // ₹1,600/month × 12
  const da = 0;
  const special = gross - basic - hra - conveyance - da;

  // Statutory deductions (employee side) — zeroed out when the candidate was
  // explicitly opted out at offer stage (offer.pf_eligible / offer.esi_eligible).
  //
  // No PF wage ceiling applied: MAS Callnet's statutory_config.pf_wage_limit
  // is 999999 (full basic), matching what live payroll and the salary-review
  // package builder (src/lib/salaryCalculator.ts DEFAULT_PF_WAGE_LIMIT) both
  // use. The EPF Act statutory minimum ceiling is ₹15,000 basic, but the
  // employer has elected to contribute on full basic — a ₹1,800/month cap
  // here previously under-deducted PF against what payroll actually withholds
  // once the employee is live.
  const pfEmployee = pfEligible ? basic * 0.12 : 0;
  const esicEmployee = esicApplies ? gross * 0.0075 : 0;

  // Professional Tax is a state subject -- not every state levies it, and the
  // amount varies by state and by gross slab. Resolve it from the same
  // pt_slab_master the live payroll engine reads (getPtFromSlab), instead of
  // a flat ₹200 assumed for every state. An unconfigured/unknown state falls
  // back to 0 rather than guessing a number that may not apply there.
  let monthlyProfessionalTax = 0;
  if (stateCode) {
    try {
      monthlyProfessionalTax = await getPtFromSlab(stateCode, monthlyGross);
    } catch (e) {
      console.warn(`[calculateSalary] PT lookup failed for state "${stateCode}":`, (e as Error).message);
    }
  }
  const professionalTax = monthlyProfessionalTax * 12;

  // Employer side (returned for display/records). Recomputed on the actual
  // final basic, not the rough pre-gross estimate used only to derive gross
  // above -- otherwise employer PF silently drifts from employee PF, which
  // should be identical (both 12% of the same basic).
  const pfEmployer = pfEligible ? basic * 0.12 : 0;
  const esicEmployer = esicApplies ? gross * (esicEmployerPct / 100) : 0;
  // Reported for cost-analysis/statutory-liability visibility only -- excluded
  // from the CTC/gross derivation above.
  const gratuity = (basic / 26 / 12) * 15;
  const adminCharges = pfEligible ? basic * 0.01 : 0;
  const bonus = basic * 0.0833;

  const netInHand = gross - pfEmployee - esicEmployee - professionalTax;

  const m = (v: number) => Math.round((v / 12) * 100) / 100;

  return {
    offered_ctc:       m(annualCtc),
    gross:             m(gross),
    basic:             m(basic),
    hra:               m(hra),
    conveyance:        m(conveyance),
    da:                m(da),
    special_allowance: Math.max(0, m(special)),
    other_allowance:   0,
    bonus:             m(bonus),
    pf_employee:       m(pfEmployee),
    pf_employer:       m(pfEmployer),
    esic_employee:     m(esicEmployee),
    esic_employer:     m(esicEmployer),
    professional_tax:  m(professionalTax),
    gratuity:          m(gratuity),
    admin_charges:     m(adminCharges),
    net_in_hand:       m(netInHand),
  };
}
