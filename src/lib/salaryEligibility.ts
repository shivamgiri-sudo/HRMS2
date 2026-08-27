/**
 * "Is this employee on PF / ESIC?" — read the flag, never the amount.
 *
 * salary_component_assignments carries BOTH a boolean eligibility flag
 * (pf_applicable / esi_applicable) and a deduction amount (pf_employee /
 * esic_employee). Screens that answered the question from the amount reported
 * "No" for thousands of enrolled employees, because the amount columns were
 * added later (migration 445) and were never backfilled:
 *
 *   active assignments  4,290
 *   pf_employee IS NULL 3,577   pf_applicable = 1  3,124
 *   esic_employee > 0     712   esi_applicable = 1 2,376
 *
 * So the flag is the answer and the amount is only ever a display value. The
 * amount is still consulted as a fallback for rows written before the flags
 * existed, where a non-zero deduction is itself proof of enrolment.
 */

export interface SalaryEligibilityRow {
  pf_applicable?: number | boolean | null;
  esi_applicable?: number | boolean | null;
  pf_employee?: number | string | null;
  esic_employee?: number | string | null;
  employer_pf?: number | string | null;
  employer_esi?: number | string | null;
}

const truthyFlag = (v: unknown) => v === 1 || v === true || v === '1';
const positive = (v: unknown) => Number(v ?? 0) > 0;

export function isPfApplicable(sc: SalaryEligibilityRow | null | undefined): boolean {
  if (!sc) return false;
  if (sc.pf_applicable != null) return truthyFlag(sc.pf_applicable);
  return positive(sc.pf_employee) || positive(sc.employer_pf);
}

export function isEsicApplicable(sc: SalaryEligibilityRow | null | undefined): boolean {
  if (!sc) return false;
  if (sc.esi_applicable != null) return truthyFlag(sc.esi_applicable);
  return positive(sc.esic_employee) || positive(sc.employer_esi);
}

export const pfYesNo   = (sc: SalaryEligibilityRow | null | undefined) => (isPfApplicable(sc) ? 'Yes' : 'No');
export const esicYesNo = (sc: SalaryEligibilityRow | null | undefined) => (isEsicApplicable(sc) ? 'Yes' : 'No');
