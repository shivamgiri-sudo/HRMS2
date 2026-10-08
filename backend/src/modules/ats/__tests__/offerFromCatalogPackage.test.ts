import { describe, it, expect, vi, beforeEach } from 'vitest';

const execute = vi.fn();
vi.mock('../../../db/mysql.js', () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));

import { componentsFromCatalogPackage } from '../ats.onboarding.service.js';

// A catalog row as MySQL returns it (DECIMAL columns as strings).
const PKG = {
  id: 'pkg-1', active_status: 1, band_code: 'B', package_amount: '20000.00',
  basic: '7376.67', hra: '2950.67', conveyance: '1600.00', special_allowance: '5899.86',
  other_allowance: '0.00', bonus: '614.48', lta: '0.00', portfolio: '0.00', medical: '0.00', pli: '0.00',
  gross: '18441.68', epf_employee: '885.20', esic_employee: '138.31', professional_tax: '0.00',
  net_in_hand: '17418.17', epf_employer: '885.20', esic_employer: '599.35', admin_charges: '73.77', ctc: '20000.00',
};

describe('offer saved from a catalog package', () => {
  beforeEach(() => execute.mockReset());

  it('copies the stored components verbatim and never adds gratuity', async () => {
    execute.mockResolvedValueOnce([[PKG]]);
    const c = await componentsFromCatalogPackage('pkg-1', 20000, true, true);
    expect(c).toEqual({
      offered_ctc: 20000, gross: 18441.68, basic: 7376.67, hra: 2950.67, conveyance: 1600, da: 0,
      special_allowance: 5899.86, other_allowance: 0, bonus: 614.48,
      pf_employee: 885.2, pf_employer: 885.2, esic_employee: 138.31, esic_employer: 599.35,
      professional_tax: 0, gratuity: 0, admin_charges: 73.77, net_in_hand: 17418.17,
    });
    expect(String(execute.mock.calls[0][0])).toMatch(/active_status = 1/);
  });

  it('refuses a retired or unknown package instead of recalculating', async () => {
    execute.mockResolvedValueOnce([[]]);
    await expect(componentsFromCatalogPackage('gone', 20000, true, true)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('refuses a CTC that does not match the package', async () => {
    execute.mockResolvedValueOnce([[PKG]]);
    await expect(componentsFromCatalogPackage('pkg-1', 21000, true, true)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('refuses a package that deducts PF/ESIC for an opted-out candidate', async () => {
    execute.mockResolvedValueOnce([[PKG]]);
    await expect(componentsFromCatalogPackage('pkg-1', 20000, false, true)).rejects.toThrow(/PF/);
    execute.mockResolvedValueOnce([[PKG]]);
    await expect(componentsFromCatalogPackage('pkg-1', 20000, true, false)).rejects.toThrow(/ESI/);
  });

  it('keeps components adding up to gross when the package carries lta/medical', async () => {
    execute.mockResolvedValueOnce([[{ ...PKG, special_allowance: '5399.86', lta: '300.00', medical: '200.00' }]]);
    const c = await componentsFromCatalogPackage('pkg-1', 20000, true, true);
    expect(c.other_allowance).toBe(500);
    expect(c.basic + c.hra + c.conveyance + c.special_allowance + c.other_allowance + c.bonus).toBeCloseTo(c.gross, 2);
  });
});
