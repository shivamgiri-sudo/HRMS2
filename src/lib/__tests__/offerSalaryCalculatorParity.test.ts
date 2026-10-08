import { describe, it, expect } from 'vitest';
import { calcFromCtc } from '../salaryCalculator';
import { calculateSalary } from '../../../backend/src/modules/ats/salary.calculator';

/**
 * The onboarding offer form (Payroll HR) and the Salary Package page (Payroll Head)
 * must produce the same components for the same inputs. The offer is calculated and
 * saved server-side (backend/src/modules/ats/salary.calculator.ts), the package page
 * uses src/lib/salaryCalculator.ts; this runs both over a grid and requires equality.
 */
describe('offer calculator == Salary Package page calculator', () => {
  const ctcs = [8000, 12345.67, 15000, 20000, 21700, 22500, 30000, 55000, 150000];
  const splits: [number, number][] = [[40, 40], [50, 50], [100, 0], [45, 40], [33.33, 50]];
  const flags: [boolean, boolean][] = [[true, true], [true, false], [false, true], [false, false]];

  for (const monthly of ctcs) {
    for (const [basicPct, hraPct] of splits) {
      for (const [pf, esi] of flags) {
        it(`CTC ${monthly} basic ${basicPct}% hra ${hraPct}% pf=${pf} esi=${esi}`, async () => {
          const ref = calcFromCtc(monthly, { includePf: pf, includeEsic: esi, basicPct, hraPct });
          const off = await calculateSalary(monthly * 12, basicPct, hraPct, false, undefined, pf, esi);
          expect(off).toMatchObject({
            offered_ctc: ref.ctc,
            gross: ref.gross,
            basic: ref.basic,
            hra: ref.hra,
            conveyance: ref.conveyance,
            special_allowance: ref.special_allowance,
            other_allowance: ref.other_allowance,
            bonus: ref.bonus,
            pf_employee: ref.epf_employee,
            pf_employer: ref.epf_employer,
            esic_employee: ref.esic_employee,
            esic_employer: ref.esic_employer,
            admin_charges: ref.admin_charges,
            net_in_hand: ref.net_in_hand,
          });
        });
      }
    }
  }

  it('gratuity is not part of the offer package', async () => {
    const off = await calculateSalary(20000 * 12, 40, 40, false);
    expect(off.gratuity).toBe(0);
    // CTC is gross + employer PF + employer ESIC + admin -- nothing else.
    expect(off.offered_ctc).toBeCloseTo(off.gross + off.pf_employer + off.esic_employer + off.admin_charges, 2);
    // Bonus sits inside gross, as on every catalog package.
    expect(off.basic + off.hra + off.conveyance + off.special_allowance + off.bonus).toBeCloseTo(off.gross, 1);
  });
});
