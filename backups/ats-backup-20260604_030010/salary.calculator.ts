// backend/src/modules/ats/salary.calculator.ts
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
export function calculateSalary(
  annualCtc: number,
  basicPct: number,
  hraPct: number,
  _isMetro: boolean,
): SalaryComponents {
  // Single-pass: derive gross from CTC by subtracting employer-side costs.
  // We don't know gross yet, so approximate employer PF/ESIC/gratuity iteratively.
  // Use CTC * 0.88 as starting estimate for gross to determine ESIC eligibility only.
  const estimatedMonthlyGross = (annualCtc * 0.88) / 12;
  const esicApplies = estimatedMonthlyGross <= 21000;

  // Employer-side annual costs (deducted from CTC to get gross)
  // These are computed on gross which we don't know yet — use an iterative solve.
  // In practice one pass is accurate enough for HRM purposes.
  const estimatedGross = annualCtc * 0.88;
  const estimatedBasic = estimatedGross * (basicPct / 100);
  const pfEmployerAnnual = estimatedBasic * 0.12;
  const esicEmployerAnnual = esicApplies ? estimatedGross * 0.0325 : 0;
  const gratuityAnnual = (estimatedBasic / 26 / 12) * 15;
  const adminChargesAnnual = estimatedBasic * 0.005;

  const gross = annualCtc - pfEmployerAnnual - esicEmployerAnnual - gratuityAnnual - adminChargesAnnual;
  const monthlyGross = gross / 12;

  // Recompute all derived values on the actual gross
  const basic = gross * (basicPct / 100);
  const hra = basic * (hraPct / 100);
  const conveyance = 19200; // ₹1,600/month × 12
  const da = 0;
  const special = gross - basic - hra - conveyance - da;

  // Statutory deductions (employee side)
  const pfEmployee = Math.min(basic * 0.12, 21600); // capped at ₹1,800/month × 12
  const esicEmployee = esicApplies ? gross * 0.0075 : 0;
  const professionalTax = 2400; // ₹200/month × 12

  // Employer side (returned for display/records — already used to derive gross above)
  const pfEmployer = estimatedBasic * 0.12; // consistent with gross derivation
  const esicEmployer = esicApplies ? gross * 0.0325 : 0;
  const gratuity = (basic / 26 / 12) * 15;
  const adminCharges = basic * 0.005;
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
