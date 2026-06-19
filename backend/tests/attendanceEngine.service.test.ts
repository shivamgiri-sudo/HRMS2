import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/mysql.js', () => ({
  db: {
    execute: vi.fn(),
  },
}));

vi.mock('../src/modules/inbox/inbox.service.js', () => ({
  inboxService: {
    createItem: vi.fn().mockResolvedValue({}),
  },
}));

import { db } from '../src/db/mysql.js';
import { inboxService } from '../src/modules/inbox/inbox.service.js';
import {
  attendanceEngineService,
  classifyCosecMinutes,
  classifyOperationsNetLogin,
  isOperationsExecutive,
  type EngineResult,
} from '../src/modules/wfm/attendance-engine.service.js';

const mockExecute = db.execute as ReturnType<typeof vi.fn>;
const mockCreateItem = inboxService.createItem as ReturnType<typeof vi.fn>;

describe('attendance engine policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue([[], []]);
  });

  it('limits net-login attendance to Operations Executive variants', () => {
    expect(isOperationsExecutive('OPERATIONS', 'EXECUTIVE')).toBe(true);
    expect(isOperationsExecutive('OPERATIONS', 'EXECUTIVE - VOICE')).toBe(true);
    expect(isOperationsExecutive('OPERATIONS', 'EXECUTIVE - BACKEND')).toBe(true);
    expect(isOperationsExecutive('OPERATIONS', 'SR. EXECUTIVE - VOICE')).toBe(false);
    expect(isOperationsExecutive('OPERATIONS', 'TEAM LEADER')).toBe(false);
    expect(isOperationsExecutive('INFORMATION TECHNOLOGY', 'EXECUTIVE')).toBe(false);
  });

  it('uses the strict eight-hour and four-hour net-login boundaries', () => {
    expect(classifyOperationsNetLogin(480)).toEqual({ status: 'present', lwpValue: 0 });
    expect(classifyOperationsNetLogin(479)).toEqual({ status: 'half_day', lwpValue: 0.5 });
    expect(classifyOperationsNetLogin(241)).toEqual({ status: 'half_day', lwpValue: 0.5 });
    expect(classifyOperationsNetLogin(240)).toEqual({ status: 'absent', lwpValue: 1 });
    expect(classifyOperationsNetLogin(239)).toEqual({ status: 'absent', lwpValue: 1 });
  });

  it('uses the strict nine-hour and four-hour COSEC boundaries', () => {
    expect(classifyCosecMinutes(540)).toEqual({ status: 'present', lwpValue: 0 });
    expect(classifyCosecMinutes(539)).toEqual({ status: 'half_day', lwpValue: 0.5 });
    expect(classifyCosecMinutes(241)).toEqual({ status: 'half_day', lwpValue: 0.5 });
    expect(classifyCosecMinutes(240)).toEqual({ status: 'absent', lwpValue: 1 });
    expect(classifyCosecMinutes(239)).toEqual({ status: 'absent', lwpValue: 1 });
  });

  it('notifies both employee and manager when COSEC is at least nine hours but net login is below eight', async () => {
    mockExecute
      .mockResolvedValueOnce([[
        {
          user_id: 'user-employee',
          reporting_manager_id: 'manager-employee-id',
          employee_code: 'MAS100',
          full_name: 'Test Employee',
        },
      ], []])
      .mockResolvedValueOnce([[{ user_id: 'user-manager' }], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[], []]);

    const result: EngineResult = {
      employeeId: 'employee-id',
      date: '2026-06-14',
      processId: null,
      branchId: null,
      source: 'dialler',
      sourceSystem: 'apr.ReportDate',
      sourceRecordDate: '2026-06-14',
      sourceReference: 'MAS100',
      diallerMinutes: 479,
      biometricMinutes: 540,
      rawMinutes: 479,
      status: 'half_day',
      lwpValue: 0.5,
      lateMark: 0,
      lateByMinutes: 0,
      ruleConfigId: null,
    };

    await attendanceEngineService.checkAndNotifyBiometricMismatch(
      'employee-id',
      '2026-06-14',
      result
    );

    expect(mockCreateItem).toHaveBeenCalledTimes(2);
    expect(mockCreateItem).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-employee',
      type: 'attendance_validation',
      priority: 'high',
    }));
    expect(mockCreateItem).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-manager',
      type: 'attendance_validation',
      priority: 'high',
    }));
  });

  it('does not create duplicate mismatch notifications for the same employee and date', async () => {
    mockExecute
      .mockResolvedValueOnce([[
        {
          user_id: 'user-employee',
          reporting_manager_id: null,
          employee_code: 'MAS100',
          full_name: 'Test Employee',
        },
      ], []])
      .mockResolvedValueOnce([[{ id: 'existing-notification' }], []]);

    await attendanceEngineService.checkAndNotifyBiometricMismatch(
      'employee-id',
      '2026-06-14',
      {
        employeeId: 'employee-id',
        date: '2026-06-14',
        processId: null,
        branchId: null,
        source: 'dialler',
        sourceSystem: 'apr.ReportDate',
        sourceRecordDate: '2026-06-14',
        sourceReference: 'MAS100',
        diallerMinutes: 200,
        biometricMinutes: 600,
        rawMinutes: 200,
        status: 'absent',
        lwpValue: 1,
        lateMark: 0,
        lateByMinutes: 0,
        ruleConfigId: null,
      }
    );

    expect(mockCreateItem).not.toHaveBeenCalled();
  });
});
