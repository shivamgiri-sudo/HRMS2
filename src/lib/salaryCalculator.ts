export interface PkgCalcOptions {
  includePf: boolean;
  includeEsic: boolean;
  basicPct: number;
  hraPct: number;
  /** State name from branch_master.state — kept for branch/state display and
   *  minimum-wage lookups elsewhere in the package builder. Professional Tax has
   *  been removed company-wide, so this calculator no longer derives PT from it. */
  state?: string;
  /**
   * PF wage ceiling used to cap the PF-eligible basic.
   *
   * EPF Act statutory ceiling is ₹15,000 (basic) — the employer MUST contribute
   * on at least min(basic, 15000). The employer MAY contribute on a higher amount.
   * MAS Callnet's statutory_config.pf_wage_limit = 999999 meaning full basic, so
   * the default here matches production. Set to 15000 to show the statutory-minimum
   * view. This field drives the package builder estimate only; actual payroll
   * reads from statutory_config via payrollCalculate.service.ts.
   */
  pfWageLimit?: number;
  /**
   * Include the 8.33% statutory bonus in gross.
   *
   * Owner ruling, 2026-08-27: bonus is part of CTC, so this DEFAULTS TO TRUE — pass
   * `false` explicitly for the rare package that excludes it. The live catalog agrees:
   * 229 of the 230 populated salary_package_master rows carry bonus = 8.33% of basic
   * inside gross. Defaulting it off produced packages whose CTC was short by that
   * amount against every package already in the catalog.
   */
  includeBonus?: boolean;
}

export interface PkgComponents {
  basic: number;
  hra: number;
  conveyance: number;
  special_allowance: number;
  other_allowance: number;
  bonus: number;
  pli: number;
  portfolio: number;
  medical: number;
  gross: number;
  epf_employee: number;
  esic_employee: number;
  net_in_hand: number;
  epf_employer: number;
  esic_employer: number;
  admin_charges: number;
  ctc: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const CONV = 1600;
const PF_EMP_RATE = 0.12;
const PF_EMPLR_RATE = 0.12;
const ESIC_EMP_RATE = 0.0075;
const ESIC_EMPLR_RATE = 0.0325;
const ESIC_LIMIT = 21000;
const GRATUITY_RATE = 15 / 26 / 12;
/** Payment of Bonus Act minimum: 8.33% of basic. */
const BONUS_RATE = 0.0833;
// Owner ruling, 2026-08-27: admin charges are 1% of PF wages.
// This matches the live catalog, which is the stronger evidence: every populated row in
// salary_package_master computes admin_charges at exactly 1.00% (basic 3,000 -> 30,
// basic 3,700 -> 37), so the 1.01% here was making the builder disagree with the 230
// packages already in use. EPFO's own rate is 0.50% admin + 0.50% EDLI; the extra 0.01%
// EDLI administration charge was abolished in 2018 and should not have survived here.
export const ADMIN_RATE = 0.01;
// Default PF wage limit: 999999 = full basic (matches MAS Callnet's statutory_config).
// EPF Act statutory minimum is ₹15,000; employer may contribute on more.
const DEFAULT_PF_WAGE_LIMIT = 999999;

function deriveComponents(gross: number, opts: PkgCalcOptions): PkgComponents {
  const { includePf, includeEsic, basicPct, hraPct } = opts;
  const includeBonus = opts.includeBonus ?? true; // part of CTC unless explicitly excluded
  const pfCap = opts.pfWageLimit ?? DEFAULT_PF_WAGE_LIMIT;

  const basic = r2(gross * (basicPct / 100));
  const hra = r2(basic * (hraPct / 100));
  const bonus = includeBonus ? r2(basic * BONUS_RATE) : 0;
  const special_allowance = Math.max(0, r2(gross - basic - hra - CONV - bonus));

  const pfBase = Math.min(basic, pfCap);
  const epf_employee = includePf ? r2(pfBase * PF_EMP_RATE) : 0;
  const esic_employee = includeEsic && gross <= ESIC_LIMIT ? r2(gross * ESIC_EMP_RATE) : 0;
  const net_in_hand = r2(gross - epf_employee - esic_employee);

  const epf_employer = includePf ? r2(pfBase * PF_EMPLR_RATE) : 0;
  const esic_employer = includeEsic && gross <= ESIC_LIMIT ? r2(gross * ESIC_EMPLR_RATE) : 0;
  const admin_charges = includePf ? r2(pfBase * ADMIN_RATE) : 0;
  // Gratuity is NOT part of CTC in the package definition. It is a statutory
  // liability accrued separately and shown in cost analyses, not in the monthly
  // package amount that employees or payroll work against.
  const ctc = r2(gross + epf_employer + esic_employer + admin_charges);

  return {
    basic, hra, conveyance: CONV, special_allowance,
    other_allowance: 0, bonus, pli: 0, portfolio: 0, medical: 0,
    gross,
    epf_employee, esic_employee, net_in_hand,
    epf_employer, esic_employer, admin_charges, ctc,
  };
}

export function calcFromCtc(monthlyCtc: number, opts: PkgCalcOptions): PkgComponents {
  const { includePf, includeEsic, basicPct } = opts;
  const pfCap = opts.pfWageLimit ?? DEFAULT_PF_WAGE_LIMIT;
  const bFrac = basicPct / 100;

  // Exact analytical solve — replaces the old rough "× 0.88" estimate that produced
  // CTC overshoot (entering 20,000 showed Monthly CTC 20,077).
  //
  // CTC = Gross + EPF_employer + ESIC_employer + Admin
  //     = Gross × (1 + bFrac × (PF_EMPLR_RATE + ADMIN_RATE) + ESIC_EMPLR_RATE)  [ESIC applies]
  //     = Gross × (1 + bFrac × (PF_EMPLR_RATE + ADMIN_RATE))                    [ESIC exempt]
  const pfContribRate   = includePf    ? (PF_EMPLR_RATE + ADMIN_RATE) : 0;
  const esicContribRate = includeEsic  ? ESIC_EMPLR_RATE              : 0;

  // Assume ESIC applies first; check whether the derived gross is actually ≤ ESIC_LIMIT
  let gross = monthlyCtc / (1 + bFrac * pfContribRate + esicContribRate);
  if (includeEsic && gross > ESIC_LIMIT) {
    gross = monthlyCtc / (1 + bFrac * pfContribRate);
  }

  // PF wage-cap edge case: pfCap defaults to 999999 in production so this rarely fires,
  // but when basic would exceed pfCap the employer costs are fixed amounts, not proportional.
  if (includePf && gross * bFrac > pfCap) {
    const fixedEmployer = pfCap * (PF_EMPLR_RATE + ADMIN_RATE);
    const esicAmt = includeEsic && gross <= ESIC_LIMIT ? gross * ESIC_EMPLR_RATE : 0;
    gross = monthlyCtc - fixedEmployer - esicAmt;
  }

  return deriveComponents(r2(Math.max(0, gross)), opts);
}

export function calcFromInHand(monthlyInHand: number, opts: PkgCalcOptions): PkgComponents {
  const { includePf, includeEsic, basicPct } = opts;
  let gross: number;

  if (!includePf && !includeEsic) {
    // Net = Gross exactly — no deductions to solve for.
    gross = r2(Math.max(0, monthlyInHand));
  } else if (!includePf) {
    const gEsic = r2(monthlyInHand / (1 - ESIC_EMP_RATE));
    gross = gEsic > ESIC_LIMIT ? monthlyInHand : gEsic;
    gross = r2(Math.max(0, gross));
  } else {
    // Maximum PF employee contribution = pfWageLimit × rate (capped basic × 12%).
    const pfMaxContribution = (opts.pfWageLimit ?? DEFAULT_PF_WAGE_LIMIT) * PF_EMP_RATE;
    gross = monthlyInHand + pfMaxContribution;
    for (let i = 0; i < 5; i++) {
      const b = gross * (basicPct / 100);
      const pf = Math.min(b * PF_EMP_RATE, pfMaxContribution);
      const esic = includeEsic && gross <= ESIC_LIMIT ? gross * ESIC_EMP_RATE : 0;
      gross = monthlyInHand + pf + esic;
    }
    gross = r2(Math.max(0, gross));
  }

  return deriveComponents(gross, opts);
}
