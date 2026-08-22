export interface PkgCalcOptions {
  includePf: boolean;
  includeEsic: boolean;
  basicPct: number;
  hraPct: number;
  /** State name from branch_master.state — used to compute Professional Tax.
   *  Defaults to 0 if the state is not known or not PT-applicable.
   *  PT is a state-level tax; Delhi, UP, Haryana and many others do not levy it. */
  state?: string;
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
  professional_tax: number;
  net_in_hand: number;
  epf_employer: number;
  esic_employer: number;
  admin_charges: number;
  ctc: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const CONV = 1600;
const PF_EMP_RATE = 0.12;
const PF_EMP_CAP = 1800;
const PF_EMPLR_RATE = 0.12;
const ESIC_EMP_RATE = 0.0075;
const ESIC_EMPLR_RATE = 0.0325;
const ESIC_LIMIT = 21000;
const GRATUITY_RATE = 15 / 26 / 12;
const ADMIN_RATE = 0.0101; // EPFO: 0.50% admin + 0.50% EDLI + 0.01% EDLI admin

/**
 * Monthly Professional Tax by state and gross salary.
 *
 * Only states that ACTUALLY levy PT are listed. Every other state returns 0.
 * Hardcoding slabs is intentional — slabs change infrequently and require a
 * deploy to update, but silently applying PT in a state that doesn't have it
 * (the old ₹200-for-everyone bug) causes real payroll errors.
 *
 * Maximum PT is ₹2,500/year (₹208/month average) as per Article 276 of the
 * Constitution. States billing ₹300 in February (Maharashtra) are handled at
 * payroll-run time, not here — this returns the standard monthly figure.
 */
export const PT_BY_STATE: Record<string, (gross: number) => number> = {
  // Gujarat — most MAS Callnet branches (Ahmedabad)
  'Gujarat': (g) => g < 6000 ? 0 : g < 9000 ? 80 : g < 12000 ? 150 : 200,

  // Maharashtra
  'Maharashtra': (g) => g <= 7500 ? 0 : 200,

  // Karnataka
  'Karnataka': (g) => g < 15000 ? 150 : 200,

  // West Bengal
  'West Bengal': (g) =>
    g < 8500 ? 0 : g < 10000 ? 90 : g < 15000 ? 110 : g < 25000 ? 130 : g < 40000 ? 150 : 200,

  // Andhra Pradesh
  'Andhra Pradesh': (g) => g < 15000 ? 0 : g < 20000 ? 150 : 200,

  // Telangana
  'Telangana': (g) => g < 15000 ? 0 : g < 20000 ? 150 : 200,

  // Tamil Nadu
  'Tamil Nadu': (g) => g < 21000 ? 0 : 182,

  // Madhya Pradesh
  'Madhya Pradesh': (g) => g < 18750 ? 0 : 208,

  // Odisha
  'Odisha': (g) => g < 15000 ? 0 : g < 20000 ? 125 : 200,

  // Assam
  'Assam': (g) => g < 10000 ? 0 : g < 15000 ? 150 : 208,

  // Kerala
  'Kerala': (g) => g < 11500 ? 0 : g < 17500 ? 150 : g < 25000 ? 180 : 208,

  // Jharkhand
  'Jharkhand': (g) => g < 25000 ? 0 : 208,

  // Chhattisgarh
  'Chhattisgarh': (g) => g < 15000 ? 0 : 200,

  // Goa
  'Goa': (g) => g < 15000 ? 0 : 200,

  // Sikkim
  'Sikkim': (g) => g < 20000 ? 0 : 208,

  // States with NO Professional Tax — explicit zeros so intent is clear:
  'Delhi':              () => 0,
  'Uttar Pradesh':      () => 0,
  'Haryana':            () => 0,
  'Punjab':             () => 0,
  'Rajasthan':          () => 0,
  'Uttarakhand':        () => 0,
  'Himachal Pradesh':   () => 0,
  'Jammu and Kashmir':  () => 0,
  'Ladakh':             () => 0,
  'Chandigarh':         () => 0,
  'Bihar':              () => 0, // Bihar abolished PT
  'Arunachal Pradesh':  () => 0,
  'Nagaland':           () => 0,
  'Manipur':            () => 0,
  'Mizoram':            () => 0,
};

/** Returns monthly Professional Tax for the given state and gross salary. */
export function getProfessionalTax(gross: number, state?: string): number {
  if (!state) return 0;
  const fn = PT_BY_STATE[state];
  return fn ? fn(gross) : 0; // unknown state = 0, safer than assuming PT applies
}

function deriveComponents(gross: number, opts: PkgCalcOptions): PkgComponents {
  const { includePf, includeEsic, basicPct, hraPct, state } = opts;

  const basic = r2(gross * (basicPct / 100));
  const hra = r2(basic * (hraPct / 100));
  const special_allowance = Math.max(0, r2(gross - basic - hra - CONV));
  const bonus = r2(basic * 0.0833);

  const epf_employee = includePf ? r2(Math.min(basic * PF_EMP_RATE, PF_EMP_CAP)) : 0;
  const esic_employee = includeEsic && gross <= ESIC_LIMIT ? r2(gross * ESIC_EMP_RATE) : 0;
  const professional_tax = r2(getProfessionalTax(gross, state));
  const net_in_hand = r2(gross - epf_employee - esic_employee - professional_tax);

  const epf_employer = includePf ? r2(Math.min(basic * PF_EMPLR_RATE, PF_EMP_CAP)) : 0;
  const esic_employer = includeEsic && gross <= ESIC_LIMIT ? r2(gross * ESIC_EMPLR_RATE) : 0;
  const gratuity = r2(basic * GRATUITY_RATE);
  const admin_charges = includePf ? r2(basic * ADMIN_RATE) : 0;
  const ctc = r2(gross + epf_employer + esic_employer + gratuity + admin_charges);

  return {
    basic, hra, conveyance: CONV, special_allowance,
    other_allowance: 0, bonus, pli: 0, portfolio: 0, medical: 0,
    gross,
    epf_employee, esic_employee, professional_tax, net_in_hand,
    epf_employer, esic_employer, admin_charges, ctc,
  };
}

export function calcFromCtc(monthlyCtc: number, opts: PkgCalcOptions): PkgComponents {
  const { includePf, includeEsic, basicPct } = opts;
  const estGross = monthlyCtc * 0.88;
  const estBasic = estGross * (basicPct / 100);
  const pf_e = includePf ? Math.min(estBasic * PF_EMPLR_RATE, PF_EMP_CAP) : 0;
  const esic_e = includeEsic && estGross <= ESIC_LIMIT ? estGross * ESIC_EMPLR_RATE : 0;
  const grat = estBasic * GRATUITY_RATE;
  const adm = includePf ? estBasic * ADMIN_RATE : 0;
  const gross = r2(Math.max(0, monthlyCtc - pf_e - esic_e - grat - adm));
  return deriveComponents(gross, opts);
}

export function calcFromInHand(monthlyInHand: number, opts: PkgCalcOptions): PkgComponents {
  const { includePf, includeEsic, basicPct, state } = opts;
  // PT is gross-dependent but we need gross to compute PT — iterative solve
  let gross: number;
  const ptFn = (g: number) => getProfessionalTax(g, state);

  if (!includePf && !includeEsic) {
    // Net = Gross - PT: solve iteratively
    gross = monthlyInHand; // initial estimate
    for (let i = 0; i < 5; i++) {
      gross = monthlyInHand + ptFn(gross);
    }
    gross = r2(Math.max(0, gross));
  } else if (!includePf) {
    const g0 = monthlyInHand + ptFn(monthlyInHand);
    const gEsic = r2(g0 / (1 - ESIC_EMP_RATE));
    gross = gEsic > ESIC_LIMIT ? g0 : gEsic;
    // Refine with PT
    for (let i = 0; i < 3; i++) {
      const pt = ptFn(gross);
      const g1 = monthlyInHand + pt;
      gross = g1 > ESIC_LIMIT ? g1 : r2(g1 / (1 - ESIC_EMP_RATE));
    }
    gross = r2(Math.max(0, gross));
  } else {
    gross = monthlyInHand + ptFn(monthlyInHand) + PF_EMP_CAP;
    for (let i = 0; i < 5; i++) {
      const b = gross * (basicPct / 100);
      const pf = Math.min(b * PF_EMP_RATE, PF_EMP_CAP);
      const esic = includeEsic && gross <= ESIC_LIMIT ? gross * ESIC_EMP_RATE : 0;
      const pt = ptFn(gross);
      gross = monthlyInHand + pt + pf + esic;
    }
    gross = r2(Math.max(0, gross));
  }

  return deriveComponents(gross, opts);
}
