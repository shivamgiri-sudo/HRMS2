export interface PkgCalcOptions {
  includePf: boolean;
  includeEsic: boolean;
  basicPct: number;
  hraPct: number;
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
const PT = 200;
const CONV = 1600;
const PF_EMP_RATE = 0.12;
const PF_EMP_CAP = 1800;
const PF_EMPLR_RATE = 0.12;
const ESIC_EMP_RATE = 0.0075;
const ESIC_EMPLR_RATE = 0.0325;
const ESIC_LIMIT = 21000;
const GRATUITY_RATE = 15 / 26 / 12;
const ADMIN_RATE = 0.0136;
const BONUS_RATE = 0.0833;

function deriveComponents(gross: number, opts: PkgCalcOptions): PkgComponents {
  const { includePf, includeEsic, basicPct, hraPct } = opts;

  const basic = r2(gross * (basicPct / 100));
  const hra = r2(basic * (hraPct / 100));
  const special_allowance = Math.max(0, r2(gross - basic - hra - CONV));

  const epf_employee = includePf ? r2(Math.min(basic * PF_EMP_RATE, PF_EMP_CAP)) : 0;
  const esic_employee = includeEsic && gross <= ESIC_LIMIT ? r2(gross * ESIC_EMP_RATE) : 0;
  const net_in_hand = r2(gross - epf_employee - esic_employee - PT);

  const epf_employer = includePf ? r2(basic * PF_EMPLR_RATE) : 0;
  const esic_employer = includeEsic && gross <= ESIC_LIMIT ? r2(gross * ESIC_EMPLR_RATE) : 0;
  const gratuity = r2(basic * GRATUITY_RATE);
  const admin_charges = r2(basic * ADMIN_RATE);
  const bonus = r2(basic * BONUS_RATE);
  const ctc = r2(gross + epf_employer + esic_employer + gratuity + admin_charges);

  return {
    basic, hra, conveyance: CONV, special_allowance,
    other_allowance: 0, bonus, pli: 0, portfolio: 0, medical: 0,
    gross,
    epf_employee, esic_employee, professional_tax: PT, net_in_hand,
    epf_employer, esic_employer, admin_charges, ctc,
  };
}

export function calcFromCtc(monthlyCtc: number, opts: PkgCalcOptions): PkgComponents {
  const { includePf, includeEsic, basicPct } = opts;
  const estGross = monthlyCtc * 0.88;
  const estBasic = estGross * (basicPct / 100);
  const pf_e = includePf ? estBasic * PF_EMPLR_RATE : 0;
  const esic_e = includeEsic && estGross <= ESIC_LIMIT ? estGross * ESIC_EMPLR_RATE : 0;
  const grat = estBasic * GRATUITY_RATE;
  const adm = estBasic * ADMIN_RATE;
  const gross = r2(Math.max(0, monthlyCtc - pf_e - esic_e - grat - adm));
  return deriveComponents(gross, opts);
}

export function calcFromInHand(monthlyInHand: number, opts: PkgCalcOptions): PkgComponents {
  const { includePf, includeEsic, basicPct } = opts;
  let gross: number;

  if (!includePf && !includeEsic) {
    gross = monthlyInHand + PT;
  } else if (!includePf) {
    const g0 = monthlyInHand + PT;
    gross = g0 > ESIC_LIMIT ? g0 : r2((monthlyInHand + PT) / (1 - ESIC_EMP_RATE));
  } else {
    gross = monthlyInHand + PT + PF_EMP_CAP;
    for (let i = 0; i < 5; i++) {
      const b = gross * (basicPct / 100);
      const pf = Math.min(b * PF_EMP_RATE, PF_EMP_CAP);
      const esic = includeEsic && gross <= ESIC_LIMIT ? gross * ESIC_EMP_RATE : 0;
      gross = monthlyInHand + PT + pf + esic;
    }
    gross = r2(gross);
  }

  return deriveComponents(Math.max(0, gross), opts);
}
