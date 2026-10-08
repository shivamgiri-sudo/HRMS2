import { describe, it, expect, vi, beforeEach } from 'vitest';

const executeMock = vi.fn();
vi.mock('../../../db/mysql.js', () => ({
  db: { execute: (...args: unknown[]) => executeMock(...args) },
}));

import { resolveDayThresholds } from '../day-threshold-rule.service.js';

describe('day-threshold-rule.service', () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  it('resolves to the unconstrained Day_Threshold_Rule when nothing more specific matches', async () => {
    executeMock
      .mockResolvedValueOnce([
        [
          {
            id: 'default-thresholds',
            full_day_minutes: 540,
            half_day_minutes: 270,
            grace_minutes: 10,
            effective_from: '2026-01-01',
            created_at: '2026-01-01 00:00:00',
          },
        ],
      ])
      .mockResolvedValueOnce([[]]);

    const result = await resolveDayThresholds(
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

    expect(result).toEqual({
      fullDayMinutes: 540,
      halfDayMinutes: 270,
      graceMinutes: 10,
      decidingRuleId: 'default-thresholds',
    });
  });
});
