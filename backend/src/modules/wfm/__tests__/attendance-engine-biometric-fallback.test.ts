import { describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../../../db/mysql.js', () => ({ db: { execute, query: execute } }));

import { attendanceEngineService } from '../attendance-engine.service.js';

describe('getBiometricEvidence integration_biometric_daily fallback', () => {
  it('matches the employee code via an indexable IN(...) list (not OR) and maps the row', async () => {
    const seen: string[] = [];
    execute.mockImplementation(async (sql: string) => {
      seen.push(sql);
      if (sql.includes('wfm_attendance_session')) return [[]];
      if (sql.includes('attendance_feature_config')) return [[]];
      if (sql.includes('integration_biometric_daily')) {
        return [[{ minutes: 540, source_system: 'integration:cosec', source_reference: '42' }]];
      }
      return [[]];
    });
    const res = await (attendanceEngineService as any).getBiometricEvidence('emp-1', '2026-09-10');
    expect(res).toEqual({ minutes: 540, sourceSystem: 'integration:cosec', sourceReference: '42' });
    const q = seen.find((s) => s.includes('integration_biometric_daily'))!;
    expect(q).toMatch(/ibd\.employee_code IN \(e\.employee_code, e\.biometric_code\)/);
    expect(q).not.toMatch(/ibd\.employee_code = e\.employee_code OR/);
  });
});
