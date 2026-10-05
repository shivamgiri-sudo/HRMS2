/**
 * Display estimates for a salary package row: employee PF/ESIC, employer cost, CTC and net in hand.
 *
 * Rows that are not linked to a catalog package (package_id NULL: the db_bill rebuild, the db_bill increment sync,
 * the joining sync) carry no trustworthy stored estimates: the increment sync left net_estimate at nonsense values
 * (Rs 3,647 on a Rs 38,398 gross) and the rebuild left it NULL, so the page showed either that or net = gross. These are
 * derived from the components and the row's own PF/ESIC flags with the standard rates, which reproduces the catalog
 * exactly (band G, gross 15,059, basic 8,000: PF 960, ESIC 113, net 13,986). Payroll does not read these fields; it
 * recomputes every month.
 */
export const PF_EMPLOYEE_RATE = 0.12;
export const PF_EMPLOYER_RATE = 0.12;
export const PF_ADMIN_RATE = 0.01;
export const ESIC_EMPLOYEE_RATE = 0.0075;
export const ESIC_EMPLOYER_RATE = 0.0325;
export const ESIC_GROSS_LIMIT = 21000;

export interface EstimateInput {
  gross: unknown;
  basic: unknown;
  pf_applicable: unknown;
  esi_applicable: unknown;
}

export interface SalaryEstimates {
  pf_employee: number;
  esic_employee: number;
  employer_pf: number;
  employer_esi: number;
  admin_charges: number;
  ctc: number;
  net_in_hand: number;
}

const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

export function deriveSalaryEstimates(row: EstimateInput): SalaryEstimates {
  const gross = num(row.gross);
  const basic = num(row.basic);
  const pf = num(row.pf_applicable) === 1;
  const esic = num(row.esi_applicable) === 1 && gross <= ESIC_GROSS_LIMIT;
  const pf_employee = pf ? Math.round(basic * PF_EMPLOYEE_RATE) : 0;
  const esic_employee = esic ? Math.round(gross * ESIC_EMPLOYEE_RATE) : 0;
  const employer_pf = pf ? Math.round(basic * PF_EMPLOYER_RATE) : 0;
  const employer_esi = esic ? Math.round(gross * ESIC_EMPLOYER_RATE) : 0;
  const admin_charges = pf ? Math.round(basic * PF_ADMIN_RATE) : 0;
  return {
    pf_employee,
    esic_employee,
    employer_pf,
    employer_esi,
    admin_charges,
    ctc: gross + employer_pf + employer_esi + admin_charges,
    net_in_hand: gross - pf_employee - esic_employee,
  };
}
