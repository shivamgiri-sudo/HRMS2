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
  /** Always 0. Kept because ats_employment_offer and its readers still carry the column. */
  gratuity: number;
  admin_charges: number;
  net_in_hand: number;
}

/*
 * The offer calculator is the SAME calculation as the Salary Package admin page
 * (/payroll/package-admin -> src/lib/salaryCalculator.ts calcFromCtc). The backend
 * cannot import that file (it lives outside backend/), so it is ported here line for
 * line; src/lib/__tests__/offerSalaryCalculatorParity.test.ts runs both over a grid
 * of inputs and fails on any difference. Change both together or not at all.
 *
 * This replaced an older formula that disagreed with the package page for the same
 * inputs (owner report, 2026-10-01):
 *   - gross came from a rough "CTC x 0.88" estimate, so gross + employer PF/ESIC/admin
 *     came to MORE than the CTC entered (20,000 -> 20,077);
 *   - the 8.33% bonus was shown as a component but left out of gross and CTC, while
 *     every catalog package carries it inside gross (owner ruling 2026-08-27);
 *   - ESIC applicability was decided on that estimate rather than the real gross;
 *   - a gratuity figure ((basic / 26 / 12) x 15) was returned and saved on the offer.
 *     Gratuity is a statutory accrual handled by payroll/F&F, not part of the offer
 *     package, so it is no longer computed here: the field is always 0.
 */
const r2 = (n: number) => Math.round(n * 100) / 100;
const CONV = 1600;
const PF_EMP_RATE = 0.12;
const PF_EMPLR_RATE = 0.12;
const ESIC_EMP_RATE = 0.0075;
const ESIC_EMPLR_RATE = 0.0325;
const ESIC_LIMIT = 21000;
/** Payment of Bonus Act minimum: 8.33% of basic -- part of gross and CTC. */
const BONUS_RATE = 0.0833;
/** 1% of PF wages -- see ADMIN_RATE in src/lib/salaryCalculator.ts. */
const ADMIN_RATE = 0.01;
/** Full basic (statutory_config.pf_wage_limit = 999999). */
const PF_WAGE_LIMIT = 999999;

/**
 * All inputs are annual; all returned values are monthly.
 * basic_pct: % of gross (e.g. 40 for 40%)
 * hra_pct:   % of basic (e.g. 40 for 40%)
 */
export async function calculateSalary(
  annualCtc: number,
  basicPct: number,
  hraPct: number,
  _isMetro: boolean,
  _esicEmployerPct?: number, // kept for caller compatibility; the rate is fixed at 3.25% as on the package page
  pfEligible = true,
  esiEligible = true,
  stateCode?: string | null,
): Promise<SalaryComponents> {
  void stateCode; // Professional Tax removed company-wide 2026-09-11; kept for caller compatibility
  const monthlyCtc = annualCtc / 12;
  const bFrac = basicPct / 100;

  // calcFromCtc: CTC = Gross x (1 + bFrac x (PF employer + admin) + ESIC employer)
  const pfContribRate = pfEligible ? (PF_EMPLR_RATE + ADMIN_RATE) : 0;
  const esicContribRate = esiEligible ? ESIC_EMPLR_RATE : 0;
  let g = monthlyCtc / (1 + bFrac * pfContribRate + esicContribRate);
  if (esiEligible && g > ESIC_LIMIT) {
    g = monthlyCtc / (1 + bFrac * pfContribRate);
  }
  if (pfEligible && g * bFrac > PF_WAGE_LIMIT) {
    const fixedEmployer = PF_WAGE_LIMIT * (PF_EMPLR_RATE + ADMIN_RATE);
    const esicAmt = esiEligible && g <= ESIC_LIMIT ? g * ESIC_EMPLR_RATE : 0;
    g = monthlyCtc - fixedEmployer - esicAmt;
  }
  const gross = r2(Math.max(0, g));

  // deriveComponents (includeBonus defaults to true on the package page)
  const basic = r2(gross * (basicPct / 100));
  const hra = r2(basic * (hraPct / 100));
  // Conveyance and bonus are carved out of the gross, never added on top of it. When basic and
  // HRA already take the whole gross (a package split of basic = gross, HRA 0, as the band-package
  // ratio can return for a low band) there is no room for them, so they are 0. Before this guard
  // the Math.max(0, ...) below hid the overflow: 63694C's offer listed bonus 949.44 and
  // conveyance 1,600 on top of a gross that was already all basic (components 13,947 vs gross 11,398).
  const room = r2(gross - basic - hra);
  const fits = room >= CONV + r2(basic * BONUS_RATE);
  const conveyance = fits ? CONV : 0;
  const bonus = fits ? r2(basic * BONUS_RATE) : 0;
  const special = Math.max(0, r2(room - conveyance - bonus));

  const pfBase = Math.min(basic, PF_WAGE_LIMIT);
  const esicApplies = esiEligible && gross <= ESIC_LIMIT;
  const pfEmployee = pfEligible ? r2(pfBase * PF_EMP_RATE) : 0;
  const esicEmployee = esicApplies ? r2(gross * ESIC_EMP_RATE) : 0;
  const netInHand = r2(gross - pfEmployee - esicEmployee);

  const pfEmployer = pfEligible ? r2(pfBase * PF_EMPLR_RATE) : 0;
  const esicEmployer = esicApplies ? r2(gross * ESIC_EMPLR_RATE) : 0;
  const adminCharges = pfEligible ? r2(pfBase * ADMIN_RATE) : 0;
  const ctc = r2(gross + pfEmployer + esicEmployer + adminCharges);

  return {
    offered_ctc:       ctc,
    gross,
    basic,
    hra,
    conveyance,
    da:                0,
    special_allowance: special,
    other_allowance:   0,
    bonus,
    pf_employee:       pfEmployee,
    pf_employer:       pfEmployer,
    esic_employee:     esicEmployee,
    esic_employer:     esicEmployer,
    professional_tax:  0,
    gratuity:          0,
    admin_charges:     adminCharges,
    net_in_hand:       netInHand,
  };
}
