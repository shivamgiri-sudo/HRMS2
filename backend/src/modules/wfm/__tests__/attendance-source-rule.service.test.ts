import { describe, it, expect, vi, beforeEach } from 'vitest';

const executeMock = vi.fn();
vi.mock('../../../db/mysql.js', () => ({
  db: { execute: (...args: unknown[]) => executeMock(...args) },
}));

import {
  loadActiveWindowedRules,
  resolveAttendanceSource,
} from '../attendance-source-rule.service.js';

describe('attendance-source-rule.service', () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  it('loadActiveWindowedRules assembles rule rows with their dimension_value children into Sets', async () => {
    executeMock
      .mockResolvedValueOnce([
        [
          {
            id: 'rule-1',
            attendance_source: 'dialler',
            effective_from: '2026-06-01',
            created_at: '2026-06-01 10:00:00',
          },
        ],
      ])
      .mockResolvedValueOnce([
        [
          { rule_id: 'rule-1', dimension: 'process', value_id: 'proc-voice' },
          { rule_id: 'rule-1', dimension: 'department', value_id: 'dept-ops' },
          { rule_id: 'rule-1', dimension: 'department', value_id: 'dept-ops-alt' },
        ],
      ]);

    const rules = await loadActiveWindowedRules('2026-07-15');

    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe('rule-1');
    expect(rules[0].attendanceSource).toBe('dialler');
    expect(rules[0].dimensionValues.process).toEqual(new Set(['proc-voice']));
    expect(rules[0].dimensionValues.department).toEqual(new Set(['dept-ops', 'dept-ops-alt']));
    expect(rules[0].dimensionValues.cost_centre).toBeUndefined();
  });

  it('resolveAttendanceSource returns the resolved source and deciding rule id', async () => {
    executeMock
      .mockResolvedValueOnce([
        [
          {
            id: 'system-default',
            attendance_source: 'biometric',
            effective_from: '2026-01-01',
            created_at: '2026-01-01 00:00:00',
          },
          {
            id: 'rule-voice-dialler',
            attendance_source: 'dialler',
            effective_from: '2026-06-01',
            created_at: '2026-06-01 10:00:00',
          },
        ],
      ])
      .mockResolvedValueOnce([
        [{ rule_id: 'rule-voice-dialler', dimension: 'process', value_id: 'proc-voice' }],
      ]);

    const result = await resolveAttendanceSource(
      {
        costCentreId: null,
        processId: 'proc-voice',
        branchId: null,
        departmentId: null,
        designationId: null,
        employmentProfile: null,
      },
      '2026-07-15',
    );

    expect(result.attendanceSource).toBe('dialler');
    expect(result.decidingRuleId).toBe('rule-voice-dialler');
  });
});
