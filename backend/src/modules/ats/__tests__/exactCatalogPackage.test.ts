import { describe, it, expect, vi, beforeEach } from 'vitest';

const execute = vi.fn();
vi.mock('../../../db/mysql.js', () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));

import { findExactCatalogPackageId } from '../band-package-ratio.service.js';

// Band F CTC 13,250: gross = basic = CTC, no bonus/conveyance/PF/ESIC/admin (the 63694C package).
const row = (id: string, over: Record<string, string> = {}) => ({
  id, gross: '13250', basic: '13250', hra: '0', conveyance: '0', bonus: '0', special_allowance: '0',
  epf_employee: '0', esic_employee: '0', epf_employer: '0', esic_employer: '0', admin_charges: '0', net_in_hand: '13250', ...over,
});

describe('findExactCatalogPackageId', () => {
  beforeEach(() => execute.mockReset());

  it('returns the package when the band and CTC match exactly one distinct package', async () => {
    execute.mockResolvedValueOnce([[row('a')]]);
    expect(await findExactCatalogPackageId('F', 13250)).toBe('a');
    expect(String(execute.mock.calls[0][0])).toMatch(/active_status = 1/);
  });

  it('accepts several copies (branch / cost centre) when their components are identical', async () => {
    execute.mockResolvedValueOnce([[row('a'), row('b')]]);
    expect(await findExactCatalogPackageId('F', 13250)).toBe('a');
  });

  it('returns null when same band and CTC carry different components (ambiguous)', async () => {
    execute.mockResolvedValueOnce([[row('a'), row('b', { epf_employee: '1000', net_in_hand: '12250' })]]);
    expect(await findExactCatalogPackageId('F', 13250)).toBeNull();
  });

  it('returns null when nothing matches, or the band or CTC is unusable', async () => {
    execute.mockResolvedValueOnce([[]]);
    expect(await findExactCatalogPackageId('F', 13251)).toBeNull();
    expect(await findExactCatalogPackageId(null, 13250)).toBeNull();
    expect(await findExactCatalogPackageId('F', 0)).toBeNull();
  });
});
