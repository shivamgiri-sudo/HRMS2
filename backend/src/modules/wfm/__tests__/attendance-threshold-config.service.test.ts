import { describe, it, expect, vi, beforeEach } from 'vitest';

const executeMock = vi.fn();
vi.mock('../../../db/mysql.js', () => ({
  db: { execute: (...args: unknown[]) => executeMock(...args) },
}));

import {
  resolveThreshold,
  resolveDualReviewCeiling,
  DEFAULT_THRESHOLD_MINUTES,
} from '../attendance-threshold-config.service.js';

describe('attendance-threshold-config.service', () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  it('applies the 480-minute default (criterion 5.5) when no apr_corroboration rule is configured', async () => {
    executeMock.mockResolvedValueOnce([[]]); // no rows for this threshold_kind at all

    const minutes = await resolveThreshold(
      'apr_corroboration',
      {
        costCentreId: null,
        processId: null,
        branchId: null,
        departmentId: null,
        designationId: null,
        employmentProfile: null,
      },
      '2026-07-15',
    );

    expect(minutes).toBe(480);
    expect(DEFAULT_THRESHOLD_MINUTES.apr_corroboration).toBe(480);
    expect(DEFAULT_THRESHOLD_MINUTES.variance_tolerance).toBe(60);
    expect(DEFAULT_THRESHOLD_MINUTES.floor_absence_ceiling).toBe(60);
  });

  it('resolveDualReviewCeiling falls back to 100 when no row matches (criterion 6.10)', async () => {
    executeMock.mockResolvedValueOnce([[]]); // exact (branch, pay_month) — no match
    executeMock.mockResolvedValueOnce([[]]); // (branch, NULL) — no match
    executeMock.mockResolvedValueOnce([[]]); // (NULL, pay_month) — no match

    const ceiling = await resolveDualReviewCeiling('branch-1', '2026-07');

    expect(ceiling).toBe(100);
  });

  it('resolveDualReviewCeiling prefers an exact branch+pay_month match', async () => {
    executeMock.mockResolvedValueOnce([[{ ceiling_value: 150 }]]);

    const ceiling = await resolveDualReviewCeiling('branch-1', '2026-07');

    expect(ceiling).toBe(150);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });
});
