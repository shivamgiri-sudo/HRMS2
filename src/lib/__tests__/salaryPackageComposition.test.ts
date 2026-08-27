import { describe, expect, it } from 'vitest';
import { calcFromCtc, calcFromInHand, ADMIN_RATE } from '@/lib/salaryCalculator';
import { earningRows, otherDeductionRows, employerCostRows } from '@/lib/salaryComponentRows';
import { isPfApplicable, isEsicApplicable, pfYesNo, esicYesNo } from '@/lib/salaryEligibility';

/**
 * The package builder's arithmetic and the row lists every salary screen renders from.
 *
 * The reference figures below are not invented — they are read off live
 * salary_package_master rows, which is the whole point. The builder had drifted away from
 * the catalog it feeds (admin charges at 1.01% vs the catalog's 1.00%, bonus defaulted
 * off while 229 of the 230 populated rows carry it), so "matches a real package" is the
 * property worth pinning, not "matches whatever the code currently does".
 */

const OPTS = { includePf: true, includeEsic: true, basicPct: 40, hraPct: 40 };

describe('admin charges', () => {
  it('is 1% of PF wages, matching every populated catalog row', () => {
    expect(ADMIN_RATE).toBe(0.01);
  });

  it('reproduces the catalog: basic 3,000 -> ₹30, basic 3,700 -> ₹37, basic 8,000 -> ₹80', () => {
    // Live salary_package_master rows (band C at 6,463 and 6,843, and the band the
    // Salary Review screenshot came from). At 1.01% these would be ₹30.30 / ₹37.37 / ₹80.80,
    // which is what made the builder disagree with the catalog it feeds.
    for (const [basic, expected] of [[3000, 30], [3700, 37], [8000, 80]] as const) {
      expect(Math.round(basic * ADMIN_RATE)).toBe(expected);
    }
  });

  it('is charged on the basic the builder itself derived', () => {
    const pkg = calcFromCtc(16588, OPTS);
    expect(pkg.admin_charges).toBeCloseTo(pkg.basic * 0.01, 2);
  });

  it('is not charged when PF is off', () => {
    expect(calcFromCtc(20000, { ...OPTS, includePf: false }).admin_charges).toBe(0);
  });
});

describe('statutory bonus', () => {
  it('is included by default — it is part of CTC', () => {
    expect(calcFromCtc(16588, OPTS).bonus).toBeGreaterThan(0);
    expect(calcFromInHand(13986, OPTS).bonus).toBeGreaterThan(0);
  });

  it('is 8.33% of basic', () => {
    const pkg = calcFromCtc(16588, OPTS);
    expect(pkg.bonus).toBeCloseTo(pkg.basic * 0.0833, 1);
  });

  it('sits INSIDE gross, exactly as the catalog stores it', () => {
    // Live row: basic 8,000 + hra 4,793 + conveyance 1,600 + bonus 666 = gross 15,059.
    const pkg = calcFromCtc(16588, OPTS);
    const earnings = pkg.basic + pkg.hra + pkg.conveyance + pkg.bonus + pkg.special_allowance;
    expect(earnings).toBeCloseTo(pkg.gross, 0);
  });

  it('can still be switched off explicitly', () => {
    expect(calcFromCtc(16588, { ...OPTS, includeBonus: false }).bonus).toBe(0);
  });

  it('turning it off does not change gross — it moves money to special allowance', () => {
    const withBonus = calcFromCtc(16588, OPTS);
    const without = calcFromCtc(16588, { ...OPTS, includeBonus: false });
    expect(without.gross).toBeCloseTo(withBonus.gross, 2);
    expect(without.special_allowance).toBeCloseTo(withBonus.special_allowance + withBonus.bonus, 1);
  });
});

describe('earningRows', () => {
  it('always shows the three core earnings, even at zero', () => {
    const labels = earningRows({ basic: 0, hra: 0, conveyance: 0 }).map((r) => r.label);
    expect(labels).toEqual(['Basic', 'HRA', 'Conveyance']);
  });

  it('adds a component only when it carries money', () => {
    const labels = earningRows({
      basic: 8000, hra: 4793, conveyance: 1600, bonus: 666,
      lta: 0, portfolio: 0, medical: 0, pli: 0, special_allowance: 0, other_allowance: 0,
    }).map((r) => r.label);

    expect(labels).toContain('Bonus (8.33%)');
    expect(labels).not.toContain('LTA');
    expect(labels).not.toContain('PLI');
  });

  it('reads DECIMAL columns that arrive as strings over JSON', () => {
    const rows = earningRows({ basic: '8000.00', hra: '4793.00', conveyance: '1600.00', bonus: '666.00' });
    expect(rows.find((r) => r.label === 'Bonus (8.33%)')?.value).toBe(666);
  });

  it('the visible earnings add up to the gross beside them', () => {
    const pkg = { basic: 8000, hra: 4793, conveyance: 1600, bonus: 666, gross: 15059 };
    const sum = earningRows(pkg).reduce((total, row) => total + row.value, 0);
    expect(sum).toBe(pkg.gross);
  });
});

describe('employerCostRows — one row, three different column names', () => {
  it.each([
    ['ats_employment_offer', { pf_employer: 960, esic_employer: 489 }],
    ['salary_package_master', { epf_employer: 960, esic_employer: 489 }],
    ['salary_component_assignments', { employer_pf: 960, employer_esi: 489 }],
  ])('resolves %s', (_source, row) => {
    const rows = employerCostRows(row);
    expect(rows.find((r) => r.label === 'PF (Employer)')?.value).toBe(960);
    expect(rows.find((r) => r.label === 'ESIC (Employer)')?.value).toBe(489);
  });

  it('omits employer lines that are zero', () => {
    expect(employerCostRows({ epf_employer: 0, esic_employer: 0, admin_charges: 80 }))
      .toEqual([{ label: 'Admin Charges (1%)', value: 80 }]);
  });
});

describe('otherDeductionRows', () => {
  it('shows professional tax only where the state levies it', () => {
    expect(otherDeductionRows({ professional_tax: 200 })).toEqual([{ label: 'Professional Tax', value: 200 }]);
    expect(otherDeductionRows({ professional_tax: 0 })).toEqual([]);
  });
});

describe('PF / ESIC eligibility', () => {
  it('reads the flag, not the deduction amount — the 3,577-row NULL case', () => {
    // The shape that made the page say "No": enrolled, but pf_employee never backfilled.
    const row = { pf_applicable: 1, esi_applicable: 1, pf_employee: null, esic_employee: null };
    expect(pfYesNo(row)).toBe('Yes');
    expect(esicYesNo(row)).toBe('Yes');
  });

  it('says No when the flag says No, even if an amount lingers', () => {
    expect(isPfApplicable({ pf_applicable: 0, pf_employee: 960 })).toBe(false);
    expect(isEsicApplicable({ esi_applicable: 0, esic_employee: 113 })).toBe(false);
  });

  it('falls back to the amount only when the flag is absent (pre-migration rows)', () => {
    expect(isPfApplicable({ pf_employee: 960 })).toBe(true);
    expect(isPfApplicable({ employer_pf: 960 })).toBe(true);
    expect(isPfApplicable({ pf_employee: 0 })).toBe(false);
  });

  it('handles a missing row without throwing', () => {
    expect(pfYesNo(null)).toBe('No');
    expect(esicYesNo(undefined)).toBe('No');
  });
});
